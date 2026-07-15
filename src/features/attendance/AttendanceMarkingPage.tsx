import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { toIsoDate } from "@/lib/ethiopian-date";

type Status = "present" | "absent" | "late" | "excused";
const STATUSES: Status[] = ["present", "absent", "late", "excused"];

export function AttendanceMarkingPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const [date, setDate] = useState<Date>(new Date());
  const [classId, setClassId] = useState<string>("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const queryClient = useQueryClient();

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("id, name, section")).data ?? [],
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

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("attendance.title")}</h1>
      <div className="flex flex-wrap items-start gap-4">
        <select value={classId} onChange={(e) => setClassId(e.target.value)}
          className="rounded-card border border-line px-3 py-2 text-sm">
          <option value="">{t("attendance.class")}</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
        </select>
        <EthDatePicker value={date} onChange={setDate} />
      </div>

      {holidayBlocked && (
        <p role="alert" className="rounded-card bg-warn/10 px-4 py-2 text-sm text-warn">
          {t("attendance.holidayBlocked")}
        </p>
      )}

      {classId && (
        !students?.length ? (
          <Card className="py-8 text-center text-ink-faint">{t("attendance.empty")}</Card>
        ) : (
          <div className="overflow-hidden rounded-card border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {students.map((s) => {
                  const current = marks[s.id] ?? savedMap.get(s.id) ?? "present";
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-medium">{s.first_name} {s.last_name}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          {STATUSES.map((st) => (
                            <button key={st} type="button"
                              onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                              className={cn(
                                "rounded-card px-2.5 py-1 text-xs font-medium capitalize",
                                current === st ? "bg-meskel text-ink" : "bg-chalk-sunken text-ink-faint hover:bg-line",
                              )}>
                              {t(`attendance.${st}`)}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {!!students?.length && (
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {t("attendance.save")}
        </Button>
      )}
      {mutation.isSuccess && <p className="text-sm text-ok">{t("attendance.saved")}</p>}
    </div>
  );
}
