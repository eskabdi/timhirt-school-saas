-- ============================================================================
-- Staff ID card printing (§21.9): issue-staff-id writes into the same
-- generic id_cards / id_card_batches tables the student pipeline already
-- uses (batch_type and subject_type both already list 'staff'/'staff_id' —
-- 20260713000007 anticipated this, nothing to add there). What's missing is
-- access: id_card_batches, id_cards' RLS, and both id-cards storage read
-- policies admit only school_admin/registrar, so hr_officer — the role this
-- whole staff module is built for — could never see a staff ID card row or
-- list history (caught by staff_id_card_access.sql failing on the batch
-- insert before this policy was added, not just assumed). Same shape as the
-- documents/avatars gaps fixed in the registration commit.
-- ============================================================================
drop policy if exists idbatch_all on public.id_card_batches;
create policy idbatch_all on public.id_card_batches for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

drop policy if exists idcards_select on public.id_cards;
create policy idcards_select on public.id_cards for select to authenticated using (
  tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

drop policy if exists idcards_write on public.id_cards;
create policy idcards_write on public.id_cards for all to authenticated
using (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'))
with check (tenant_id = (select public.get_tenant_id_for_user(auth.uid()))
       and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

drop policy if exists "admin read id-cards" on storage.objects;
create policy "admin read id-cards" on storage.objects for select to authenticated
using (bucket_id = 'id-cards'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));

drop policy if exists "tenant read id cards" on storage.objects;
create policy "tenant read id cards" on storage.objects for select to authenticated
using (bucket_id = 'id-cards'
  and (storage.foldername(name))[1] = (select public.get_tenant_id_for_user(auth.uid()))::text
  and (select public.get_role_for_user(auth.uid())) in ('school_admin','registrar','hr_officer'));
