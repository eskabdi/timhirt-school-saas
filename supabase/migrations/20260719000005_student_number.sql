-- ============================================================================
-- Auto-generated Student Numbers (replaces hand-typed admission numbers).
--
-- Format: {3 initials of tenant name}{tenant_no}-{per-tenant sequence}-{Luhn
-- check digit} — e.g. Abadir Elementary School, tenant #1, first student
-- => ABD01-0001-6. Initials are the name's first letter plus its next two
-- consonants (ABaDiR -> ABD), falling back to the first three letters
-- (X-padded) for short or vowel-heavy names. The check digit is standard
-- Luhn over the digits (tenant_no || sequence), so a number mistyped at the
-- office counter fails validation instead of silently hitting the wrong
-- student.
--
-- Storage: the existing students.admission_no column — renaming it would
-- ripple through the search_vector expression, the column-level grants
-- (migration 013), the per-tenant unique constraint, and every UI/PDF
-- reference, for zero data benefit. The UI label becomes "Student No.";
-- students enrolled before this migration keep their hand-typed numbers,
-- which satisfy the same uniqueness and format constraints.
--
-- Generation is a BEFORE INSERT trigger that fires only when admission_no
-- is NULL, so every insert path (enroll_admission_application, the manual
-- Add Student form, future imports) gets a number without duplicating
-- generator calls, while seeds/imports that provide an explicit number are
-- left alone. The trigger function is SECURITY DEFINER because the sequence
-- counter lives on tenants, which only super_admin may write
-- (tenants_write policy) — same postgres-owned definer pattern as
-- settle_gateway_payment(). Concurrency: "UPDATE ... SET student_seq =
-- student_seq + 1 RETURNING" takes a row lock, so two simultaneous
-- enrollments cannot mint the same number.
-- ============================================================================

alter table public.tenants
  add column tenant_no   int,
  add column student_seq int not null default 0;

-- Backfill tenant_no in creation order ("count row of tenants table" at the
-- time each tenant appeared); new tenants get max+1 via trigger below.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.tenants
)
update public.tenants t set tenant_no = o.rn
from ordered o where t.id = o.id;

alter table public.tenants alter column tenant_no set not null;
alter table public.tenants add constraint tenants_tenant_no_key unique (tenant_no);

create or replace function public.set_tenant_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tenant_no is null then
    select coalesce(max(tenant_no), 0) + 1 into new.tenant_no from public.tenants;
  end if;
  return new;
end;
$$;
revoke all on function public.set_tenant_no() from public, anon, authenticated;

create trigger tenants_set_tenant_no
before insert on public.tenants
for each row execute function public.set_tenant_no();

create or replace function public.set_student_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq      int;
  v_no       int;
  v_name     text;
  v_letters  text;
  v_initials text;
  v_digits   text;
  v_sum      int := 0;
  v_d        int;
  v_pos      int := 0;
  i          int;
begin
  if new.admission_no is not null then
    return new;
  end if;

  update public.tenants
     set student_seq = student_seq + 1
   where id = new.tenant_id
  returning student_seq, tenant_no, name into v_seq, v_no, v_name;

  if v_seq is null then
    raise exception 'tenant not found while generating student number';
  end if;

  v_letters  := upper(regexp_replace(v_name, '[^A-Za-z]', '', 'g'));
  v_initials := substr(v_letters, 1, 1)
                || substr(regexp_replace(substr(v_letters, 2), '[AEIOU]', '', 'g'), 1, 2);
  if length(v_initials) < 3 then
    v_initials := rpad(substr(v_letters, 1, 3), 3, 'X');
  end if;

  -- lpad() truncates anything LONGER than the target width, which would
  -- silently collide numbers past tenant #99 or student #9999 — greatest()
  -- makes the pad a minimum width, never a maximum.
  v_digits := lpad(v_no::text,  greatest(2, length(v_no::text)),  '0')
           || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');

  -- Luhn check digit over the payload digits (rightmost payload digit
  -- doubled first, per the standard when appending a check digit).
  for i in reverse length(v_digits)..1 loop
    v_d   := substr(v_digits, i, 1)::int;
    v_pos := v_pos + 1;
    if v_pos % 2 = 1 then
      v_d := v_d * 2;
      if v_d > 9 then v_d := v_d - 9; end if;
    end if;
    v_sum := v_sum + v_d;
  end loop;

  new.admission_no := v_initials
    || lpad(v_no::text, greatest(2, length(v_no::text)), '0')
    || '-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0')
    || '-' || ((10 - (v_sum % 10)) % 10)::text;

  return new;
end;
$$;
revoke all on function public.set_student_number() from public, anon, authenticated;

create trigger students_set_admission_no
before insert on public.students
for each row execute function public.set_student_number();

-- ---------------------------------------------------------------------------
-- enroll_admission_application no longer takes an admission number — the
-- trigger above generates the Student Number during the INSERT. The old
-- 3-arg signature is dropped (not overloaded) so PostgREST can't route a
-- stale client call to it.
-- ---------------------------------------------------------------------------
drop function if exists public.enroll_admission_application(uuid, uuid, text);

create function public.enroll_admission_application(
  p_application_id uuid,
  p_class_id        uuid
) returns uuid
language plpgsql
as $$
declare
  v_app        public.admission_applications;
  v_capacity   int;
  v_enrolled   int;
  v_student_id uuid;
begin
  select * into v_app from public.admission_applications where id = p_application_id;
  if not found then
    raise exception 'application not found';
  end if;
  if v_app.stage <> 'registered' then
    raise exception 'application is not at the registered stage';
  end if;
  if v_app.converted_student_id is not null then
    raise exception 'application has already been enrolled';
  end if;

  select capacity into v_capacity from public.classes
    where id = p_class_id and tenant_id = v_app.tenant_id;
  if not found then
    raise exception 'class not found for this tenant';
  end if;

  if v_capacity is not null then
    select count(*) into v_enrolled from public.students
      where class_id = p_class_id and status = 'active';
    if v_enrolled >= v_capacity then
      raise exception 'selected section is at capacity';
    end if;
  end if;

  insert into public.students (
    tenant_id, class_id,
    first_name, first_name_am, middle_name, middle_name_am, last_name, last_name_am,
    date_of_birth, gender
  ) values (
    v_app.tenant_id, p_class_id,
    v_app.applicant_first_name, v_app.applicant_first_name_am,
    v_app.applicant_middle_name, v_app.applicant_middle_name_am,
    v_app.applicant_last_name, v_app.applicant_last_name_am,
    v_app.date_of_birth, v_app.gender
  ) returning id into v_student_id;

  insert into public.guardians (tenant_id, student_id, relationship, phone, email)
  values (
    v_app.tenant_id, v_student_id,
    coalesce(v_app.guardian_relationship::text, 'guardian'),
    v_app.guardian_phone, v_app.guardian_email
  );

  update public.admission_applications
    set converted_student_id = v_student_id, assigned_class_id = p_class_id
    where id = p_application_id;

  return v_student_id;
end;
$$;

grant execute on function public.enroll_admission_application(uuid, uuid) to authenticated;
