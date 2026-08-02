// ============================================================================
// Single invoice: balance, fee structure, full payment history, and a way
// to pay it. Reused for both the staff Fees module (/fees/invoices/:id) and
// the parent portal (/portal/pay/:id, via ParentInvoiceDetailPage) — RLS on
// fee_invoices/payments already scopes a parent to their own children's
// invoices and staff to the whole tenant, so one component serves both,
// same as InvoicesPage/ParentPaymentPage already do for the list view.
//
// Recording a cash/bank payment here is new: RLS (payments_manual_insert,
// 20260713000010_security_hardening.sql) has always let school_admin/
// accountant insert a manual 'succeeded' cash/bank payment, and a trigger
// (apply_payment_to_invoice) already credits the invoice automatically —
// but no page anywhere ever exposed that path. For a school where most fee
// payment happens in person rather than through Chapa, that's not an edge
// case, it's the common case — the module was incomplete without it.
// ============================================================================
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";
import { formatETB, tField } from "@/lib/i18n";

const STATUS_TONE = { pending: "neutral", partial: "navy", paid: "ok", overdue: "danger" } as const;
const PAYMENT_STATUS_TONE = { succeeded: "ok", pending: "neutral", failed: "danger", refunded: "late" } as const;

export function InvoiceDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const isPortal = location.pathname.startsWith("/portal");
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const canManage = profile?.role === "school_admin" || profile?.role === "accountant";

  const { data: invoice, isLoading, error } = useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("fee_invoices")
        .select("id, tenant_id, amount_due, amount_paid, due_date, status, student:students(id, first_name, last_name, admission_no, class:classes(name, section)), fee_structure:fee_structures(name_i18n, billing_cycle)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: payments } = useQuery({
    queryKey: ["invoice-payments", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("payments")
        .select("id, amount, provider, provider_ref, status, paid_at")
        .eq("invoice_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const pay = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-fee-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ invoice_id: id, provider: "chapa" }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ checkout_url: string }>;
    },
    onSuccess: (data) => { window.location.href = data.checkout_url; },
  });

  const [amount, setAmount] = useState("");
  const [provider, setProvider] = useState<"cash" | "bank">("cash");
  const [reference, setReference] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const remaining = invoice ? Number(invoice.amount_due) - Number(invoice.amount_paid) : 0;

  const recordPayment = useMutation({
    mutationFn: async () => {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error(t("fees.errors.invalidAmount"));
      const { error } = await supabase.from("payments").insert({
        tenant_id: invoice!.tenant_id,
        invoice_id: id,
        amount: amt,
        provider,
        provider_ref: reference.trim() || null,
        status: "succeeded",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAmount(""); setReference(""); setManualError(null);
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoice-payments", id] });
    },
    onError: (err: unknown) => setManualError(err instanceof Error ? err.message : String(err)),
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (error || !invoice) return <p role="alert" className="text-danger">{t("errors.generic")}</p>;

  const student = invoice.student as any;
  const feeStructure = invoice.fee_structure as any;
  const canPay = invoice.status !== "paid" && (profile?.role === "parent" || canManage);

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-ink-faint">
        <Link to={isPortal ? "/portal/pay" : "/fees/invoices"} className="hover:underline">
          {isPortal ? t("common.makePayment") : t("nav.invoices")}
        </Link> › <span className="text-navy">{t("students.profile.breadcrumb")}</span>
      </p>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold text-ink">
              <Link to={`/students/${student?.id}`} className="hover:underline">{student?.first_name} {student?.last_name}</Link>
            </h1>
            <p className="text-sm text-ink-faint">{student?.admission_no} · {student?.class?.name} {student?.class?.section}</p>
          </div>
          <Badge tone={STATUS_TONE[invoice.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`fees.invoiceStatus.${invoice.status}`)}</Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">{t("fees.feeStructure")}</dt><dd className="text-ink">{tField(feeStructure?.name_i18n, i18n.resolvedLanguage!)} ({t(`fees.cycle.${feeStructure?.billing_cycle}`)})</dd></div>
          <div><dt className="text-ink-faint">{t("fees.due")}</dt><dd className="text-ink"><EthDate value={invoice.due_date} /></dd></div>
          <div><dt className="text-ink-faint">{t("fees.amountDue")}</dt><dd className="text-ink">{formatETB(Number(invoice.amount_due), i18n.resolvedLanguage!)}</dd></div>
          <div><dt className="text-ink-faint">{t("fees.amountPaid")}</dt><dd className="text-ink">{formatETB(Number(invoice.amount_paid), i18n.resolvedLanguage!)}</dd></div>
          <div><dt className="text-ink-faint">{t("fees.remaining")}</dt><dd className="font-semibold text-ink">{formatETB(remaining, i18n.resolvedLanguage!)}</dd></div>
        </dl>

        {canPay && (
          <Button className="mt-4" onClick={() => pay.mutate()} disabled={pay.isPending}>
            {t("fees.payViaChapa")}
          </Button>
        )}
      </Card>

      <Panel>
        <PanelHeader title={t("fees.paymentHistory")} />
        {!payments?.length ? (
          <p className="p-5 text-sm text-ink-faint">{t("fees.noPayments")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-2">{t("fees.amount")}</th>
                <th className="px-5 py-2">{t("fees.provider")}</th>
                <th className="px-5 py-2">{t("fees.reference")}</th>
                <th className="px-5 py-2">{t("fees.status")}</th>
                <th className="px-5 py-2">{t("fees.paidOn")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-2 text-ink">{formatETB(Number(p.amount), i18n.resolvedLanguage!)}</td>
                  <td className="px-5 py-2 text-ink-faint">{t(`fees.paymentProvider.${p.provider}`)}</td>
                  <td className="px-5 py-2 text-ink-faint">{p.provider_ref ?? "—"}</td>
                  <td className="px-5 py-2"><Badge tone={PAYMENT_STATUS_TONE[p.status as keyof typeof PAYMENT_STATUS_TONE] ?? "neutral"}>{t(`fees.paymentStatus.${p.status}`)}</Badge></td>
                  <td className="px-5 py-2 text-ink-faint">{p.paid_at ? <EthDate value={p.paid_at.slice(0, 10)} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {canManage && invoice.status !== "paid" && (
        <Panel>
          <PanelHeader title={t("fees.recordPayment")} />
          <div className="space-y-3 p-5">
            <Field label={t("fees.amount")}>
              <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={remaining.toFixed(2)} />
            </Field>
            <Field label={t("fees.provider")}>
              <select value={provider} onChange={(e) => setProvider(e.target.value as "cash" | "bank")}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                <option value="cash">{t("fees.paymentProvider.cash")}</option>
                <option value="bank">{t("fees.paymentProvider.bank")}</option>
              </select>
            </Field>
            <Field label={t("fees.reference")}>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder={t("fees.referencePlaceholder")} />
            </Field>
            {manualError && <p role="alert" className="text-sm text-danger">{manualError}</p>}
            <Button onClick={() => recordPayment.mutate()} disabled={recordPayment.isPending || !amount}>
              {recordPayment.isPending ? t("fees.recording") : t("fees.recordPayment")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
