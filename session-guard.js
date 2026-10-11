
(function () {
  "use strict";

  const NOTICE_KEY = "sessionNotice";      // login.html reads this and shows it
  const CHECK_EVERY_MS = 60 * 1000;

  const MSG = {
    network: "Can't reach the server. Check your internet connection and try again.",
    expired: "Your session has expired. Please log in again.",
    generic: "Something went wrong. Please try again."
  };

  let watching = false;
  let leaving = false; 

  function errText(err) {
    return String((err && (err.message || err.error_description)) || err || "").toLowerCase();
  }

  function isNetworkError(err) {
    if (!err) return false;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    const t = errText(err);
    return (
      err.name === "AuthRetryableFetchError" ||
      err.status === 0 ||
      t.includes("failed to fetch") ||
      t.includes("fetch failed") ||
      t.includes("networkerror") ||
      t.includes("network request failed") ||
      t.includes("load failed")
    );
  }

  function isSessionError(err) {
    if (!err || isNetworkError(err)) return false;
    const t = errText(err);
    return (
      err.name === "AuthSessionMissingError" ||
      err.status === 401 ||
      err.code === "PGRST301" ||
      t.includes("jwt expired") ||
      t.includes("invalid jwt") ||
      t.includes("invalid refresh token") ||
      t.includes("refresh token not found") ||
      t.includes("auth session missing") ||
      t.includes("session missing")
    );
  }

  function friendlyMessage(err, fallback) {
    if (isNetworkError(err)) return MSG.network;
    if (isSessionError(err)) return MSG.expired;
    return fallback || MSG.generic;
  }

  /* ---------- on-screen messages ---------- */

  function showBanner(message, opts) {
    opts = opts || {};
    let el = document.getElementById("sg-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "sg-banner";
      el.setAttribute("role", "alert");
      el.style.cssText =
        "position:fixed;z-index:100;top:0;left:0;right:0;padding:12px 16px;text-align:center;" +
        "font:700 0.95rem system-ui,sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3);";
      document.body.prepend(el);
    }
    el.style.background = opts.type === "info" ? "#1f5f9c" : "#9d3631";
    el.textContent = message;
    if (opts.retry) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Try again";
      btn.style.cssText =
        "margin-left:12px;padding:4px 12px;font:inherit;color:#9d3631;background:#fff;border:0;border-radius:4px;cursor:pointer;";
      btn.addEventListener("click", opts.retry);
      el.append(btn);
    }
    el.hidden = false;
  }

  function hideBanner() {
    const el = document.getElementById("sg-banner");
    if (el) el.hidden = true;
  }

  // Full-screen message used when a page cannot load at all (so the person never sees a blank screen).
  function showBlocking(title, message) {
    let el = document.getElementById("sg-blocking");
    if (el) el.remove();
    el = document.createElement("div");
    el.id = "sg-blocking";
    el.setAttribute("role", "alert");
    el.style.cssText =
      "position:fixed;z-index:200;inset:0;display:flex;align-items:center;justify-content:center;" +
      "padding:16px;background:rgba(8,26,44,.94);font-family:system-ui,sans-serif;";

    const card = document.createElement("div");
    card.style.cssText =
      "max-width:460px;width:100%;padding:32px;background:#fff;border-radius:8px;text-align:center;color:#172536;";

    const h = document.createElement("h2");
    h.textContent = title;
    h.style.margin = "0 0 12px";

    const p = document.createElement("p");
    p.textContent = message;
    p.style.cssText = "margin:0 0 24px;line-height:1.5;color:#536273;";

    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.style.cssText =
      "padding:10px 20px;margin:0 6px;font:800 1rem inherit;color:#fff;background:#1f5f9c;border:0;border-radius:4px;cursor:pointer;";
    retry.addEventListener("click", () => window.location.reload());

    const back = document.createElement("a");
    back.href = "login.html";
    back.textContent = "Back to log in";
    back.style.cssText =
      "display:inline-block;padding:10px 20px;margin:0 6px;font-weight:800;color:#122b45;border:1px solid #8197aa;border-radius:4px;text-decoration:none;";

    card.append(h, p, retry, back);
    el.append(card);
    document.body.append(el);
  }

  /* ---------- sign-out helpers ---------- */

  function clearLocalAuth() {
    // signOut() can fail when offline and then leaves the token behind, so clear it ourselves too.
    try {
      Object.keys(localStorage)
        .filter((k) => /^sb-.*-auth-token$/.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    try {
      const saved = JSON.parse(localStorage.getItem("libraryVisitDesk") || "{}");
      saved.staff = null;
      localStorage.setItem("libraryVisitDesk", JSON.stringify(saved));
    } catch { /* ignore */ }
  }

  async function safeSignOut() {
    try {
      if (typeof db !== "undefined") {
        await Promise.race([db.auth.signOut(), new Promise((resolve) => setTimeout(resolve, 2500))]);
      }
    } catch { /* ignore */ }
    clearLocalAuth();
  }

  // Session is over (expired, not active, signed out elsewhere): remember why, then go to the login page.
  async function endSession(message, redirect) {
    leaving = true;
    try { sessionStorage.setItem(NOTICE_KEY, message || MSG.expired); } catch { /* ignore */ }
    await safeSignOut();
    window.location.href = redirect || "login.html";
  }

  // Normal "Log out" button.
  async function logout(redirect) {
    leaving = true;
    await safeSignOut();
    window.location.href = redirect || "welcome.html";
  }

  /* ---------- keeping an eye on the session ---------- */

  async function checkNow() {
    if (leaving) return;
    try {
      const { data, error } = await db.auth.getSession(); // refreshes the token when it can
      if (error) throw error;
      if (!data.session) { endSession(MSG.expired); return; }
      hideBanner();
    } catch (err) {
      if (isSessionError(err)) endSession(MSG.expired);
      else if (isNetworkError(err)) showBanner(MSG.network, { retry: checkNow });
    }
  }

  function watch() {
    if (watching || typeof db === "undefined") return;
    watching = true;

    db.auth.onAuthStateChange((event) => {
      // Signed out in another tab, or the refresh token was rejected.
      // (Deferred: calling Supabase inside this callback can deadlock.)
      if (event === "SIGNED_OUT" && !leaving) {
        setTimeout(() => endSession("You were signed out. Please log in again."), 0);
      }
    });

    window.addEventListener("offline", () =>
      showBanner("You are offline. Changes can't be saved until the connection is back."));
    window.addEventListener("online", () => { hideBanner(); checkNow(); });
    setInterval(checkNow, CHECK_EVERY_MS);

    // Anything that slips through (a failed request nobody caught) still gets a clear message.
    window.addEventListener("unhandledrejection", (event) => {
      if (isNetworkError(event.reason)) showBanner(MSG.network);
      else if (isSessionError(event.reason)) endSession(MSG.expired);
    });
  }

  /* ---------- the main check every staff page runs first ---------- */

  function fail(err) {
    if (isSessionError(err)) { endSession(MSG.expired); return null; }
    showBlocking(
      isNetworkError(err) ? "Can't connect" : "Something went wrong",
      friendlyMessage(err, "We could not check your account. Please try again.")
    );
    return null;
  }

  function isAdminRole(role) {
    return String(role || "").toLowerCase().includes("admin");
  }

  /**
   * Returns { session, profile, isAdmin } when the person may use the page.
   * Returns null when it has already redirected / shown a message.
   * With { adminOnly: true } a non-admin gets { denied: true, profile } so the page can show "Admins only".
   */
  async function requireStaff(options) {
    options = options || {};
    if (typeof db === "undefined") {
      showBlocking("Can't connect", "The connection to the system could not be set up. Please reload the page.");
      return null;
    }

    let sessionResult;
    try { sessionResult = await db.auth.getSession(); } catch (err) { return fail(err); }
    if (sessionResult.error) return fail(sessionResult.error);

    const session = sessionResult.data.session;
    if (!session) { endSession("Please log in to continue."); return null; }

    let profileResult;
    try {
      profileResult = await db
        .from("profiles")
        .select("staff_id, full_name, role, status")
        .eq("id", session.user.id)
        .single();
    } catch (err) { return fail(err); }

    const { data: profile, error } = profileResult;
    if (error) {
      if (error.code === "PGRST116") { endSession("We could not find your staff account."); return null; }
      return fail(error);
    }
    if (!profile || profile.status !== "active") {
      endSession("Your account is not active. Contact the library admin.");
      return null;
    }

    watch();
    const result = { session, profile, isAdmin: isAdminRole(profile.role) };
    if (options.adminOnly && !result.isAdmin) return { ...result, denied: true };
    return result;
  }

  window.SessionGuard = {
    MESSAGES: MSG,
    NOTICE_KEY,
    isNetworkError,
    isSessionError,
    friendlyMessage,
    showBanner,
    hideBanner,
    showBlocking,
    endSession,
    logout,
    requireStaff,
    isAdminRole
  };
})();
