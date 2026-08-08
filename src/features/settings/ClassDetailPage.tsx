import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { getClassDetail, listClassRoster } from "./classesApi";
import { gradeCycleKeyFor, gradeCycleI18nKey } from "@/lib/gradeCycles";

const STATUS_TONE: Record<string, "ok" | "late" | "neutral"> = { active: "ok", graduated: "neutral", transferred: "late" };

export function ClassDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const { data: cls, isLoading } = useQuery({
    queryKey: ["class-detail", id],
    enabled: !!id,
    queryFn: () => getClassDetail(id!),
  });
  const { data: roster } = useQuery({
    queryKey: ["class-roster", id],
    enabled: !!id,
    queryFn: () => listClassRoster(id!),
  });

  if (isLoading || !cls) return <p className="text-ink-faint">…</p>;

  const enrolled = roster?.length ?? 0;
  const cycleKey = gradeCycleKeyFor(cls.grade_level);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-faint">
        <Link to="/classes" className="hover:underline">{t("crud.classes")}</Link> › <span className="text-navy">{cls.name} {cls.section}</span>
      </p>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{cls.name} {cls.section}</h1>
          {cls.academic_years?.ec_year && <p className="text-sm text-ink-faint">{t("crud.academicYear")}: {cls.academic_years.ec_year}</p>}
        </div>
        <Link to="/classes" className="text-sm font-medium text-navy hover:underline">← {t("crud.backToClasses")}</Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("crud.gradeLevel")}</p>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{cls.grade_level ?? "—"}</p>
          {cycleKey && <Badge tone="navy" className="mt-2">{t(`gradeCycles.${gradeCycleI18nKey(cycleKey)}`)}</Badge>}
        </Card>
        <Card className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("crud.capacity")}</p>
          <p className="mt-2 font-display text-2xl font-bold text-ink">{cls.capacity ?? t("crud.unlimited")}</p>
        </Card>
        <Card className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("crud.enrolled")}</p>
          <p className="mt-2 font-display text-2xl font-bold text-navy">
            {cls.capacity != null ? `${enrolled}/${cls.capacity}` : enrolled}
          </p>
        </Card>
        <Card className="text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("crud.homeroomTeacher")}</p>
          <p className="mt-2 font-display text-lg font-bold text-ink">{cls.teachers?.users?.full_name ?? t("crud.notSet")}</p>
        </Card>
      </div>

      <Panel>
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-bold text-ink">{t("crud.roster")}</h2>
        </div>
        {!roster?.length ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("students.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-3">{t("students.edit.rollNumber")}</th>
                <th className="px-5 py-3">{t("students.admissionNo")}</th>
                <th className="px-5 py-3">{t("students.firstName")}</th>
                <th className="px-5 py-3">{t("students.lastName")}</th>
                <th className="px-5 py-3">{t("students.gender")}</th>
                <th className="px-5 py-3">{t("students.status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roster.map((s) => (
                <tr key={s.id} className="hover:bg-sidebar">
                  <td className="px-5 py-3 font-medium text-ink">{s.roll_number ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Link to={`/students/${s.id}`} className="font-medium text-navy hover:underline">{s.admission_no}</Link>
                  </td>
                  <td className="px-5 py-3 text-ink">{s.first_name}</td>
                  <td className="px-5 py-3 text-ink">{s.last_name}</td>
                  <td className="px-5 py-3 text-ink-faint">{t(`students.${s.gender}`)}</td>
                  <td className="px-5 py-3"><Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{t(`students.${s.status}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
