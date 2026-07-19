import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";

const STATUS_TONE = { active: "ok", graduated: "navy", transferred: "late" } as const;

export function StudentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data: student, isLoading, error } = useQuery({
    queryKey: ["student", id],
    queryFn: async () => {
      // Explicit column list, not select("*") -- students has table-level
      // SELECT revoked with only a specific column list granted back
      // (20260715000013_column_level_grants.sql, medical_notes excluded);
      // select("*") expands to every column and fails outright for any
      // column outside that grant, which useQuery surfaced as a silently
      // swallowed error (only `data` was read) -- a blank page with no
      // indication anything had gone wrong.
      const { data, error } = await supabase.from("students")
        .select("id, admission_no, first_name, middle_name, last_name, first_name_am, middle_name_am, last_name_am, date_of_birth, gender, status, class:classes(name, section)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (error) return <p role="alert" className="text-danger">{t("errors.generic")}</p>;
  if (!student) return null;

  const hasAmharicName = student.first_name_am || student.middle_name_am || student.last_name_am;

  return (
    <Card className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">
          {[student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ")}
        </h1>
        <Badge tone={STATUS_TONE[student.status as keyof typeof STATUS_TONE] ?? "neutral"}>
          {t(`students.${student.status}`)}
        </Badge>
      </div>

      {hasAmharicName && (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">{t("students.firstName")}</dt><dd className="text-ink">{student.first_name} / {student.first_name_am ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("students.middleName")}</dt><dd className="text-ink">{student.middle_name ?? "—"} / {student.middle_name_am ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("students.lastName")}</dt><dd className="text-ink">{student.last_name} / {student.last_name_am ?? "—"}</dd></div>
        </dl>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-faint">{t("students.admissionNo")}</dt><dd className="font-medium text-ink">{student.admission_no}</dd></div>
        <div><dt className="text-ink-faint">{t("students.class")}</dt><dd className="font-medium text-ink">{(student.class as any)?.name} {(student.class as any)?.section}</dd></div>
        <div><dt className="text-ink-faint">{t("students.dob")}</dt><dd className="font-medium text-ink"><EthDate value={student.date_of_birth} /></dd></div>
      </dl>
    </Card>
  );
}
