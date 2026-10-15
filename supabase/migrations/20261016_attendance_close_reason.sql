-- Report / Logs: mark check-outs that the visitor did not scan themselves.
--   'auto'  = closed by the system at closing time (autoCloseVisits in javascript-stuff.js)
--   'force' = closed by staff with "Force check-out" on the Currently-In List
-- The report (csv.html) leaves these out of check-out counts and peak hours, because their time
-- is when the system or staff closed the visit, not when the visitor left.
-- Normal scans leave it empty. Rows saved before this migration also stay empty.
-- Run in Supabase > SQL Editor (or apply as a migration). Safe to run more than once.

alter table public.attendance_logs
  add column if not exists close_reason text;

alter table public.attendance_logs
  drop constraint if exists attendance_logs_close_reason_check;

alter table public.attendance_logs
  add constraint attendance_logs_close_reason_check
  check (close_reason is null or (event_type = 'check_out' and close_reason in ('auto', 'force')));

-- Only needed if the table uses column-level grants; harmless otherwise.
grant select (close_reason), insert (close_reason) on public.attendance_logs to authenticated;
