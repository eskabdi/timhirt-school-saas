import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useTranslation } from "react-i18next";
import { formatEth } from "@/lib/ethiopian-date";
import { buildTranscriptPdf } from "../transcript-pdf";
import { fetchAcademicRecord, fetchClassRank, fetchGradeHistory } from "../academic-record";
import { fetchConductSummary } from "../conduct-summary";

export function AcademicRecordTab({ studentId, studentName, admissionNo, classId }: {
  studentId: string; studentName?: string; admissionNo?: string; classId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  // The EC month names live in the calendar namespace, same source <EthDate/>
  // uses — the transcript's issue date must read identically to the UI.
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const [gradeTab, setGradeTab] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real class history (past grades completed + current), not a hardcoded
  // range -- a student never sees a tab for a grade they haven't reached.
  const { data: gradeTabs } = useQuery({
    queryKey: ["grade-history", studentId],
    queryFn: () => fetchGradeHistory(studentId),
  });
  // Default to the most recent (current) grade once history loads, instead
  // of a hardcoded starting tab.
  useEffect(() => {
    if (gradeTab == null && gradeTabs?.length) setGradeTab(gradeTabs[gradeTabs.length - 1]!);
  }, [gradeTabs, gradeTab]);

  // Cumulative, all-time record (no grade filter) -- drives the "Cumulative
  // GPA" stat card, which is deliberately NOT scoped to whichever tab is
  // selected.
  const { data: cumulative } = useQuery({
    queryKey: ["academic-record", studentId],
    queryFn: () => fetchAcademicRecord(studentId, i18n.resolvedLanguage!),
  });

  // The selected tab's own record -- drives the on-screen table and the PDF.
  const { data: record } = useQuery({
    queryKey: ["academic-record", studentId, gradeTab],
    enabled: gradeTab != null,
    queryFn: () => fetchAcademicRecord(studentId, i18n.resolvedLanguage!, gradeTab!),
  });
  const rows = record?.rows;

  const { data: classRank } = useQuery({
    queryKey: ["class-rank", studentId, classId],
    enabled: !!classId,
    queryFn: () => fetchClassRank(studentId, classId!),
  });

  // School name for the transcript letterhead — same branding record the nav
  // and ID cards read, so all three stay consistent.
  const { data: brand } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });

  // R4-C5: opt-in per-tenant setting (FeeStructuresPage.tsx). Only ever
  // restricts the PDF download action for a self-viewing student/guardian —
  // never the underlying data (that's R4-C4's job), and never staff.
  const isPortalViewer = profile?.role === "student" || profile?.role === "parent";
  const blockUnpaidBalance = !!(brand?.settings as { billing?: { blockUnpaidBalance?: boolean } } | undefined)?.billing?.blockUnpaidBalance;
  const { data: hasUnpaidBalance } = useQuery({
    queryKey: ["student-unpaid-balance", studentId],
    enabled: isPortalViewer && blockUnpaidBalance,
    queryFn: async () => {
      const { count } = await supabase.from("invoice_summary").select("id", { count: "exact", head: true })
        .eq("student_id", studentId).neq("status", "paid");
      return (count ?? 0) > 0;
    },
  });
  const downloadBlocked = isPortalViewer && blockUnpaidBalance && !!hasUnpaidBalance;

  const cumulativeGpa = cumulative?.totals.gpa ?? 0;
  const totals = record?.totals ?? { sum: 0, max: 0, gpa: 0 };

  const downloadPdf = async () => {
    setError(null);
    if (downloadBlocked) { setError(t("academicRecord.unpaidBalanceBlock")); return; }
    setBusy(true);
    try {
      const branding = brand?.settings?.branding as { nameEn?: string; nameAm?: string; nameOm?: string } | undefined;
      const lang = i18n.resolvedLanguage;
      const schoolName =
        (lang === "am" ? branding?.nameAm : lang === "om" ? branding?.nameOm : branding?.nameEn) ||
        branding?.nameEn || t("app.name");
      const dateOpts = { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") };
      const conduct = await fetchConductSummary(studentId);
      const blob = await buildTranscriptPdf({
        schoolName,
        studentName: studentName ?? "—",
        admissionNo: admissionNo ?? "—",
        // Always reflects the SELECTED tab, not the student's current class
        // -- viewing an earlier grade must export that grade's own record,
        // not the current one relabeled.
        gradeLabel: `${t("students.profile.grade")} ${gradeTab}`,
        academicPeriod: `${t("students.profile.grade")} ${gradeTab}`,
        rows: rows ?? [],
        gpa: totals.gpa,
        totalScore: totals.sum,
        maxScore: totals.max,
        issuedOn: formatEth(new Date(), dateOpts),
        conduct: {
          incidents: conduct.incidents.map((i) => ({
            dateEc: formatEth(new Date(i.date + "T00:00:00Z"), dateOpts),
            label: i.category ? t(`behavioralTab.categories.${i.category}`, i.category) : t("behavioralTab.category"),
            detail: `${t(`discipline.severityLevel.${i.severity}`, i.severity)} — ${t(`behavioralTab.statuses.${i.status}`, i.status)}`,
          })),
          merits: conduct.merits.map((m) => ({
            dateEc: formatEth(new Date(m.date + "T00:00:00Z"), dateOpts),
            label: m.title,
            detail: `+${m.points}`,
          })),
          totalMeritPoints: conduct.totalMeritPoints,
        },
        labels: {
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
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transcript-${(admissionNo ?? studentId).replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("academicRecord.pdfFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t("academicRecord.title")}</h1>
        <div className="no-print flex flex-wrap items-center gap-2">
          <Badge tone="ok">{t("academicRecord.officialDocument")}</Badge>
          <Button variant="ghost" className="border border-line">✉ {t("academicRecord.emailGuardian")}</Button>
          <Button variant="ghost" className="border border-line">✎ {t("academicRecord.requestRevision")}</Button>
          <Button onClick={downloadPdf} disabled={busy || downloadBlocked}>
            ⬇ {busy ? t("academicRecord.preparing") : t("academicRecord.downloadPdf")}
          </Button>
        </div>
      </div>
      {downloadBlocked && <p className="text-sm text-danger">{t("academicRecord.unpaidBalanceBlock")}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex items-center justify-around">
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("academicRecord.cumulativeGpa")}</p>
            <p className="font-display text-3xl font-bold text-navy">{cumulativeGpa.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("nav.subjects")}</p>
            <p className="font-display text-3xl font-bold text-ink">{rows?.length ?? 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("students.profile.classRank")}</p>
            <p className="font-display text-3xl font-bold text-ink">{classRank ? `${classRank.rank} / ${classRank.totalStudents}` : "—"}</p>
          </div>
        </Card>
        <Card className="md:col-span-2">
          <p className="mb-2 text-sm font-semibold text-ink">{t("academicRecord.gpaTrend")}</p>
          <div className="flex h-24 gap-2">
            {[60, 70, 65, 80, 75, 92].map((h, i) => (
              <div key={i} className="flex flex-1 items-end">
                <div className="w-full rounded-t bg-navy-wash" style={{ height: `${h}%`, background: i === 5 ? "var(--navy, #1a56db)" : undefined }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
            <span>G9 S1</span><span>G9 S2</span><span>G10 S1</span><span>G10 S2</span><span>G11 S1</span>
          </div>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="no-print flex flex-wrap items-center gap-2">
          {(gradeTabs ?? []).map((g) => (
            <button key={g} onClick={() => setGradeTab(g)}
              className={`rounded-control px-3 py-1 text-sm ${gradeTab === g ? "bg-navy text-white" : "text-ink-soft hover:bg-sidebar"}`}>
              {t("students.profile.grade")} {g}
            </button>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="py-2">{t("gradebook.subject")}</th><th>{t("academicRecord.instructor")}</th>
              <th>{t("academicRecord.ca")}</th><th>{t("academicRecord.finalCol")}</th>
              <th>{t("academicRecord.totalCol")}</th><th>{t("academicRecord.letter")}</th><th>{t("students.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.length ? rows.map((r) => (
              <tr key={r.code}>
                <td className="py-3"><p className="font-medium text-ink">{r.subject}</p><p className="text-xs text-ink-faint">{r.code}</p></td>
                <td className="text-ink-soft">{r.instructor}</td>
                <td className="text-ink">{r.ca.toFixed(1)}</td>
                <td className="text-ink">{r.final.toFixed(1)}</td>
                <td className="font-bold text-navy">{r.total.toFixed(1)}</td>
                <td><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ok-tint text-xs font-bold text-ok">{r.letter}</span></td>
                <td><Badge tone={r.total >= 50 ? "ok" : "danger"}>{r.total >= 50 ? t("academicRecord.pass") : t("academicRecord.fail")}</Badge></td>
              </tr>
            )) : <tr><td colSpan={7} className="py-10 text-center text-ink-faint">{t("academicRecord.empty")}</td></tr>}
          </tbody>
          {!!rows?.length && (
            <tfoot>
              <tr className="border-t-2 border-line">
                <td colSpan={4} className="py-3 text-right font-semibold text-ink-faint">{t("academicRecord.semesterTotals")}:</td>
                <td className="font-display text-lg font-bold text-navy">{totals.sum.toFixed(1)} / {totals.max}</td>
                <td className="font-display text-lg font-bold text-navy">{totals.gpa.toFixed(2)}</td>
                <td>{totals.gpa >= 3.5 && <Badge tone="ok">{t("academicRecord.honorsList")}</Badge>}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      <Card className="bg-navy-wash">
        <div className="flex gap-2">
          <span className="text-navy">ⓘ</span>
          <div>
            <p className="font-semibold text-ink">{t("academicRecord.noticeTitle")}</p>
            <p className="mt-1 text-sm text-ink-faint">{t("academicRecord.noticeBody")}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
