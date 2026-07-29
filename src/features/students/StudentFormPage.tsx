import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studentSchema, type StudentInput } from "./schemas";
import { createStudent, listClasses, uploadStudentPhoto, PHOTO_MIME_TYPES } from "./api";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthnicitySelect } from "./EthnicitySelect";

export function StudentFormPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: listClasses });

  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Set when the student row was created but its photo could not be stored —
  // the student exists, so silently returning to the list would hide a
  // half-finished save.
  const [savedWithoutPhoto, setSavedWithoutPhoto] = useState(false);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const pickPhoto = (file: File | undefined) => {
    setPhotoError(null);
    if (!file) return;
    if (!PHOTO_MIME_TYPES.includes(file.type)) { setPhotoError(t("students.photo.badType")); return; }
    setPhoto(file);
  };

  const { register, handleSubmit, control, formState: { errors } } = useForm<StudentInput>({
    resolver: zodResolver(studentSchema),
  });

  const errorText = (code?: string) => code && t(`students.errors.${code}`);

  const mutation = useMutation({
    mutationFn: async (input: StudentInput) => {
      const student = await createStudent(profile!.tenant_id!, input);
      if (photo) {
        try {
          await uploadStudentPhoto(profile!.tenant_id!, student.id, photo);
        } catch (e) {
          const code = e instanceof Error && e.message === "photo_too_large" ? "tooLarge" : "failed";
          return { student, photoFailed: t(`students.photo.${code}`) };
        }
      }
      return { student, photoFailed: null as string | null };
    },
    onSuccess: ({ photoFailed }) => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      if (photoFailed) { setPhotoError(photoFailed); setSavedWithoutPhoto(true); return; }
      nav("/students");
    },
  });

  return (
    <Card className="max-w-xl">
      <h1 className="mb-4 font-display text-xl font-bold text-ink">{t("students.add")}</h1>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
        <Field label={t("students.photo.label")} error={photoError ?? undefined}>
          <div className="flex items-center gap-4">
            <div className="h-24 w-20 shrink-0 overflow-hidden rounded-control border border-line bg-navy-wash">
              {photoPreview
                ? <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-3xl text-ink-faint">👤</div>}
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="border border-line" onClick={() => photoInput.current?.click()}>
                  {photo ? t("students.photo.change") : t("students.photo.choose")}
                </Button>
                {photo && (
                  <Button type="button" variant="ghost" onClick={() => { setPhoto(null); setPhotoError(null); if (photoInput.current) photoInput.current.value = ""; }}>
                    {t("students.photo.remove")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-faint">{t("students.photo.hint")}</p>
            </div>
            <input
              ref={photoInput}
              type="file"
              accept={PHOTO_MIME_TYPES.join(",")}
              className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0])}
            />
          </div>
        </Field>

        <Field label={t("students.firstName")} error={errorText(errors.first_name?.message) || errorText(errors.first_name_am?.message)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input {...register("first_name")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.english")}</p>
            </div>
            <div>
              <Input {...register("first_name_am")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.amharic")}</p>
            </div>
          </div>
        </Field>
        <Field label={t("students.middleName")} error={errorText(errors.middle_name?.message) || errorText(errors.middle_name_am?.message)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input {...register("middle_name")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.english")}</p>
            </div>
            <div>
              <Input {...register("middle_name_am")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.amharic")}</p>
            </div>
          </div>
        </Field>
        <Field label={t("students.lastName")} error={errorText(errors.last_name?.message) || errorText(errors.last_name_am?.message)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Input {...register("last_name")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.english")}</p>
            </div>
            <div>
              <Input {...register("last_name_am")} maxLength={80} required />
              <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.amharic")}</p>
            </div>
          </div>
        </Field>
        <Field label={t("students.dob")} error={errorText(errors.date_of_birth?.message)}>
          <Controller name="date_of_birth" control={control}
            render={({ field }) => <EthDatePicker value={field.value ?? null} onChange={field.onChange} />} />
        </Field>
        <Field label={t("students.gender")} error={errorText(errors.gender?.message)}>
          <select {...register("gender")} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" required>
            <option value="">—</option>
            <option value="male">{t("students.male")}</option>
            <option value="female">{t("students.female")}</option>
            <option value="other">{t("students.other")}</option>
          </select>
        </Field>
        <Controller name="ethnicity" control={control}
          render={({ field }) => (
            <EthnicitySelect value={field.value ?? ""} onChange={field.onChange}
              error={errorText(errors.ethnicity?.message)} />
          )} />
        <Field label={t("students.class")} error={errorText(errors.class_id?.message)}>
          <select {...register("class_id")} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" required>
            <option value="">—</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
          </select>
        </Field>
        {savedWithoutPhoto ? (
          <div className="space-y-2 rounded-control border border-late bg-late-tint p-3">
            <p className="text-sm text-late">{t("students.photo.savedWithoutPhoto")}</p>
            <Button type="button" onClick={() => nav("/students")}>{t("students.photo.continue")}</Button>
          </div>
        ) : (
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={mutation.isPending}>{t("students.save")}</Button>
            <Button type="button" variant="ghost" onClick={() => nav("/students")}>{t("students.cancel")}</Button>
          </div>
        )}
      </form>
    </Card>
  );
}
