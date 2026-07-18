import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

export function AttendanceOverviewPage() {
  const { t } = useTranslation();
  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("id,name,section")).data ?? [],
  });
  const { data: summary } = useQuery({
    queryKey: ["attendance-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance")
        .select("class_id, status").gte("attendance_date", new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
      if (error) throw error;
      return data;
    },
  });
  const byClass = new Map<string, { present: number; absent: number }>();
  summary?.forEach((r) => {
    const e = byClass.get(r.class_id) ?? { present: 0, absent: 0 };
    if (r.status === "present") e.present++; else if (r.status === "absent") e.absent++;
    byClass.set(r.class_id, e);
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("attendance.overview")}</h1>
      <div className="grid gap-3 md:grid-cols-3">
        {classes?.map((c) => {
          const e = byClass.get(c.id) ?? { present: 0, absent: 0 };
          const total = e.present + e.absent;
          const pct = total ? Math.round((e.present / total) * 100) : 0;
          return (
            <Card key={c.id}>
              <p className="font-medium text-ink">{c.name} {c.section}</p>
              <p className="mt-1 font-display text-2xl font-bold text-ink">{pct}%</p>
              <p className="text-xs text-ink-faint">{t("attendance.presentAbsent", { present: e.present, absent: e.absent })}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
