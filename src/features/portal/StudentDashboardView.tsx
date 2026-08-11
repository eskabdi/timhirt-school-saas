// Shared read-only dashboard for a single student — the content both the
// student's own portal ("my dashboard") and a guardian's per-child view
// ("their child's dashboard") render. One component so the two surfaces
// can't drift: KPI row, Personal Info, Academic Record, Attendance Log,
// Disciplinary Incident Log. Never renders admin actions (Edit, Print,
// Log Incident, Add Merit) — RLS has no write policy for student/parent on
// any of these tables, so offering the button would just produce a
// permission-denied error.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { AcademicRecordTab } from "@/features/students/tabs/AcademicRecordTab";
import { AttendanceTab } from "@/features/students/tabs/AttendanceTab";
import { BehavioralTab } from "@/features/students/tabs/BehavioralTab";

const TABS = ["personalInfo", "academicRecord", "attendance", "behavioral"] as const;
type Tab = (typeof TABS)[number];

const GC_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function gc(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00Z");
  return `${GC_MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function StudentDashboardView({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("personalInfo");

  const { data: student, isLoading } = useQuery({
    queryKey: ["portal-student-profile", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("students")
        .select("id, class_id, admission_no, roll_number, first_name, middle_name, last_name, date_of_birth, gender, status, avatar_path, blood_type, primary_language, ethnicity, admission_date, class:classes(name, section, grade_level)")
        .eq("id", studentId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: photoUrl } = useQuery({
    queryKey: ["portal-student-photo-url", student?.avatar_path],
    enabled: !!student?.avatar_path,
    staleTime: 4 * 60 * 1000,
    queryFn: async () =>
      (await supabase.storage.from("student-photos").createSignedUrl(student!.avatar_path!, 300)).data?.signedUrl ?? null,
  });

  const { data: attendancePct } = useQuery({
    queryKey: ["portal-student-att-pct", studentId],
    queryFn: async () => {
      const { data } = await supabase.from("attendance").select("status").eq("student_id", studentId);
      if (!data?.length) return null;
      const present = data.filter((a) => a.status === "present" || a.status === "excused").length;
      return Math.round((present / data.length) * 100);
    },
  });

  const { data: openIncidents } = useQuery({
    queryKey: ["portal-student-open-incidents", studentId],
    queryFn: async () => {
      const { count } = await supabase.from("discipline_incidents")
        .select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "open");
      return count ?? 0;
    },
  });

  const { data: meritPoints } = useQuery({
    queryKey: ["portal-student-merit-points", studentId],
    queryFn: async () => {
      const { data } = await supabase.from("student_merits").select("points").eq("student_id", studentId);
      return (data ?? []).reduce((sum, m) => sum + (m.points ?? 0), 0);
    },
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (!student) return null;

  const cls = student.class as { name?: string; section?: string; grade_level?: number } | null;
  const fullName = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ");
  const gradeLabel = cls?.grade_level != null ? `${t("students.profile.grade")} ${cls.grade_level}${cls.section ? `-${cls.section}` : ""}` : cls?.name ?? "—";

  const statCard = (label: string, value: React.ReactNode) => (
    <Card className="flex-1 bg-navy-wash">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4">
        <div className="h-32 w-32 overflow-hidden rounded-lg border border-line bg-navy-wash">
          {photoUrl
            ? <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            : <div className="flex h-full w-full items-center justify-center text-5xl text-ink-faint">👤</div>}
        </div>
        <div className="min-w-[240px]">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-3xl font-bold text-ink">{fullName || t("students.profile.fullNamePlaceholder")}</h1>
            <Badge tone={student.status === "active" ? "ok" : "neutral"}>{t(`students.${student.status}`)}</Badge>
          </div>
          <p className="mt-2 text-sm text-ink-soft">{t("students.admissionNo")}: <span className="font-medium text-ink">{student.admission_no}</span></p>
          <p className="text-sm text-ink-soft">{t("students.profile.grade")}: <span className="font-medium text-ink">{gradeLabel}</span></p>
        </div>
        <div className="flex flex-1 flex-wrap gap-3">
          {statCard(t("attendance.title"), attendancePct != null ? `${attendancePct}%` : "—")}
          {statCard(t("behavioralTab.merits"), meritPoints ?? 0)}
          {statCard(t("behavioralTab.incidentLog"), openIncidents ?? 0)}
        </div>
      </Card>

      <div className="flex gap-6 border-b border-line">
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${tab === tb ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink"}`}>
            {t(`students.tabs.${tb}`)}
          </button>
        ))}
      </div>

      {tab === "personalInfo" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">{t("students.edit.demographics")}</h2>
            <dl className="space-y-3 text-sm">
              <Row label={t("students.profile.dobGc")} value={gc(student.date_of_birth)} />
              <Row label={t("students.profile.dobEc")} value={<EthDate value={student.date_of_birth} />} />
              <Row label={t("students.gender")} value={t(`students.${student.gender}`)} />
              <Row label={t("students.edit.primaryLanguage")} value={student.primary_language ?? "—"} />
              <Row label={t("students.ethnicity")}
                   value={student.ethnicity
                     ? t(`ethnicity.${student.ethnicity}`, { defaultValue: student.ethnicity })
                     : "—"} />
              <Row label={t("students.edit.bloodType")} value={student.blood_type ?? "—"} />
            </dl>
          </Card>
          <Card>
            <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">{t("students.edit.enrollment")}</h2>
            <dl className="space-y-3 text-sm">
              <Row label={t("students.edit.admissionDate")} value={student.admission_date ? <EthDate value={student.admission_date} /> : "—"} />
              <Row label={t("students.edit.rollNumber")} value={student.roll_number ?? "—"} />
              <Row label={t("students.edit.section")} value={cls?.section ?? "—"} />
            </dl>
          </Card>
        </div>
      )}

      {tab === "academicRecord" && (
        <AcademicRecordTab studentId={student.id} studentName={fullName}
          admissionNo={student.admission_no} classId={student.class_id} />
      )}
      {tab === "attendance" && <AttendanceTab studentId={student.id} />}
      {tab === "behavioral" && <BehavioralTab studentId={student.id} readOnly />}
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
