
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;


drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin() or status = 'active');

-- UPDATE: admins only.
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and (new.status is distinct from old.status or new.role is distinct from old.role) then

    if not public.is_admin() then
      raise exception 'Only an admin can change status or role';
    end if;

    if new.id = auth.uid() then
      raise exception 'You cannot change your own status or role';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on public.profiles;
create trigger profiles_guard_privileged
  before update on public.profiles
  for each row
  execute function public.guard_profile_privileged_columns();

