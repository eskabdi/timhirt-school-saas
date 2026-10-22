-- ============================================================================
-- F-01 Academic Calendar Engine, slice 2a: the school authors its calendar.
--
-- A draft is edited directly (save_school_calendar_entry,
-- delete_school_calendar_entry) by whoever holds academic_calendar:update.
-- Publishing it, and every later change to the published calendar, goes
-- through maker-checker (R6 WP-09): academic_calendar_publish and
-- academic_calendar_change are submitted with submit_approval and applied by
-- execute_approval once a second person holding academic_calendar:approve
-- agrees. The guards refuse any other write to a published calendar, and a
-- calendar closes, for good, when its academic year closes.
--
-- Platform authoring (MoE and regional calendars) is slice 2b.
-- ============================================================================

-- ------------------------------------------------------------ permissions --
update public.permissions set description = 'Request publishing the school''s calendar'
 where key = 'academic_calendar:publish';
insert into public.permissions (key, module, resource, action, description) values
  ('academic_calendar:approve', 'calendar', 'academic_calendar', 'approve',
   'Approve publishing or changing the school''s calendar (maker-checker)')
on conflict (key) do nothing;
insert into public.resource_default_role_grants (resource, action, role) values
  ('academic_calendar', 'approve', 'school_admin')
on conflict do nothing;

-- -------------------------------------------------------- approval actions --
insert into public.approval_actions (action, entity_table, checker_resource, platform_minimum, available, planned_wp, description, module) values
  ('academic_calendar_publish', 'school_calendars',        'academic_calendar', true, true, null, 'Publish the school''s academic calendar', 'events'),
  ('academic_calendar_change',  'school_calendar_entries', 'academic_calendar', true, true, null, 'Change the school''s published academic calendar', 'events');

-- A checker previews the draft they are asked to publish.
drop policy school_calendars_select on public.school_calendars;
create policy school_calendars_select on public.school_calendars for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (status <> 'draft'
       or public.has_resource_permission(auth.uid(), 'academic_calendar', 'update')
       or public.has_resource_permission(auth.uid(), 'academic_calendar', 'approve'))
);

-- A school replaces or removes a given MoE/regional entry at most once.
create unique index school_calendar_entries_one_override on public.school_calendar_entries (calendar_id, overrides_entry_id)
  where overrides_entry_id is not null;

-- ----------------------------------------------------------- entry names --
-- {en, am, om}, each at most 200 characters, at least one non-blank. A name
-- given only in Amharic or Afaan Oromo is copied to en (the column requires
-- it; tField falls back the same way). Null when the input is not that.
create function public.normalize_calendar_entry_name(p jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
  val text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return null;
  end if;
  for k, val in select e.key, case when jsonb_typeof(e.value) = 'string' then btrim(e.value #>> '{}') end from jsonb_each(p) e loop
    if k not in ('en', 'am', 'om') or val is null or char_length(val) > 200 then
      return null;
    end if;
    if val <> '' then
      v := v || jsonb_build_object(k, val);
    end if;
  end loop;
  if v = '{}'::jsonb then
    return null;
  end if;
  if not v ? 'en' then
    v := v || jsonb_build_object('en', coalesce(v ->> 'am', v ->> 'om'));
  end if;
  -- The column's CHECK counts the serialized object (escapes included).
  if length(v::text) > 1000 then
    return null;
  end if;
  return v;
end $$;
revoke execute on function public.normalize_calendar_entry_name(jsonb) from public, anon, authenticated;

-- What a publish request shows the checker and what the approval re-checks:
-- the origin, the weekend and every entry. Owner-only (the definer RPCs).
create function public.school_calendar_snapshot(p_calendar_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'origin', c.origin, 'weekend_days', c.weekend_days,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'day_type_code', e.day_type_code, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
               'name_i18n', e.name_i18n, 'overrides_entry_id', e.overrides_entry_id, 'suppressed', e.suppressed)
             order by e.starts_on, e.id)
        from public.school_calendar_entries e where e.calendar_id = c.id and e.tenant_id = c.tenant_id), '[]'::jsonb))
    from public.school_calendars c where c.id = p_calendar_id
$$;
revoke execute on function public.school_calendar_snapshot(uuid) from public, anon, authenticated;

-- A publish request for this calendar is waiting (and has not expired).
create function public.school_calendar_publish_pending(p_calendar_id uuid)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.approval_requests r
                  where r.action = 'academic_calendar_publish' and r.entity_id = p_calendar_id
                    and r.status = 'pending' and r.expires_at > now())
$$;
revoke execute on function public.school_calendar_publish_pending(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ year state --
-- The year a calendar belongs to has closed (academic_years), so nothing in
-- it changes any more, a draft included.
create function public.school_year_closed(p_tenant uuid, p_ec_year integer)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select exists (select 1 from public.academic_years y
                  where y.tenant_id = p_tenant and y.ec_year = p_ec_year and y.status = 'closed')
$$;
revoke execute on function public.school_year_closed(uuid, integer) from public, anon, authenticated;

-- ------------------------------------------------------- draft authoring --
-- Add (p_entry_id null) or change an entry of the school's draft calendar.
-- A published calendar changes only through an academic_calendar_change
-- request (approval_required); a draft waiting for its publish approval is
-- frozen (approval_already_pending), so the checker approves what they saw.
-- The guard trigger checks the rest (type, range, overrides, locks, limit).
create function public.save_school_calendar_entry(
  p_calendar_id uuid, p_entry_id uuid, p_day_type_code text, p_starts_on date, p_ends_on date,
  p_name_i18n jsonb, p_overrides_entry_id uuid default null, p_suppressed boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.get_tenant_id_for_user(auth.uid());
  v_cal public.school_calendars;
  v_name jsonb;
  v_id uuid;
begin
  if v_uid is null or v_tenant is null
     or not coalesce(public.has_resource_permission(v_uid, 'academic_calendar', 'update'), false)
     or not coalesce(public.has_module(v_tenant, 'events'), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into v_cal from public.school_calendars where id = p_calendar_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_cal.status = 'closed' or public.school_year_closed(v_tenant, v_cal.ec_year) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if v_cal.status <> 'draft' then
    raise exception 'approval_required' using errcode = '42501';
  end if;
  if public.school_calendar_publish_pending(v_cal.id) then
    raise exception 'approval_already_pending' using errcode = '22023';
  end if;
  v_name := public.normalize_calendar_entry_name(p_name_i18n);
  if v_name is null then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_day_type_code is null or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  begin
    if p_entry_id is null then
      insert into public.school_calendar_entries
        (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed, created_by)
      values (v_tenant, v_cal.id, p_day_type_code, p_starts_on, p_ends_on, v_name, p_overrides_entry_id,
              coalesce(p_suppressed, false), v_uid)
      returning id into v_id;
    else
      update public.school_calendar_entries
         set day_type_code = p_day_type_code, starts_on = p_starts_on, ends_on = p_ends_on, name_i18n = v_name,
             overrides_entry_id = p_overrides_entry_id, suppressed = coalesce(p_suppressed, false)
       where id = p_entry_id and calendar_id = v_cal.id and tenant_id = v_tenant
      returning id into v_id;
    end if;
  exception when unique_violation then
    raise exception 'already_overridden' using errcode = '22023';
  end;
  if v_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_id;
end $$;
revoke execute on function public.save_school_calendar_entry(uuid, uuid, text, date, date, jsonb, uuid, boolean) from public, anon, authenticated;
grant execute on function public.save_school_calendar_entry(uuid, uuid, text, date, date, jsonb, uuid, boolean) to authenticated;

create function public.delete_school_calendar_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid := public.get_tenant_id_for_user(auth.uid());
  v_cal public.school_calendars;
begin
  if v_uid is null or v_tenant is null
     or not coalesce(public.has_resource_permission(v_uid, 'academic_calendar', 'update'), false)
     or not coalesce(public.has_module(v_tenant, 'events'), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select c.* into v_cal from public.school_calendars c
    join public.school_calendar_entries e on e.calendar_id = c.id and e.tenant_id = c.tenant_id
   where e.id = p_entry_id and c.tenant_id = v_tenant
     for update of c;
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_cal.status = 'closed' or public.school_year_closed(v_tenant, v_cal.ec_year) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if v_cal.status <> 'draft' then
    raise exception 'approval_required' using errcode = '42501';
  end if;
  if public.school_calendar_publish_pending(v_cal.id) then
    raise exception 'approval_already_pending' using errcode = '22023';
  end if;
  delete from public.school_calendar_entries where id = p_entry_id and calendar_id = v_cal.id and tenant_id = v_tenant;
end $$;
revoke execute on function public.delete_school_calendar_entry(uuid) from public, anon, authenticated;
grant execute on function public.delete_school_calendar_entry(uuid) to authenticated;

-- The pending (unexpired) requests about one of the caller's school's
-- calendars, for its editors and checkers: whether a publish waits, and which
-- entries (or MoE/regional dates) a change waits on. No payload, reason or
-- maker: RLS on approval_requests still decides who reads those.
create function public.school_calendar_pending(p_calendar_id uuid)
returns table (action text, entity_id uuid, op text, overrides_entry_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.action, r.entity_id, r.payload ->> 'op', (r.payload -> 'to' ->> 'overrides_entry_id')::uuid
    from public.school_calendars c
    join public.approval_requests r on r.tenant_id = c.tenant_id
   where c.id = p_calendar_id
     and c.tenant_id = public.get_tenant_id_for_user(auth.uid())
     and public.has_module(c.tenant_id, 'events')
     and (coalesce(public.has_resource_permission(auth.uid(), 'academic_calendar', 'update'), false)
          or coalesce(public.has_resource_permission(auth.uid(), 'academic_calendar', 'approve'), false))
     and r.status = 'pending' and r.expires_at > now()
     and ((r.action = 'academic_calendar_publish' and r.entity_id = c.id)
          or (r.action = 'academic_calendar_change' and r.payload ->> 'calendar_id' = c.id::text))
$$;
revoke execute on function public.school_calendar_pending(uuid) from public, anon, authenticated;
grant execute on function public.school_calendar_pending(uuid) to authenticated;

-- ---------------------------------------------------- approval payloads --
-- Called by submit_approval (as its owner) with the maker and their school.
-- academic_calendar_publish: p_entity_id is the draft calendar; the payload
-- carries the snapshot's hash, which the approval re-checks.
-- academic_calendar_change: p_changes = {op: add|update|delete, day_type_code,
-- starts_on, ends_on, name_i18n, overrides_entry_id, suppressed}; p_entity_id
-- is the published calendar (add) or the entry (update, delete). The change is
-- tried against the guards first, in a subtransaction that is then rolled
-- back, so a request the guards would refuse is refused now, not at approval.
create function public.academic_calendar_approval_payload(
  p_action text, p_entity_id uuid, p_changes jsonb, p_uid uuid, p_tenant uuid,
  out o_entity uuid, out o_payload jsonb)
language plpgsql set search_path = public, pg_temp as $$
declare
  v_cal public.school_calendars;
  v_entry public.school_calendar_entries;
  v_snap jsonb;
  v_op text;
  v_type text;
  v_start date;
  v_end date;
  v_over uuid;
  v_supp boolean;
  v_name jsonb;
  v_from jsonb := '{}'::jsonb;
  v_to jsonb := '{}'::jsonb;
begin
  if p_action = 'academic_calendar_publish' then
    select * into v_cal from public.school_calendars where id = p_entity_id and tenant_id = p_tenant for update;
    if not found or not coalesce(public.has_resource_permission(p_uid, 'academic_calendar', 'publish'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if v_cal.status = 'closed' or public.school_year_closed(p_tenant, v_cal.ec_year) then
      raise exception 'calendar_closed' using errcode = '42501';
    end if;
    if v_cal.status <> 'draft' then
      raise exception 'invalid_state' using errcode = '22023';
    end if;
    if p_changes <> '{}'::jsonb then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    v_snap := public.school_calendar_snapshot(v_cal.id);
    o_entity := v_cal.id;
    o_payload := jsonb_build_object(
      'ec_year', v_cal.ec_year, 'entry_count', jsonb_array_length(v_snap -> 'entries'),
      'calendar_id', v_cal.id, 'snapshot_hash', public.approval_payload_hash(v_snap),
      'from', jsonb_build_object('status', 'draft'),
      'to',   jsonb_build_object('status', 'published'));
    return;
  end if;

  -- academic_calendar_change
  if not coalesce(public.has_resource_permission(p_uid, 'academic_calendar', 'update'), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
              where k not in ('op', 'day_type_code', 'starts_on', 'ends_on', 'name_i18n', 'overrides_entry_id', 'suppressed')) then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  v_op := p_changes ->> 'op';
  if v_op is null or v_op not in ('add', 'update', 'delete') then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  if v_op = 'add' then
    select * into v_cal from public.school_calendars where id = p_entity_id and tenant_id = p_tenant for update;
  else
    select * into v_entry from public.school_calendar_entries where id = p_entity_id and tenant_id = p_tenant;
    if found then
      select * into v_cal from public.school_calendars where id = v_entry.calendar_id and tenant_id = p_tenant for update;
    end if;
  end if;
  if v_cal.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_cal.status = 'closed' or public.school_year_closed(p_tenant, v_cal.ec_year) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if v_cal.status = 'draft' then
    raise exception 'approval_not_needed' using errcode = '22023';   -- edit the draft directly
  end if;
  if v_op <> 'add' then
    v_from := jsonb_build_object(
      'type', (select t.label_i18n from public.calendar_day_types t where t.code = v_entry.day_type_code),
      'day_type_code', v_entry.day_type_code, 'name_i18n', v_entry.name_i18n,
      'starts_on', v_entry.starts_on, 'ends_on', v_entry.ends_on,
      'overrides_entry_id', v_entry.overrides_entry_id, 'suppressed', v_entry.suppressed,
      'overrides', (select a.name_i18n from public.authority_calendar_entries a where a.id = v_entry.overrides_entry_id));
  end if;
  if v_op <> 'delete' then
    begin
      v_type := p_changes ->> 'day_type_code';
      v_start := (p_changes ->> 'starts_on')::date;
      v_end := (p_changes ->> 'ends_on')::date;
      v_over := nullif(p_changes ->> 'overrides_entry_id', '')::uuid;
      v_supp := coalesce((p_changes ->> 'suppressed')::boolean, false);
    exception when others then
      raise exception 'invalid_changes' using errcode = '22023';
    end;
    v_name := public.normalize_calendar_entry_name(p_changes -> 'name_i18n');
    if v_name is null then
      raise exception 'invalid_name' using errcode = '22023';
    end if;
    if v_type is null or v_start is null or v_end is null or v_end < v_start then
      raise exception 'invalid_range' using errcode = '22023';
    end if;
    v_to := jsonb_build_object(
      'type', (select t.label_i18n from public.calendar_day_types t where t.code = v_type),
      'day_type_code', v_type, 'name_i18n', v_name, 'starts_on', v_start, 'ends_on', v_end,
      'overrides_entry_id', v_over, 'suppressed', v_supp,
      'overrides', (select a.name_i18n from public.authority_calendar_entries a where a.id = v_over));
    if v_op = 'update' and v_to = v_from then
      raise exception 'no_change' using errcode = '22023';
    end if;
    -- 6: another request waiting to replace or remove the same date.
    if v_over is not null and exists (
         select 1 from public.approval_requests q
          where q.tenant_id = p_tenant and q.action = 'academic_calendar_change' and q.status = 'pending'
            and q.expires_at > now() and q.payload ->> 'calendar_id' = v_cal.id::text
            and q.payload -> 'to' ->> 'overrides_entry_id' = v_over::text
            and q.entity_id is distinct from v_entry.id) then
      raise exception 'already_overridden' using errcode = '22023';
    end if;
    -- The guards decide, exactly as they will at approval; nothing is kept.
    begin
      perform set_config('timhirt.calendar_change', 'approved', true);
      if v_op = 'add' then
        insert into public.school_calendar_entries
          (tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed, created_by)
        values (p_tenant, v_cal.id, v_type, v_start, v_end, v_name, v_over, v_supp, p_uid);
      else
        update public.school_calendar_entries
           set day_type_code = v_type, starts_on = v_start, ends_on = v_end, name_i18n = v_name,
               overrides_entry_id = v_over, suppressed = v_supp
         where id = v_entry.id;
      end if;
      raise exception 'calendar_probe_ok';
    exception
      when unique_violation then
        raise exception 'already_overridden' using errcode = '22023';
      when raise_exception then
        if sqlerrm <> 'calendar_probe_ok' then
          raise;
        end if;
    end;
  end if;
  o_entity := case when v_op = 'add' then gen_random_uuid() else v_entry.id end;
  o_payload := jsonb_build_object('ec_year', v_cal.ec_year, 'calendar_id', v_cal.id, 'op', v_op,
                                  'from', v_from, 'to', v_to);
end $$;
revoke execute on function public.academic_calendar_approval_payload(text, uuid, jsonb, uuid, uuid) from public, anon, authenticated;

-- Applies an approved academic_calendar_publish or academic_calendar_change
-- (called by execute_approval). The calendar, and for an update or delete the
-- entry, must still be exactly what the checker approved (entity_changed).
create function public.execute_academic_calendar_approval(r public.approval_requests)
returns void language plpgsql set search_path = public, pg_temp as $$
declare
  v_cal public.school_calendars;
  v_entry public.school_calendar_entries;
  v_op text := r.payload ->> 'op';
  v_from jsonb := r.payload -> 'from';
  v_to jsonb := r.payload -> 'to';
begin
  select * into v_cal from public.school_calendars
   where id = (r.payload ->> 'calendar_id')::uuid and tenant_id = r.tenant_id for update;
  if not found or public.school_year_closed(r.tenant_id, v_cal.ec_year) then
    raise exception 'entity_changed' using errcode = '40001';
  end if;
  if r.action = 'academic_calendar_publish' then
    if v_cal.status <> 'draft' or v_cal.id <> r.entity_id
       or public.approval_payload_hash(public.school_calendar_snapshot(v_cal.id)) is distinct from r.payload ->> 'snapshot_hash' then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    perform set_config('timhirt.calendar_change', 'approved', true);
    update public.school_calendars set status = 'published', published_at = now(), published_by = r.checker_id
     where id = v_cal.id;
    perform set_config('timhirt.calendar_change', '', true);
    return;
  end if;

  if v_cal.status <> 'published' then
    raise exception 'entity_changed' using errcode = '40001';
  end if;
  if v_op in ('update', 'delete') then
    select * into v_entry from public.school_calendar_entries
     where id = r.entity_id and calendar_id = v_cal.id and tenant_id = r.tenant_id for update;
    if not found
       or v_entry.day_type_code is distinct from v_from ->> 'day_type_code'
       or v_entry.starts_on is distinct from (v_from ->> 'starts_on')::date
       or v_entry.ends_on is distinct from (v_from ->> 'ends_on')::date
       or v_entry.name_i18n is distinct from v_from -> 'name_i18n'
       or v_entry.overrides_entry_id is distinct from (v_from ->> 'overrides_entry_id')::uuid
       or v_entry.suppressed is distinct from (v_from ->> 'suppressed')::boolean then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
  end if;
  perform set_config('timhirt.calendar_change', 'approved', true);
  begin
  if v_op = 'add' then
    insert into public.school_calendar_entries
      (id, tenant_id, calendar_id, day_type_code, starts_on, ends_on, name_i18n, overrides_entry_id, suppressed, created_by)
    values (r.entity_id, r.tenant_id, v_cal.id, v_to ->> 'day_type_code', (v_to ->> 'starts_on')::date,
            (v_to ->> 'ends_on')::date, v_to -> 'name_i18n', (v_to ->> 'overrides_entry_id')::uuid,
            (v_to ->> 'suppressed')::boolean, r.maker_id);
  elsif v_op = 'update' then
    update public.school_calendar_entries
       set day_type_code = v_to ->> 'day_type_code', starts_on = (v_to ->> 'starts_on')::date,
           ends_on = (v_to ->> 'ends_on')::date, name_i18n = v_to -> 'name_i18n',
           overrides_entry_id = (v_to ->> 'overrides_entry_id')::uuid, suppressed = (v_to ->> 'suppressed')::boolean
     where id = v_entry.id;
  elsif v_op = 'delete' then
    delete from public.school_calendar_entries where id = v_entry.id;
  else
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  exception when unique_violation then
    raise exception 'entity_changed' using errcode = '40001';   -- the date was replaced or removed meanwhile
  end;
  update public.school_calendars set version = version + 1 where id = v_cal.id;
  perform set_config('timhirt.calendar_change', '', true);
end $$;
revoke execute on function public.execute_academic_calendar_approval(public.approval_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------- guards --
-- A school calendar is published, changed once published, and closed only
-- by an approved request (execute_approval sets timhirt.calendar_change =
-- approved) or by its year closing (= close). Clients hold no write
-- privilege on these tables at all; this is the second line, against a
-- future definer function that forgets. Trusted contexts (none,
-- service_role, postgres, supabase_admin) are platform maintenance.
create or replace function public.school_calendars_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_trusted boolean := coalesce(current_setting('role', true), 'none') in ('none', 'service_role', 'postgres', 'supabase_admin');
  v_grant text := coalesce(current_setting('timhirt.calendar_change', true), '');
begin
  if old.status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id, new.ec_year) is distinct from (old.tenant_id, old.ec_year) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if not v_trusted then
    if tg_op = 'DELETE' then
      if old.status <> 'draft' then
        raise exception 'approval_required' using errcode = '42501';
      end if;
    elsif old.status = 'draft' and new.status = 'draft' then
      -- The draft's origin and weekend (create_school_calendar), except while
      -- its publish request waits: the checker approves what they saw.
      if public.school_calendar_publish_pending(old.id) then
        raise exception 'approval_already_pending' using errcode = '22023';
      end if;
    elsif new.status = 'published' and v_grant = 'approved' then
      null;   -- publishing, or an approved change (version)
    elsif old.status = 'published' and new.status = 'closed' and v_grant = 'close' then
      null;   -- the academic year closed
    else
      raise exception 'approval_required' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- ------------------------------------------------------------ year close --
-- Closing an academic year closes its published calendar, for good: reopening
-- the year does not reopen it (a closed calendar is the record of the year).
-- A draft cannot be closed (it was never published); it is frozen only while
-- its year is closed (school_year_closed), so reopening the year to correct
-- it lets the school finish and publish it.
create function public.academic_years_close_calendar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    perform set_config('timhirt.calendar_change', 'close', true);
    update public.school_calendars set status = 'closed', closed_at = now()
     where tenant_id = new.tenant_id and ec_year = new.ec_year and status = 'published';
    perform set_config('timhirt.calendar_change', '', true);
  end if;
  return new;
end $$;
revoke execute on function public.academic_years_close_calendar() from public, anon, authenticated;
create trigger academic_years_close_calendar after update of status on public.academic_years
  for each row execute function public.academic_years_close_calendar();

-- ------------------------------------------------------- year settings --
-- As in 20261008000001, except that a draft school calendar applies only for
-- a signed-in user who may see it (an editor or a checker previewing it): with
-- no user (service_role, a scheduled job) or for anyone else, the school layer
-- is the published one or nothing.
create or replace function public.calendar_year_settings(p_ec_year integer, p_tenant uuid default null)
returns table (
  tenant_id uuid, ec_year integer,
  school_calendar_id uuid, school_status text, school_origin text,
  region_calendar_id uuid, region_code text, moe_calendar_id uuid,
  weekend_days smallint[], session_starts_on date, session_ends_on date
)
rows 1
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_own uuid := public.get_tenant_id_for_user(auth.uid());
  v_tenant uuid := coalesce(p_tenant, v_own);
  v_authority uuid;
  v_moe uuid;
  v_school_id uuid; v_school_status text; v_school_origin text; v_school_weekend smallint[];
  v_region_id uuid; v_region_code text; v_region_weekend smallint[]; v_region_from date; v_region_to date;
  v_moe_id uuid; v_moe_weekend smallint[]; v_moe_from date; v_moe_to date;
  v_year_from date; v_year_to date;
begin
  if p_tenant is distinct from v_own and p_tenant is not null
     and coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin')
     and public.get_role_for_user(auth.uid()) is distinct from 'super_admin' then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select a.id into v_moe from public.edu_authorities a where a.kind = 'moe';
  if v_tenant is not null then
    select t.edu_authority_id into v_authority from public.tenants t where t.id = v_tenant;
    select s.id, s.status, s.origin, s.weekend_days
      into v_school_id, v_school_status, v_school_origin, v_school_weekend
      from public.school_calendars s where s.tenant_id = v_tenant and s.ec_year = p_ec_year
       and (s.status <> 'draft'
            or (auth.uid() is not null
                and (coalesce(public.has_resource_permission(auth.uid(), 'academic_calendar', 'update'), false)
                     or coalesce(public.has_resource_permission(auth.uid(), 'academic_calendar', 'approve'), false))));
  end if;
  if v_authority is not null and v_authority is distinct from v_moe then
    select c.id, a.code, c.weekend_days, c.session_starts_on, c.session_ends_on
      into v_region_id, v_region_code, v_region_weekend, v_region_from, v_region_to
      from public.authority_calendars c join public.edu_authorities a on a.id = c.authority_id
     where c.authority_id = v_authority and c.ec_year = p_ec_year and c.status in ('published', 'closed');
  end if;
  select c.id, c.weekend_days, c.session_starts_on, c.session_ends_on
    into v_moe_id, v_moe_weekend, v_moe_from, v_moe_to
    from public.authority_calendars c
   where c.authority_id = v_moe and c.ec_year = p_ec_year and c.status in ('published', 'closed');
  if v_tenant is not null and v_region_id is null and v_moe_id is null then
    -- The school's own academic year is used only when it lies in its EC
    -- year and starts no earlier than Meskerem 1 (the Nehase lead-in is for
    -- authority calendars): a school can write academic_years, and a span
    -- reaching into another year would capture its days, locked MoE holidays
    -- included (CAL-DB3-03, INV-SEC-02).
    select y.starts_on, y.ends_on into v_year_from, v_year_to
      from public.academic_years y
     where y.tenant_id = v_tenant and y.ec_year = p_ec_year
       and y.starts_on >= public.ec_to_gregorian(p_ec_year, 1, 1)
       and public.ec_session_in_year(p_ec_year, y.starts_on, y.ends_on);
  end if;
  return query select
    v_tenant, p_ec_year,
    v_school_id, v_school_status, v_school_origin,
    v_region_id, v_region_code, v_moe_id,
    coalesce(v_school_weekend, v_region_weekend, v_moe_weekend, '{6,7}'::smallint[]),
    coalesce(v_region_from, v_moe_from, v_year_from),
    coalesce(v_region_to, v_moe_to, v_year_to);
end $$;

-- -------------------------------------------------------- entry guard --
-- As in 20261008000001, plus: an entry of a published calendar changes only
-- in an approved academic_calendar_change, and a draft's entries do not change
-- while its publish request waits (trusted contexts excepted).
create or replace function public.school_calendar_entries_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  v_cal record;
  v_target record;
  v_settings record;
  v_type record;
begin
  select c.status, c.tenant_id, c.ec_year into v_cal
    from public.school_calendars c where c.id = coalesce(new.calendar_id, old.calendar_id);
  if v_cal.status = 'closed' then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if v_cal.status = 'published'
     and coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin')
     and coalesce(current_setting('timhirt.calendar_change', true), '') <> 'approved' then
    raise exception 'approval_required' using errcode = '42501';
  end if;
  if v_cal.status = 'draft'
     and coalesce(current_setting('role', true), 'none') not in ('none', 'service_role', 'postgres', 'supabase_admin')
     and public.school_calendar_publish_pending(coalesce(new.calendar_id, old.calendar_id)) then
    raise exception 'approval_already_pending' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.calendar_id, new.tenant_id) is distinct from (old.calendar_id, old.tenant_id) then
    raise exception 'calendar_closed' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from v_cal.tenant_id then
    raise exception 'invalid_calendar' using errcode = '22023';
  end if;
  select t.authority_only, t.derived into v_type from public.calendar_day_types t where t.code = new.day_type_code;
  if not found or v_type.derived or (v_type.authority_only and not new.suppressed) then
    raise exception 'invalid_day_type' using errcode = '22023';
  end if;
  if new.starts_on < public.ec_to_gregorian(v_cal.ec_year, 1, 1) - 60
     or new.ends_on > public.ec_to_gregorian(v_cal.ec_year, 13, public.ec_days_in_month(v_cal.ec_year, 13)) + 60 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  if new.overrides_entry_id is not null then
    select * into v_settings from public.calendar_year_settings(v_cal.ec_year, v_cal.tenant_id);
    select e.locked, e.calendar_id into v_target from public.authority_calendar_entries e where e.id = new.overrides_entry_id;
    -- NULL-safe: with no published layer for the year nothing is a valid target.
    if not found or not coalesce(v_target.calendar_id = any (array[v_settings.moe_calendar_id, v_settings.region_calendar_id]), false) then
      raise exception 'invalid_override' using errcode = '22023';
    end if;
    if v_target.locked then
      raise exception 'calendar_entry_locked' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.school_calendar_entries where calendar_id = new.calendar_id) >= 500 then
    raise exception 'too_many_entries' using errcode = '22023';
  end if;
  return new;
end $$;

-- ------------------------------------------------------- maker-checker --
-- submit_approval and execute_approval as in 20260927000003, with one branch
-- each for the two calendar actions.
create or replace function public.submit_approval(p_action text, p_entity_id uuid, p_changes jsonb default '{}'::jsonb, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_act    public.approval_actions;
  v_entity uuid := p_entity_id;
  v_payload jsonb;
  v_id     uuid;
  r        record;
  v_score  numeric;
  v_remark text;
  v_to     text;
  v_on     date;
  v_student uuid;
  v_subject uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  v_tenant := public.get_tenant_id_for_user(v_uid);
  if v_tenant is null then raise exception 'no_tenant' using errcode = '42501'; end if;
  select * into v_act from public.approval_actions where action = p_action;
  if not found or not v_act.available or p_action = 'manual_payment_accept' then
    -- Manual payments are submitted by the payments trigger, not by hand.
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  if v_act.module is not null and not coalesce(public.has_module(v_tenant, v_act.module), false) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'invalid_changes' using errcode = '22023';
  end if;
  -- A stale pending request must not block a new one (or keep a parked
  -- payment blocking a void).
  perform public.expire_approvals_for(v_tenant);

  if p_action = 'invoice_void' then
    select h.id,
           coalesce(sum(fi.amount_due) filter (where fi.status <> 'void'), 0) as due,
           coalesce(sum(fi.amount_paid), 0) as paid,
           count(fi.id) filter (where fi.status <> 'void') as open_lines
      into r
      from public.invoice_headers h
      left join public.fee_invoices fi on fi.invoice_header_id = h.id and fi.tenant_id = h.tenant_id
     where h.id = p_entity_id and h.tenant_id = v_tenant
     group by h.id;
    if r.id is null or not coalesce(public.has_resource_permission(v_uid, 'fee_invoices', 'update'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.open_lines = 0 then raise exception 'invoice_already_void' using errcode = '22023'; end if;
    if r.paid > 0 or exists (select 1 from public.payments p
                              where p.invoice_id = p_entity_id and p.tenant_id = v_tenant
                                and p.status in ('pending', 'succeeded')) then
      raise exception 'invoice_has_payments' using errcode = '22023';
    end if;
    v_payload := jsonb_build_object(
      'from', jsonb_build_object('amount_due', r.due, 'amount_paid', r.paid, 'open_lines', r.open_lines),
      'to',   jsonb_build_object('status', 'void'));

  elsif p_action = 'grade_edit_after_publish' then
    select g.id, g.exam_id, g.student_id, g.subject_id, g.score, g.remark, s.class_id, e.max_score,
           s.first_name, s.middle_name, s.last_name, e.name_i18n as exam_name, sj.name_i18n as subject_name
      into r
      from public.grades g
      join public.students s on s.id = g.student_id and s.tenant_id = g.tenant_id
      join public.exams e on e.id = g.exam_id and e.tenant_id = g.tenant_id
      join public.subjects sj on sj.id = g.subject_id and sj.tenant_id = g.tenant_id
     where g.id = p_entity_id and g.tenant_id = v_tenant;
    if r.id is null or not (coalesce(public.has_resource_permission(v_uid, 'grades', 'update'), false)
                            or public.is_teacher_of_class(r.class_id)) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if not coalesce(public.exam_results_published(r.exam_id), false) then
      raise exception 'approval_not_needed' using errcode = '22023';   -- edit it directly
    end if;
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('score', 'remark')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    v_score := r.score;
    if p_changes ? 'score' then
      if jsonb_typeof(p_changes -> 'score') <> 'number' then raise exception 'invalid_score' using errcode = '22023'; end if;
      v_score := (p_changes ->> 'score')::numeric;
      if v_score < 0 or v_score > r.max_score then raise exception 'invalid_score' using errcode = '22023'; end if;
    end if;
    v_remark := r.remark;
    if p_changes ? 'remark' then
      if jsonb_typeof(p_changes -> 'remark') not in ('string', 'null') then raise exception 'invalid_remark' using errcode = '22023'; end if;
      v_remark := nullif(btrim(p_changes ->> 'remark'), '');
      if char_length(v_remark) > 300 then raise exception 'invalid_remark' using errcode = '22023'; end if;
    end if;
    if v_score = r.score and v_remark is not distinct from r.remark then
      raise exception 'no_change' using errcode = '22023';
    end if;
    -- The checker sees whose grade, in which exam and subject (review CQ-2).
    v_payload := jsonb_build_object(
      'student', concat_ws(' ', r.first_name, r.middle_name, r.last_name),
      'exam', r.exam_name, 'subject', r.subject_name,
      'exam_id', r.exam_id, 'student_id', r.student_id, 'subject_id', r.subject_id,
      'from', jsonb_build_object('score', r.score, 'remark', r.remark),
      'to',   jsonb_build_object('score', v_score, 'remark', v_remark));

  elsif p_action = 'grade_entry_after_publish' then
    -- p_entity_id is the exam. The request's entity is the grade to be, with
    -- an id derived from (exam, student, subject), so a second request for
    -- the same grade is refused as already pending.
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('student_id', 'subject_id', 'score', 'remark')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    begin
      v_student := (p_changes ->> 'student_id')::uuid;
      v_subject := (p_changes ->> 'subject_id')::uuid;
    exception when others then
      raise exception 'invalid_changes' using errcode = '22023';
    end;
    select e.id, e.max_score, e.class_id as exam_class, s.class_id, s.status::text as student_status,
           s.first_name, s.middle_name, s.last_name, e.name_i18n as exam_name,
           (select sj.name_i18n from public.subjects sj where sj.id = v_subject and sj.tenant_id = v_tenant) as subject_name
      into r
      from public.exams e
      join public.students s on s.id = v_student and s.tenant_id = v_tenant
     where e.id = p_entity_id and e.tenant_id = v_tenant;
    if r.id is null
       or not exists (select 1 from public.subjects sj where sj.id = v_subject and sj.tenant_id = v_tenant)
       or not (coalesce(public.has_resource_permission(v_uid, 'grades', 'create'), false)
               or public.is_teacher_of_class(r.class_id)) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.exam_class is not null and r.class_id is distinct from r.exam_class then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if not coalesce(public.exam_results_published(r.id), false) then
      raise exception 'approval_not_needed' using errcode = '22023';
    end if;
    if exists (select 1 from public.grades g where g.tenant_id = v_tenant and g.exam_id = r.id
                  and g.student_id = v_student and g.subject_id = v_subject) then
      raise exception 'grade_exists' using errcode = '22023';
    end if;
    if jsonb_typeof(p_changes -> 'score') is distinct from 'number' then raise exception 'invalid_score' using errcode = '22023'; end if;
    v_score := (p_changes ->> 'score')::numeric;
    if v_score < 0 or v_score > r.max_score then raise exception 'invalid_score' using errcode = '22023'; end if;
    v_remark := null;
    if p_changes ? 'remark' then
      if jsonb_typeof(p_changes -> 'remark') not in ('string', 'null') then raise exception 'invalid_remark' using errcode = '22023'; end if;
      v_remark := nullif(btrim(p_changes ->> 'remark'), '');
      if char_length(v_remark) > 300 then raise exception 'invalid_remark' using errcode = '22023'; end if;
    end if;
    v_entity := md5('grade_entry:' || r.id || ':' || v_student || ':' || v_subject)::uuid;
    v_payload := jsonb_build_object(
      'student', concat_ws(' ', r.first_name, r.middle_name, r.last_name),
      'exam', r.exam_name, 'subject', r.subject_name,
      'exam_id', r.id, 'student_id', v_student, 'subject_id', v_subject,
      'from', jsonb_build_object('score', null, 'remark', null),
      'to',   jsonb_build_object('score', v_score, 'remark', v_remark));

  elsif p_action = 'student_transfer_out' then
    select st.id, st.status::text as status into r
      from public.students st where st.id = p_entity_id and st.tenant_id = v_tenant;
    if r.id is null or not coalesce(public.has_resource_permission(v_uid, 'students', 'update'), false) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if r.status <> 'active' then raise exception 'invalid_state' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('transferred_to', 'transferred_reason', 'transferred_on')) then
      raise exception 'invalid_changes' using errcode = '22023';
    end if;
    v_to := nullif(btrim(p_changes ->> 'transferred_to'), '');
    if v_to is null or char_length(v_to) > 200 then raise exception 'invalid_transferred_to' using errcode = '22023'; end if;
    if char_length(p_changes ->> 'transferred_reason') > 500 then raise exception 'reason_too_long' using errcode = '22023'; end if;
    begin
      v_on := (p_changes ->> 'transferred_on')::date;
    exception when others then
      raise exception 'invalid_transferred_on' using errcode = '22023';
    end;
    if v_on is null then raise exception 'invalid_transferred_on' using errcode = '22023'; end if;
    v_payload := jsonb_build_object(
      'from', jsonb_build_object('status', r.status),
      'to',   jsonb_build_object('status', 'transferred', 'transferred_to', v_to,
                                 'transferred_reason', nullif(btrim(p_changes ->> 'transferred_reason'), ''),
                                 'transferred_on', v_on));
  elsif p_action in ('academic_calendar_publish', 'academic_calendar_change') then
    select x.o_entity, x.o_payload into v_entity, v_payload
      from public.academic_calendar_approval_payload(p_action, p_entity_id, p_changes, v_uid, v_tenant) x;
  else
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;

  begin
    insert into public.approval_requests (tenant_id, action, entity_table, entity_id, payload, payload_hash, maker_id, reason)
    values (v_tenant, p_action, v_act.entity_table, v_entity, v_payload, public.approval_payload_hash(v_payload), v_uid,
            nullif(btrim(p_reason), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'approval_already_pending' using errcode = '22023';
  end;
  return v_id;
end $$;

create or replace function public.execute_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.approval_requests;
  n int;
  v_to jsonb;
  v_from jsonb;
  v_pay public.payments;
  v_due numeric;
  v_paid numeric;
  v_open int;
  v_balance numeric;
begin
  select * into r from public.approval_requests where id = p_id for update;
  if not found or r.status <> 'approved' then raise exception 'approval_not_approved' using errcode = '22023'; end if;
  if public.approval_payload_hash(r.payload) <> r.payload_hash then
    raise exception 'payload_tampered' using errcode = '22023';
  end if;
  v_to := r.payload -> 'to';
  v_from := r.payload -> 'from';

  if r.action = 'manual_payment_accept' then
    select * into v_pay from public.payments where id = r.entity_id and tenant_id = r.tenant_id;
    if not found or v_pay.invoice_id is distinct from (r.payload ->> 'invoice_id')::uuid then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    -- Lock order: header, then lines. The approved amount must still be owed.
    perform 1 from public.invoice_headers where id = v_pay.invoice_id and tenant_id = r.tenant_id for update;
    perform 1 from public.fee_invoices where invoice_header_id = v_pay.invoice_id and tenant_id = r.tenant_id
      order by created_at for update;
    select coalesce(sum(amount_due - amount_paid) filter (where status <> 'void'), 0) into v_balance
      from public.fee_invoices where invoice_header_id = v_pay.invoice_id and tenant_id = r.tenant_id;
    if v_pay.amount > v_balance then
      raise exception 'entity_changed' using errcode = '40001',
        hint = 'The invoice no longer owes this amount.';
    end if;
    update public.payments set status = 'succeeded', paid_at = now()
     where id = r.entity_id and tenant_id = r.tenant_id and status = 'pending'
       and amount = (r.payload ->> 'amount')::numeric;
  elsif r.action = 'invoice_void' then
    perform 1 from public.invoice_headers where id = r.entity_id and tenant_id = r.tenant_id for update;
    perform 1 from public.fee_invoices where invoice_header_id = r.entity_id and tenant_id = r.tenant_id
      order by created_at for update;
    select coalesce(sum(amount_due) filter (where status <> 'void'), 0), coalesce(sum(amount_paid), 0),
           count(*) filter (where status <> 'void')
      into v_due, v_paid, v_open
      from public.fee_invoices where invoice_header_id = r.entity_id and tenant_id = r.tenant_id;
    -- The checker approved voiding exactly what the request showed.
    if v_due <> (v_from ->> 'amount_due')::numeric or v_paid <> (v_from ->> 'amount_paid')::numeric
       or v_open <> (v_from ->> 'open_lines')::int or v_paid > 0
       or exists (select 1 from public.payments where invoice_id = r.entity_id and tenant_id = r.tenant_id
                    and status in ('pending', 'succeeded')) then
      raise exception 'entity_changed' using errcode = '40001';
    end if;
    update public.fee_invoices set status = 'void'
     where invoice_header_id = r.entity_id and tenant_id = r.tenant_id and status <> 'void' and amount_paid = 0;
    get diagnostics n = row_count;
    if n <> v_open then raise exception 'entity_changed' using errcode = '40001'; end if;
  elsif r.action = 'grade_edit_after_publish' then
    update public.grades set score = (v_to ->> 'score')::numeric, remark = v_to ->> 'remark'
     where id = r.entity_id and tenant_id = r.tenant_id
       and score = (v_from ->> 'score')::numeric and remark is not distinct from (v_from ->> 'remark');
  elsif r.action = 'grade_entry_after_publish' then
    begin
      insert into public.grades (id, tenant_id, student_id, exam_id, subject_id, score, remark, entered_by)
      values (r.entity_id, r.tenant_id, (r.payload ->> 'student_id')::uuid, (r.payload ->> 'exam_id')::uuid,
              (r.payload ->> 'subject_id')::uuid, (v_to ->> 'score')::numeric, v_to ->> 'remark', r.maker_id);
    exception when unique_violation then
      raise exception 'entity_changed' using errcode = '40001';   -- entered meanwhile
    end;
    n := 1;
  elsif r.action = 'student_transfer_out' then
    update public.students
       set status = 'transferred', transferred_to = v_to ->> 'transferred_to',
           transferred_reason = v_to ->> 'transferred_reason', transferred_on = (v_to ->> 'transferred_on')::date
     where id = r.entity_id and tenant_id = r.tenant_id and status::text = v_from ->> 'status';
  elsif r.action in ('academic_calendar_publish', 'academic_calendar_change') then
    perform public.execute_academic_calendar_approval(r);
    n := 1;
  else
    raise exception 'approval_action_unavailable' using errcode = '22023';
  end if;
  if r.action not in ('invoice_void', 'grade_entry_after_publish', 'academic_calendar_publish', 'academic_calendar_change') then
    get diagnostics n = row_count;
  end if;
  if n = 0 then
    -- The entity moved on since the request was made; nothing is applied and
    -- the caller's transaction (the approval itself) rolls back.
    raise exception 'entity_changed' using errcode = '40001';
  end if;

  update public.approval_requests set status = 'executed', executed_at = now() where id = p_id;

  -- An approved manual payment tells the student and their guardians, as
  -- record-fee-payment does for one that needs no approval (review CQ-1).
  -- The unique index (recipient, kind, payment) makes it idempotent.
  if r.action = 'manual_payment_accept' then
    insert into public.portal_notifications (tenant_id, recipient_id, student_id, kind, invoice_id, payment_id, amount)
    select r.tenant_id, u.user_id, h.student_id, 'payment_received', h.id, v_pay.id, v_pay.amount
      from public.invoice_headers h
      cross join lateral (
        select s.user_id from public.students s
         where s.id = h.student_id and s.tenant_id = r.tenant_id and s.user_id is not null
        union
        select g.user_id from public.guardians g
         where g.student_id = h.student_id and g.tenant_id = r.tenant_id and g.user_id is not null) u
     where h.id = v_pay.invoice_id and h.tenant_id = r.tenant_id
    on conflict do nothing;
  end if;
end $$;

-- Years already closed before this migration (none had a published school
-- calendar, which only this slice can produce; kept for correctness).
select set_config('timhirt.calendar_change', 'close', true);
update public.school_calendars c set status = 'closed', closed_at = now()
  from public.academic_years y
 where y.tenant_id = c.tenant_id and y.ec_year = c.ec_year and y.status = 'closed' and c.status = 'published';
select set_config('timhirt.calendar_change', '', true);
