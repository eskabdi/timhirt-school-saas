import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export function TimetableEditorPage() {
  const { data: slots } = useQuery({
    queryKey: ["timetable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timetable_slots")
        .select("id, day_of_week, starts_at, ends_at, room, classes(name,section), subjects(name_i18n), teachers(staff_no)")
        .order("day_of_week").order("starts_at");
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Timetable</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {DAYS.map((d, idx) => (
          <div key={d} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase text-ink-faint">{d}</h2>
            {slots?.filter((s) => s.day_of_week === idx + 2).map((s) => (
              <Card key={s.id} className="p-3">
                <p className="text-sm font-medium">{(s.subjects as any)?.name_i18n?.en}</p>
                <p className="text-xs text-ink-faint">{(s.classes as any)?.name} {(s.classes as any)?.section} · {s.starts_at?.slice(0,5)}–{s.ends_at?.slice(0,5)}</p>
                {s.room && <p className="text-xs text-ink-faint">Room {s.room}</p>}
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
