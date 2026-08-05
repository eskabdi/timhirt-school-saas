-- ============================================================================
-- Privilege-escalation fix: guardians_write/students_write let school_admin
-- AND registrar write any column, including user_id -- the column
-- is_guardian_of() (§ "guardians.user_id = auth.uid()") and every
-- "s.user_id = auth.uid()" check across grades/attendance/fee_invoices/
-- payments/library_checkouts/announcements trusts unconditionally.
--
-- grades_select and payments_select grant direct read access to school_admin
-- (grades: also accountant for payments) but NOT registrar -- registrar only
-- sees that data via teacher/self/guardian linkage. Because registrar could
-- already write guardians.user_id / students.user_id to their own auth.uid(),
-- nothing stopped a registrar from self-linking as "guardian" of an arbitrary
-- student and reading grades/payments/attendance/library data their role is
-- explicitly denied elsewhere -- the same identity-drift shape the
-- users_lock_identity trigger (20260713000010) already closed for `users`,
-- just never extended to these two tables.
--
-- Fix: a before-update trigger, same belt-and-suspenders shape as
-- users_lock_identity, that rejects any change to user_id unless the actor
-- is school_admin or super_admin. Linking a portal account to a guardian/
-- student row is a staff action (provision-portal-accounts, staff UI) that
-- only those roles should perform; registrar keeps every other column.
-- ============================================================================
create or replace function public.guardians_lock_user_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id
     and public.get_role_for_user(auth.uid()) not in ('school_admin', 'super_admin') then
    raise exception 'guardian_user_id_immutable_for_role';
  end if;
  return new;
end $$;
drop trigger if exists guardians_lock_user_id_trg on public.guardians;
create trigger guardians_lock_user_id_trg before update on public.guardians
for each row execute function public.guardians_lock_user_id();

create or replace function public.students_lock_user_id()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is distinct from old.user_id
     and public.get_role_for_user(auth.uid()) not in ('school_admin', 'super_admin') then
    raise exception 'student_user_id_immutable_for_role';
  end if;
  return new;
end $$;
drop trigger if exists students_lock_user_id_trg on public.students;
create trigger students_lock_user_id_trg before update on public.students
for each row execute function public.students_lock_user_id();
