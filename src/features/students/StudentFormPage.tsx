import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studentSchema, type StudentInput } from "./schemas";
import { createStudent, listClasses } from "./api";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { EthDatePicker } from "@/components/EthDatePicker";

export function StudentFormPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: listClasses });

  const { register, handleSubmit, control, formState: { errors } } = useForm<StudentInput>({
    resolver: zodResolver(studentSchema),
  });

  const errorText = (code?: string) => code && t(`students.errors.${code}`);

  const mutation = useMutation({
    mutationFn: (input: StudentInput) => createStudent(profile!.tenant_id!, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      nav("/students");
    },
  });

  return (
    <Card className="max-w-xl">
      <h1 className="mb-4 font-display text-xl font-bold text-ink">{t("students.add")}</h1>
      <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4" noValidate>
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
        <Field label={t("students.admissionNo")} error={errorText(errors.admission_no?.message)}>
          <Input {...register("admission_no")} placeholder="ADM-2018-001" maxLength={20} required />
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
        <Field label={t("students.class")} error={errorText(errors.class_id?.message)}>
          <select {...register("class_id")} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" required>
            <option value="">—</option>
            {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
          </select>
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={mutation.isPending}>{t("students.save")}</Button>
          <Button type="button" variant="ghost" onClick={() => nav("/students")}>{t("students.cancel")}</Button>
        </div>
      </form>
    </Card>
  );
}
