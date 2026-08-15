-- R4-B3: exam scheduling fields -- ExamsPage.tsx already rendered an
-- EthDatePicker for "window start" but never sent its value anywhere; the
-- exams table had nowhere to put it. All four fields are nullable: exams
-- are created well ahead of a room/time being finalized, and every exam
-- that already exists in production predates scheduling entirely.
--
-- exam_date is Gregorian storage per §17.2 -- same toIsoDate() convention
-- every other date-picker-backed column in this schema uses; presentation
-- goes through <EthDate/>, never a raw render.
alter table public.exams
  add column exam_type_name text,
  add column exam_date      date,
  add column start_time     time,
  add column end_time       time,
  add column room           text,
  add constraint exams_time_order check (start_time is null or end_time is null or end_time > start_time);
