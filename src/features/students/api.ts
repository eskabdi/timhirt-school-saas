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

/** Stores a student's photo and points students.avatar_path at it.
 *
 *  Always PNG: issue-id-card embeds the photo with pdf-lib's embedPng, so a
 *  JPEG left in this bucket would silently render as the initials
 *  placeholder. Runs after the insert because the path is keyed by student
 *  id, and the leading tenant segment is what the bucket's RLS policy checks. */
export async function uploadStudentPhoto(tenantId: string, studentId: string, file: Blob) {
  const png = await convertImageToPng(file, STUDENT_PHOTO_MAX_PX);
  if (png.size > PHOTO_MAX_BYTES) throw new Error("photo_too_large");
  const path = `${tenantId}/${studentId}/${crypto.randomUUID()}.png`;
  const { error: upErr } = await supabase.storage.from("student-photos")
    .upload(path, png, { contentType: "image/png" });
  if (upErr) throw upErr;
  const { error } = await supabase.from("students").update({ avatar_path: path }).eq("id", studentId);
  if (error) throw error;
  return path;
}

export async function listStudents(search?: string) {
  let q = supabase.from("students")
    .select("id, admission_no, first_name, last_name, status, gender, date_of_birth, class:classes(id, name, section)")
    .order("last_name");
  if (search) q = q.textSearch("search_vector", search, { type: "websearch" });
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createStudent(tenantId: string, input: StudentInput) {
  const { data, error } = await supabase.from("students").insert({
    tenant_id: tenantId,
    ...input,
    date_of_birth: input.date_of_birth.toISOString().slice(0, 10),
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function listClasses() {
  const { data, error } = await supabase.from("classes").select("id, name, section").order("name");
  if (error) throw error;
  return data;
}
