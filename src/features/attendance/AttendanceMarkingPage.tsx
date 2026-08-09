import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader, PanelFooter } from "@/components/ui/Panel";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import { toIsoDate } from "@/lib/ethiopian-date";

type Status = "present" | "absent" | "late" | "excused";
const STATUSES: Status[] = ["present", "absent", "late", "excused"];
const TONE: Record<Status, SegmentOption<Status>["tone"]> = {
  present: "ok", absent: "danger", late: "late", excused: "navy",
};

export function AttendanceMarkingPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const [date, setDate] = useState<Date>(new Date());
  const [classId, setClassId] = useState<string>("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const queryClient = useQueryClient();

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("id, name, section").order("grade_level").order("section")).data ?? [],
  });

  const { data: students } = useQuery({
    queryKey: ["attendance-roster", classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data } = await supabase.from("students")
        .select("id, first_name, last_name").eq("class_id", classId).eq("status", "active").order("last_name");
      return data ?? [];
    },
  });

  const { data: existing, isError: holidayBlocked } = useQuery({
    queryKey: ["attendance", classId, toIsoDate(date)],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance")
        .select("student_id, status").eq("class_id", classId).eq("attendance_date", toIsoDate(date));
      if (error) throw error;
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(marks).map(([student_id, status]) => ({
        tenant_id: profile!.tenant_id, student_id, class_id: classId,
        attendance_date: toIsoDate(date), status,
      }));
      const { error } = await supabase.from("attendance")
        .upsert(rows, { onConflict: "tenant_id,student_id,attendance_date,class_id" });
      if (error) throw error; // holiday_blocked surfaces here from the DB trigger
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["attendance", classId, toIsoDate(date)] }),
  });

  const savedMap = new Map((existing ?? []).map((e) => [e.student_id, e.status as Status]));

  // Computed client-side from marks/savedMap (the same state the save
  // mutation already uses), not a separate aggregate query — this reflects
  // *unsaved* local edits until Save is pressed, which is the right UX (an
  // in-progress tally), but is a deliberate behavior worth knowing about.
  const counts = useMemo(() => {
    const c: Record<Status, number> = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const s of students ?? []) {
      const current = marks[s.id] ?? savedMap.get(s.id) ?? "present";
      c[current]++;
    }
    return c;
  }, [students, marks, existing]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("attendance.title")}</h1>
      <div className="flex flex-wrap items-start gap-4">
        <select value={classId} onChange={(e) => setClassId(e.target.value)}
          className="rounded-control border border-line bg-card px-3 py-2 text-sm">
          <option value="">{t("attendance.class")}</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
        </select>
        <EthDatePicker value={date} onChange={setDate} />
      </div>

      {holidayBlocked && (
        <p role="alert" className="rounded-control bg-late-tint px-4 py-2 text-sm text-late">
          {t("attendance.holidayBlocked")}
        </p>
      )}

      {classId && !!students?.length && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {STATUSES.map((st) => (
            <Card key={st} className="py-3 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t(`attendance.${st}`)}</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-ink">{counts[st]}</p>
            </Card>
          ))}
        </div>
      )}

      {classId && (
        !students?.length ? (
          <Card className="py-8 text-center text-ink-faint">{t("attendance.empty")}</Card>
        ) : (
          <Panel>
            <PanelHeader title={t("attendance.title")} />
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {students.map((s) => {
                  const current = marks[s.id] ?? savedMap.get(s.id) ?? "present";
                  return (
                    <tr key={s.id}>
                      <td className="px-5 py-3 font-medium text-ink">{s.first_name} {s.last_name}</td>
                      <td className="px-5 py-3 text-right">
                        <SegmentedControl
                          options={STATUSES.map((st) => ({ value: st, label: t(`attendance.${st}`), tone: TONE[st] }))}
                          value={current}
                          onChange={(st) => setMarks((m) => ({ ...m, [s.id]: st }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <PanelFooter className="flex items-center gap-3">
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {t("attendance.save")}
              </Button>
              {mutation.isSuccess && <p className="text-sm text-ok">{t("attendance.saved")}</p>}
            </PanelFooter>
          </Panel>
        )
      )}
    </div>
  );
}
