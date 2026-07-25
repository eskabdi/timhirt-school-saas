import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { AcademicRecordTab } from "./tabs/AcademicRecordTab";
import { AttendanceTab } from "./tabs/AttendanceTab";
import { BehavioralTab } from "./tabs/BehavioralTab";
import { PrintIDCardModal } from "./PrintIDCardModal";
import { EditProfileModal } from "./EditProfileModal";

const TABS = ["personalInfo", "academicRecord", "attendance", "behavioral"] as const;
type Tab = (typeof TABS)[number];

// Gregorian formatter (toLocaleDateString is lint-banned in this repo).
const GC_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function gc(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value + "T00:00:00Z");
  return `${GC_MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function StudentDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>("personalInfo");
  const [showIdCard, setShowIdCard] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: student, isLoading } = useQuery({
    queryKey: ["student-profile", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("students")
        .select("id, tenant_id, class_id, admission_no, roll_number, first_name, middle_name, last_name, first_name_am, middle_name_am, last_name_am, date_of_birth, gender, status, avatar_path, blood_type, primary_language, admission_date, user_id, class:classes(name, section, grade_level, homeroom_teacher_id)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  // student-photos is a private bucket, so the photo needs a signed URL —
  // getPublicUrl only resolves for buckets created with public = true.
  const { data: photoUrl } = useQuery({
    queryKey: ["student-photo-url", student?.avatar_path],
    enabled: !!student?.avatar_path,
    staleTime: 4 * 60 * 1000, // re-sign before the 5-minute link expires
    queryFn: async () =>
      (await supabase.storage.from("student-photos").createSignedUrl(student!.avatar_path!, 300)).data?.signedUrl ?? null,
  });

  // Homeroom teacher lives on the class; resolve the name so the Enrollment
  // card can show who it is rather than just that someone is assigned.
  const homeroomId = (student?.class as { homeroom_teacher_id?: string | null } | null)?.homeroom_teacher_id ?? null;
  const { data: homeroomTeacher } = useQuery({
    queryKey: ["student-homeroom-teacher", homeroomId],
    enabled: !!homeroomId,
    queryFn: async () =>
      (await supabase.from("teachers").select("staff_no, user:users(full_name)").eq("id", homeroomId!).maybeSingle()).data,
  });

  const { data: guardian } = useQuery({
    queryKey: ["student-guardian", id],
    enabled: !!id,
    queryFn: async () => (await supabase.from("guardians").select("id, full_name, relationship, phone, email").eq("student_id", id).limit(1).maybeSingle()).data,
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
  const gradeLabel = cls?.grade_level != null ? `${t("students.profile.grade")} ${cls.grade_level}${cls.section ? `-${cls.section}` : ""}` : cls?.name ?? "—";

  const statCard = (label: string, value: React.ReactNode) => (
    <Card className="flex-1 bg-navy-wash">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
    </Card>
  );

  const sidebar = (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-2"><span className="text-navy">🔗</span><h2 className="font-semibold text-ink">{t("students.profile.primaryGuardian")}</h2></div>
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy-wash text-sm font-bold text-navy">
            {guardian?.full_name ? guardian.full_name.trim().charAt(0).toUpperCase() : "—"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{guardian?.full_name ?? "—"}</p>
            <span className="text-xs text-ink-faint">
              {guardian?.relationship ? t(`admissions.relationshipType.${guardian.relationship}`) : "—"}
            </span>
          </div>
        </div>
        <div className="mt-3 space-y-1 text-sm text-ink-soft">
          <p>📞 {guardian?.phone ?? "—"}</p>
          <p>✉ {guardian?.email ?? "—"}</p>
        </div>
        <Button variant="ghost" className="mt-3 w-full border border-line" onClick={() => guardian?.phone && window.open(`tel:${guardian.phone}`)} disabled={!guardian?.phone}>{t("students.profile.contactGuardian")}</Button>
      </Card>
      <Card>
        <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">{t("students.profile.recentAbsences")}</h2>
        <button onClick={() => setTab("attendance")} className="w-full rounded-control bg-navy-wash py-2 text-sm text-navy">{t("students.profile.viewAttendanceLog")}</button>
      </Card>
      <Card className="bg-navy-wash">
        <h2 className="text-xs font-bold uppercase tracking-wide text-navy">{t("students.profile.adminNotes")}</h2>
        <p className="mt-2 text-sm text-ink-faint">{t("students.profile.noNotes")}</p>
      </Card>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-ink-faint"><Link to="/students" className="hover:underline">{t("students.title")}</Link> › {gradeLabel} › <span className="text-navy">{t("students.profile.breadcrumb")}</span></p>
        <div className="flex gap-2">
          <Button variant="ghost" className="border border-line" onClick={() => setShowIdCard(true)}>🪪 {t("students.profile.printIdCard")}</Button>
          <Button variant="ghost" className="border border-line" onClick={() => window.print()}>🖨 {t("students.profile.printReport")}</Button>
          <Button onClick={() => setShowEdit(true)}>✎ {t("students.profile.editProfile")}</Button>
        </div>
      </div>

      {/* Identity header */}
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
          <p className="text-sm text-ink-soft">{t("students.edit.rollNumber")}: <span className="font-medium text-ink">{student.roll_number ?? "—"}</span></p>
        </div>
        <div className="flex flex-1 gap-3">
          {statCard(t("students.profile.currentGpa"), "—")}
          {statCard(t("attendance.title"), attendancePct != null ? `${attendancePct}%` : "—")}
          {statCard(t("students.profile.classRank"), "—")}
        </div>
      </Card>

      {/* Tabs */}
      <div className="no-print flex gap-6 border-b border-line">
        {TABS.map((tb) => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`-mb-px border-b-2 px-1 pb-2 text-sm font-medium ${tab === tb ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink"}`}>
            {t(`students.tabs.${tb}`)}
          </button>
        ))}
      </div>

      {/* Print Report scopes to this container only (see index.css @media print) */}
      <div id="print-scope">
      <div className="print-only mb-4">
        <h2 className="font-display text-xl font-bold text-ink">{fullName} — {t(`students.tabs.${tab}`)}</h2>
        <p className="text-sm text-ink-faint">{t("students.admissionNo")}: {student.admission_no} · {gradeLabel}</p>
      </div>

      {tab === "personalInfo" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">{t("students.edit.demographics")}</h2>
                <dl className="space-y-3 text-sm">
                  <Row label={t("students.profile.dobGc")} value={gc(student.date_of_birth)} />
                  <Row label={t("students.profile.dobEc")} value={<EthDate value={student.date_of_birth} />} />
                  <Row label={t("students.gender")} value={t(`students.${student.gender}`)} />
                  <Row label={t("students.edit.primaryLanguage")} value={student.primary_language ?? "—"} />
                  <Row label={t("students.edit.bloodType")} value={student.blood_type ?? "—"} />
                </dl>
              </Card>
              <Card>
                <h2 className="mb-3 border-b border-line pb-2 font-semibold text-ink">{t("students.edit.enrollment")}</h2>
                <dl className="space-y-3 text-sm">
                  <Row label={t("students.edit.admissionDate")} value={student.admission_date ? <EthDate value={student.admission_date} /> : "—"} />
                  <Row label={t("students.edit.homeroomTeacher")} value={(homeroomTeacher?.user as { full_name?: string } | null)?.full_name ?? homeroomTeacher?.staff_no ?? "—"} />
                  <Row label={t("students.edit.rollNumber")} value={student.roll_number ?? "—"} />
                  <Row label={t("students.edit.section")} value={cls?.section ?? "—"} />
                </dl>
              </Card>
            </div>
            <Card>
              <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                <h2 className="font-semibold text-ink">{t("students.profile.recentAcademic")}</h2>
                <button onClick={() => setTab("academicRecord")} className="text-sm text-navy hover:underline">{t("students.profile.viewFullTranscript")}</button>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-ink-faint">
                  <tr><th className="py-2">{t("gradebook.subject")}</th><th>{t("students.profile.internal")}</th><th>{t("students.profile.final")}</th><th>{t("students.profile.total")}</th><th>{t("students.profile.gradeCol")}</th><th>{t("students.status")}</th></tr>
                </thead>
                <tbody className="divide-y divide-line text-ink">
                  <tr><td colSpan={6} className="py-8 text-center text-ink-faint">{t("students.profile.seeAcademicTab")}</td></tr>
                </tbody>
              </table>
            </Card>
          </div>

          {sidebar}
        </div>
      )}

      {tab === "academicRecord" && (
        <AcademicRecordTab studentId={student.id} studentName={fullName}
          admissionNo={student.admission_no} gradeLabel={gradeLabel} />
      )}
      {tab === "attendance" && <AttendanceTab studentId={student.id} />}
      {tab === "behavioral" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2"><BehavioralTab studentId={student.id} /></div>
          {sidebar}
        </div>
      )}
      </div>

      <PrintIDCardModal studentId={student.id} studentName={fullName} open={showIdCard} onClose={() => setShowIdCard(false)} />
      <EditProfileModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        student={{
          id: student.id, tenant_id: student.tenant_id,
          first_name: student.first_name, middle_name: student.middle_name, last_name: student.last_name,
          first_name_am: student.first_name_am, middle_name_am: student.middle_name_am, last_name_am: student.last_name_am,
          date_of_birth: student.date_of_birth, gender: student.gender, primary_language: student.primary_language,
          blood_type: student.blood_type, roll_number: student.roll_number, admission_date: student.admission_date,
          avatar_path: student.avatar_path, class_id: student.class_id,
        }}
        guardian={guardian ?? null}
      />
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
