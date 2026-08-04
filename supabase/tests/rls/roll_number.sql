-- ============================================================================
-- Roll number auto-assignment (migration 20260803000001).
--
-- roll_number used to be free-typed and nothing computed it. The trigger
-- makes it "how many active students are already in this section, plus
-- one" on every insert and on every class_id change -- proves the count is
-- right, that a transfer recomputes the destination section without
-- disturbing the source section, and that a manually-corrected roll number
-- survives an update that doesn't actually change the section (the "OF
-- class_id" + IS NOT DISTINCT FROM guard).
-- ============================================================================
begin;
select plan(9);

insert into public.tenants (id, name, slug, status) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'Roll Number Tenant', 'roll-number-tenant', 'active');

insert into public.academic_years (id, tenant_id, ec_year, label_i18n, starts_on, ends_on, status) values
  ('bbbb0000-0000-0000-0000-00000000000b', 'aaaa0000-0000-0000-0000-00000000000a',
   2018, '{"en":"2018"}'::jsonb, '2025-09-01', '2026-06-30', 'active');

insert into public.classes (id, tenant_id, academic_year_id, name, section) values
  ('cccc0000-0000-0000-0000-00000000000c', 'aaaa0000-0000-0000-0000-00000000000a',
   'bbbb0000-0000-0000-0000-00000000000b', 'Grade 1', 'A'),
  ('dddd0000-0000-0000-0000-00000000000d', 'aaaa0000-0000-0000-0000-00000000000a',
   'bbbb0000-0000-0000-0000-00000000000b', 'Grade 1', 'B');

-- ---------- Sequential assignment on insert ----------------------------------
insert into public.students (tenant_id, class_id, first_name, last_name, date_of_birth, gender)
values ('aaaa0000-0000-0000-0000-00000000000a', 'cccc0000-0000-0000-0000-00000000000c', 'Alpha', 'One', '2015-01-01', 'male')
returning id \gset alpha_

insert into public.students (tenant_id, class_id, first_name, last_name, date_of_birth, gender)
values ('aaaa0000-0000-0000-0000-00000000000a', 'cccc0000-0000-0000-0000-00000000000c', 'Beta', 'Two', '2015-01-01', 'female')
returning id \gset beta_

insert into public.students (tenant_id, class_id, first_name, last_name, date_of_birth, gender)
values ('aaaa0000-0000-0000-0000-00000000000a', 'cccc0000-0000-0000-0000-00000000000c', 'Gamma', 'Three', '2015-01-01', 'male')
returning id \gset gamma_

select is((select roll_number from public.students where id = :'alpha_id'), '1', 'first student in the section is roll #1');
select is((select roll_number from public.students where id = :'beta_id'), '2', 'second student in the section is roll #2');
select is((select roll_number from public.students where id = :'gamma_id'), '3', 'third student in the section is roll #3');

-- ---------- A graduated student does not count toward the next roll number ---
update public.students set status = 'graduated' where id = :'gamma_id';

insert into public.students (tenant_id, class_id, first_name, last_name, date_of_birth, gender)
values ('aaaa0000-0000-0000-0000-00000000000a', 'cccc0000-0000-0000-0000-00000000000c', 'Delta', 'Four', '2015-01-01', 'female')
returning id \gset delta_

select is((select roll_number from public.students where id = :'delta_id'), '3',
  'a graduated student frees up its roll position -- count only includes active students');

-- ---------- Transfer: destination section recomputes, source is untouched ----
update public.students set class_id = 'dddd0000-0000-0000-0000-00000000000d' where id = :'beta_id';

select is((select roll_number from public.students where id = :'beta_id'), '1',
  'transferring into an empty section assigns roll #1 there');
select is((select roll_number from public.students where id = :'alpha_id'), '1',
  'the source section''s remaining student keeps its own roll number -- no re-pack');

-- ---------- Manual override survives a same-class resave ----------------------
update public.students set roll_number = '99' where id = :'alpha_id';
update public.students set class_id = 'cccc0000-0000-0000-0000-00000000000c' where id = :'alpha_id';

select is((select roll_number from public.students where id = :'alpha_id'), '99',
  'resaving the SAME class_id does not clobber a manually-corrected roll number');

-- ---------- A genuine second transfer still recomputes -----------------------
update public.students set class_id = 'dddd0000-0000-0000-0000-00000000000d' where id = :'alpha_id';

select is((select roll_number from public.students where id = :'alpha_id'), '2',
  'an actual class change still recomputes, even after a prior manual override');
select is((select count(*)::int from public.students
            where class_id = 'dddd0000-0000-0000-0000-00000000000d' and status = 'active'),
  2, 'both transferred students now sit in the destination section');

select * from finish();
rollback;
