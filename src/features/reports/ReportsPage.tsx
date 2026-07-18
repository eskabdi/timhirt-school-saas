import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";

const STATUS_TONE = { queued: "neutral", processing: "navy", done: "ok", failed: "danger" } as const;

export function ReportsPage() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["moe_exports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("moe_exports").select("id,export_type,ec_year,status").limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("reports.title")}</h1>
      {!data?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("reports.empty")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {data.map((row) => (
                <tr key={row.id} className="hover:bg-sidebar">
                  <td className="px-4 py-2 text-ink">{t(`reports.exportType.${row.export_type}`)}</td>
                  <td className="px-4 py-2 text-ink">{row.ec_year}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`reports.status.${row.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
