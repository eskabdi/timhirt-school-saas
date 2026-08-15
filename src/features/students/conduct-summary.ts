// The transcript has never included conduct/remarks, even though the
// Behavioral tab (BehavioralTab.tsx) already has working discipline and
// merit data for the same student. This reuses that exact query shape so
// the transcript shows the same records the tab does, not a second view
// of the data that could drift.
import { supabase } from "@/lib/supabase";

export interface ConductIncident { date: string; category: string | null; severity: string; status: string; }
export interface ConductMerit { date: string; title: string; points: number; }

export async function fetchConductSummary(studentId: string) {
  const [{ data: incidents, error: incErr }, { data: merits, error: meritErr }] = await Promise.all([
    supabase.from("discipline_incidents")
      .select("incident_date, category, severity, status")
      .eq("student_id", studentId).order("incident_date", { ascending: false }),
    supabase.from("student_merits")
      .select("awarded_on, title, points")
      .eq("student_id", studentId).order("awarded_on", { ascending: false }),
  ]);
  if (incErr) throw incErr;
  if (meritErr) throw meritErr;

  const conductIncidents: ConductIncident[] = (incidents ?? []).map((i) => ({
    date: i.incident_date, category: i.category, severity: i.severity, status: i.status,
  }));
  const conductMerits: ConductMerit[] = (merits ?? []).map((m) => ({
    date: m.awarded_on, title: m.title, points: m.points,
  }));
  return {
    incidents: conductIncidents,
    merits: conductMerits,
    totalMeritPoints: conductMerits.reduce((a, m) => a + m.points, 0),
  };
}
