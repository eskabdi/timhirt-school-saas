import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { formatETB } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-chalk-sunken text-ink-faint", partial: "bg-meskel-wash text-meskel-deep",
  paid: "bg-ok/10 text-ok", overdue: "bg-danger/10 text-danger",
};

export function InvoicesPage() {
  const { i18n } = useTranslation();
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
      <h1 className="font-display text-2xl font-bold">Invoices</h1>
      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">Student</th><th className="px-4 py-2">Due</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Status</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices?.map((inv) => (
              <tr key={inv.id}>
                <td className="px-4 py-2 font-medium">{(inv.students as any)?.first_name} {(inv.students as any)?.last_name}</td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={inv.due_date} /></td>
                <td className="px-4 py-2">{formatETB(Number(inv.amount_due) - Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2"><span className={`rounded-card px-2 py-1 text-xs font-medium capitalize ${STATUS_COLOR[inv.status]}`}>{inv.status}</span></td>
                <td className="px-4 py-2">
                  {inv.status !== "paid" && (
                    <Button variant="ghost" onClick={() => pay.mutate(inv.id)} disabled={pay.isPending}>Pay via Chapa</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
