-- ============================================================================
-- R4-B7: student leave request via the parent portal. Reuses leave_status
-- (pending/approved/rejected/cancelled) from the existing staff leave
-- system rather than a duplicate enum -- same lifecycle, different subject.
--
-- decide_student_leave_request() is SECURITY INVOKER, matching
-- promote_students_batch/revert_promotion_run's established rationale: it
-- adds atomicity (status update + attendance backfill in one call), not new
-- authority -- the caller's own attendance_write RLS (school_admin or
-- is_teacher_of_class) already governs whether they may write excused
-- attendance rows, and student_leave_requests_write below governs whether
-- they may decide the request itself. Approving excuses every school day
-- in the range EXCEPT holidays (attendance_guard already blocks those) --
-- weekends aren't specially excluded (this schema has no weekend concept
-- anywhere else either), so an excused row lands on a non-school weekend
-- day too; harmless (nothing reads it) rather than worth new logic to avoid.
-- ============================================================================
create table public.student_leave_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id),
  student_id   uuid not null references public.students(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  starts_on    date not null,
  ends_on      date not null,
  reason       text not null check (char_length(reason) between 1 and 500),
  status       public.leave_status not null default 'pending',
  decided_by   uuid references public.users(id),
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index student_leave_requests_student on public.student_leave_requests (tenant_id, student_id);
create index student_leave_requests_pending on public.student_leave_requests (tenant_id) where status = 'pending';

alter table public.student_leave_requests enable row level security;
alter table public.student_leave_requests force row level security;

create trigger audit_student_leave_requests after insert or update or delete on public.student_leave_requests
for each row execute function public.audit_trigger();

create policy student_leave_requests_select on public.student_leave_requests for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid())) and (
        (select public.get_role_for_user(auth.uid())) = 'school_admin'
        or public.is_guardian_of(student_id)
        or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))))
);

create policy student_leave_requests_insert on public.student_leave_requests for insert to authenticated with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and requested_by = auth.uid()
  and public.is_guardian_of(student_id)
  and status = 'pending'
);

-- One combined policy for every UPDATE path: a guardian may cancel their
-- OWN still-pending request (and nothing else); school_admin or the
-- student's own class teacher may decide any pending request in their
-- tenant.
create policy student_leave_requests_update on public.student_leave_requests for update to authenticated
using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (
    (requested_by = auth.uid() and status = 'pending')
    or (select public.get_role_for_user(auth.uid())) = 'school_admin'
    or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))
  )
)
with check (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (
    (requested_by = auth.uid() and status = 'cancelled')
    or (select public.get_role_for_user(auth.uid())) = 'school_admin'
    or exists (select 1 from public.students s where s.id = student_id and public.is_teacher_of_class(s.class_id))
  )
);

create or replace function public.decide_student_leave_request(p_request_id uuid, p_approve boolean)
returns int language plpgsql as $$
declare
  v_req         record;
  v_class_id    uuid;
  v_day         date;
  v_excused_cnt int := 0;
begin
  select id, tenant_id, student_id, starts_on, ends_on, status
    into v_req from public.student_leave_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'leave_request_not_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'leave_request_already_decided';
  end if;

  update public.student_leave_requests
    set status = case when p_approve then 'approved' else 'rejected' end::public.leave_status,
        decided_by = auth.uid(), decided_at = now()
    where id = p_request_id;

  if not found then
    -- The UPDATE above ran under the caller's own RLS (this function is
    -- SECURITY INVOKER) -- zero rows updated means RLS rejected it, which
    -- reads exactly like "not authorized" to the caller.
    raise exception 'not_authorized';
  end if;

  if p_approve then
    select class_id into v_class_id from public.students where id = v_req.student_id;
    v_day := v_req.starts_on;
    while v_day <= v_req.ends_on loop
      if not exists (
        select 1 from public.calendar_events ce
        where ce.tenant_id = v_req.tenant_id and ce.event_date = v_day and ce.event_type in ('holiday','national')
      ) then
        insert into public.attendance (tenant_id, student_id, class_id, attendance_date, status)
        values (v_req.tenant_id, v_req.student_id, v_class_id, v_day, 'excused')
        on conflict (tenant_id, student_id, attendance_date, class_id, period_key)
        do update set status = 'excused';
        v_excused_cnt := v_excused_cnt + 1;
      end if;
      v_day := v_day + 1;
    end loop;
  end if;

  return v_excused_cnt;
end;
$$;

grant execute on function public.decide_student_leave_request(uuid, boolean) to authenticated;
