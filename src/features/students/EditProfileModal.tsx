import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Field } from "@/components/ui/Field";
import { EthnicitySelect } from "./EthnicitySelect";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";
import { uploadStudentPhoto, PHOTO_MIME_TYPES } from "./api";

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS = ["male", "female", "other"];
const RELATIONSHIPS = ["father", "mother", "guardian", "other"];

export interface StudentLike {
  id: string; tenant_id?: string | null;
  first_name: string; middle_name: string | null; last_name: string;
  first_name_am?: string | null; middle_name_am?: string | null; last_name_am?: string | null;
  date_of_birth: string; gender: string; primary_language: string | null;
  ethnicity?: string | null;
  blood_type: string | null; roll_number: string | null; admission_date: string | null;
  avatar_path?: string | null; class_id?: string | null;
}

interface GuardianLike {
  id: string; full_name: string | null; relationship: string; phone: string | null; email: string | null;
}

/** Section-heading inside the modal — the form covers four distinct record
 *  groups and reads as a wall of inputs without them. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      {children}
    </div>
  );
}

export function EditProfileModal({ student, guardian, open, onClose }: {
  student: StudentLike; guardian?: GuardianLike | null; open: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { profile } = useSession();
  const photoInput = useRef<HTMLInputElement>(null);

  const [f, setF] = useState({
    first_name: student.first_name, middle_name: student.middle_name ?? "", last_name: student.last_name,
    first_name_am: student.first_name_am ?? "", middle_name_am: student.middle_name_am ?? "", last_name_am: student.last_name_am ?? "",
    dob: student.date_of_birth ? new Date(student.date_of_birth + "T00:00:00Z") : null as Date | null,
    gender: student.gender, primary_language: student.primary_language ?? "",
    ethnicity: student.ethnicity ?? "",
    blood_type: student.blood_type ?? "", roll_number: student.roll_number ?? "",
    admission_date: student.admission_date ? new Date(student.admission_date + "T00:00:00Z") : null as Date | null,
    class_id: student.class_id ?? "",
    g_full_name: guardian?.full_name ?? "", g_relationship: guardian?.relationship ?? "father",
    g_phone: guardian?.phone ?? "", g_email: guardian?.email ?? "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Sections the student can move between.
  const { data: classes } = useQuery({
    queryKey: ["edit-profile-classes"],
    enabled: open,
    queryFn: async () =>
      (await supabase.from("classes").select("id, name, section").order("grade_level").order("section")).data ?? [],
  });

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const { data: currentPhotoUrl } = useQuery({
    queryKey: ["student-photo-url", student.avatar_path],
    enabled: open && !!student.avatar_path,
    queryFn: async () =>
      (await supabase.storage.from("student-photos").createSignedUrl(student.avatar_path!, 300)).data?.signedUrl ?? null,
  });

  const pickPhoto = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!PHOTO_MIME_TYPES.includes(file.type)) { setError(t("students.photo.badType")); return; }
    setPhoto(file);
  };

  const save = useMutation({
    mutationFn: async () => {
      const tenantId = student.tenant_id ?? profile?.tenant_id;
      const { error: sErr } = await supabase.from("students").update({
        first_name: f.first_name, middle_name: f.middle_name || null, last_name: f.last_name,
        first_name_am: f.first_name_am || null, middle_name_am: f.middle_name_am || null, last_name_am: f.last_name_am || null,
        date_of_birth: f.dob ? toIsoDate(f.dob) : student.date_of_birth,
        gender: f.gender, primary_language: f.primary_language || null,
        // This modal is the backfill path for students enrolled before the
        // field existed, so it has to be able to set it as well as clear it.
        ethnicity: f.ethnicity || null,
        blood_type: f.blood_type || null, roll_number: f.roll_number || null,
        admission_date: f.admission_date ? toIsoDate(f.admission_date) : null,
        ...(f.class_id ? { class_id: f.class_id } : {}),
      }).eq("id", student.id);
      if (sErr) throw sErr;

      const guardianTouched = f.g_full_name || f.g_phone || f.g_email;
      if (guardian) {
        const { error: gErr } = await supabase.from("guardians").update({
          full_name: f.g_full_name || null, relationship: f.g_relationship,
          phone: f.g_phone || null, email: f.g_email || null,
        }).eq("id", guardian.id);
        if (gErr) throw gErr;
      } else if (guardianTouched && tenantId) {
        const { error: gErr } = await supabase.from("guardians").insert({
          tenant_id: tenantId, student_id: student.id, full_name: f.g_full_name || null,
          relationship: f.g_relationship, phone: f.g_phone || null, email: f.g_email || null,
        });
        if (gErr) throw gErr;
      }

      if (photo && tenantId) await uploadStudentPhoto(tenantId, student.id, photo);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["student-profile"] });
      qc.invalidateQueries({ queryKey: ["student-guardian"] });
      qc.invalidateQueries({ queryKey: ["student-photo-url"] });
      onClose();
    },
    // students_active_roll_number_unique (20260815000001) rejects a
    // hand-typed roll_number that already belongs to another active student
    // in the same section -- surface that as the specific, actionable
    // message rather than a raw Postgres constraint-violation string.
    onError: (e: unknown) => {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23505") {
        setError(t("students.edit.rollNumberTaken"));
      } else {
        setError(e instanceof Error ? e.message : t("students.edit.failed"));
      }
    },
  });

  const shownPhoto = photoPreview ?? currentPhotoUrl ?? null;

  return (
    <Modal open={open} onClose={onClose} title={t("students.edit.title")} size="lg">
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        <Group title={t("students.edit.photo")}>
          <div className="flex items-center gap-4">
            <div className="h-24 w-20 shrink-0 overflow-hidden rounded-control border border-line bg-navy-wash">
              {shownPhoto
                ? <img src={shownPhoto} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-3xl text-ink-faint">👤</div>}
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="border border-line" onClick={() => photoInput.current?.click()}>
                  {shownPhoto ? t("students.photo.change") : t("students.photo.choose")}
                </Button>
                {photo && (
                  <Button type="button" variant="ghost" onClick={() => { setPhoto(null); if (photoInput.current) photoInput.current.value = ""; }}>
                    {t("students.photo.remove")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-faint">{t("students.photo.hint")}</p>
            </div>
            <input ref={photoInput} type="file" accept={PHOTO_MIME_TYPES.join(",")} className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </div>
        </Group>

        <Group title={t("students.edit.identity")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={`${t("students.firstName")} (${t("students.labels.english")})`}>
              <Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} maxLength={80} />
            </Field>
            <Field label={`${t("students.firstName")} (${t("students.labels.amharic")})`}>
              <Input value={f.first_name_am} onChange={(e) => setF({ ...f, first_name_am: e.target.value })} maxLength={80} />
            </Field>
            <Field label={`${t("students.middleName")} (${t("students.labels.english")})`}>
              <Input value={f.middle_name} onChange={(e) => setF({ ...f, middle_name: e.target.value })} maxLength={80} />
            </Field>
            <Field label={`${t("students.middleName")} (${t("students.labels.amharic")})`}>
              <Input value={f.middle_name_am} onChange={(e) => setF({ ...f, middle_name_am: e.target.value })} maxLength={80} />
            </Field>
            <Field label={`${t("students.lastName")} (${t("students.labels.english")})`}>
              <Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} maxLength={80} />
            </Field>
            <Field label={`${t("students.lastName")} (${t("students.labels.amharic")})`}>
              <Input value={f.last_name_am} onChange={(e) => setF({ ...f, last_name_am: e.target.value })} maxLength={80} />
            </Field>
          </div>
        </Group>

        <Group title={t("students.edit.demographics")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("students.dob")}><EthDatePicker value={f.dob} onChange={(d) => setF({ ...f, dob: d })} /></Field>
            <Field label={t("students.gender")}>
              <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                {GENDERS.map((g) => <option key={g} value={g}>{t(`students.${g}`)}</option>)}
              </select>
            </Field>
            <Field label={t("students.edit.primaryLanguage")}>
              <Input value={f.primary_language} onChange={(e) => setF({ ...f, primary_language: e.target.value })} maxLength={40} />
            </Field>
            <EthnicitySelect value={f.ethnicity} onChange={(v) => setF({ ...f, ethnicity: v })} />
            <Field label={t("students.edit.bloodType")}>
              <select value={f.blood_type} onChange={(e) => setF({ ...f, blood_type: e.target.value })}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                {BLOOD.map((b) => <option key={b} value={b}>{b || "—"}</option>)}
              </select>
            </Field>
          </div>
        </Group>

        <Group title={t("students.edit.enrollment")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("students.edit.admissionDate")}>
              <EthDatePicker value={f.admission_date} onChange={(d) => setF({ ...f, admission_date: d })} />
            </Field>
            <Field label={t("students.edit.rollNumber")} hint={t("students.edit.rollNumberHint")}>
              <Input value={f.roll_number} onChange={(e) => setF({ ...f, roll_number: e.target.value })} maxLength={20} />
            </Field>
            <Field label={t("students.edit.section")}>
              <select value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                <option value="">—</option>
                {classes?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ""}</option>)}
              </select>
            </Field>
          </div>
        </Group>

        <Group title={t("students.edit.guardian")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("students.edit.guardianName")}>
              <Input value={f.g_full_name} onChange={(e) => setF({ ...f, g_full_name: e.target.value })} maxLength={120} />
            </Field>
            <Field label={t("admissions.relationship")}>
              <select value={f.g_relationship} onChange={(e) => setF({ ...f, g_relationship: e.target.value })}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                {RELATIONSHIPS.map((r) => <option key={r} value={r}>{t(`admissions.relationshipType.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={t("admissions.phone")}>
              <PhoneInput value={f.g_phone} onChange={(v) => setF({ ...f, g_phone: v })} />
            </Field>
            <Field label={t("admissions.email")}>
              <Input type="email" value={f.g_email} onChange={(e) => setF({ ...f, g_email: e.target.value })} />
            </Field>
          </div>
        </Group>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onClose}>{t("students.cancel")}</Button>
        <Button onClick={() => save.mutate()} disabled={!f.first_name || !f.last_name || save.isPending}>
          {save.isPending ? t("students.edit.saving") : t("students.edit.save")}
        </Button>
      </div>
    </Modal>
  );
}
