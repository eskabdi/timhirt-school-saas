// Shared academic-record aggregation — extracted verbatim from
// AcademicRecordTab.tsx so ReportCardBatchPage.tsx's batch generation uses
// the exact same query/aggregation/grading logic as the working
// single-student "Download Official PDF" button, rather than a second,
// potentially-drifting implementation. Behavior is unchanged from the
// inline version this replaced.
import { supabase } from "@/lib/supabase";
import { tField } from "@/lib/i18n";

export interface AcademicRecordRow { subject: string; code: string; instructor: string; ca: number; final: number; total: number; }

export function letterGrade(total: number): string {
  if (total >= 90) return "A+";
  if (total >= 85) return "A";
  if (total >= 80) return "A-";
  if (total >= 75) return "B+";
  if (total >= 70) return "B";
  if (total >= 60) return "C";
  if (total >= 50) return "D";
  return "F";
}

export function gradePoint(total: number): number {
  if (total >= 90) return 4.0;
  if (total >= 85) return 3.75;
  if (total >= 80) return 3.5;
  if (total >= 75) return 3.0;
  if (total >= 70) return 2.5;
  if (total >= 60) return 2.0;
  if (total >= 50) return 1.0;
  return 0;
}

export async function fetchAcademicRecord(studentId: string, locale: string) {
  const { data, error } = await supabase.from("grades")
    .select("score, subjects(name_i18n, code), exams(category, max_score, name_i18n)")
    .eq("student_id", studentId);
  if (error) throw error;
  const bySubject = new Map<string, AcademicRecordRow>();
  for (const g of (data ?? []) as unknown as { score: number; subjects: { name_i18n: Record<string, string>; code: string } | null; exams: { category: string | null } | null }[]) {
    const code = g.subjects?.code ?? "—";
    const r = bySubject.get(code) ?? { subject: tField(g.subjects?.name_i18n, locale) || code, code, instructor: "—", ca: 0, final: 0, total: 0 };
    if (g.exams?.category === "final") r.final += Number(g.score);
    else r.ca += Number(g.score);
    r.total = r.ca + r.final;
    bySubject.set(code, r);
  }
  const rows = Array.from(bySubject.values());
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const gpa = rows.length ? rows.reduce((a, r) => a + gradePoint(r.total), 0) / rows.length : 0;
  return { rows, totals: { sum, max: rows.length * 100, gpa } };
}
