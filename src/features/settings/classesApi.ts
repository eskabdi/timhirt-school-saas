// Typed Supabase calls for the Classes list + detail pages. RLS injects
// tenant_id server-side (§8.1) -- no .eq('tenant_id', …) needed here.
import { supabase } from "@/lib/supabase";

export interface ClassRow {
  id: string;
  name: string;
  section: string | null;
  grade_level: number | null;
  capacity: number | null;
  academic_year_id: string;
  homeroom_teacher_id: string | null;
  shift: string | null;
}

export interface ClassFilters {
  search?: string;
  gradeLevel?: string;
  section?: string;
  academicYearId?: string;
}

export async function listClasses(filters: ClassFilters = {}, range?: [number, number]) {
  let q = supabase.from("classes")
    .select("id,name,section,grade_level,capacity,academic_year_id,homeroom_teacher_id,shift", { count: "exact" })
    .order("grade_level").order("section");
  if (filters.search) q = q.or(`name.ilike.%${filters.search}%,section.ilike.%${filters.search}%`);
  if (filters.gradeLevel) q = q.eq("grade_level", Number(filters.gradeLevel));
  if (filters.section) q = q.eq("section", filters.section);
  if (filters.academicYearId) q = q.eq("academic_year_id", filters.academicYearId);
  if (range) q = q.range(range[0], range[1]);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as ClassRow[], count: count ?? 0 };
}

/** Active-student count per class, tenant-wide -- one lightweight query
 *  (just id + class_id) rather than N per-row count queries. */
export async function listEnrolledCounts(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from("students").select("class_id").eq("status", "active");
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const s of data ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
  return counts;
}

export async function listActiveAcademicYears() {
  const { data, error } = await supabase.from("academic_years").select("id,ec_year,starts_on,ends_on").eq("status", "active").order("ec_year", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export interface TeacherOption {
  id: string;
  staff_no: string;
  user: { full_name: string } | null;
}

export async function listTeachers(): Promise<TeacherOption[]> {
  const { data, error } = await supabase.from("teachers").select("id, staff_no, user:users(full_name)").order("staff_no");
  if (error) throw error;
  return (data ?? []) as unknown as TeacherOption[];
}

export interface ClassInput {
  name: string;
  section: string;
  gradeLevel: string;
  capacity: string;
  homeroomTeacherId: string;
  shift: string;
}

export async function createClass(tenantId: string, academicYearId: string, input: ClassInput) {
  const { error } = await supabase.from("classes").insert({
    tenant_id: tenantId,
    academic_year_id: academicYearId,
    name: input.name,
    section: input.section || null,
    grade_level: input.gradeLevel === "" ? null : Number(input.gradeLevel),
    capacity: input.capacity === "" ? null : Number(input.capacity),
    homeroom_teacher_id: input.homeroomTeacherId || null,
    shift: input.shift || null,
  });
  if (error) throw error;
}

export async function updateClass(id: string, input: ClassInput) {
  const { error } = await supabase.from("classes").update({
    name: input.name,
    section: input.section || null,
    grade_level: input.gradeLevel === "" ? null : Number(input.gradeLevel),
    capacity: input.capacity === "" ? null : Number(input.capacity),
    homeroom_teacher_id: input.homeroomTeacherId || null,
    shift: input.shift || null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteClass(id: string) {
  const { error } = await supabase.from("classes").delete().eq("id", id);
  if (error) throw error;
}

export interface ClassDetail extends ClassRow {
  academic_years: { ec_year: number } | null;
  users: { full_name: string } | null; // homeroom teacher, via teachers -> users
}

export async function getClassDetail(id: string) {
  const { data, error } = await supabase.from("classes")
    .select("id,name,section,grade_level,capacity,academic_year_id,shift, academic_years(ec_year), homeroom_teacher_id")
    .eq("id", id).single();
  if (error) throw error;

  // classes.homeroom_teacher_id carries no foreign key (20260713000002), so
  // PostgREST can't embed it via a schema-cache relationship -- a
  // `teachers:homeroom_teacher_id(...)` select 400s with PGRST200 ("Could
  // not find a relationship"). Fetch the name as a second, explicit query.
  let teacherName: string | null = null;
  if (data.homeroom_teacher_id) {
    const { data: teacher } = await supabase.from("teachers")
      .select("users(full_name)")
      .eq("id", data.homeroom_teacher_id)
      .maybeSingle();
    teacherName = (teacher as unknown as { users: { full_name: string } | null } | null)?.users?.full_name ?? null;
  }

  return {
    ...data,
    teachers: teacherName ? { users: { full_name: teacherName } } : null,
  } as unknown as ClassRow & {
    academic_years: { ec_year: number } | null;
    teachers: { users: { full_name: string } | null } | null;
  };
}

export interface ClassRosterRow {
  id: string; admission_no: string; first_name: string; last_name: string; roll_number: string | null; gender: string; status: string;
}

export async function listClassRoster(classId: string) {
  const { data, error } = await supabase.from("students")
    .select("id,admission_no,first_name,last_name,roll_number,gender,status")
    .eq("class_id", classId)
    .order("roll_number", { ascending: true, nullsFirst: false })
    .order("last_name");
  if (error) throw error;
  return (data ?? []) as ClassRosterRow[];
}
