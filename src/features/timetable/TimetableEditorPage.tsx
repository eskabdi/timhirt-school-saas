import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { tField } from "@/lib/i18n";

// day_of_week is 1=Sunday..7=Saturday (matches weekdays[] index); the school
// week only shows Monday(2)-Friday(6).
const WEEKDAY_INDEXES = [2, 3, 4, 5, 6];

export function TimetableEditorPage() {
  const { t, i18n } = useTranslation();
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
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
      <h1 className="font-display text-2xl font-bold text-ink">{t("nav.timetable")}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {WEEKDAY_INDEXES.map((dow) => (
          <div key={dow} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase text-ink-faint">{weekdays[dow]}</h2>
            {slots?.filter((s) => s.day_of_week === dow).map((s) => (
              <Card key={s.id} className="p-3">
                <p className="text-sm font-medium text-ink">{tField((s.subjects as any)?.name_i18n, i18n.resolvedLanguage!)}</p>
                <p className="text-xs text-ink-faint">{(s.classes as any)?.name} {(s.classes as any)?.section} · {s.starts_at?.slice(0,5)}–{s.ends_at?.slice(0,5)}</p>
                {s.room && <p className="text-xs text-ink-faint">{t("timetable.room", { room: s.room })}</p>}
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
