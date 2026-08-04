// Typed Supabase calls — no `.eq('tenant_id', …)` needed for security (RLS
// injects it server-side); parameterized by PostgREST structurally (§8.1).
import { supabase } from "@/lib/supabase";
import { convertImageToPng, STUDENT_PHOTO_MAX_PX } from "@/lib/image";
import type { StudentInput } from "./schemas";

/** Mirrors the student-photos bucket's allowed_mime_types + file_size_limit
 *  (migration 20260719000004), so a bad pick is rejected with a real message
 *  instead of an opaque storage error. */
export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** One photo per student, at a path derived from the student id.
 *
 *  A random filename per upload meant every replacement stranded the previous
 *  object: nothing referenced it and, until 20260726000004, no policy could
 *  delete it. A deterministic path is overwritten in place instead, so a
 *  student has exactly one photo object for their whole record. */
export const studentPhotoPath = (tenantId: string, studentId: string) =>
  `${tenantId}/${studentId}/photo.png`;

/** Stores a student's photo and points students.avatar_path at it.
 *
 *  Always PNG: issue-id-card embeds the photo with pdf-lib's embedPng, so a
 *  JPEG left in this bucket would silently render as the initials
 *  placeholder. Runs after the insert because the path is keyed by student
 *  id, and the leading tenant segment is what the bucket's RLS policy checks. */
export async function uploadStudentPhoto(tenantId: string, studentId: string, file: Blob) {
  const png = await convertImageToPng(file, STUDENT_PHOTO_MAX_PX);
  if (png.size > PHOTO_MAX_BYTES) throw new Error("photo_too_large");
  const path = studentPhotoPath(tenantId, studentId);

  // Read the current path first: rows written before the deterministic scheme
  // point at <uuid>.png, and overwriting the new path would leave those behind
  // exactly as before. Best-effort — a failure here must not cost the upload.
  const { data: current } = await supabase.from("students")
    .select("avatar_path").eq("id", studentId).maybeSingle();

  const { error: upErr } = await supabase.storage.from("student-photos")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (upErr) throw upErr;
  const { error } = await supabase.from("students").update({ avatar_path: path }).eq("id", studentId);
  if (error) throw error;

  const stale = current?.avatar_path;
  if (stale && stale !== path) {
    await supabase.storage.from("student-photos").remove([stale]);
  }
  return path;
}

export interface StudentFilters {
  search?: string;
  classId?: string;
  status?: string;
  gender?: string;
}

export async function listStudents(filters: StudentFilters = {}) {
  let q = supabase.from("students")
    .select("id, admission_no, first_name, last_name, status, gender, date_of_birth, class:classes(id, name, section)")
    .order("last_name");
  if (filters.search) q = q.textSearch("search_vector", filters.search, { type: "websearch" });
  if (filters.classId) q = q.eq("class_id", filters.classId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.gender) q = q.eq("gender", filters.gender);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createStudent(tenantId: string, input: StudentInput) {
  const { data, error } = await supabase.from("students").insert({
    tenant_id: tenantId,
    ...input,
    date_of_birth: input.date_of_birth.toISOString().slice(0, 10),
    // The empty string is what the select emits for "not recorded"; the
    // column's CHECK rejects it, so it has to become NULL here.
    ethnicity: input.ethnicity || null,
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function listClasses() {
  const { data, error } = await supabase.from("classes").select("id, name, section").order("name");
  if (error) throw error;
  return data;
}

export interface GuardianInput {
  full_name: string;
  relationship: "father" | "mother" | "guardian" | "other";
  phone: string;
  email: string;
}

/** One guardian per student from this form — mirrors EditProfileModal's
 *  insert path (the only other writer of this table). */
export async function createGuardian(tenantId: string, studentId: string, input: GuardianInput) {
  const { error } = await supabase.from("guardians").insert({
    tenant_id: tenantId, student_id: studentId,
    full_name: input.full_name || null, relationship: input.relationship,
    phone: input.phone || null, email: input.email || null,
  });
  if (error) throw error;
}

export interface ApplicableFee {
  id: string; name_i18n: Record<string, string>; amount: number; billing_cycle: string;
}

/** Fees that apply to a class: school-wide (class_id null) plus anything
 *  scoped to this specific class — same shape as the public applicant sees
 *  for their chosen grade (submit-admission's fee list), so a registrar
 *  reviews the identical total a parent would have. */
export async function listApplicableFees(classId: string): Promise<ApplicableFee[]> {
  const { data, error } = await supabase.from("fee_structures")
    .select("id, name_i18n, amount, billing_cycle, class_id")
    .or(`class_id.is.null,class_id.eq.${classId}`);
  if (error) throw error;
  return (data ?? []) as ApplicableFee[];
}
