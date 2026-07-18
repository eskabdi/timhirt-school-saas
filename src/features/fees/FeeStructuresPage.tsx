import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { formatETB, tField } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

export function FeeStructuresPage() {
  const { t, i18n } = useTranslation();
  const { data } = useQuery({
    queryKey: ["fee-structures"],
    queryFn: async () => (await supabase.from("fee_structures").select("id, name_i18n, amount, billing_cycle")).data ?? [],
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("fees.structuresTitle")}</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((f) => (
          <Card key={f.id}>
            <p className="font-medium text-ink">{tField(f.name_i18n, i18n.resolvedLanguage!)}</p>
            <p className="text-sm text-ink-faint">{t(`fees.cycle.${f.billing_cycle}`)}</p>
            <p className="mt-2 font-display text-xl font-bold text-ink">{formatETB(Number(f.amount), i18n.resolvedLanguage!)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
