# Access module: roles and permissions

Two roles, stored in `profiles.role`. An account must also have `profiles.status = 'active'`;
`pending` and `rejected` accounts can read only their own profile and nothing else.

| Action (key in `access.js`)        | Admin | Staff | Enforced by |
|------------------------------------|:-----:|:-----:|-------------|
| Type-ID check-in / check-out (`check_in_out`) | yes | yes | Screen guard; database: active staff may insert logs |
| Force check-out (`force_checkout`) | yes   | yes   | Screen guard; database: active staff may insert logs |
| Currently-In list (`view_currently_in`) | yes | yes | Screen guard; database: active staff may read logs |
| View reports / logs (`view_reports`) | yes | yes   | Screen guard; database: active staff may read logs |
| Export reports to CSV (`export_reports`) | yes | no | **Screen only** (see note) |
| Add / edit / deactivate patrons (`manage_patrons`) | yes | no | Screen guard **and** database (only admins may insert or update `patrons`) |
| Approve / reject staff accounts (`approve_staff`) | yes | no | Screen guard **and** database (only admins may update `profiles`) |
| Change a user's role (`manage_roles`) | yes | no | Screen guard **and** database |
| Edit or delete log rows            | no    | no    | Database: no update or delete policy on `attendance_logs` |

Database rules that apply to everyone:
- Staff cannot approve themselves or change their own role or status (trigger, once the Access migration is applied).
- At least one active admin must always remain (same trigger).
- Only `full_name`, `role` and `status` can be updated on a profile; `id` and `staff_id` cannot (column privileges, same migration).

Note on CSV export: staff may read the logs on screen, so a database rule cannot tell "viewing" from
"downloading". Export is hidden from staff in the interface only. If it must be enforced in the database,
move the export into a Supabase Edge Function or RPC that checks `private.is_admin()`.

## For the other modules

- Admin-only page: `<body data-requires-session="true" data-requires-permission="approve_staff">`
- Admin-only button or link: `<button data-requires-permission="export_reports">`
- In JavaScript: `if (can(state.staff.role, "manage_patrons")) { ... }`
- Add `<script src="access.js"></script>` after `auth.js` and before `javascript-stuff.js`.
- Never decide access from `localStorage`. The role is re-read from `profiles` on every page load.
