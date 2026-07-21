import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

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

export function AcademicRecordTab({ studentId }: { studentId: string }) {
  const { i18n } = useTranslation();
  const [gradeTab, setGradeTab] = useState("Grade 11");

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

  const totals = useMemo(() => {
    const list = rows ?? [];
    const sum = list.reduce((a, r) => a + r.total, 0);
    return { sum, max: list.length * 100, gpa: list.length ? (list.reduce((a, r) => a + gp(r.total), 0) / list.length) : 0 };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">Academic Record / የትምህርት ማስረጃ</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">Official Document</Badge>
          <Button variant="ghost" className="border border-line">✉ Email Guardian</Button>
          <Button variant="ghost" className="border border-line">✎ Request Revision</Button>
          <Button>⬇ Download Official PDF</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex items-center justify-around">
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">Cumulative GPA</p>
            <p className="font-display text-3xl font-bold text-navy">{totals.gpa.toFixed(2)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">Subjects</p>
            <p className="font-display text-3xl font-bold text-ink">{rows?.length ?? 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs uppercase text-ink-faint">Class Rank</p>
            <p className="font-display text-3xl font-bold text-ink">—</p>
          </div>
        </Card>
        <Card className="md:col-span-2">
          <p className="mb-2 text-sm font-semibold text-ink">GPA Trend History</p>
          <div className="flex h-24 items-end gap-2">
            {[60, 70, 65, 80, 75, 92].map((h, i) => (
              <div key={i} className="flex-1 rounded-t bg-navy-wash" style={{ height: `${h}%`, background: i === 5 ? "var(--navy, #1a56db)" : undefined }} />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-faint"><span>G9 S1</span><span>G9 S2</span><span>G10 S1</span><span>G10 S2</span><span>G11 S1</span></div>
        </Card>
      </div>

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {["Grade 9", "Grade 10", "Grade 11", "Grade 12"].map((g) => (
            <button key={g} onClick={() => setGradeTab(g)} className={`rounded-control px-3 py-1 text-sm ${gradeTab === g ? "bg-navy text-white" : "text-ink-soft hover:bg-sidebar"}`}>{g}</button>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase text-ink-faint">
            <tr><th className="py-2">Subject</th><th>Instructor</th><th>CA (40%)</th><th>Final (60%)</th><th>Total (100%)</th><th>Letter</th><th>Status</th></tr>
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
                  <td><Badge tone={r.total >= 50 ? "ok" : "danger"}>{r.total >= 50 ? "Pass" : "Fail"}</Badge></td>
                </tr>
              );
            }) : <tr><td colSpan={7} className="py-10 text-center text-ink-faint">No grades recorded for this student yet.</td></tr>}
          </tbody>
          {!!rows?.length && (
            <tfoot>
              <tr className="border-t-2 border-line">
                <td colSpan={4} className="py-3 text-right font-semibold text-ink-faint">SEMESTER TOTALS:</td>
                <td className="font-display text-lg font-bold text-navy">{totals.sum.toFixed(1)} / {totals.max}</td>
                <td className="font-display text-lg font-bold text-navy">{totals.gpa.toFixed(2)}</td>
                <td>{totals.gpa >= 3.5 && <Badge tone="ok">Honors List</Badge>}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>

      <Card className="bg-navy-wash">
        <div className="flex gap-2">
          <span className="text-navy">ⓘ</span>
          <div>
            <p className="font-semibold text-ink">Official Document Notice</p>
            <p className="mt-1 text-sm text-ink-faint">This academic transcript is generated by the Student Information System. All records are verified by the Office of the Registrar. Any unauthorized alteration or reproduction of this record is strictly prohibited and subject to institutional disciplinary policy. For verification, scan the QR code on the official printed copy.</p>
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
