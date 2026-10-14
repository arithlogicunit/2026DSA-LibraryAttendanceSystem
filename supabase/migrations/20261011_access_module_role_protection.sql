-- Access module (Phase 3): role-based protection on profiles.
-- Run in Supabase > SQL Editor (or apply as a migration). Safe to run once.

-- 1. Merge the two SELECT policies into one (same behaviour: an admin is also active staff).
drop policy if exists "profiles_select_active_staff" on public.profiles;
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_active_staff" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_active_staff()));

-- 2. Column-level UPDATE: even an admin can only change name, role and status
--    (id, staff_id and created_at become immutable through the API).
revoke update on public.profiles from authenticated;
grant update (full_name, role, status) on public.profiles to authenticated;

-- 3. Guard rails on role/status changes.
create function private.guard_profile_changes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status then
    -- Nobody changes their own role or status (stops self-approval and admin lock-out).
    if old.id = (select auth.uid()) then
      raise exception 'You cannot change your own role or status.' using errcode = '42501';
    end if;

    -- Always keep at least one active admin.
    if old.role = 'admin' and old.status = 'active'
       and (new.role <> 'admin' or new.status <> 'active')
       and not exists (
         select 1 from public.profiles
         where id <> old.id and role = 'admin' and status = 'active'
       ) then
      raise exception 'At least one active admin must remain.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.guard_profile_changes() from public, anon, authenticated;

create trigger profiles_guard_changes
before update on public.profiles
for each row execute function private.guard_profile_changes();
