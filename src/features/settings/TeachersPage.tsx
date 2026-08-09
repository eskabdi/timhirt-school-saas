// ============================================================================
// Teacher management (school_admin): invite teacher logins and manage
// teaching assignments. This page is what makes the teacher-facing side of
// the app reachable at all — class_subject_teachers drives every
// is_teacher_of_class() RLS policy (students visibility, attendance
// writes, grade writes) and the timetable, yet no UI ever wrote to it
// before this page; and invite-staff is the only path that creates a
// teacher login (onboard-tenant/invite-tenant-admin are school_admin-only,
// provision-portal-accounts is students/parents-only).
//
// Assignment writes are direct table writes — cst_write RLS already limits
// them to school_admin in-tenant; only login creation goes through the
// Edge Function (auth.users + public.users need service role).
//
// Grouped by teaching_cycle_key (20260819000001), same collapsible pattern
// as PermissionsMatrixTab's domain groups -- unpaginated (unlike most admin
// lists here) since grouping needs the whole set, and a school's teacher
// count (tens, not thousands) makes that cheap.
// ============================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { tField } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";
import { GRADE_CYCLES, gradeCycleKeyFor, gradeCycleI18nKey } from "@/lib/gradeCycles";

const SHIFTS = ["morning", "afternoon"] as const;

interface TeacherRow {
  id: string;
  staff_no: string;
  shift: string | null;
  teaching_cycle_key: string | null;
  user: { full_name: string; email: string } | null;
}
interface AssignmentRow {
  id: string;
  teacher_id: string;
  class: { name: string; section: string | null } | null;
  subject: { name_i18n: Record<string, string>; code: string } | null;
}

async function callInviteStaff(body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-staff`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Invite failed");
  return res.json();
}

export function TeachersPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [staffNo, setStaffNo] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOk, setInviteOk] = useState(false);

  const [assignClass, setAssignClass] = useState<Record<string, string>>({});
  const [assignSubject, setAssignSubject] = useState<Record<string, string>>({});
  const [assignOverride, setAssignOverride] = useState<Record<string, boolean>>({});
  const [assignError, setAssignError] = useState<Record<string, string | null>>({});

  const [openCycles, setOpenCycles] = useState<Set<string>>(
    () => new Set([...GRADE_CYCLES.map((c) => c.key), "unassigned"]),
  );
  const toggleCycle = (key: string) => {
    setOpenCycles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const { data: teachers } = useQuery({
    queryKey: ["teachers-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teachers")
        .select("id, staff_no, shift, teaching_cycle_key, user:users(full_name, email)")
        .order("staff_no");
      if (error) throw error;
      return (data ?? []) as unknown as TeacherRow[];
    },
  });
  const { data: classes } = useQuery({
    queryKey: ["classes-brief"],
    queryFn: async () => (await supabase.from("classes").select("id, name, section, grade_level").order("grade_level").order("section")).data ?? [],
  });
  const { data: subjects } = useQuery({
    queryKey: ["subjects-brief"],
    queryFn: async () => (await supabase.from("subjects").select("id, name_i18n, code").order("code")).data ?? [],
  });
  const { data: assignments } = useQuery({
    queryKey: ["cst-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subject_teachers")
        .select("id, teacher_id, class:classes(name, section), subject:subjects(name_i18n, code)");
      if (error) throw error;
      return data as unknown as AssignmentRow[];
    },
  });

  const cycleGroups = useMemo(() => {
    const byKey = new Map<string, TeacherRow[]>();
    for (const teacher of teachers ?? []) {
      const key = teacher.teaching_cycle_key ?? "unassigned";
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(teacher);
    }
    const order = [...GRADE_CYCLES.map((c) => c.key), "unassigned"];
    return order.filter((k) => byKey.has(k)).map((key) => ({ key, rows: byKey.get(key)! }));
  }, [teachers]);
  const cycleGroupLabel = (key: string) => key === "unassigned" ? t("teachers.noCycleAssigned") : t(`gradeCycles.${gradeCycleI18nKey(key)}`);

  // A class with no resolvable cycle (grade 0/KG, or no grade_level set) is
  // never a mismatch -- same "unrestricted" rule the DB trigger enforces.
  const classCycleKey = (classId: string) => gradeCycleKeyFor(classes?.find((c) => c.id === classId)?.grade_level ?? null);
  const cycleMismatch = (teacher: TeacherRow, classId: string) => {
    if (!teacher.teaching_cycle_key || !classId) return false;
    const cc = classCycleKey(classId);
    return cc !== null && cc !== teacher.teaching_cycle_key;
  };

  const invite = useMutation({
    mutationFn: () => callInviteStaff({ email, full_name: fullName, role: "teacher", staff_no: staffNo }),
    onSuccess: () => {
      setFullName(""); setEmail(""); setStaffNo(""); setInviteError(null); setInviteOk(true);
      setTimeout(() => setInviteOk(false), 3000);
      qc.invalidateQueries({ queryKey: ["teachers-admin"] });
    },
    onError: (err: unknown) => { setInviteOk(false); setInviteError(err instanceof Error ? err.message : String(err)); },
  });

  const addAssignment = useMutation({
    mutationFn: async ({ teacherId, tenantScope }: { teacherId: string; tenantScope: string }) => {
      const { error } = await supabase.from("class_subject_teachers").insert({
        tenant_id: tenantScope, teacher_id: teacherId,
        class_id: assignClass[teacherId], subject_id: assignSubject[teacherId],
        cycle_override: assignOverride[teacherId] ?? false,
      });
      if (error) throw error;
    },
    onSuccess: (_d, { teacherId }) => {
      setAssignClass((m) => ({ ...m, [teacherId]: "" }));
      setAssignSubject((m) => ({ ...m, [teacherId]: "" }));
      setAssignOverride((m) => ({ ...m, [teacherId]: false }));
      setAssignError((m) => ({ ...m, [teacherId]: null }));
      qc.invalidateQueries({ queryKey: ["cst-admin"] });
    },
    // The override checkbox below should catch this before the request ever
    // goes out -- this is the defense-in-depth path (e.g. the class list
    // changed underneath a stale checkbox state) for enforce_teacher_cycle()
    // (20260819000001) rejecting it server-side anyway.
    onError: (e: unknown, { teacherId }) => {
      const message = e instanceof Error && e.message.includes("teacher_outside_assigned_cycle")
        ? t("teachers.cycleMismatchBlocked")
        : t("teachers.assignFailed");
      setAssignError((m) => ({ ...m, [teacherId]: message }));
    },
  });

  const removeAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("class_subject_teachers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cst-admin"] }),
  });

  // tenant_id for inserts comes from an existing teacher row (RLS re-checks it
  // server-side regardless — a wrong value simply fails the with-check clause).
  const { data: myTenant } = useQuery({
    queryKey: ["my-tenant-id"],
    queryFn: async () => (await supabase.from("users").select("tenant_id").limit(1).single()).data?.tenant_id as string,
  });
  // Working shift only means anything for a double-shift school -- a
  // full-day tenant never sees the control at all rather than a dead one.
  const { data: tenantConfig } = useQuery({
    queryKey: ["tenant-config", myTenant],
    enabled: !!myTenant,
    queryFn: async () => (await supabase.from("tenant_configs").select("operational_mode_key").eq("tenant_id", myTenant!).maybeSingle()).data,
  });
  const isDoubleShift = tenantConfig?.operational_mode_key === "double_shift";

  const setShift = useMutation({
    mutationFn: async ({ teacherId, shift }: { teacherId: string; shift: string }) => {
      const { error } = await supabase.from("teachers").update({ shift }).eq("id", teacherId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers-admin"] }),
  });

  const setTeachingCycle = useMutation({
    mutationFn: async ({ teacherId, cycleKey }: { teacherId: string; cycleKey: string }) => {
      const { error } = await supabase.from("teachers").update({ teaching_cycle_key: cycleKey || null }).eq("id", teacherId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers-admin"] }),
  });

  const renderTeacher = (teacher: TeacherRow) => {
    const own = assignments?.filter((a) => a.teacher_id === teacher.id) ?? [];
    const mismatch = cycleMismatch(teacher, assignClass[teacher.id] ?? "");
    return (
      <Panel key={teacher.id}>
        <PanelHeader
          title={`${teacher.user?.full_name ?? "—"} (${teacher.staff_no})`}
          subtitle={teacher.user?.email}
        />
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between rounded-control bg-navy-wash p-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("teachers.teachingCycle")}</span>
            <select
              value={teacher.teaching_cycle_key ?? ""}
              onChange={(e) => setTeachingCycle.mutate({ teacherId: teacher.id, cycleKey: e.target.value })}
              className="rounded-control border border-line bg-card px-3 py-1.5 text-xs text-ink"
            >
              <option value="">{t("teachers.noCycleAssigned")}</option>
              {GRADE_CYCLES.map((c) => <option key={c.key} value={c.key}>{t(`gradeCycles.${gradeCycleI18nKey(c.key)}`)}</option>)}
            </select>
          </div>
          {isDoubleShift && (
            <div className="flex items-center justify-between rounded-control bg-navy-wash p-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("hr.workingShift")}</span>
              <div className="flex overflow-hidden rounded-control border border-line">
                {SHIFTS.map((s) => (
                  <button key={s} type="button" onClick={() => setShift.mutate({ teacherId: teacher.id, shift: s })}
                    className={`px-3 py-1 text-xs font-medium ${teacher.shift === s ? "bg-navy text-white" : "bg-card text-ink-soft"}`}>
                    {t(`hr.shiftOption.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {own.length === 0 ? (
            <p className="text-sm text-ink-faint">{t("teachers.noAssignments")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {own.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">
                    {a.class?.name} {a.class?.section} — {tField(a.subject?.name_i18n, i18n.resolvedLanguage!)} ({a.subject?.code})
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAssignment.mutate(a.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    {t("teachers.remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("students.class")}>
                <select
                  value={assignClass[teacher.id] ?? ""}
                  onChange={(e) => setAssignClass((m) => ({ ...m, [teacher.id]: e.target.value }))}
                  className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
                >
                  <option value="">—</option>
                  {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
                </select>
              </Field>
              <Field label={t("teachers.subject")}>
                <select
                  value={assignSubject[teacher.id] ?? ""}
                  onChange={(e) => setAssignSubject((m) => ({ ...m, [teacher.id]: e.target.value }))}
                  className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
                >
                  <option value="">—</option>
                  {subjects?.map((s) => (
                    <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!)} ({s.code})</option>
                  ))}
                </select>
              </Field>
              <Button
                variant="ghost"
                onClick={() => addAssignment.mutate({ teacherId: teacher.id, tenantScope: myTenant! })}
                disabled={addAssignment.isPending || !assignClass[teacher.id] || !assignSubject[teacher.id] || !myTenant || (mismatch && !assignOverride[teacher.id])}
              >
                {t("teachers.assign")}
              </Button>
            </div>
            {mismatch && (
              <label className="flex items-start gap-2 rounded-control border border-late/40 bg-late-tint/40 p-2.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={assignOverride[teacher.id] ?? false}
                  onChange={(e) => setAssignOverride((m) => ({ ...m, [teacher.id]: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  {t("teachers.cycleMismatchWarning", {
                    teacherCycle: t(`gradeCycles.${gradeCycleI18nKey(teacher.teaching_cycle_key!)}`),
                    classCycle: t(`gradeCycles.${gradeCycleI18nKey(classCycleKey(assignClass[teacher.id]!)!)}`),
                  })}
                  {" "}
                  <strong>{t("teachers.assignAnyway")}</strong>
                </span>
              </label>
            )}
            {assignError[teacher.id] && <p role="alert" className="text-xs text-danger">{assignError[teacher.id]}</p>}
          </div>
        </div>
      </Panel>
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("teachers.title")}</h1>

      <Card className="max-w-xl space-y-4">
        <h2 className="font-display text-lg font-bold text-ink">{t("teachers.inviteTitle")}</h2>
        <Field label={t("teachers.fullName")}>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </Field>
        <Field label={t("teachers.email")}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </Field>
        <Field label={t("teachers.staffNo")}>
          <Input value={staffNo} onChange={(e) => setStaffNo(e.target.value.toUpperCase())} maxLength={20} placeholder="T-001" />
        </Field>
        {inviteError && <p role="alert" className="text-sm text-danger">{inviteError}</p>}
        {inviteOk && <p className="text-sm text-ok">{t("teachers.inviteSent")}</p>}
        <Button onClick={() => invite.mutate()} disabled={invite.isPending || !fullName || !email || !staffNo}>
          {invite.isPending ? t("teachers.inviting") : t("teachers.invite")}
        </Button>
      </Card>

      {!teachers?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("teachers.empty")}</Card>
      ) : (
        <div className="space-y-3">
          {cycleGroups.map((group) => {
            const isOpen = openCycles.has(group.key);
            return (
              <div key={group.key} className="overflow-hidden rounded-control border border-line">
                <button
                  type="button"
                  onClick={() => toggleCycle(group.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between bg-navy px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-white"
                >
                  <span>{cycleGroupLabel(group.key)} <span className="font-normal normal-case text-white/70">({group.rows.length})</span></span>
                  <span className={cn("transition-transform", isOpen ? "rotate-180" : "")}>⌄</span>
                </button>
                {isOpen && (
                  <div className="space-y-3 bg-sidebar p-3">
                    {group.rows.map((teacher) => renderTeacher(teacher))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
