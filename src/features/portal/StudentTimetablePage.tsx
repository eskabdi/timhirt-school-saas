import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

const DAYS = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function StudentTimetablePage() {
  const { profile } = useSession();
  const { data: slots } = useQuery({
    queryKey: ["student-timetable", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: student } = await supabase.from("students").select("class_id").eq("user_id", profile!.id).maybeSingle();
      if (!student) return [];
      const { data } = await supabase.from("timetable_slots")
        .select("day_of_week, starts_at, ends_at, subjects(name_i18n)").eq("class_id", student.class_id)
        .order("day_of_week").order("starts_at");
      return data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">My timetable</h1>
      {slots?.map((s, i) => (
        <Card key={i} className="flex justify-between text-sm">
          <span>{DAYS[s.day_of_week]} {s.starts_at?.slice(0,5)}</span><span>{(s.subjects as any)?.name_i18n?.en}</span>
        </Card>
      ))}
    </div>
  );
}
