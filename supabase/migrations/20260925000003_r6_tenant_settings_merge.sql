-- ============================================================================
-- R6 WP-01 round 3 (reviews CQ M-1, i18n N-01): merge a settings section on
-- the server instead of writing the whole tenant_configs.settings document.
--
-- Every settings page used to read settings, spread in its own key and upsert
-- the whole object. If the read had not finished, or had failed, the page
-- spread `{}` and the save erased every other section (branding, ID-card
-- template, billing, calendar). With PITR off, that is unrecoverable. Two
-- admins saving different sections at once also lost one of the two writes.
--
-- merge_tenant_settings(section, value) replaces exactly one top-level
-- section, in one UPDATE (row-locked, so concurrent saves of different
-- sections both land). SECURITY INVOKER: RLS (configs_write, school_admin of
-- the tenant) is the authorization, exactly as for the direct upsert it
-- replaces. The tenant is always the caller's; there is no tenant parameter.
-- ============================================================================
create or replace function public.merge_tenant_settings(p_section text, p_value jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_tenant_id_for_user(auth.uid());
  v_settings jsonb;
begin
  if v_tenant is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_section is null or p_section not in ('calendar', 'branding', 'idCardTemplate', 'billing') then
    raise exception 'unknown_settings_section' using errcode = '22023';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'invalid_settings_value' using errcode = '22023';
  end if;

  update public.tenant_configs
     set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(p_section, p_value),
         updated_at = now()
   where tenant_id = v_tenant
  returning settings into v_settings;

  if not found then
    -- No row yet, or RLS hides it from this caller; the insert is then
    -- refused by configs_write (42501) for anyone but the tenant's admin.
    insert into public.tenant_configs (tenant_id, settings)
    values (v_tenant, jsonb_build_object(p_section, p_value))
    returning settings into v_settings;
  end if;
  return v_settings;
end
$$;

revoke execute on function public.merge_tenant_settings(text, jsonb) from public, anon;
grant execute on function public.merge_tenant_settings(text, jsonb) to authenticated;
