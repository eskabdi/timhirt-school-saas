import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

const DAYS = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface StudentTimetableSlot {
  day_of_week: number;
  subjects: { name_i18n: Record<string, string> } | null;
  periods: { starts_at: string; ends_at: string; period_no: number } | null;
}

export function StudentTimetablePage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: slots } = useQuery({
    queryKey: ["student-timetable", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: student } = await supabase.from("students").select("class_id").eq("user_id", profile!.id).maybeSingle();
      if (!student) return [];
      const { data } = await supabase.from("timetable_slots")
        .select("day_of_week, subjects(name_i18n), periods(starts_at,ends_at,period_no)")
        .eq("class_id", student.class_id);
      // Ordering by a referenced table's column (periods.period_no) only
      // reorders the parent rows with `!inner` in the select, so sort here.
      return ((data as unknown as StudentTimetableSlot[] | null) ?? []).sort((a, b) =>
        a.day_of_week - b.day_of_week
        || (a.periods?.period_no ?? 0) - (b.periods?.period_no ?? 0));
    },
  });
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">{t("portalPages.myTimetable")}</h1>
      {slots?.map((s, i) => (
        <Card key={i} className="flex justify-between text-sm">
          <span>{DAYS[s.day_of_week]} {s.periods?.starts_at?.slice(0,5)}</span><span>{s.subjects?.name_i18n?.en}</span>
        </Card>
      ))}
    </div>
  );
}
