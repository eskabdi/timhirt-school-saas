import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { EthDate } from "@/components/EthDate";
import { Panel } from "@/components/ui/Panel";

export function IDCardBatchPage() {
  const { t } = useTranslation();
  const { data: cards } = useQuery({
    queryKey: ["id-cards"],
    queryFn: async () => {
      const { data, error } = await supabase.from("id_cards")
        .select("id, subject_type, verify_code, issued_on").order("issued_on", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("nav.idCards")}</h1>
      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("idCards.type")}</th><th className="px-4 py-2">{t("idCards.verifyCode")}</th><th className="px-4 py-2">{t("idCards.issued")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {cards?.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 text-ink">{t(`idCards.subjectType.${c.subject_type}`)}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink">{c.verify_code}</td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={c.issued_on} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
