import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatEth } from "@/lib/ethiopian-date";
import { buildTranscriptPdf } from "../students/transcript-pdf";
import { fetchDocumentTemplate } from "@/lib/documentTemplate";
import { fetchAcademicRecord } from "../students/academic-record";
import { fetchConductSummary } from "../students/conduct-summary";

export function ReportCardBatchPage() {
  const { t, i18n } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level").order("grade_level").order("section")).data ?? [] });
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ succeeded: number; failed: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const { data: students, error: studentsError } = await supabase.from("students")
        .select("id, first_name, last_name, admission_no, class_id")
        .in("class_id", selected)
        .eq("status", "active");
      if (studentsError) throw studentsError;

      const { data: brand } = await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle();
      const branding = brand?.settings?.branding as { nameEn?: string; nameAm?: string; nameOm?: string } | undefined;
      const lang = i18n.resolvedLanguage;
      const schoolName =
        (lang === "am" ? branding?.nameAm : lang === "om" ? branding?.nameOm : branding?.nameEn) ||
        branding?.nameEn || t("app.name");
      const dateOpts = { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") };
      const issuedOn = formatEth(new Date(), dateOpts);
      const labels = {
        title: t("academicRecord.title"), student: t("clinic.student"), studentNo: t("students.admissionNo"),
        grade: t("students.profile.grade"), period: t("academicRecord.period"),
        subject: t("gradebook.subject"), instructor: t("academicRecord.instructor"),
        ca: t("academicRecord.ca"), final: t("academicRecord.finalCol"), total: t("academicRecord.totalCol"),
        letter: t("academicRecord.letter"), status: t("students.status"),
        pass: t("academicRecord.pass"), fail: t("academicRecord.fail"),
        semesterTotals: t("academicRecord.semesterTotals"), gpa: t("academicRecord.cumulativeGpa"),
        issued: t("idCards.issued"), notice: t("academicRecord.noticeTitle"), noticeBody: t("academicRecord.noticeBody"),
        conductTitle: t("academicRecord.conductTitle"), noIncidents: t("academicRecord.conductNone"),
        meritPointsTotal: t("academicRecord.meritPointsTotal"),
      };

      // R5-C6: fetched once for the whole batch rather than per student --
      // it is the same tenant-level row for every report card in the run.
      const template = await fetchDocumentTemplate("report_card");

      const roster = students ?? [];
      setProgress({ done: 0, total: roster.length });
      let succeeded = 0;
      const failed: string[] = [];
      for (const s of roster) {
        const fullName = `${s.first_name} ${s.last_name}`;
        try {
          const cls = classes?.find((c) => c.id === s.class_id);
          const gradeLabel = cls ? `${t("students.profile.grade")} ${cls.grade_level}${cls.section ? `-${cls.section}` : ""}` : "—";
          // Scoped to this student's CURRENT grade -- a batch-generated report
          // card is a snapshot of the present term, not the student's entire
          // multi-year history mashed into one table.
          const record = await fetchAcademicRecord(s.id, i18n.resolvedLanguage!, cls?.grade_level ?? undefined);
          const conductSummary = await fetchConductSummary(s.id);
          const blob = await buildTranscriptPdf({
            schoolName, template, studentName: fullName, admissionNo: s.admission_no,
            gradeLabel, academicPeriod: gradeLabel,
            rows: record.rows,
            gpa: record.totals.gpa, totalScore: record.totals.sum, maxScore: record.totals.max,
            issuedOn, labels,
            conduct: {
              incidents: conductSummary.incidents.map((i) => ({
                dateEc: formatEth(new Date(i.date + "T00:00:00Z"), dateOpts),
                label: i.category ? t(`behavioralTab.categories.${i.category}`, i.category) : t("behavioralTab.category"),
                detail: `${t(`discipline.severityLevel.${i.severity}`, i.severity)} — ${t(`behavioralTab.statuses.${i.status}`, i.status)}`,
              })),
              merits: conductSummary.merits.map((m) => ({
                dateEc: formatEth(new Date(m.date + "T00:00:00Z"), dateOpts),
                label: m.title,
                detail: `+${m.points}`,
              })),
              totalMeritPoints: conductSummary.totalMeritPoints,
            },
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `transcript-${s.admission_no.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
          succeeded++;
        } catch {
          failed.push(fullName);
        }
        setProgress((p) => p ? { done: p.done + 1, total: p.total } : p);
      }
      setResult({ succeeded, failed });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("academicRecord.pdfFailed"));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("gradebook.reportCards")}</h1>
      <Card className="space-y-2">
        {classes?.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name} {c.section}
          </label>
        ))}
        <Button disabled={!selected.length || busy} className="mt-2" onClick={generate}>
          {busy && progress
            ? t("gradebook.generatingProgress", { done: progress.done, total: progress.total })
            : t("gradebook.queuePdf", { count: selected.length })}
        </Button>
      </Card>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <p className={`text-sm ${result.failed.length ? "text-danger" : "text-ok"}`}>
          {t("gradebook.batchComplete", { count: result.succeeded })}
          {result.failed.length > 0 && ` — ${t("gradebook.batchFailed", { names: result.failed.join(", ") })}`}
        </p>
      )}
      <p className="text-xs text-ink-faint">{t("gradebook.reportCardNote")}</p>
    </div>
  );
}
