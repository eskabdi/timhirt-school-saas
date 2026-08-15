-- ============================================================================
-- R4-B5: promotion undo/reversal. promote_students_batch() had no memory of
-- what it did -- a wrong grade-cycle mapping or a batch run against the
-- wrong source classes had no way back except a school_admin manually
-- re-editing every affected student's class_id by hand.
--
-- promotion_runs is the run header; promotion_run_students records the
-- EXACT per-student before/after (class_id, status) for every student the
-- run actually touched -- not just the move-spec (source/target class
-- pairs), because reversal needs to restore precisely what each student
-- had, and re-deriving that from the move-spec after the fact (e.g. by
-- reading the target class's current roster) would be wrong the moment
-- anything else has touched that class since.
--
-- revert_promotion_run() only writes a student back to from_class_id/
-- from_status when they're STILL at to_class_id/to_status -- if a student
-- was moved again since the run (another promotion, a manual edit,
-- graduation), reverting silently skips them rather than clobbering
-- whatever happened after. The run's summary reports both counts so the
-- caller can see when a revert was partial.
-- ============================================================================
create table public.promotion_runs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  run_by      uuid not null references public.users(id),
  run_at      timestamptz not null default now(),
  reverted_at timestamptz,
  reverted_by uuid references public.users(id)
);
create index promotion_runs_tenant on public.promotion_runs (tenant_id, run_at desc);

create table public.promotion_run_students (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.promotion_runs(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id),
  student_id    uuid not null references public.students(id) on delete cascade,
  from_class_id uuid references public.classes(id),
  from_status   public.student_status not null,
  to_class_id   uuid references public.classes(id),
  to_status     public.student_status not null
);
create index promotion_run_students_run on public.promotion_run_students (run_id);

alter table public.promotion_runs enable row level security;
alter table public.promotion_runs force row level security;
alter table public.promotion_run_students enable row level security;
alter table public.promotion_run_students force row level security;

-- promote_students_batch/revert_promotion_run are SECURITY INVOKER (see the
-- rationale on promote_students_batch below), so their writes to these two
-- tables run as the caller and need their own policies -- gated on the same
-- students:update permission the functions themselves require, not open to
-- every authenticated write. No delete policy: these are an audit trail.
create policy promotion_runs_select on public.promotion_runs for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);
create policy promotion_runs_insert on public.promotion_runs for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false)
);
create policy promotion_runs_update on public.promotion_runs for update to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false));

create policy promotion_run_students_select on public.promotion_run_students for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
);
create policy promotion_run_students_insert on public.promotion_run_students for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false)
);

-- ----------------------------------------------------------------------------
-- promote_students_batch: unchanged authorization/capacity/atomicity logic,
-- now also opening a promotion_runs row and recording every student's
-- before/after state as it moves them, and returning run_id so the caller
-- can offer an immediate "Undo" without a second round trip.
-- ----------------------------------------------------------------------------
-- Return signature changed (run_id added as the first column), so a plain
-- CREATE OR REPLACE fails -- Postgres does not allow changing an existing
-- function's return columns in place.
drop function if exists public.promote_students_batch(jsonb);

create function public.promote_students_batch(p_moves jsonb)
returns table(run_id uuid, promoted_count int, graduated_count int)
language plpgsql
as $$
declare
  v_tenant_id       uuid := public.get_tenant_id_for_user(auth.uid());
  v_bad             record;
  v_row             record;
  v_student         record;
  v_run_id          uuid;
  v_promoted_count  int := 0;
  v_graduated_count int := 0;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context for current user';
  end if;
  if not coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false) then
    raise exception 'insufficient permission to promote students';
  end if;

  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves) = 0 then
    raise exception 'p_moves must be a non-empty json array';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(source_class_id uuid, target_class_id uuid, graduate boolean)
    where m.source_class_id is null
       or (coalesce(m.graduate, false) = false and m.target_class_id is null)
  ) then
    raise exception 'every move needs a source_class_id, and either a target_class_id or graduate=true';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(source_class_id uuid, target_class_id uuid, graduate boolean)
    left join public.classes cs on cs.id = m.source_class_id
    left join public.classes ct on ct.id = m.target_class_id
    where cs.id is null
       or cs.tenant_id <> v_tenant_id
       or (m.target_class_id is not null and (ct.id is null or ct.tenant_id <> v_tenant_id))
  ) then
    raise exception 'promotion move references a class outside your school';
  end if;

  for v_bad in
    select c.id, c.name, c.section, c.capacity,
           (select count(*) from public.students s where s.class_id = c.id and s.status = 'active') as currently_enrolled,
           sum((select count(*) from public.students s2 where s2.class_id = m.source_class_id and s2.status = 'active')) as incoming
    from jsonb_to_recordset(p_moves) as m(source_class_id uuid, target_class_id uuid, graduate boolean)
    join public.classes c on c.id = m.target_class_id
    where coalesce(m.graduate, false) = false
    group by c.id, c.name, c.section, c.capacity
  loop
    if v_bad.capacity is not null and v_bad.currently_enrolled + v_bad.incoming > v_bad.capacity then
      raise exception 'promotion would exceed capacity for class % % (capacity %, would enroll %)',
        v_bad.name, coalesce(v_bad.section, ''), v_bad.capacity, v_bad.currently_enrolled + v_bad.incoming;
    end if;
  end loop;

  insert into public.promotion_runs (tenant_id, run_by) values (v_tenant_id, auth.uid())
  returning id into v_run_id;

  for v_row in
    select source_class_id, target_class_id, coalesce(graduate, false) as graduate
    from jsonb_to_recordset(p_moves) as m(source_class_id uuid, target_class_id uuid, graduate boolean)
  loop
    if v_row.graduate then
      for v_student in
        select id, class_id, status from public.students where class_id = v_row.source_class_id and status = 'active'
      loop
        update public.students set status = 'graduated' where id = v_student.id;
        insert into public.promotion_run_students (run_id, tenant_id, student_id, from_class_id, from_status, to_class_id, to_status)
        values (v_run_id, v_tenant_id, v_student.id, v_student.class_id, v_student.status, v_student.class_id, 'graduated');
        v_graduated_count := v_graduated_count + 1;
      end loop;
    else
      for v_student in
        select id, class_id, status from public.students where class_id = v_row.source_class_id and status = 'active'
      loop
        update public.students set class_id = v_row.target_class_id where id = v_student.id;
        insert into public.promotion_run_students (run_id, tenant_id, student_id, from_class_id, from_status, to_class_id, to_status)
        values (v_run_id, v_tenant_id, v_student.id, v_student.class_id, v_student.status, v_row.target_class_id, v_student.status);
        v_promoted_count := v_promoted_count + 1;
      end loop;
    end if;
  end loop;

  return query select v_run_id, v_promoted_count, v_graduated_count;
end;
$$;

grant execute on function public.promote_students_batch(jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- revert_promotion_run: restores exactly what promotion_run_students
-- recorded, per student, only where the student is still at the recorded
-- post-promotion state. Refuses a second revert of the same run outright.
-- ----------------------------------------------------------------------------
create or replace function public.revert_promotion_run(p_run_id uuid)
returns table(reverted_count int, skipped_count int)
language plpgsql
as $$
declare
  v_tenant_id      uuid := public.get_tenant_id_for_user(auth.uid());
  v_run            record;
  v_move           record;
  v_rc             int;
  v_reverted_count int := 0;
  v_skipped_count  int := 0;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context for current user';
  end if;
  if not coalesce(public.has_resource_permission(auth.uid(), 'students', 'update'), false) then
    raise exception 'insufficient permission to revert a promotion run';
  end if;

  select id, tenant_id, reverted_at into v_run from public.promotion_runs where id = p_run_id;
  if v_run.id is null or v_run.tenant_id <> v_tenant_id then
    raise exception 'promotion run not found';
  end if;
  if v_run.reverted_at is not null then
    raise exception 'promotion_run_already_reverted';
  end if;

  for v_move in
    select student_id, from_class_id, from_status, to_class_id, to_status
    from public.promotion_run_students where run_id = p_run_id
  loop
    update public.students set class_id = v_move.from_class_id, status = v_move.from_status
      where id = v_move.student_id
        and status = v_move.to_status
        and class_id is not distinct from v_move.to_class_id;
    get diagnostics v_rc = row_count;
    if v_rc > 0 then
      v_reverted_count := v_reverted_count + 1;
    else
      v_skipped_count := v_skipped_count + 1;
    end if;
  end loop;

  update public.promotion_runs set reverted_at = now(), reverted_by = auth.uid() where id = p_run_id;

  return query select v_reverted_count, v_skipped_count;
end;
$$;

grant execute on function public.revert_promotion_run(uuid) to authenticated;
