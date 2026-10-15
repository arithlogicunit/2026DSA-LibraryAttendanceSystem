// Supabase returns at most 1000 rows per request, so read page by page until a short page comes back.
// makeQuery() must build a new query with a stable order each time (one call per page).
async function fetchAllRows(makeQuery) {
  const PAGE = 1000;
  let all = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await makeQuery().range(start, start + PAGE - 1);
    if (error) return { data: null, error };
    all = all.concat(data);
    if (data.length < PAGE) return { data: all, error: null };
  }
}

// Patron lookup: a Map is a hash table.
// Loading from Supabase at startup is O(n) for n patrons, and it is refreshed every minute.
// patrons.get(id) / patrons.has(id) stay O(1) on average.
const patrons = new Map();

async function loadPatrons() {
  const { data, error } = await fetchAllRows(() =>
    db.from("patrons").select("id_number, full_name, type, status").order("id_number", { ascending: true }));
  if (error) { console.error("Could not load patrons", error); return false; }
  // Clear only after the fetch worked, so the Map is never empty while waiting for the network.
  patrons.clear();
  data.forEach((p) => patrons.set(p.id_number, { name: p.full_name, type: p.type, status: p.status }));
  return true;
}

// Rebuild "currently in" from the open_visits view: one row per person whose latest event is a
// check-in, however long ago (see supabase/migrations/20261016_open_visits_view.sql). So a visit left
// open over a weekend is still found, and autoCloseVisits can close it. O(v) for v open visits.
let visitsLoaded = false;   // true once state.visits came from the database on this page

async function loadVisits() {
  const { data, error } = await fetchAllRows(() =>
    db.from("open_visits").select("id_number, checkin_time").order("id_number", { ascending: true }));
  if (error) { console.error("Could not load visits", error); return false; }

  const visits = new Map();
  for (const row of data) {
    const id = row.id_number;
    const patron = patrons.get(id);
    visits.set(id, { id, name: patron ? patron.name : id, type: patron ? patron.type : "", checkinTime: row.checkin_time });
  }

  state.visits = visits;
  visitsLoaded = true;
  saveState();
  return true;
}

// Save one event to the database. recorded_by must be the signed-in user's own ID (RLS rule).
// closeReason ("auto" or "force") marks a check-out the visitor did not scan themselves,
// so the report can leave it out (see supabase/migrations/20261016_attendance_close_reason.sql).
async function saveEvent(eventType, id, eventTime, closeReason) {
  const row = {
    id_number: id,
    event_type: eventType,
    event_time: eventTime || nowISO(),
    recorded_by: state.staff?.uid
  };
  if (closeReason) row.close_reason = closeReason;
  const { error } = await db.from("attendance_logs").insert(row);
  if (error) { console.error("Could not save event", error); return false; }
  return true;
}

const emptyState = { staff: null, visits: [], log: [] };
let state = readState();


function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem("libraryVisitDesk")) || {};
    return {
      staff: saved.staff ?? null,
      visits: new Map((saved.visits || []).map((v) => [v.id, v])),
      log: saved.log || []
    };
  } catch {
    return { staff: null, visits: new Map(), log: [] };
  }
}


function saveState() {
  localStorage.setItem("libraryVisitDesk", JSON.stringify({ ...state, visits: [...state.visits.values()] }));
}
function normaliseId(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}
function currentTime() { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()); }
function today() { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()); }

function nowISO() { return new Date().toISOString(); }

function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(d);
}
function goTo(page) { window.location.href = page; }

function showScanResult(result) {
  const panel = document.querySelector("#scan-result");
  if (!panel) return;
  const icon = document.querySelector("#scan-result-icon");
  icon.textContent = result.success ? "✓" : "!";
  icon.classList.toggle("error", !result.success);
  document.querySelector("#scan-result-eyebrow").textContent = result.eyebrow;
  document.querySelector("#scan-result-title").textContent = result.title;
  document.querySelector("#scan-result-message").textContent = result.message;
  panel.hidden = false;
  const input = document.querySelector("#visit-id");
  input.value = "";
  window.requestAnimationFrame(() => input.focus());
}

function addLog(action, visit, by) {
  state.log.push({
    time: nowISO(), action, id: visit.id, name: visit.name,
    staff: by || state.staff?.id || "Staff",
    checkinTime: visit.checkinTime, type: visit.type
  });
}


// Staff action: check someone out who forgot to scan out. Saved to the database as a check_out.
async function forceCheckOut(id) {
  if (typeof can === "function" && !can(state.staff?.role, "force_checkout")) return;
  const visit = state.visits.get(id);
  if (!visit) return;
  if (!confirm(`Force check-out ${visit.name}?`)) return;

  if (!(await saveEvent("check_out", id, null, "force"))) {
    alert("Could not save the check-out to the database. Please try again.");
    return;
  }

  state.visits.delete(id);
  addLog("Force checked out", visit);
  saveState();
  renderDashboard();
  renderActiveTable();
}


// Library closing time (Manila). Visits still open at closing time are checked out automatically.
const CLOSING_HOUR = 19;
const CLOSING_MINUTE = 10;
const CLOSING_MINUTES = CLOSING_HOUR * 60 + CLOSING_MINUTE;


function manilaParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = Number(get("hour"));
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour, minutes: hour * 60 + Number(get("minute")) };
}


function isStale(visit) {
  const checkedIn = new Date(visit.checkinTime);
  if (isNaN(checkedIn)) return true;
  const then = manilaParts(checkedIn);
  const now = manilaParts(new Date());
  if (now.day > then.day) return true;
  return now.minutes >= CLOSING_MINUTES && then.minutes < CLOSING_MINUTES;
}

// The time an auto check-out is saved with: closing time on the day of the visit (Manila is UTC+8),
// so a visit closed the next morning still ends on the day it started.
// Someone who checked in after closing time is checked out one second after their check-in.
function autoCloseTime(visit) {
  const checkedIn = new Date(visit.checkinTime);
  if (isNaN(checkedIn)) return nowISO();
  const hh = String(CLOSING_HOUR).padStart(2, "0");
  const mm = String(CLOSING_MINUTE).padStart(2, "0");
  const closing = new Date(`${manilaParts(checkedIn).day}T${hh}:${mm}:00+08:00`);
  return (closing > checkedIn ? closing : new Date(checkedIn.getTime() + 1000)).toISOString();
}


// Check out every stale visit and save each one to the database. O(v) for v active visits.
// Only once state.visits was loaded from the database on this page; the saved copy may be out of date.
let autoClosing = false;

async function autoCloseVisits() {
  if (!visitsLoaded) return 0;
  if (autoClosing || !state.staff?.uid) return 0;
  autoClosing = true;
  let closed = 0;

  for (const [id, visit] of [...state.visits]) {
    if (!isStale(visit)) continue;
    if (await saveEvent("check_out", id, autoCloseTime(visit), "auto")) {
      state.visits.delete(id);
      addLog("Auto checked out", visit, state.staff.id);
      closed++;
    }
  }

  if (closed > 0) saveState();
  autoClosing = false;
  return closed;
}

// Check-in / check-out for one scanned ID. The database is written first; the screen updates only if that worked.
// patrons.get, visits.has, visits.get, visits.set and visits.delete are O(1) on average.
async function processVisit(id) {
  const person = patrons.get(id);

  if (!person) {
    showScanResult({
      success: false,
      eyebrow: "ID needs attention",
      title: "Unregistered ID",
      message: "This ID is not in the approved visitor directory. Follow your library's visitor-registration process rather than creating a record here."
    });
    return;
  }

  if (person.status !== "active") {
    showScanResult({
      success: false,
      eyebrow: "ID needs attention",
      title: "Inactive ID",
      message: `${person.name} is not active in the visitor directory. Please ask a librarian.`
    });
    return;
  }

  const inside = state.visits.has(id);
  const eventTime = nowISO();
  const saved = await saveEvent(inside ? "check_out" : "check_in", id, eventTime);

  if (!saved) {
    showScanResult({
      success: false,
      eyebrow: "Not saved",
      title: "Could not record this scan",
      message: "The scan was not saved to the database. Check the connection and try again."
    });
    return;
  }

  if (inside) {
    const visit = state.visits.get(id);
    state.visits.delete(id);
    addLog("Checked out", visit);
    saveState();
    showScanResult({
      success: true,
      eyebrow: "Auto-detected: check-out",
      title: "Check-out recorded",
      message: `${visit.name} was checked out at ${formatTime(eventTime)}. The event was added to today's Report / Logs. Ready for the next scan.`
    });
    return;
  }

  const visit = { id, name: person.name, type: person.type, checkinTime: eventTime };
  state.visits.set(id, visit);
  addLog("Checked in", visit);
  saveState();
  showScanResult({
    success: true,
    eyebrow: "Auto-detected: check-in",
    title: "Check-in recorded",
    message: `${visit.name} checked in at ${formatTime(visit.checkinTime)}. Their visit is now visible in the Currently-In List. Ready for the next scan.`
  });
}

function setupHeader() {
  const sessionLabel = document.querySelector("#session-label");
  const logoutButton = document.querySelector("#logout-button");
  if (sessionLabel && state.staff) {
    const role = String(state.staff.role || "");
    const roleText = role ? ` (${role.charAt(0).toUpperCase()}${role.slice(1)})` : "";
    sessionLabel.textContent = `Signed in: ${state.staff.id}${roleText}`;
    sessionLabel.hidden = false;
  }
  if (logoutButton && state.staff) {
    logoutButton.hidden = false;
    const logout = async () => {
      if (typeof db !== "undefined") await db.auth.signOut();
      state.staff = null;
      saveState();
      goTo("welcome.html");
    };
    // On a locked page (in-out.html), logging out also needs the password.
    logoutButton.addEventListener("click", () => (isExitLocked() ? askToLeave(logout) : logout()));
  }
}

// Real session check: needs a Supabase session AND an active profile.
async function requireSession() {
  if (document.body.dataset.requiresSession !== "true") return true;

  const reject = async () => {
    if (typeof db !== "undefined") await db.auth.signOut();
    state.staff = null;
    saveState();
    goTo("login.html");
    return false;
  };

  if (typeof db === "undefined") return reject();

  const { data } = await db.auth.getSession();
  if (!data.session) return reject();

  const { data: profile } = await db
    .from("profiles")
    .select("staff_id, role, status")
    .eq("id", data.session.user.id)
    .single();

  if (!profile || profile.status !== "active") return reject();

  // The role always comes from the database on every page load, never from localStorage.
  state.staff = { id: profile.staff_id, role: profile.role, uid: data.session.user.id };
  saveState();

  // Access module: block pages this role may not open (see access.js).
  if (typeof enforcePageAccess === "function" && !enforcePageAccess(profile.role)) return false;
  return true;
}

function addRow(tbody, values) {
  const row = document.createElement("tr");
  values.forEach((value) => {
    const td = document.createElement("td");
    td.textContent = value;
    row.append(td);
  });
  tbody.append(row);
}

function renderDashboard() {
  const count = document.querySelector("#active-count");
  const date = document.querySelector("#dashboard-date");
  if (count) count.textContent = state.visits.size;
  if (date) date.textContent = today();
}

// Render the Currently-In List. One pass over the Map: O(v) for v active visits.
function renderActiveTable() {
  const tbody = document.querySelector("#active-table-body");
  const empty = document.querySelector("#active-empty");
  const description = document.querySelector("#active-description");
  if (!tbody) return;
  tbody.innerHTML = "";
  const mayForceCheckOut = typeof can !== "function" || can(state.staff?.role, "force_checkout");
  state.visits.forEach((visit) => {
    addRow(tbody, [visit.id, visit.name, formatTime(visit.checkinTime)]);
    if (!mayForceCheckOut) return;

    const td = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button button-secondary";
    btn.textContent = "Force check-out";
    btn.addEventListener("click", () => forceCheckOut(visit.id));
    td.append(btn);
    tbody.lastElementChild.append(td);
  });
  const count = state.visits.size;
  empty.hidden = count !== 0;
  description.textContent = `${count} active ${count === 1 ? "visitor" : "visitors"}. Check out through the Scan ID page.`;
}

const EVENT_LABELS = { check_in: "Checked in", check_out: "Checked out", correction: "Correction" };

// Report / Logs: read today's events (Manila time) from the database, newest first.
async function renderLogTable() {
  const tbody = document.querySelector("#log-table-body");
  const empty = document.querySelector("#logs-empty");
  if (!tbody) return;

  const startOfToday = new Date(`${manilaParts(new Date()).day}T00:00:00+08:00`).toISOString();
  const { data, error } = await db
    .from("attendance_logs")
    .select("id_number, event_type, event_time, profiles!attendance_logs_recorded_by_fkey(staff_id)")
    .gte("event_time", startOfToday)
    .order("event_time", { ascending: false });

  tbody.innerHTML = "";

  if (error) {
    console.error("Could not load logs", error);
    empty.textContent = "Could not load the logs. Check the connection and try again.";
    empty.hidden = false;
    return;
  }

  data.forEach((row) => {
    const patron = patrons.get(row.id_number);
    addRow(tbody, [
      formatTime(row.event_time),
      EVENT_LABELS[row.event_type] || row.event_type,
      row.id_number,
      patron ? patron.name : "",
      row.profiles?.staff_id || "Staff"
    ]);
  });

  empty.textContent = "No visits have been recorded today.";
  empty.hidden = data.length !== 0;
}

function setupLogin() {
  const form = document.querySelector("#login-form");
  if (!form) return;
  const error = document.querySelector("#login-error");
  const button = form.querySelector('button[type="submit"]');

  // session-guard.js leaves a reason here when it ends a session (expired, not active, signed out elsewhere).
  try {
    const notice = sessionStorage.getItem("sessionNotice");
    if (notice) {
      sessionStorage.removeItem("sessionNotice");
      error.textContent = notice;
      error.hidden = false;
    }
  } catch { /* ignore */ }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;

    const data = new FormData(form);
    const staffId = normaliseId(data.get("staffId"));
    const password = String(data.get("password"));

    if (!staffId || !password) {
      error.textContent = "Enter your Staff ID and password.";
      error.hidden = false;
      return;
    }

    button.disabled = true;
    const result = await loginStaff(staffId, password);
    button.disabled = false;

    if (!result.ok) {
      error.textContent = result.message;
      error.hidden = false;
      return;
    }

    state.staff = { id: result.profile.staff_id, role: result.profile.role };
    saveState();
    goTo("dashboard.html");
  });
}

const lastScan = {};
const SCAN_COOLDOWN_MS = 3000;

function setupScan() {
  const form = document.querySelector("#scan-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const error = document.querySelector("#scan-error");
    const result = document.querySelector("#scan-result");
    error.hidden = true;
    result.hidden = true;

    const id = normaliseId(new FormData(form).get("visitorId"));
    if (!id) { error.hidden = false; return; }

    const now = Date.now();
    if (lastScan[id] && now - lastScan[id] < SCAN_COOLDOWN_MS) {
      showScanResult({
        success: false,
        eyebrow: "Duplicate scan",
        title: "Scanned too quickly",
        message: "This ID was just processed. Wait a few seconds before scanning it again."
      });
      return;
    }
    lastScan[id] = now;
    processVisit(id);
  });
}

// Exit lock (in-out.html, <body data-exit-lock="true">): leaving the scan page needs the
// signed-in staff member's password, so a visitor using the desk cannot open staff pages.
function isExitLocked() {
  return document.body.dataset.exitLock === "true";
}

let afterUnlock = null;   // what to do once the password is confirmed

function askToLeave(onUnlock) {
  const dialog = document.querySelector("#exit-dialog");
  if (!dialog || dialog.open) return;
  afterUnlock = onUnlock;
  document.querySelector("#exit-form").reset();
  document.querySelector("#exit-error").hidden = true;
  document.querySelector("#exit-description").textContent =
    `Enter the password for ${state.staff?.id || "the signed-in account"} to leave the check-in page.`;
  dialog.showModal();
  document.querySelector("#exit-password").focus();
}

// Same check as change-password.html: signing in again only works with the right password,
// and a wrong password leaves the current session as it is.
async function checkStaffPassword(password) {
  const { data } = await db.auth.getSession();
  const email = data.session?.user?.email;
  if (!email) return { ok: false, ended: true };
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (!error) return { ok: true };
  const offline = navigator.onLine === false || error.name === "AuthRetryableFetchError" || error.status === 0;
  return { ok: false, message: offline ? "Can't reach the server. Check the connection and try again." : "Wrong password." };
}

function setupExitLock() {
  if (!isExitLocked()) return;
  const dialog = document.querySelector("#exit-dialog");
  const form = document.querySelector("#exit-form");
  const password = document.querySelector("#exit-password");
  const error = document.querySelector("#exit-error");
  const confirmButton = document.querySelector("#exit-confirm");

  document.querySelector("#exit-button").addEventListener("click", () => askToLeave(() => goTo("dashboard.html")));
  document.querySelector("#exit-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    afterUnlock = null;
    document.querySelector("#visit-id").focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!password.value) {
      error.textContent = "Enter the password.";
      error.hidden = false;
      return;
    }

    confirmButton.disabled = true;
    const result = await checkStaffPassword(password.value);
    confirmButton.disabled = false;

    if (result.ended) { goTo("login.html"); return; }
    if (!result.ok) {
      error.textContent = result.message;
      error.hidden = false;
      password.value = "";
      password.focus();
      return;
    }
    const next = afterUnlock;
    dialog.close();
    if (next) next();
  });

  // Back button: keep one extra history entry so Back opens the password prompt instead of leaving.
  // Browsers only keep entries added after the person has clicked or typed, so add it on interaction.
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    history.pushState({ exitLock: true }, "", location.href);
  };
  window.addEventListener("pointerdown", arm);
  window.addEventListener("keydown", arm);
  window.addEventListener("popstate", () => {
    armed = false;
    askToLeave(() => goTo("dashboard.html"));
  });
}

requireSession().then(async (allowed) => {
  if (!allowed) return;
   if (document.body.dataset.requiresSession === "true") {
    await loadPatrons();
    await loadVisits();
  }

  setupHeader();
  if (typeof applyRoleUI === "function" && state.staff) applyRoleUI(state.staff.role);
  setupLogin();
  setupScan();
  setupExitLock();
  await autoCloseVisits();
  renderDashboard();
  renderActiveTable();

    setInterval(async () => {
    // Pick up patrons added or deactivated on the Profile pages (only on pages that need a login).
    if (document.body.dataset.requiresSession === "true") await loadPatrons();
    if ((await autoCloseVisits()) > 0) {
      renderDashboard();
      renderActiveTable();
      renderLogTable();
    }
  }, 60000);
});