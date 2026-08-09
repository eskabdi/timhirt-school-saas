import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { formatEth } from "@/lib/ethiopian-date";
import { buildTranscriptPdf } from "../transcript-pdf";

function letter(total: number): string {
  if (total >= 90) return "A+";
  if (total >= 85) return "A";
  if (total >= 80) return "A-";
  if (total >= 75) return "B+";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  return "F";
}
interface Row { subject: string; code: string; instructor: string; ca: number; final: number; total: number; }

const GRADE_TABS = [9, 10, 11, 12];

export function AcademicRecordTab({ studentId, studentName, admissionNo, gradeLabel }: {
  studentId: string; studentName?: string; admissionNo?: string; gradeLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  // The EC month names live in the calendar namespace, same source <EthDate/>
  // uses — the transcript's issue date must read identically to the UI.
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const [gradeTab, setGradeTab] = useState(11);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["academic-record", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("grades")
        .select("score, subjects(name_i18n, code), exams(category, max_score, name_i18n)")
        .eq("student_id", studentId);
      if (error) throw error;
      // Aggregate per subject: CA total, Final total.
      const bySubject = new Map<string, Row>();
      for (const g of (data ?? []) as unknown as { score: number; subjects: { name_i18n: Record<string, string>; code: string } | null; exams: { category: string | null } | null }[]) {
        const code = g.subjects?.code ?? "—";
        const r = bySubject.get(code) ?? { subject: tField(g.subjects?.name_i18n, i18n.resolvedLanguage!) || code, code, instructor: "—", ca: 0, final: 0, total: 0 };
        if (g.exams?.category === "final") r.final += Number(g.score);
        else r.ca += Number(g.score);
        r.total = r.ca + r.final;
        bySubject.set(code, r);
      }
      return Array.from(bySubject.values());
    },
  });

  // School name for the transcript letterhead — same branding record the nav
  // and ID cards read, so all three stay consistent.
  const { data: brand } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });

  const totals = useMemo(() => {
    const list = rows ?? [];
    const sum = list.reduce((a, r) => a + r.total, 0);
    return { sum, max: list.length * 100, gpa: list.length ? (list.reduce((a, r) => a + gp(r.total), 0) / list.length) : 0 };
  }, [rows]);

  const downloadPdf = async () => {
    setError(null);
    setBusy(true);
    try {
      const branding = brand?.settings?.branding as { nameEn?: string; nameAm?: string; nameOm?: string } | undefined;
      const lang = i18n.resolvedLanguage;
      const schoolName =
        (lang === "am" ? branding?.nameAm : lang === "om" ? branding?.nameOm : branding?.nameEn) ||
        branding?.nameEn || t("app.name");
      const blob = await buildTranscriptPdf({
        schoolName,
        studentName: studentName ?? "—",
        admissionNo: admissionNo ?? "—",
        gradeLabel: gradeLabel ?? `${t("students.profile.grade")} ${gradeTab}`,
        academicPeriod: `${t("students.profile.grade")} ${gradeTab}`,
        rows: (rows ?? []).map((r) => ({ ...r, letter: letter(r.total) })),
        gpa: totals.gpa,
        totalScore: totals.sum,
        maxScore: totals.max,
        issuedOn: formatEth(new Date(), {
          monthNames: tc("months", { returnObjects: true }) as string[],
          eraSuffix: tc("eraSuffix"),
        }),
        labels: {
          title: t("academicRecord.title"), student: t("clinic.student"), studentNo: t("students.admissionNo"),
          grade: t("students.profile.grade"), period: t("academicRecord.period"),
          subject: t("gradebook.subject"), instructor: t("academicRecord.instructor"),
          ca: t("academicRecord.ca"), final: t("academicRecord.finalCol"), total: t("academicRecord.totalCol"),
          letter: t("academicRecord.letter"), status: t("students.status"),
          pass: t("academicRecord.pass"), fail: t("academicRecord.fail"),
          semesterTotals: t("academicRecord.semesterTotals"), gpa: t("academicRecord.cumulativeGpa"),
          issued: t("idCards.issued"), notice: t("academicRecord.noticeTitle"), noticeBody: t("academicRecord.noticeBody"),
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
          <Button onClick={downloadPdf} disabled={busy}>
            ⬇ {busy ? t("academicRecord.preparing") : t("academicRecord.downloadPdf")}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex items-center justify-around">
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("academicRecord.cumulativeGpa")}</p>
            <p className="font-display text-3xl font-bold text-navy">{totals.gpa.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("nav.subjects")}</p>
            <p className="font-display text-3xl font-bold text-ink">{rows?.length ?? 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">{t("students.profile.classRank")}</p>
            <p className="font-display text-3xl font-bold text-ink">—</p>
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
          {GRADE_TABS.map((g) => (
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
            {rows?.length ? rows.map((r) => {
              const l = letter(r.total);
              return (
                <tr key={r.code}>
                  <td className="py-3"><p className="font-medium text-ink">{r.subject}</p><p className="text-xs text-ink-faint">{r.code}</p></td>
                  <td className="text-ink-soft">{r.instructor}</td>
                  <td className="text-ink">{r.ca.toFixed(1)}</td>
                  <td className="text-ink">{r.final.toFixed(1)}</td>
                  <td className="font-bold text-navy">{r.total.toFixed(1)}</td>
                  <td><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ok-tint text-xs font-bold text-ok">{l}</span></td>
                  <td><Badge tone={r.total >= 50 ? "ok" : "danger"}>{r.total >= 50 ? t("academicRecord.pass") : t("academicRecord.fail")}</Badge></td>
                </tr>
              );
            }) : <tr><td colSpan={7} className="py-10 text-center text-ink-faint">{t("academicRecord.empty")}</td></tr>}
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

function gp(total: number): number {
  if (total >= 90) return 4.0;
  if (total >= 85) return 3.75;
  if (total >= 80) return 3.5;
  if (total >= 75) return 3.0;
  if (total >= 70) return 2.5;
  if (total >= 60) return 2.0;
  if (total >= 50) return 1.0;
  return 0;
}
