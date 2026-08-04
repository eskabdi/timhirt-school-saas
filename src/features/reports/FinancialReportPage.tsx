import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { ReportStat, ReportBarChart, ReportSection } from "./ReportComponents";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_TONE = { pending: "neutral", partial: "late", paid: "ok", overdue: "danger" } as const;
const PROVIDER_LABEL: Record<string, string> = { cash: "Cash", bank: "Bank transfer", chapa: "Chapa", telebirr: "Telebirr", stripe: "Card" };

interface Invoice { id: string; amount_due: number; amount_paid: number; status: string; created_at: string; }
interface Payment { id: string; amount: number; provider: string; status: string; paid_at: string | null; created_at: string; }

function fmtEtb(n: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ETB`;
}

export function FinancialReportPage() {
  const { t } = useTranslation();
  const [providerPage, setProviderPage] = useState(1);
  const [statusPage, setStatusPage] = useState(1);

  const { data: invoices, isLoading: loadingInvoices } = useQuery({
    queryKey: ["financial-report", "invoices"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fee_invoices")
        .select("id, amount_due, amount_paid, status, created_at").limit(5000);
      if (error) throw error;
      return (data ?? []) as Invoice[];
    },
  });

  const { data: payments, isLoading: loadingPayments } = useQuery({
    queryKey: ["financial-report", "payments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("id, amount, provider, status, paid_at, created_at").eq("status", "succeeded").limit(5000);
      if (error) throw error;
      return (data ?? []) as Payment[];
    },
  });

  const stats = useMemo(() => {
    const totalInvoiced = (invoices ?? []).reduce((s, i) => s + Number(i.amount_due), 0);
    const totalCollected = (invoices ?? []).reduce((s, i) => s + Number(i.amount_paid), 0);
    const outstanding = Math.max(0, totalInvoiced - totalCollected);
    const rate = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
    return { totalInvoiced, totalCollected, outstanding, rate };
  }, [invoices]);

  const byMonth = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTH_LABELS[d.getMonth()] ?? "", value: 0 });
    }
    for (const p of payments ?? []) {
      const d = new Date(p.paid_at ?? p.created_at);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const b = buckets.find((x) => x.key === key);
      if (b) b.value += Number(p.amount);
    }
    return buckets.map(({ label, value }) => ({ label, value: Math.round(value) }));
  }, [payments]);

  const byProvider = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of payments ?? []) totals.set(p.provider, (totals.get(p.provider) ?? 0) + Number(p.amount));
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const byStatus = useMemo(() => {
    const rows = new Map<string, { count: number; amount: number }>();
    for (const i of invoices ?? []) {
      const row = rows.get(i.status) ?? { count: 0, amount: 0 };
      row.count += 1;
      row.amount += Number(i.amount_due);
      rows.set(i.status, row);
    }
    return Array.from(rows.entries());
  }, [invoices]);

  const loading = loadingInvoices || loadingPayments;

  // Slicing here only affects what's rendered — byProvider/byStatus (and the
  // stat cards above, which derive from the full invoices/payments arrays)
  // keep reporting the complete totals.
  const [providerFrom, providerTo] = pageRange(providerPage);
  const visibleByProvider = byProvider.slice(providerFrom, providerTo + 1);
  const [statusFrom, statusTo] = pageRange(statusPage);
  const visibleByStatus = byStatus.slice(statusFrom, statusTo + 1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("reportPages.financialTitle")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ReportStat label={t("reportPages.totalInvoiced")} value={loading ? "—" : fmtEtb(stats.totalInvoiced)} />
        <ReportStat label={t("reportPages.totalCollected")} value={loading ? "—" : fmtEtb(stats.totalCollected)} tone="ok" />
        <ReportStat label={t("reportPages.outstanding")} value={loading ? "—" : fmtEtb(stats.outstanding)} tone="danger" />
        <ReportStat label={t("reportPages.collectionRate")} value={loading ? "—" : `${stats.rate.toFixed(1)}%`} tone="navy" />
      </div>

      <ReportSection title={t("reportPages.collectionsLast6")}>
        <ReportBarChart bars={byMonth} />
      </ReportSection>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.byPaymentMethod")}</h2></div>
          {!byProvider.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {visibleByProvider.map(([provider, amount]) => (
                  <tr key={provider}>
                    <td className="px-5 py-3 text-ink-soft">{PROVIDER_LABEL[provider] ?? provider}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{fmtEtb(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={providerPage} totalCount={byProvider.length} onPageChange={setProviderPage} className="px-5" />
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.invoiceStatus")}</h2></div>
          {!byStatus.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {visibleByStatus.map(([status, row]) => (
                  <tr key={status}>
                    <td className="px-5 py-3"><Badge tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>{status}</Badge></td>
                    <td className="px-5 py-3 text-ink-soft">{row.count} invoices</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{fmtEtb(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={statusPage} totalCount={byStatus.length} onPageChange={setStatusPage} className="px-5" />
        </Panel>
      </div>
    </div>
  );
}
