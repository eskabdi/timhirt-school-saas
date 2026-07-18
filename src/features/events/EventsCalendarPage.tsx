import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { tField } from "@/lib/i18n";

const TYPE_TONE = { holiday: "navy", exam_window: "danger", national: "ok", custom: "neutral" } as const;

export function EventsCalendarPage() {
  const { t, i18n } = useTranslation();
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
      <h1 className="font-display text-2xl font-bold text-ink">{t("events.title")}</h1>
      <div className="space-y-2">
        {events?.map((e) => (
          <Card key={e.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ink">{tField(e.name_i18n, i18n.resolvedLanguage!)}</p>
              <p className="text-sm text-ink-faint"><EthDate value={e.event_date} /></p>
            </div>
            <Badge tone={TYPE_TONE[e.event_type as keyof typeof TYPE_TONE] ?? "neutral"}>
              {t(`events.eventType.${e.event_type}`)}
            </Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
