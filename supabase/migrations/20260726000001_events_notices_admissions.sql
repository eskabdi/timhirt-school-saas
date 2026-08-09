-- ============================================================================
-- Three screens' worth of schema: a richer calendar event, a notice board, and
-- an admission review checklist.
--
-- Role visibility is stored as text[] of public.user_role names rather than a
-- join table: it is a short, fixed vocabulary written once with the record and
-- read back whole, never queried across. A join table would add two writes and
-- a join for no gain. The values are constrained by a trigger-free check
-- against the enum's labels so a typo cannot land.
-- ============================================================================

-- ---------- Calendar events -------------------------------------------------
-- event_date stays the START date (existing rows keep their meaning); end_date
-- is nullable and, when set, spans through it inclusively.
alter table public.calendar_events
  add column if not exists end_date        date,
  add column if not exists notes           text check (notes is null or length(notes) <= 1000),
  add column if not exists color           text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists visible_to_roles text[],
  add column if not exists all_schools     boolean not null default false,
  add column if not exists created_by      uuid;

alter table public.calendar_events
  drop constraint if exists calendar_events_date_span;
alter table public.calendar_events
  add constraint calendar_events_date_span
  check (end_date is null or end_date >= event_date);

-- ---------- Notices ---------------------------------------------------------
-- body_html is authored by school staff in the notice editor. It is rendered
-- through an allow-list HTML-to-React renderer on the client (react/no-danger
-- is an eslint error in this repo), so no raw markup ever reaches innerHTML.
create table if not exists public.notices (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  title_i18n        jsonb not null,
  body_html         text check (body_html is null or length(body_html) <= 20000),
  visible_from      date not null,
  visible_to        date not null,
  sort_order        integer not null default 0,
  visible_all_school boolean not null default false,
  visible_to_roles  text[],
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint notices_visible_span check (visible_to >= visible_from)
);
create index if not exists notices_tenant_window on public.notices (tenant_id, visible_from, visible_to);

drop trigger if exists notices_updated on public.notices;
create trigger notices_updated before update on public.notices
for each row execute function public.set_updated_at();

drop trigger if exists audit_notices on public.notices;
create trigger audit_notices after insert or update or delete on public.notices
for each row execute function public.audit_trigger();

alter table public.notices enable row level security;
alter table public.notices force row level security;

drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated using (
  (select public.get_role_for_user(auth.uid())) = 'super_admin'
  or (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
      and (
        -- Staff who manage notices always see them; everyone else only sees a
        -- notice addressed to their role, and only inside its visible window.
        (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar')
        or (
          current_date between visible_from and visible_to
          and (visible_all_school
               or visible_to_roles is null
               or (select public.get_role_for_user(auth.uid())) = any (visible_to_roles))
        )
      ))
);

drop policy if exists notices_write on public.notices;
create policy notices_write on public.notices for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar'));

-- ---------- Admission review checklist --------------------------------------
-- Six independent steps rather than one "progress" integer: reviewers complete
-- them out of order (finance often clears before the academic check), so a
-- single monotonic counter would misrepresent the real state.
alter table public.admission_applications
  add column if not exists application_complete         boolean not null default false,
  add column if not exists meets_academic_requirements  boolean not null default false,
  add column if not exists meets_financial_requirements boolean not null default false,
  add column if not exists documents_verified           boolean not null default false,
  add column if not exists acceptance_letter_sent       boolean not null default false,
  add column if not exists student_accepted             boolean not null default false,
  add column if not exists reviewed_by                  uuid,
  add column if not exists reviewed_at                  timestamptz;

-- New enrollment statuses. The original five labels stay so existing rows keep
-- resolving. Postgres allows ADD VALUE inside a transaction; the new labels are
-- only *added* here, never used in this migration, which is the restriction.
alter type public.admission_stage add value if not exists 'incomplete_application';
alter type public.admission_stage add value if not exists 'provisionally_accepted';
alter type public.admission_stage add value if not exists 'accepted';
alter type public.admission_stage add value if not exists 'waitlisted';
alter type public.admission_stage add value if not exists 'enrolled';
