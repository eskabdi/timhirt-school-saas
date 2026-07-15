import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

const TYPE_COLOR: Record<string, string> = {
  holiday: "bg-meskel-wash text-meskel-deep", exam_window: "bg-danger/10 text-danger",
  national: "bg-ok/10 text-ok", custom: "bg-chalk-sunken text-ink-faint",
};

export function EventsCalendarPage() {
  const { data: events } = useQuery({
    queryKey: ["calendar-events"],
    queryFn: async () => {
      const { data, error } = await supabase.from("calendar_events")
        .select("id, event_date, name_i18n, event_type").order("event_date");
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Events & Academic Calendar</h1>
      <div className="space-y-2">
        {events?.map((e) => (
          <Card key={e.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium">{e.name_i18n?.en}</p>
              <p className="text-sm text-ink-faint"><EthDate value={e.event_date} /></p>
            </div>
            <span className={`rounded-card px-2.5 py-1 text-xs font-medium capitalize ${TYPE_COLOR[e.event_type]}`}>
              {e.event_type.replace("_", " ")}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
