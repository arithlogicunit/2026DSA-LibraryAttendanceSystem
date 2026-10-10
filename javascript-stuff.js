const directory = {
  "L1": { name: "Vito, Dag John Paul M.", type: "Student" },
  "L2": { name: "Pineda, Christian James T.", type: "Student" },
  "L3": { name: "Lolin, Angeline M.", type: "Student" },
  "L4": { name: "Amongan, Shamille E.", type: "Student" },
  "S1": { name: "Jordan Reyes", type: "Staff" }
};

const emptyState = { staff: null, visits: [], log: [] };
let state = readState();

function readState() {
  try {
    return { ...emptyState, ...JSON.parse(sessionStorage.getItem("libraryVisitDesk")) };
  } catch {
    return { ...emptyState };
  }
}

function saveState() { sessionStorage.setItem("libraryVisitDesk", JSON.stringify(state)); }
function normaliseId(value) { return value.trim().toUpperCase(); }
function currentTime() { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()); }
function today() { return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()); }
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

function addLog(action, visit) {
  state.log.push({ time: currentTime(), action, id: visit.id, name: visit.name, staff: state.staff?.id || "Staff" });
}

function processVisit(id) {
  const person = directory[id];
  if (!person) {
    showScanResult({ success: false, eyebrow: "ID needs attention", title: "Unregistered ID", message: "This ID is not in the approved visitor directory. Follow your library’s visitor-registration process rather than creating a record here." });
    return;
  }
  const activeIndex = state.visits.findIndex((visit) => visit.id === id);
  if (activeIndex >= 0) {
    const [visit] = state.visits.splice(activeIndex, 1);
    addLog("Checked out", visit);
    saveState();
    showScanResult({ success: true, eyebrow: "Auto-detected: check-out", title: "Check-out recorded", message: `${visit.name} was checked out at ${currentTime()}. The event was added to today’s Report / Logs. Ready for the next scan.` });
    return;
  }
  const visit = { id, name: person.name, type: person.type, checkinTime: currentTime() };
  state.visits.push(visit);
  addLog("Checked in", visit);
  saveState();
  showScanResult({ success: true, eyebrow: "Auto-detected: check-in", title: "Check-in recorded", message: `${visit.name} checked in at ${visit.checkinTime}. Their visit is now visible in the Currently-In List. Ready for the next scan.` });
}

function setupHeader() {
  const sessionLabel = document.querySelector("#session-label");
  const logoutButton = document.querySelector("#logout-button");
  if (sessionLabel && state.staff) {
    sessionLabel.textContent = `Signed in: ${state.staff.id}`;
    sessionLabel.hidden = false;
  }
  if (logoutButton && state.staff) {
    logoutButton.hidden = false;
    logoutButton.addEventListener("click", () => {
      state = { ...emptyState };
      saveState();
      goTo("welcome.html");
    });
  }
}

function requireSession() {
  if (document.body.dataset.requiresSession === "true" && !state.staff) {
    goTo("login.html");
    return false;
  }
  return true;
}

function renderDashboard() {
  const count = document.querySelector("#active-count");
  const date = document.querySelector("#dashboard-date");
  if (count) count.textContent = state.visits.length;
  if (date) date.textContent = today();
}

function renderActiveTable() {
  const tbody = document.querySelector("#active-table-body");
  const empty = document.querySelector("#active-empty");
  const description = document.querySelector("#active-description");
  if (!tbody) return;
  tbody.innerHTML = "";
  state.visits.forEach((visit) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${visit.id}</td><td>${visit.name}</td><td>${visit.checkinTime}</td>`;
    tbody.append(row);
  });
  empty.hidden = state.visits.length !== 0;
  description.textContent = `${state.visits.length} active ${state.visits.length === 1 ? "visitor" : "visitors"}. Check out through the Scan ID page.`;
}

function renderLogTable() {
  const tbody = document.querySelector("#log-table-body");
  const empty = document.querySelector("#logs-empty");
  if (!tbody) return;
  tbody.innerHTML = "";
  [...state.log].reverse().forEach((event) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${event.time}</td><td>${event.action}</td><td>${event.id}</td><td>${event.name}</td><td>${event.staff}</td>`;
    tbody.append(row);
  });
  empty.hidden = state.log.length !== 0;
}

function setupLogin() {
  const form = document.querySelector("#login-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const staffId = normaliseId(data.get("staffId"));
    const password = data.get("password");
    const error = document.querySelector("#login-error");
    if (!staffId || password.length < 4) {
      error.hidden = false;
      return;
    }
    state.staff = { id: staffId, role: data.get("role") };
    saveState();
    goTo("dashboard.html");
  });
}

function setupScan() {
  const form = document.querySelector("#scan-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = normaliseId(new FormData(form).get("visitorId"));
    const error = document.querySelector("#scan-error");
    if (!id) { error.hidden = false; return; }
    processVisit(id);
  });
}

if (requireSession()) {
  setupHeader();
  setupLogin();
  setupScan();
  renderDashboard();
  renderActiveTable();
  renderLogTable();
}
