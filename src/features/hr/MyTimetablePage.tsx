import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { tField } from "@/lib/i18n";

interface MyTimetableSlot {
  day_of_week: number;
  room: string | null;
  classes: { name: string; section: string | null } | null;
  subjects: { name_i18n: Record<string, string> } | null;
  periods: { starts_at: string; ends_at: string; period_no: number } | null;
}

export function MyTimetablePage() {
  const { t, i18n } = useTranslation();
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const { profile } = useSession();
  const { data: slots } = useQuery({
    queryKey: ["my-timetable", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: teacher } = await supabase.from("teachers").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!teacher) return [];
      const { data } = await supabase.from("timetable_slots")
        .select("day_of_week, room, classes(name,section), subjects(name_i18n), periods(starts_at,ends_at,period_no)")
        .eq("teacher_id", teacher.id);
      // Ordering by a referenced table's column (periods.period_no) only
      // reorders the parent rows with `!inner` in the select, so sort here.
      return ((data as unknown as MyTimetableSlot[] | null) ?? []).sort((a, b) =>
        a.day_of_week - b.day_of_week
        || (a.periods?.period_no ?? 0) - (b.periods?.period_no ?? 0));
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("timetable.myTitle")}</h1>
      <div className="space-y-2">
        {slots?.map((s, i) => (
          <Card key={i} className="flex items-center justify-between text-sm text-ink">
            <span className="font-medium">{weekdays[s.day_of_week]} {s.periods?.starts_at?.slice(0,5)}–{s.periods?.ends_at?.slice(0,5)}</span>
            <span>{tField(s.subjects?.name_i18n, i18n.resolvedLanguage!)} · {s.classes?.name} {s.classes?.section}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
