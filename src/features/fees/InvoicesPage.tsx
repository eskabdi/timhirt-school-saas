import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { formatETB } from "@/lib/i18n";
import { onRowDoubleClick } from "@/lib/utils";
import { useTranslation } from "react-i18next";

const STATUS_TONE = { pending: "neutral", partial: "navy", paid: "ok", overdue: "danger" } as const;

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: invoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fee_invoices")
        .select("id, amount_due, amount_paid, due_date, status, students(first_name,last_name)")
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pay = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-fee-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ invoice_id: invoiceId, provider: "chapa" }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ checkout_url: string }>;
    },
    onSuccess: (data) => { window.location.href = data.checkout_url; },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("fees.invoicesTitle")}</h1>
      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("fees.student")}</th><th className="px-4 py-2">{t("fees.due")}</th><th className="px-4 py-2">{t("fees.amount")}</th><th className="px-4 py-2">{t("fees.status")}</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices?.map((inv) => (
              <tr key={inv.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, inv.id)}>
                <td className="px-4 py-2 font-medium text-ink">
                  <Link to={inv.id} className="hover:underline">{(inv.students as any)?.first_name} {(inv.students as any)?.last_name}</Link>
                </td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={inv.due_date} /></td>
                <td className="px-4 py-2 text-ink">{formatETB(Number(inv.amount_due) - Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[inv.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`fees.invoiceStatus.${inv.status}`)}</Badge></td>
                <td className="px-4 py-2">
                  {inv.status !== "paid" && (
                    <Button variant="ghost" onClick={() => pay.mutate(inv.id)} disabled={pay.isPending}>{t("fees.payViaChapa")}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
