// §18.3 — effective-dated tax/pension config. super_admin only (RLS-enforced).
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";

export function StatutoryConfigPage() {
  const { t } = useTranslation();
  const [bracketsPage, setBracketsPage] = useState(1);
  const [pensionPage, setPensionPage] = useState(1);
  const { data: brackets } = useQuery({
    queryKey: ["tax-brackets"],
    queryFn: async () => (await supabase.from("tax_brackets").select("*").order("effective_from", { ascending: false }).order("income_from")).data ?? [],
  });
  const { data: pension } = useQuery({
    queryKey: ["pension-rates"],
    queryFn: async () => (await supabase.from("pension_rates").select("*").order("effective_from", { ascending: false })).data ?? [],
  });

  const [bracketsFrom, bracketsTo] = pageRange(bracketsPage);
  const visibleBrackets = (brackets ?? []).slice(bracketsFrom, bracketsTo + 1);
  const [pensionFrom, pensionTo] = pageRange(pensionPage);
  const visiblePension = (pension ?? []).slice(pensionFrom, pensionTo + 1);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t("platformPagesX.statutoryConfig")}</h1>
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{t("platformPagesX.taxBrackets")}</h2>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs uppercase text-ink-faint">
            <tr><th className="py-1">{t("platformPagesX.from")}</th><th className="py-1">{t("platformPagesX.to")}</th><th className="py-1">{t("platformPagesX.rate")}</th><th className="py-1">{t("platformPagesX.deduction")}</th><th className="py-1">{t("platformPagesX.effective")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibleBrackets.map((b) => (
              <tr key={b.id}>
                <td className="py-1.5 text-ink">{b.income_from} ETB</td>
                <td className="py-1.5 text-ink">{b.income_to ?? "∞"} ETB</td>
                <td className="py-1.5 text-ink">{b.rate_pct}%</td>
                <td className="py-1.5 text-ink">{b.deduction_amount} ETB</td>
                <td className="py-1.5 text-ink-faint"><EthDate value={b.effective_from} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <Pagination page={bracketsPage} totalCount={brackets?.length ?? 0} onPageChange={setBracketsPage} />
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{t("platformPagesX.pensionRates")}</h2>
        {visiblePension.map((p) => (
          <p key={p.id} className="text-sm text-ink">Employee {p.employee_pct}% · Employer {p.employer_pct}% — effective <EthDate value={p.effective_from} /></p>
        ))}
        <Pagination page={pensionPage} totalCount={pension?.length ?? 0} onPageChange={setPensionPage} />
      </Card>
      <p className="text-xs text-late">{t("platformPagesX.verifyWarning")}</p>
    </div>
  );
}
