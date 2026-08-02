-- ============================================================================
-- Staff messages: private 1:1 correspondence with replies.
--
-- Unlike notices/announcements (broadcast, school_admin/registrar manage
-- everything), a message is visible ONLY to its sender and recipient -- no
-- role gets a blanket read here. That, and the staff-only insert guard (a
-- message can't target a student/parent), are the two things this file
-- actually needs to prove rather than assume.
-- ============================================================================
begin;
select plan(14);

-- ---------- Fixtures ---------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', 'ea000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'msg-hr-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ea000002-0000-0000-0000-000000000002',
   'authenticated', 'authenticated', 'msg-teacher-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ea000003-0000-0000-0000-000000000003',
   'authenticated', 'authenticated', 'msg-teacher2-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ea000004-0000-0000-0000-000000000004',
   'authenticated', 'authenticated', 'msg-parent-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'ea000005-0000-0000-0000-000000000005',
   'authenticated', 'authenticated', 'msg-student-a@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eb000001-0000-0000-0000-000000000001',
   'authenticated', 'authenticated', 'msg-hr-b@test.example', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

insert into public.tenants (id, name, slug, status) values
  ('ea000000-0000-0000-0000-00000000000a', 'Message Tenant A', 'msg-tenant-a', 'active'),
  ('eb000000-0000-0000-0000-00000000000b', 'Message Tenant B', 'msg-tenant-b', 'active');

insert into public.users (id, tenant_id, role, full_name, email) values
  ('ea000001-0000-0000-0000-000000000001', 'ea000000-0000-0000-0000-00000000000a', 'hr_officer', 'HR A',      'msg-hr-a@test.example'),
  ('ea000002-0000-0000-0000-000000000002', 'ea000000-0000-0000-0000-00000000000a', 'teacher',    'Teacher A', 'msg-teacher-a@test.example'),
  ('ea000003-0000-0000-0000-000000000003', 'ea000000-0000-0000-0000-00000000000a', 'teacher',    'Teacher A2','msg-teacher2-a@test.example'),
  ('ea000004-0000-0000-0000-000000000004', 'ea000000-0000-0000-0000-00000000000a', 'parent',     'Parent A',  'msg-parent-a@test.example'),
  ('ea000005-0000-0000-0000-000000000005', 'ea000000-0000-0000-0000-00000000000a', 'student',    'Student A', 'msg-student-a@test.example'),
  ('eb000001-0000-0000-0000-000000000001', 'eb000000-0000-0000-0000-00000000000b', 'hr_officer', 'HR B',      'msg-hr-b@test.example');

-- ---------- As Tenant A's HR officer -----------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ea000001-0000-0000-0000-000000000001';

select lives_ok(
  $stmt$ insert into public.messages (tenant_id, sender_id, recipient_id, title, body)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea000001-0000-0000-0000-000000000001',
                 'ea000002-0000-0000-0000-000000000002',
                 'Welcome', 'Please see the updated timetable.') $stmt$,
  'HR can message a teacher in the same tenant');

select is(
  (select thread_id from public.messages where title = 'Welcome'),
  (select id from public.messages where title = 'Welcome'),
  'thread_id defaults to the message''s own id when left unset');

select throws_ok(
  $stmt$ insert into public.messages (tenant_id, sender_id, recipient_id, title, body)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea000001-0000-0000-0000-000000000001',
                 'ea000004-0000-0000-0000-000000000004',
                 'Oops', 'This should not be allowed.') $stmt$,
  null, null,
  'HR cannot message a parent -- staff-only insert guard rejects the recipient role');

select throws_ok(
  $stmt$ insert into public.messages (tenant_id, sender_id, recipient_id, title, body)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea000001-0000-0000-0000-000000000001',
                 'ea000005-0000-0000-0000-000000000005',
                 'Oops', 'This should not be allowed.') $stmt$,
  null, null,
  'HR cannot message a student -- staff-only insert guard rejects the recipient role');

select throws_ok(
  $stmt$ insert into public.messages (tenant_id, sender_id, recipient_id, title, body)
         values ('ea000000-0000-0000-0000-00000000000a',
                 'ea000001-0000-0000-0000-000000000001',
                 'eb000001-0000-0000-0000-000000000001',
                 'Oops', 'Cross-tenant recipient.') $stmt$,
  null, null,
  'HR cannot message a user in a different tenant');

select is(
  (select count(*)::int from public.messages),
  1, 'only the one legitimate message exists after the rejected attempts');

-- ---------- As Tenant A's Teacher (the recipient) ----------------------------
set local request.jwt.claim.sub = 'ea000002-0000-0000-0000-000000000002';

select is(
  (select count(*)::int from public.messages),
  1, 'the recipient sees the message sent to them');

select lives_ok(
  $stmt$ insert into public.messages (tenant_id, thread_id, sender_id, recipient_id, title, body)
         values ('ea000000-0000-0000-0000-00000000000a',
                 (select thread_id from public.messages where title = 'Welcome'),
                 'ea000002-0000-0000-0000-000000000002',
                 'ea000001-0000-0000-0000-000000000001',
                 'Re: Welcome', 'Thanks, got it.') $stmt$,
  'the recipient can reply into the same thread');

select is(
  (select count(*)::int from public.messages
   where thread_id = (select id from public.messages where title = 'Welcome')),
  2, 'the thread now has both the original message and the reply');

select lives_ok(
  $stmt$ update public.messages set read_at = now() where title = 'Welcome' $stmt$,
  'the recipient can mark the message they received as read');

select isnt(
  (select read_at from public.messages where title = 'Welcome'), null,
  'read_at is actually set after the update');

-- ---------- As Tenant A's other teacher (not a party to the thread) ---------
set local request.jwt.claim.sub = 'ea000003-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.messages),
  0, 'a staff member who is neither sender nor recipient sees nothing -- no role-wide bypass');

-- 'Re: Welcome' was sent by the teacher (ea000002) to HR (ea000001), so only
-- ea000001 is its recipient. This non-party's update should silently touch
-- zero rows rather than erroring (RLS filters the target row out of the
-- UPDATE, same as it would out of a SELECT).
update public.messages set read_at = now() where title = 'Re: Welcome';

-- ---------- Back as the actual recipient: confirm the update above was a no-op
set local request.jwt.claim.sub = 'ea000001-0000-0000-0000-000000000001';

select is(
  (select read_at from public.messages where title = 'Re: Welcome'),
  null, 'the non-recipient''s update above did not actually set read_at');

-- ---------- As Tenant B's HR officer (different tenant entirely) ------------
set local request.jwt.claim.sub = 'eb000001-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.messages),
  0, 'a different tenant sees none of tenant A''s messages');

select * from finish();
rollback;
