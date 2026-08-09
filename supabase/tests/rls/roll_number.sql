-- ============================================================================
-- Roll number auto-assignment (migration 20260803000001) and the uniqueness
-- backstop on top of it (20260815000001).
--
-- roll_number used to be free-typed and nothing computed it. The trigger
-- makes it "how many active students are already in this section, plus
-- one" on every insert and on every class_id change -- proves the count is
-- right, that a transfer recomputes the destination section without
-- disturbing the source section, and that a manually-corrected roll number
-- survives an update that doesn't actually change the section (the "OF
-- class_id" + IS NOT DISTINCT FROM guard).
--
-- That same guard is exactly what let a genuine duplicate through: a
-- same-class resave with a hand-typed roll_number never revisits the
-- trigger's count logic at all, so nothing checked it against the section's
-- other active students. students_active_roll_number_unique closes that;
-- these assertions prove it rejects a real collision while leaving the
-- deliberate "departed student's slot gets reused" behavior (already proven
-- above) untouched.
-- ============================================================================
begin;
select plan(13);

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

-- ---------- A genuine duplicate among active students is now rejected -------
-- alpha and beta are both active in class dddd (roll #2 and #1). A
-- same-class resave that hand-types alpha's roll_number to collide with
-- beta's must be rejected, not silently accepted.
select throws_ok(
  format($stmt$ update public.students set class_id = 'dddd0000-0000-0000-0000-00000000000d', roll_number = '1'
         where id = %L $stmt$, :'alpha_id'),
  '23505', null, 'a hand-typed roll_number colliding with another ACTIVE student in the same section is rejected');

select is((select roll_number from public.students where id = :'alpha_id'), '2',
  'the rejected update left alpha''s roll_number unchanged');

-- ---------- The deliberate departed-student reuse is NOT affected -----------
-- gamma (graduated) and delta (active) both legitimately hold roll_number
-- '3' in class cccc -- proven above -- and the partial index (status =
-- 'active' only) must not treat that coexistence as a violation.
select is((select roll_number from public.students where id = :'gamma_id'), '3',
  'the graduated student keeps its old roll_number -- not cleared by the new index');
select is((select roll_number from public.students where id = :'delta_id'), '3',
  'the active student reusing that freed slot is unaffected by the graduated student sharing the same value');

select * from finish();
rollback;
