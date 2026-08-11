// Shared academic-record aggregation — extracted verbatim from
// AcademicRecordTab.tsx so ReportCardBatchPage.tsx's batch generation uses
// the exact same query/aggregation/grading logic as the working
// single-student "Download Official PDF" button, rather than a second,
// potentially-drifting implementation. Behavior is unchanged from the
// inline version this replaced.
import { supabase } from "@/lib/supabase";
import { tField } from "@/lib/i18n";

export interface AcademicRecordRow { subject: string; code: string; instructor: string; ca: number; final: number; total: number; letter: string; }

interface GradeBand { letter: string; min_percent: number; gpa_points: number; }

// Used only when a tenant has no grading_scales row at all -- the case for
// every tenant today, since none is seeded on tenant creation. Once a
// school configures a scale (Settings > Grading Scales), fetchDefaultBands()
// below returns that instead and this ladder is never consulted for them.
const FALLBACK_BANDS: GradeBand[] = [
  { letter: "A+", min_percent: 90, gpa_points: 4.0 },
  { letter: "A", min_percent: 85, gpa_points: 3.75 },
  { letter: "A-", min_percent: 80, gpa_points: 3.5 },
  { letter: "B+", min_percent: 75, gpa_points: 3.0 },
  { letter: "B", min_percent: 70, gpa_points: 2.5 },
  { letter: "C", min_percent: 60, gpa_points: 2.0 },
  { letter: "D", min_percent: 50, gpa_points: 1.0 },
  { letter: "F", min_percent: 0, gpa_points: 0 },
];

export function letterGrade(total: number, bands: GradeBand[] = FALLBACK_BANDS): string {
  return bandFor(total, bands).letter;
}

export function gradePoint(total: number, bands: GradeBand[] = FALLBACK_BANDS): number {
  return bandFor(total, bands).gpa_points;
}

function bandFor(total: number, bands: GradeBand[]): GradeBand {
  return bands.find((b) => total >= b.min_percent) ?? bands[bands.length - 1] ?? FALLBACK_BANDS[FALLBACK_BANDS.length - 1]!;
}

// grading_scales/grade_bands SELECT is already RLS-scoped to the caller's
// own tenant (or super_admin), so no tenant_id needs to be passed in here.
async function fetchDefaultBands(): Promise<GradeBand[]> {
  const { data: scale } = await supabase.from("grading_scales").select("id").eq("is_default", true).maybeSingle();
  if (!scale) return FALLBACK_BANDS;
  const { data: bands } = await supabase.from("grade_bands")
    .select("letter, min_percent, gpa_points")
    .eq("scale_id", scale.id).order("min_percent", { ascending: false });
  return bands?.length ? bands : FALLBACK_BANDS;
}

export async function fetchAcademicRecord(studentId: string, locale: string) {
  const [{ data, error }, bands] = await Promise.all([
    supabase.from("grades")
      .select("score, subjects(name_i18n, code), exams(category, max_score, name_i18n)")
      .eq("student_id", studentId),
    fetchDefaultBands(),
  ]);
  if (error) throw error;
  const bySubject = new Map<string, Omit<AcademicRecordRow, "letter">>();
  for (const g of (data ?? []) as unknown as { score: number; subjects: { name_i18n: Record<string, string>; code: string } | null; exams: { category: string | null } | null }[]) {
    const code = g.subjects?.code ?? "—";
    const r = bySubject.get(code) ?? { subject: tField(g.subjects?.name_i18n, locale) || code, code, instructor: "—", ca: 0, final: 0, total: 0 };
    if (g.exams?.category === "final") r.final += Number(g.score);
    else r.ca += Number(g.score);
    r.total = r.ca + r.final;
    bySubject.set(code, r);
  }
  const rows: AcademicRecordRow[] = Array.from(bySubject.values()).map((r) => ({ ...r, letter: letterGrade(r.total, bands) }));
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const gpa = rows.length ? rows.reduce((a, r) => a + gradePoint(r.total, bands), 0) / rows.length : 0;
  return { rows, totals: { sum, max: rows.length * 100, gpa } };
}

// A classmate's raw grades aren't readable via RLS by a self-viewing
// student/guardian, so rank is computed server-side (get_class_rank(),
// SECURITY DEFINER) rather than by fetching every classmate's grades here.
export async function fetchClassRank(studentId: string, classId: string) {
  const { data, error } = await supabase.rpc("get_class_rank", { p_student_id: studentId, p_class_id: classId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.rank != null ? { rank: row.rank as number, totalStudents: row.total_students as number } : null;
}
