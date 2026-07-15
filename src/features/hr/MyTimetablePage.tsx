import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

const DAYS = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MyTimetablePage() {
  const { profile } = useSession();
  const { data: slots } = useQuery({
    queryKey: ["my-timetable", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: teacher } = await supabase.from("teachers").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!teacher) return [];
      const { data } = await supabase.from("timetable_slots")
        .select("day_of_week, starts_at, ends_at, room, classes(name,section), subjects(name_i18n)")
        .eq("teacher_id", teacher.id).order("day_of_week").order("starts_at");
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">My timetable</h1>
      <div className="space-y-2">
        {slots?.map((s, i) => (
          <Card key={i} className="flex items-center justify-between text-sm">
            <span className="font-medium">{DAYS[s.day_of_week]} {s.starts_at?.slice(0,5)}–{s.ends_at?.slice(0,5)}</span>
            <span>{(s.subjects as any)?.name_i18n?.en} · {(s.classes as any)?.name} {(s.classes as any)?.section}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
