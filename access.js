// Access module: roles, permissions, page guards.
//
// This file is the single place that says what each role may do (see docs/permission-table.md).
// It only controls what the SCREEN shows. The database (Row Level Security) is what really
// protects the data, so a staff member who types an admin URL or calls the API directly is
// still blocked there.
//
// How other modules use it:
//   - A page only admins may open:      <body data-requires-session="true" data-requires-permission="approve_staff">
//   - A button or link only admins see: <button data-requires-permission="export_reports">
//   - In JavaScript:                    if (can(state.staff.role, "manage_patrons")) { ... }

const PERMISSIONS = {
  admin: [
    "check_in_out", "undo_entry", "force_checkout",
    "view_currently_in", "view_reports",
    "export_reports", "manage_patrons", "approve_staff", "manage_roles"
  ],
  staff: [
    "check_in_out", "undo_entry", "force_checkout",
    "view_currently_in", "view_reports"
  ]
};

const ROLE_LABELS = { admin: "Admin", staff: "Staff" };

// Permission lookup: an array scan over at most 9 entries, so effectively O(1).
// An unknown or missing role gets nothing.
function can(role, action) {
  const allowed = PERMISSIONS[role];
  return Array.isArray(allowed) && allowed.includes(action);
}

// Page guard. If the page asks for a permission the role lacks, go back to the dashboard.
// Returns true when the page may stay open.
function enforcePageAccess(role) {
  const needed = document.body.dataset.requiresPermission;
  if (!needed || can(role, needed)) return true;
  window.location.href = "dashboard.html?denied=1";
  return false;
}

// Hide what the role may not use, and show the role in the header.
function applyRoleUI(role) {
  document.querySelectorAll("[data-requires-permission]").forEach((el) => {
    if (el === document.body) return;
    const allowed = can(role, el.dataset.requiresPermission);
    el.hidden = !allowed;
    if ("disabled" in el) el.disabled = !allowed;
  });

  const label = ROLE_LABELS[role] || "No role";

  const roleLabel = document.querySelector("#role-label");
  if (roleLabel) roleLabel.textContent = `${label} profile`;

  const sessionLabel = document.querySelector("#session-label");
  if (sessionLabel && !sessionLabel.textContent.includes("(")) {
    sessionLabel.textContent = `${sessionLabel.textContent} (${label})`;
  }

  const denied = document.querySelector("#access-denied");
  if (denied && new URLSearchParams(window.location.search).has("denied")) {
    denied.hidden = false;
  }
}
