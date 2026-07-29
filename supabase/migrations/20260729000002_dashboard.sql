-- ============================================================================
-- Main dashboard: student ethnicity, and the aggregates every card reads.
--
-- The dashboard asks nine different questions of eight tables, and every one
-- of them is an aggregate over rows the browser has no business downloading —
-- "students above 10% absence" means reading the whole attendance table for
-- the term. Doing that client-side would ship thousands of rows to compute a
-- five-row table.
--
-- So each card gets a function. They are security definer because several of
-- them read columns the generic `authenticated` role has had SELECT revoked on
-- (§18.5 column grants), which means every one of them has to re-apply the
-- tenant scope and the role gate that RLS would otherwise have applied. That
-- is done here the same way the policies do it: get_tenant_id_for_user() and
-- get_role_for_user() against auth.uid(), never a client-supplied tenant.
--
-- A caller without the right role gets an empty result rather than an error,
-- so a teacher's dashboard renders the cards they may see and leaves the rest
-- reading clean instead of throwing a page-level failure.
-- ============================================================================

-- ---------- students.ethnicity ----------------------------------------------
-- The "Students by Ethnicity" chart needs a column that did not exist.
--
-- In the Ethiopian context this identifies a student's language and region of
-- origin, and MoE census reporting is built on it. Its point is to let a
-- school and the ministry see which groups are under-served and direct support
-- accordingly.
--
-- Which is why the value list is NOT enumerated here. A CHECK naming the
-- fourteen largest groups looked tidy and did the opposite of what the column
-- is for: it would have funnelled Gumuz, Nuer, Anuak, Berta, Harari, Kunama
-- and Agew students into 'other' — making precisely the minorities the data
-- exists to surface the ones it cannot see. Ethiopia's census counts more than
-- eighty groups and the official list is revised as regions are reorganised,
-- so pinning it in a constraint means a migration every time a school enrols a
-- student the list forgot.
--
-- The constraint is therefore on shape only. The set of groups offered lives
-- in src/lib/ethnic-groups.ts with its labels in the three locale files, so
-- adding one is a frontend change; the chart falls back to rendering an
-- unrecognised key verbatim rather than dropping the slice.
alter table public.students add column if not exists ethnicity text;

do $$ begin
  alter table public.students add constraint students_ethnicity_check
    check (ethnicity is null or ethnicity ~ '^[a-z][a-z0-9_]{1,39}$');
exception when duplicate_object then null; end $$;

comment on column public.students.ethnicity is
  'Self-declared ethnic group, as a lower_snake key. Identifies language and '
  'region of origin for MoE census reporting and for directing support to '
  'under-served groups. Nullable; ''undisclosed'' records a family that was '
  'asked and chose not to answer, which is not the same as never being asked.';

-- A new column on students is NOT readable by `authenticated` without this.
--
-- 20260713000010 revoked SELECT on medical_notes, and a column-level REVOKE
-- makes Postgres expand the table-wide GRANT SELECT into one grant per column
-- that existed at that moment. Every column added afterwards therefore starts
-- with no SELECT privilege at all, and the failure is not subtle: any query
-- naming it dies with "permission denied for table students" — so the student
-- profile page breaks entirely, not just the one field.
--
-- INSERT and UPDATE are unaffected (nothing was ever revoked column-wise for
-- those, so they are still table-wide), which makes the shape of the bug
-- confusing: the value can be written and then cannot be read back.
-- 20260720000002 hit this same trap for blood_type/primary_language and fixed
-- it the same way.
grant select (ethnicity) on public.students to authenticated;

create index if not exists students_tenant_ethnicity
  on public.students (tenant_id, ethnicity) where status = 'active';

-- ---------- shared guards ----------------------------------------------------
-- Roles that may see the tenant-wide dashboard at all. Students and parents
-- have their own portal; super_admin is redirected to the platform console.
create or replace function public.dashboard_can_read()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select (select public.get_role_for_user(auth.uid()))
         in ('school_admin', 'teacher', 'hr_officer', 'accountant', 'registrar');
$$;

-- Money is narrower than the rest of the dashboard.
create or replace function public.dashboard_can_read_finance()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select (select public.get_role_for_user(auth.uid())) in ('school_admin', 'accountant');
$$;

-- Teaching days in a range: every date that is not a Sunday and not a holiday
-- or national closure on the tenant's calendar. Counted arithmetically rather
-- than by cross-joining students to dates, which is what keeps the missing-
-- attendance figure cheap over a whole academic year.
create or replace function public.dashboard_teaching_days(
  p_tenant uuid, p_from date, p_to date)
returns integer language sql stable security definer
set search_path = public, pg_temp as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(dow from d) <> 0
    and not exists (
      select 1 from public.calendar_events ce
      where ce.tenant_id = p_tenant
        and ce.event_date = d::date
        and ce.event_type in ('holiday', 'national'));
$$;

-- ---------- headline counts, gender and ethnicity ----------------------------
create or replace function public.dashboard_overview(p_academic_year_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid := (select public.get_tenant_id_for_user(auth.uid()));
  v_result jsonb;
begin
  if v_tenant is null or not public.dashboard_can_read() then
    return jsonb_build_object('students', 0, 'staff', 0, 'parents', 0,
                              'by_gender', '[]'::jsonb, 'by_ethnicity', '[]'::jsonb);
  end if;

  with scoped as (
    select s.id, s.gender, s.ethnicity
    from public.students s
    where s.tenant_id = v_tenant
      and s.status = 'active'
      -- The dashboard filter selects an academic year; a null means all-time.
      and (p_academic_year_id is null or exists (
            select 1 from public.classes c
            where c.id = s.class_id and c.academic_year_id = p_academic_year_id))
  )
  select jsonb_build_object(
    'students', (select count(*) from scoped),
    'staff', (select count(*) from public.employees e
              where e.tenant_id = v_tenant and e.status = 'active'),
    'parents', (select count(*) from public.guardians g
                where g.tenant_id = v_tenant and g.student_id in (select id from scoped)),
    'by_gender', coalesce((
      select jsonb_agg(jsonb_build_object('key', gender::text, 'count', n) order by n desc)
      from (select gender, count(*) n from scoped group by gender) x), '[]'::jsonb),
    -- Students with no answer recorded are their own slice rather than being
    -- dropped, so the pie always sums to the headline student count.
    'by_ethnicity', coalesce((
      select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc)
      from (select coalesce(ethnicity, 'unrecorded') k, count(*) n
            from scoped group by 1) y), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ---------- weekly attendance ------------------------------------------------
create or replace function public.dashboard_attendance_week(p_week_start date)
returns table (day date, present integer, absent integer, half_day integer)
language sql stable security definer
set search_path = public, pg_temp as $$
  select d::date,
         -- A late arrival attended, so it counts as present here; the
         -- distinction matters on the attendance register, not in a weekly
         -- headcount. 'excused' is a sanctioned absence and stays absent.
         count(*) filter (where a.status in ('present', 'late'))::integer,
         count(*) filter (where a.status in ('absent', 'excused'))::integer,
         count(*) filter (where a.status = 'half_day')::integer
  from generate_series(p_week_start, p_week_start + 6, interval '1 day') d
  left join public.attendance a
    on a.attendance_date = d::date
   and a.tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  where public.dashboard_can_read()
  group by d
  order by d;
$$;

-- Student-days that should have been recorded in a range and were not.
-- expected = teaching days x active students; recorded = rows actually present.
create or replace function public.dashboard_missing_attendance(p_from date, p_to date)
returns integer language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid := (select public.get_tenant_id_for_user(auth.uid()));
  v_days integer;
  v_students integer;
  v_recorded integer;
begin
  if v_tenant is null or not public.dashboard_can_read() then return 0; end if;

  v_days := public.dashboard_teaching_days(v_tenant, p_from, least(p_to, current_date));
  select count(*) into v_students from public.students
   where tenant_id = v_tenant and status = 'active';
  select count(*) into v_recorded from public.attendance
   where tenant_id = v_tenant and attendance_date between p_from and least(p_to, current_date);

  return greatest(v_days * v_students - v_recorded, 0);
end $$;

-- ---------- at-risk tables ---------------------------------------------------
create or replace function public.dashboard_high_absence(
  p_from date, p_to date, p_threshold numeric default 10, p_limit integer default 10)
returns table (
  student_id   uuid,
  admission_no text,
  full_name    text,
  grade        text,
  absences     integer,
  absence_pct  numeric
)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.id,
         s.admission_no,
         s.first_name || ' ' || s.last_name,
         c.name || coalesce(' ' || c.section, ''),
         count(*) filter (where a.status in ('absent', 'excused'))::integer,
         round(100.0 * count(*) filter (where a.status in ('absent', 'excused'))
               / nullif(count(*), 0), 1)
  from public.students s
  join public.classes c on c.id = s.class_id
  join public.attendance a on a.student_id = s.id
  where s.tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
    and s.status = 'active'
    and a.attendance_date between p_from and p_to
    and public.dashboard_can_read()
  group by s.id, s.admission_no, s.first_name, s.last_name, c.name, c.section
  having round(100.0 * count(*) filter (where a.status in ('absent', 'excused'))
               / nullif(count(*), 0), 1) > p_threshold
  order by 6 desc, 5 desc
  limit p_limit;
$$;

-- Cumulative GPA per student, resolved through the tenant's default grading
-- scale. A school that has not configured one still gets a number: the raw
-- percentage mapped onto a 4.0 scale, which is what the gradebook falls back
-- to elsewhere.
create or replace function public.dashboard_lowest_gpa(p_limit integer default 10)
returns table (
  student_id   uuid,
  admission_no text,
  full_name    text,
  grade        text,
  cgpa         numeric
)
language sql stable security definer
set search_path = public, pg_temp as $$
  with tenant as (select public.get_tenant_id_for_user(auth.uid()) as id),
  pct as (
    select g.student_id, (g.score / e.max_score) * 100 as percent
    from public.grades g
    join public.exams e on e.id = g.exam_id
    where g.tenant_id = (select id from tenant)
      and e.max_score > 0
  ),
  banded as (
    select pct.student_id,
           coalesce(
             (select gb.gpa_points
              from public.grade_bands gb
              join public.grading_scales gs on gs.id = gb.scale_id
              where gs.tenant_id = (select id from tenant)
                and gs.is_default
                and gb.min_percent <= pct.percent
              order by gb.min_percent desc
              limit 1),
             round(least(pct.percent, 100) * 4 / 100.0, 2)
           ) as points
    from pct
  )
  select s.id,
         s.admission_no,
         s.first_name || ' ' || s.last_name,
         c.name || coalesce(' ' || c.section, ''),
         round(avg(b.points), 2)
  from banded b
  join public.students s on s.id = b.student_id
  join public.classes c on c.id = s.class_id
  where s.status = 'active'
    and public.dashboard_can_read()
  group by s.id, s.admission_no, s.first_name, s.last_name, c.name, c.section
  order by 5 asc
  limit p_limit;
$$;

-- ---------- billing ----------------------------------------------------------
create or replace function public.dashboard_billing(p_from date, p_to date)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid := (select public.get_tenant_id_for_user(auth.uid()));
  v_result jsonb;
begin
  if v_tenant is null or not public.dashboard_can_read_finance() then
    return jsonb_build_object('collected', 0, 'overdue', 0,
                              'to_be_collected', 0, 'by_fee_type', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'collected', coalesce((
      select sum(p.amount) from public.payments p
      where p.tenant_id = v_tenant and p.status = 'succeeded'
        and p.paid_at::date between p_from and p_to), 0),
    -- Outstanding balance, not invoice face value: a partially paid invoice
    -- is overdue for the remainder only.
    'overdue', coalesce((
      select sum(i.amount_due - i.amount_paid) from public.fee_invoices i
      where i.tenant_id = v_tenant and i.status <> 'paid'
        and i.due_date < current_date), 0),
    'to_be_collected', coalesce((
      select sum(i.amount_due - i.amount_paid) from public.fee_invoices i
      where i.tenant_id = v_tenant and i.status <> 'paid'
        and i.due_date >= current_date), 0),
    'by_fee_type', coalesce((
      select jsonb_agg(jsonb_build_object('name_i18n', name_i18n, 'total', total)
                       order by total desc)
      from (
        select fs.name_i18n, sum(p.amount) total
        from public.payments p
        join public.fee_invoices i on i.id = p.invoice_id
        join public.fee_structures fs on fs.id = i.fee_structure_id
        where p.tenant_id = v_tenant and p.status = 'succeeded'
          and p.paid_at::date between p_from and p_to
        group by fs.name_i18n) z), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ---------- alerts -----------------------------------------------------------
create or replace function public.dashboard_alerts(p_from date, p_to date)
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_tenant uuid := (select public.get_tenant_id_for_user(auth.uid()));
begin
  if v_tenant is null or not public.dashboard_can_read() then
    return jsonb_build_object('messages', 0, 'applications', 0,
                              'course_requests', 0, 'missing_attendance', 0);
  end if;

  return jsonb_build_object(
    -- Notifications accepted but not yet delivered. An undelivered queue is
    -- the actionable thing here; "unread" is not modelled anywhere.
    'messages', (select count(*) from public.notification_log n
                 where n.tenant_id = v_tenant and n.status = 'queued'),
    'applications', (select count(*) from public.admission_applications a
                     where a.tenant_id = v_tenant and a.stage = 'applied'),
    -- Applications past first triage and awaiting a place. Disjoint from the
    -- count above, so the two tiles never double-count the same row.
    'course_requests', (select count(*) from public.admission_applications a
                        where a.tenant_id = v_tenant
                          and a.stage in ('shortlisted', 'offered')),
    'missing_attendance', public.dashboard_missing_attendance(p_from, p_to)
  );
end $$;

-- ---------- grants -----------------------------------------------------------
-- anon never reaches any of these; the role gate inside each one is the second
-- line, not the first.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.dashboard_can_read()',
    'public.dashboard_can_read_finance()',
    'public.dashboard_teaching_days(uuid, date, date)',
    'public.dashboard_overview(uuid)',
    'public.dashboard_attendance_week(date)',
    'public.dashboard_missing_attendance(date, date)',
    'public.dashboard_high_absence(date, date, numeric, integer)',
    'public.dashboard_lowest_gpa(integer)',
    'public.dashboard_billing(date, date)',
    'public.dashboard_alerts(date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- dashboard_teaching_days takes a tenant id as an argument, which would be a
-- cross-tenant read if it were callable directly. It is a helper for the
-- functions above, all of which pass the caller's own tenant.
revoke execute on function public.dashboard_teaching_days(uuid, date, date) from authenticated;
