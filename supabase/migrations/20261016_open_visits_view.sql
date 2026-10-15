-- Currently-In List: one row per person whose latest event is a check-in, however long ago.
-- The app used to rebuild this from the last 48 hours of logs, so a visit left open from Friday was
-- no longer found on Monday and never auto checked out. Reading this view also avoids the
-- 1000-rows-per-request limit, because it returns only the people who are in, not every log row.
--
-- Corrections work the same as before: a correction cancels the event just before it
-- (for the same person), and the person's state is their latest event that was not cancelled.
--
-- security_invoker: the view uses the reader's own permissions, so the attendance_logs RLS rules
-- (active staff may read logs) still apply.
-- Run in Supabase > SQL Editor (or apply as a migration). Safe to run more than once.

create or replace view public.open_visits
with (security_invoker = true)
as
with ordered as (
  select
    id_number,
    event_type,
    event_time,
    id,
    lead(event_type) over (partition by id_number order by event_time, id) as next_type
  from public.attendance_logs
),
kept as (
  select * from ordered
  where event_type <> 'correction'
    and next_type is distinct from 'correction'
),
latest as (
  select distinct on (id_number) id_number, event_type, event_time
  from kept
  order by id_number, event_time desc, id desc
)
select id_number, event_time as checkin_time
from latest
where event_type = 'check_in';

grant select on public.open_visits to authenticated;

-- Speeds up the view (and each patron's visit history), which read logs per person in time order.
create index if not exists attendance_logs_id_number_event_time_idx
  on public.attendance_logs (id_number, event_time, id);
