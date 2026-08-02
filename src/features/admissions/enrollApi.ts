// ============================================================================
// Shared core of "turn an admission application into a student": the
// enroll_admission_application() RPC, the best-effort application-photo
// copy, and the two independent follow-ups (issue-id-card,
// provision-portal-accounts). Originally lived only in EnrollStudentModal;
// pulled out so AdmissionReviewModal can run the exact same sequence when a
// reviewer picks 'enrolled' from the status dropdown instead of using the
// dedicated Enroll button -- both are "convert this application" and must
// not diverge into two different definitions of what enrolling does.
// ============================================================================
import { supabase } from "@/lib/supabase";
import { convertImageToPng, STUDENT_PHOTO_MAX_PX } from "@/lib/image";
import { studentPhotoPath } from "@/features/students/api";

export interface ProvisionedAccount {
  kind: "student" | "guardian";
  method: "password" | "email_invite" | "existing_account";
  email: string;
  temp_password?: string;
}

export interface EnrollResult {
  studentId: string;
  idCardUrl: string | null;
  idCardError: string | null;
  accounts: ProvisionedAccount[];
  accountsError: string | null;
}

export async function callFunction(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${name} failed`);
  return res.json();
}

// Best-effort: the application's photo (Step 3 of the public stepper) is the
// only source of a real student photo anywhere in this app -- there's no
// separate avatar upload feature. Copying it into student-photos here is
// what lets issue-id-card embed an actual photo instead of an initials
// placeholder. Never blocks or fails enrollment: a missing/broken photo
// just means the card falls back to initials, same as before this existed.
async function copyApplicationPhoto(tenantId: string, photoPath: string, studentId: string) {
  try {
    const { data: blob, error: dlErr } = await supabase.storage.from("admission-documents").download(photoPath);
    if (dlErr || !blob) return;
    // Normalized to PNG regardless of the original upload's format -- see
    // src/lib/image.ts for why (pdf-lib can't embed WebP).
    // Bounded like the admin form's upload: an applicant's phone photo can be
    // several MB, and lossless PNG re-encoding only grows it, which would push
    // the result past the student-photos bucket's 2 MB limit and (this being
    // best-effort) drop the photo silently.
    const png = blob.type === "application/pdf" ? null : await convertImageToPng(blob, STUDENT_PHOTO_MAX_PX).catch(() => null);
    if (!png) return;
    // Same deterministic path as the admin upload, so a photo set here and one
    // replaced later are the same object rather than two.
    const destPath = studentPhotoPath(tenantId, studentId);
    const { error: upErr } = await supabase.storage.from("student-photos")
      .upload(destPath, png, { contentType: "image/png", upsert: true });
    if (upErr) return;
    await supabase.from("students").update({ avatar_path: destPath }).eq("id", studentId);
  } catch {
    // best-effort -- see comment above
  }
}

export async function enrollApplication(args: {
  applicationId: string; tenantId: string; classId: string; photoPath: string | null;
}): Promise<EnrollResult> {
  // Student Number is generated DB-side (students_set_admission_no trigger,
  // migration 20260719000005) -- nothing to type here. The RPC also sets
  // admission_applications.stage = 'enrolled' (20260802000001).
  const { data, error: rpcErr } = await supabase.rpc("enroll_admission_application", {
    p_application_id: args.applicationId,
    p_class_id: args.classId,
  });
  if (rpcErr) throw rpcErr;
  const studentId = data as string;

  // Runs before issue-id-card so the card can embed the real photo instead
  // of an initials placeholder when one exists.
  if (args.photoPath) {
    await copyApplicationPhoto(args.tenantId, args.photoPath, studentId);
  }

  // Independent follow-ups -- a failure in either must not look like the
  // enrollment itself failed, since by this point it already succeeded.
  const [cardRes, accountsRes] = await Promise.allSettled([
    callFunction("issue-id-card", { student_id: studentId }),
    callFunction("provision-portal-accounts", { student_id: studentId }),
  ]);

  return {
    studentId,
    idCardUrl: cardRes.status === "fulfilled" ? (cardRes.value.url as string) : null,
    idCardError: cardRes.status === "rejected" ? String(cardRes.reason) : null,
    accounts: accountsRes.status === "fulfilled" ? (accountsRes.value.accounts as ProvisionedAccount[]) : [],
    accountsError: accountsRes.status === "rejected" ? String(accountsRes.reason) : null,
  };
}
