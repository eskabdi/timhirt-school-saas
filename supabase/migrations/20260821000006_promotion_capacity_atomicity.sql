-- ============================================================================
-- PromotionPage.tsx computes `overCapacity` per row but never used it to
-- block anything -- the "Run promotion" button called direct
-- students.update() per source class, so (a) capacity was decorative only,
-- and (b) a failure partway through left some classes promoted and others
-- not, with no rollback.
--
-- promote_students_batch(p_moves) fixes both with one function: every
-- target class's post-promotion headcount is checked against capacity
-- BEFORE any row is written, and the whole batch runs as one PL/pgSQL call
-- (one transaction) -- a capacity failure on any single move raises an
-- exception, which rolls back every move in the batch, not just the
-- offending one.
--
-- SECURITY INVOKER, not SECURITY DEFINER: the audit note asking for this fix
-- cited enroll_admission_application() as "the same pattern", but that
-- function is explicitly SECURITY INVOKER by design (see the comment at
-- 20260719000001_enrollment_bridge.sql:30-38) -- it adds atomicity across
-- multiple writes, not new authority, relying on the caller's own RLS
-- (students_update already requires has_resource_permission(..., 'students',
-- 'update') and tenant match, see 20260817000002). This function follows
-- that same real pattern: it re-derives the caller's tenant and permission
-- explicitly (defense in depth, since a bug in this function's own SQL
-- would otherwise only be caught by RLS at write time), but does not
-- bypass RLS to do it.
-- ============================================================================
create or replace function public.promote_students_batch(p_moves jsonb)
returns table(promoted_count int, graduated_count int)
language plpgsql
as $$
declare
  v_tenant_id       uuid := public.get_tenant_id_for_user(auth.uid());
  v_bad             record;
  v_row             record;
  v_rc              int;
  v_promoted_count  int := 0;
  v_graduated_count int := 0;
begin
  if v_tenant_id is null then
    raise exception 'no tenant context for current user';
  end if;
  -- has_resource_permission()'s coalesce() chain can itself return NULL (no
  -- matching row anywhere), and `if not null` is NULL, not true, so a bare
  -- `if not has_resource_permission(...)` would silently skip this guard
  -- for a caller with no grant at all -- coalesce to false here.
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

  -- Every referenced class, source or target, must belong to the caller's
  -- own tenant -- promote_students_batch is invoker-rights, but this check
  -- is re-derived here rather than left purely to RLS so a capacity/tenant
  -- mismatch surfaces as a clear exception instead of a silent zero-row update.
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

  -- Phase 1: capacity check for every target BEFORE any write, aggregated
  -- across every source class in this batch that maps to the same target --
  -- two source classes each individually within capacity can still overflow
  -- a shared target combined, and this catches that case too.
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

  -- Phase 2: execute every move. Any exception here rolls back Phase 1's
  -- checks too -- the whole call is one transaction, so a failure on any
  -- move undoes the entire batch, not just that move.
  for v_row in
    select source_class_id, target_class_id, coalesce(graduate, false) as graduate
    from jsonb_to_recordset(p_moves) as m(source_class_id uuid, target_class_id uuid, graduate boolean)
  loop
    if v_row.graduate then
      update public.students set status = 'graduated'
        where class_id = v_row.source_class_id and status = 'active';
      get diagnostics v_rc = row_count;
      v_graduated_count := v_graduated_count + v_rc;
    else
      update public.students set class_id = v_row.target_class_id
        where class_id = v_row.source_class_id and status = 'active';
      get diagnostics v_rc = row_count;
      v_promoted_count := v_promoted_count + v_rc;
    end if;
  end loop;

  return query select v_promoted_count, v_graduated_count;
end;
$$;

grant execute on function public.promote_students_batch(jsonb) to authenticated;
