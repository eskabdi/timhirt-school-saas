import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { formatETB } from "@/lib/i18n";
import { onRowDoubleClick } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { issueFeeDocumentUrl, markAllNotificationsRead, markNotificationRead, useBillingNotifications } from "./api";

const STATUS_TONE = { pending: "neutral", partial: "navy", paid: "ok", overdue: "danger" } as const;

function BillingNotificationsBanner() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: notifications } = useBillingNotifications(true);
  const unread = notifications?.filter((n) => !n.read_at) ?? [];

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing-notifications"] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(unread.map((n) => n.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing-notifications"] }),
  });

  if (!unread.length) return null;

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">{t("fees.notifications.title")} ({unread.length})</p>
        <button type="button" className="text-xs text-navy hover:underline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          {t("fees.notifications.markAllRead")}
        </button>
      </div>
      <div className="divide-y divide-line">
        {unread.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <p className="text-ink">
              {t(`fees.notifications.${n.kind}`, {
                amount: n.amount != null ? formatETB(Number(n.amount), i18n.resolvedLanguage!) : "",
                student: n.student ? `${n.student.first_name} ${n.student.last_name}` : "",
              })}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              {n.invoice_id && <Link to={n.invoice_id} className="text-navy hover:underline">{t("nav.invoices")}</Link>}
              <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={() => markRead.mutate(n.id)}>
                {t("fees.notifications.markRead")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ["invoices", page],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("fee_invoices")
        .select("id, amount_due, amount_paid, due_date, status, students(first_name,last_name)", { count: "exact" })
        .order("due_date", { ascending: false })
        .range(...pageRange(page));
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const invoices = data?.rows;

  // Un-paginated aggregate for the summary strip -- deliberately a separate,
  // lightweight query rather than summing the current page's 20 rows.
  const { data: totals } = useQuery({
    queryKey: ["invoices-totals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("fee_invoices").select("amount_due, amount_paid");
      if (error) throw error;
      const billed = (data ?? []).reduce((s, r) => s + Number(r.amount_due), 0);
      const paid = (data ?? []).reduce((s, r) => s + Number(r.amount_paid), 0);
      return { billed, paid, outstanding: billed - paid };
    },
  });

  const [payError, setPayError] = useState<Record<string, string | null>>({});
  const pay = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-fee-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      // Read the body even on failure -- process-fee-payment returns a real
      // reason (e.g. "Payment gateway is not configured yet") as JSON, which
      // a bare `if (!res.ok) throw new Error("failed")` used to discard.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || t("fees.payFailed"));
      return body as { checkout_url: string };
    },
    onMutate: (invoiceId) => setPayError((m) => ({ ...m, [invoiceId]: null })),
    onSuccess: (data) => { window.location.href = data.checkout_url; },
    onError: (e: unknown, invoiceId) => setPayError((m) => ({ ...m, [invoiceId]: e instanceof Error ? e.message : t("fees.payFailed") })),
  });

  const downloadInvoice = useMutation({
    mutationFn: (invoiceId: string) => issueFeeDocumentUrl("invoice", invoiceId),
    onSuccess: (res) => window.open(res.url, "_blank"),
  });

  const isStaffOrParent = profile?.role === "school_admin" || profile?.role === "accountant" || profile?.role === "parent" || profile?.role === "student";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("fees.invoicesTitle")}</h1>

      {isStaffOrParent && <BillingNotificationsBanner />}

      {totals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card><p className="text-xs text-ink-faint">{t("fees.totalBilled")}</p><p className="mt-1 font-display text-lg font-bold text-ink">{formatETB(totals.billed, i18n.resolvedLanguage!)}</p></Card>
          <Card><p className="text-xs text-ink-faint">{t("fees.totalPaid")}</p><p className="mt-1 font-display text-lg font-bold text-ok">{formatETB(totals.paid, i18n.resolvedLanguage!)}</p></Card>
          <Card><p className="text-xs text-ink-faint">{t("fees.outstanding")}</p><p className="mt-1 font-display text-lg font-bold text-danger">{formatETB(totals.outstanding, i18n.resolvedLanguage!)}</p></Card>
        </div>
      )}

      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-2">{t("fees.student")}</th>
              <th className="px-4 py-2">{t("fees.due")}</th>
              <th className="px-4 py-2">{t("fees.amountDue")}</th>
              <th className="px-4 py-2">{t("fees.amountPaid")}</th>
              <th className="px-4 py-2">{t("fees.balance")}</th>
              <th className="px-4 py-2">{t("fees.status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoices?.map((inv) => {
              const student = inv.students as unknown as { first_name: string; last_name: string } | null;
              return (
              <tr key={inv.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, inv.id)}>
                <td className="px-4 py-2 font-medium text-ink">
                  <Link to={inv.id} className="hover:underline">{student?.first_name} {student?.last_name}</Link>
                </td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={inv.due_date} /></td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(inv.amount_due), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink">{formatETB(Number(inv.amount_due) - Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2"><Badge tone={STATUS_TONE[inv.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`fees.invoiceStatus.${inv.status}`)}</Badge></td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button type="button" className="text-navy hover:underline" onClick={(e) => { e.stopPropagation(); downloadInvoice.mutate(inv.id); }}>
                      {t("fees.downloadInvoice")}
                    </button>
                    {inv.status !== "paid" && (
                      <Button variant="ghost" onClick={() => pay.mutate(inv.id)} disabled={pay.isPending}>{t("fees.payViaTelebirr")}</Button>
                    )}
                  </div>
                  {payError[inv.id] && <p role="alert" className="mt-1 text-xs text-danger">{payError[inv.id]}</p>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-4" />
      </Panel>
    </div>
  );
}
