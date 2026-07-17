// §18.3 — effective-dated tax/pension config. super_admin only (RLS-enforced).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function StatutoryConfigPage() {
  const { data: brackets } = useQuery({
    queryKey: ["tax-brackets"],
    queryFn: async () => (await supabase.from("tax_brackets").select("*").order("effective_from", { ascending: false }).order("income_from")).data ?? [],
  });
  const { data: pension } = useQuery({
    queryKey: ["pension-rates"],
    queryFn: async () => (await supabase.from("pension_rates").select("*").order("effective_from", { ascending: false })).data ?? [],
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">Statutory configuration</h1>
      <Card>
        <h2 className="mb-3 font-semibold text-ink">Income tax brackets (Proc. 979/2016 Art. 11, as amended by 1395/2025)</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-ink-faint">
            <tr><th className="py-1">From</th><th className="py-1">To</th><th className="py-1">Rate</th><th className="py-1">Deduction</th><th className="py-1">Effective</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {brackets?.map((b) => (
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
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold text-ink">Pension rates (Proc. 715/2011)</h2>
        {pension?.map((p) => (
          <p key={p.id} className="text-sm text-ink">Employee {p.employee_pct}% · Employer {p.employer_pct}% — effective <EthDate value={p.effective_from} /></p>
        ))}
      </Card>
      <p className="text-xs text-late">⚠️ Verify against the proclamation currently in force before go-live (§18.3).</p>
    </div>
  );
}
