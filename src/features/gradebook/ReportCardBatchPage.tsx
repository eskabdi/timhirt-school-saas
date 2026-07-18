import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function ReportCardBatchPage() {
  const { t } = useTranslation();
  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: async () => (await supabase.from("classes").select("id,name,section")).data ?? [] });
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("gradebook.reportCards")}</h1>
      <Card className="space-y-2">
        {classes?.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name} {c.section}
          </label>
        ))}
        <Button disabled={!selected.length} className="mt-2">{t("gradebook.queuePdf", { count: selected.length })}</Button>
      </Card>
      <p className="text-xs text-ink-faint">{t("gradebook.reportCardNote")}</p>
    </div>
  );
}
