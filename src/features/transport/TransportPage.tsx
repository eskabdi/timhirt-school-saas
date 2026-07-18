import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";

export function TransportPage() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["transport_routes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transport_routes").select("id,name,vehicle_no,driver_name").limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("nav.transport")}</h1>
      {!data?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("noRecordsYet")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {data.map((row: Record<string, unknown>, i: number) => (
                <tr key={i} className="hover:bg-sidebar">
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="px-4 py-2 text-ink">{String(v ?? "—")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
