import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { AcademicRecordTab } from "./tabs/AcademicRecordTab";
import { AttendanceTab } from "./tabs/AttendanceTab";
import { BehavioralTab } from "./tabs/BehavioralTab";

const TABS = ["Personal Info", "Academic Record", "Attendance", "Behavioral"] as const;
type Tab = (typeof TABS)[number];

// Gregorian formatter (toLocaleDateString is lint-banned in this repo).
const GC_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function gc(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00Z");
  return `${GC_MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function StudentDetailPage() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>("Personal Info");

  const { data: student, isLoading } = useQuery({
    queryKey: ["student-profile", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("students")
        .select("id, admission_no, roll_number, first_name, middle_name, last_name, date_of_birth, gender, status, avatar_path, blood_type, primary_language, admission_date, user_id, class:classes(name, section, grade_level, homeroom_teacher_id)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: guardian } = useQuery({
    queryKey: ["student-guardian", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("guardians").select("relationship, phone, email").eq("student_id", id).limit(1).maybeSingle()).data,
  });

  const { data: attendancePct } = useQuery({
    queryKey: ["student-att-pct", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("attendance").select("status").eq("student_id", id);
      if (!data?.length) return null;
      const present = data.filter((a) => a.status === "present" || a.status === "excused").length;
      return Math.round((present / data.length) * 100);
    },
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (!student) return null;

  const cls = student.class as { name?: string; section?: string; grade_level?: number } | null;
  const fullName = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ");
  const gradeLabel = cls?.grade_level != null ? `Grade ${cls.grade_level}${cls.section ? `-${cls.section}` : ""}` : cls?.name ?? "—";

  const statCard = (label: string, value: React.ReactNode) => (
    <Card className="flex-1 bg-navy-wash">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
    </Card>
  );

  const sidebar = (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-2"><span className="text-navy">🔗</span><h2 className="font-semibold text-ink">Primary Guardian</h2></div>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-wash text-sm font-bold text-navy">{guardian ? "G" : "—"}</div>
          <span className="text-sm capitalize text-ink-faint">{guardian?.relationship ?? "—"}</span>
        </div>
        <div className="mt-3 space-y-1 text-sm text-ink-soft">
          <p>📞 {guardian?.phone ?? "—"}</p>
          <p>✉ {guardian?.email ?? "—"}</p>
        </div>
        <Button variant="ghost" className="mt-3 w-full border border-line">Contact Guardian</Button>
      </Card>
      <Card>
        <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">Recent Absences</h2>
        <button onClick={() => setTab("Attendance")} className="w-full rounded-control bg-navy-wash py-2 text-sm text-navy">View Attendance Log</button>
      </Card>
      <Card className="bg-navy-wash">
        <h2 className="text-xs font-bold uppercase tracking-wide text-navy">Admin Notes</h2>
        <p className="mt-2 text-sm text-ink-faint">No notes.</p>
      </Card>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-faint"><Link to="/students" className="hover:underline">Students</Link> › {gradeLabel} › <span className="text-navy">Profile</span></p>
        <div className="flex gap-2">
          <Button variant="ghost" className="border border-line">🪪 Print ID Card</Button>
          <Button variant="ghost" className="border border-line">🖨 Print Report</Button>
          <Button>✎ Edit Profile</Button>
        </div>
      </div>

      {/* Identity header */}
      <Card className="flex flex-wrap items-center gap-4">
        <div className="h-32 w-32 overflow-hidden rounded-lg border border-line bg-navy-wash">
          {student.avatar_path
            ? <img src={supabase.storage.from("student-photos").getPublicUrl(student.avatar_path).data.publicUrl} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-5xl text-ink-faint">👤</div>}
        </div>
        <div className="min-w-[240px]">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-3xl font-bold text-ink">{fullName || "FULL NAME"}</h1>
            <Badge tone={student.status === "active" ? "ok" : "neutral"}>{student.status}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink-soft">St. No: <span className="font-medium text-ink">{student.admission_no}</span></p>
          <p className="text-sm text-ink-soft">Grade: <span className="font-medium text-ink">{gradeLabel}</span></p>
          <p className="text-sm text-ink-soft">Roll: <span className="font-medium text-ink">{student.roll_number ?? "—"}</span></p>
        </div>
        <div className="flex flex-1 gap-3">
          {statCard("Current GPA", "—")}
          {statCard("Attendance", attendancePct != null ? `${attendancePct}%` : "—")}
          {statCard("Class Rank", "—")}
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-line">
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${tab === tb ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink"}`}>
            {tb}
          </button>
        ))}
      </div>

      {tab === "Personal Info" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">Demographics &amp; Identity</h2>
                <dl className="space-y-3 text-sm">
                  <Row label="Date of Birth (GC)" value={gc(student.date_of_birth)} />
                  <Row label="Date of Birth (EC)" value={<EthDate value={student.date_of_birth} />} />
                  <Row label="Gender" value={student.gender} />
                  <Row label="Primary Language" value={student.primary_language ?? "—"} />
                  <Row label="Blood Type" value={student.blood_type ?? "—"} />
                </dl>
              </Card>
              <Card>
                <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">Enrollment Details</h2>
                <dl className="space-y-3 text-sm">
                  <Row label="Admission Date" value={student.admission_date ? <EthDate value={student.admission_date} /> : "—"} />
                  <Row label="Homeroom Teacher" value={cls?.name ? "Assigned" : "—"} />
                  <Row label="Roll Number" value={student.roll_number ?? "—"} />
                  <Row label="Section" value={cls?.section ?? "—"} />
                </dl>
              </Card>
            </div>
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                <h2 className="font-semibold text-ink">Recent Academic Record (Semester 1)</h2>
                <button onClick={() => setTab("Academic Record")} className="text-sm text-navy hover:underline">View Full Transcript</button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ink-faint">
                  <tr><th className="py-2">Subject</th><th>Internal (40%)</th><th>Final (60%)</th><th>Total</th><th>Grade</th><th>Status</th></tr>
                </thead>
                <tbody className="divide-y divide-line text-ink">
                  <tr><td colSpan={6} className="py-8 text-center text-ink-faint">See Academic Record tab</td></tr>
                </tbody>
              </table>
            </Card>
          </div>

          {sidebar}
        </div>
      )}

      {tab === "Academic Record" && <AcademicRecordTab studentId={student.id} />}
      {tab === "Attendance" && <AttendanceTab studentId={student.id} />}
      {tab === "Behavioral" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><BehavioralTab studentId={student.id} /></div>
          {sidebar}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
