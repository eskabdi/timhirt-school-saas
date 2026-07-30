// Data access for staff registration and the staff profile.
//
// Kept separate from the page components for the same reason
// features/students/api.ts is: the photo/document upload paths and the
// draft-row upsert logic are exercised from more than one place (the
// registration stepper now, the profile's edit modal later) and belong in one
// spot rather than duplicated per caller.
import { supabase } from "@/lib/supabase";
import { convertImageToPng } from "@/lib/image";

export const STAFF_PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const STAFF_PHOTO_MAX_PX = 800;
const STAFF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** One photo per employee, at a deterministic path — same reasoning as
 *  studentPhotoPath: a random name per upload strands the previous object. */
export const staffPhotoPath = (tenantId: string, employeeId: string) =>
  `${tenantId}/staff/${employeeId}/photo.png`;

export async function uploadStaffPhoto(tenantId: string, employeeId: string, file: Blob) {
  const png = await convertImageToPng(file, STAFF_PHOTO_MAX_PX);
  if (png.size > STAFF_PHOTO_MAX_BYTES) throw new Error("photo_too_large");
  const path = staffPhotoPath(tenantId, employeeId);
  const { error: upErr } = await supabase.storage.from("avatars")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (upErr) throw upErr;
  const { error } = await supabase.from("employees").update({ photo_path: path }).eq("id", employeeId);
  if (error) throw error;
  return path;
}

/** The four documents the registration checklist and the profile's Documents
 *  tab both key off. `category` is the column employee_documents groups by;
 *  cv_resume has no category of its own in the schema and is filed under
 *  qualifications — a CV is a career/education document, same family as a
 *  degree certificate. */
export const STAFF_DOC_TYPES = [
  { key: "cv_resume", category: "qualifications" as const },
  { key: "id_passport_copy", category: "identification" as const },
  { key: "degree_certificate", category: "qualifications" as const },
  { key: "professional_license", category: "qualifications" as const },
];
export type StaffDocType = (typeof STAFF_DOC_TYPES)[number]["key"];

const DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const DOC_MAX_BYTES = 5 * 1024 * 1024;

export async function uploadStaffDocument(
  tenantId: string, employeeId: string, docType: StaffDocType, file: File,
) {
  if (!DOC_MIME_TYPES.includes(file.type)) throw new Error("bad_file_type");
  if (file.size > DOC_MAX_BYTES) throw new Error("file_too_large");
  const category = STAFF_DOC_TYPES.find((d) => d.key === docType)!.category;
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${tenantId}/staff/${employeeId}/${docType}.${ext}`;

  const { error: upErr } = await supabase.storage.from("documents")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (upErr) throw upErr;

  // No unique constraint on (employee_id, doc_type) — a re-upload replaces
  // the row by deleting the prior one for this slot rather than relying on
  // an upsert key the schema doesn't have.
  await supabase.from("employee_documents").delete()
    .eq("employee_id", employeeId).eq("doc_type", docType);
  const { error } = await supabase.from("employee_documents").insert({
    tenant_id: tenantId, employee_id: employeeId, category, doc_type: docType, storage_path: path,
  });
  if (error) throw error;
  return path;
}

/** The Documents tab's own uploader, distinct from uploadStaffDocument: that
 *  one fills one of the four fixed registration slots (one file per
 *  doc_type, replace-on-reupload). This one is for anything filed later —
 *  a police clearance renewal, a signed contract addendum — where more than
 *  one document can exist per category, so each upload is its own row at
 *  its own random path rather than overwriting a deterministic slot. */
export async function uploadCategoryDocument(
  tenantId: string, employeeId: string, category: "identification" | "qualifications" | "contractual" | "health_legal",
  label: string, file: File,
) {
  if (!DOC_MIME_TYPES.includes(file.type)) throw new Error("bad_file_type");
  if (file.size > DOC_MAX_BYTES) throw new Error("file_too_large");
  const ext = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
  const path = `${tenantId}/staff/${employeeId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("documents")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { error } = await supabase.from("employee_documents").insert({
    tenant_id: tenantId, employee_id: employeeId, category, doc_type: label.slice(0, 60), storage_path: path,
  });
  if (error) throw error;
  return path;
}

export interface EmergencyContactInput {
  full_name: string;
  full_name_am?: string;
  relationship?: string;
  phone?: string;
  email?: string;
  region?: string; zone?: string; woreda?: string; city?: string; kebele?: string; house_number?: string;
}

/** One row per employee — employee_emergency_contacts.employee_id is unique,
 *  so this is a real upsert rather than delete-then-insert. */
export async function upsertEmergencyContact(
  tenantId: string, employeeId: string, input: EmergencyContactInput,
) {
  if (!input.full_name.trim()) return; // nothing to save yet
  const { error } = await supabase.from("employee_emergency_contacts")
    .upsert({ tenant_id: tenantId, employee_id: employeeId, ...input }, { onConflict: "employee_id" });
  if (error) throw error;
}

/** The Professional step's certificate textarea is one line per entry, no
 *  structure. Replacing wholesale on every save is fine here because this
 *  field is the only writer of qualifications during registration — nothing
 *  else in this flow adds one row at a time that a blanket delete would lose. */
export async function replaceQualificationsFromText(tenantId: string, employeeId: string, text: string) {
  await supabase.from("employee_qualifications").delete().eq("employee_id", employeeId);
  const names = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!names.length) return;
  const { error } = await supabase.from("employee_qualifications").insert(
    names.map((name) => ({ tenant_id: tenantId, employee_id: employeeId, name })),
  );
  if (error) throw error;
}

export async function replaceTeachingSubjects(tenantId: string, employeeId: string, subjectIds: string[]) {
  await supabase.from("employee_subjects").delete().eq("employee_id", employeeId);
  if (!subjectIds.length) return;
  const { error } = await supabase.from("employee_subjects").insert(
    subjectIds.map((subject_id) => ({ tenant_id: tenantId, employee_id: employeeId, subject_id })),
  );
  if (error) throw error;
}

/** Same shape as TeachersPage's callInviteStaff — kept as its own copy rather
 *  than shared, since the two pages already diverge in how they surface
 *  errors and this is a four-line function. */
export async function callInviteStaff(body: unknown): Promise<{ user_id: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Invite failed");
  return res.json();
}

/** Invites the employee to the portal and links the resulting auth account
 *  back onto their employees row.
 *
 *  That link is the point, not a side effect: invite-staff creates `users`
 *  and, for teachers, `teachers` rows, but has never touched `employees` —
 *  which is exactly the gap check_staff_employee_linkage() (20260726000003)
 *  exists to surface. An employee whose employees.user_id stays null sees no
 *  payslips and cannot file leave, with nothing telling them why, because
 *  those RLS policies join through employees.user_id.
 */
export async function inviteAndLink(params: {
  tenantId: string; employeeId: string; email: string; fullName: string;
  role: "teacher" | "registrar" | "hr_officer" | "accountant";
  staffNo: string; locale: "en" | "am" | "om";
}) {
  const { employeeId, email, fullName, role, staffNo, locale } = params;
  const { user_id } = await callInviteStaff({
    email, full_name: fullName, role,
    staff_no: role === "teacher" ? staffNo : undefined,
    default_locale: locale,
  });
  const { error } = await supabase.from("employees").update({ user_id }).eq("id", employeeId);
  if (error) throw error;
  return user_id;
}
