// Shared fees-module helpers: on-demand invoice/receipt PDFs, server-side
// manual payment recording (record-fee-payment), and the portal billing
// notification feed shown on InvoicesPage/DashboardShell.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { callFunction } from "@/lib/functions";

export async function issueFeeDocumentUrl(kind: "invoice" | "receipt", invoiceId: string, paymentId?: string) {
  const res = await callFunction("issue-fee-document", { kind, invoice_id: invoiceId, payment_id: paymentId });
  return res as { url: string; doc_no: string };
}

export interface RecordPaymentInput {
  invoiceId: string;
  amount: number;
  provider: "cash" | "bank";
  reference?: string;
  bankVerification?: { payment_method: "cbe" | "awash_bank" | "telebirr"; verification_url: string };
}

export async function recordFeePayment(input: RecordPaymentInput) {
  const res = await callFunction("record-fee-payment", {
    invoice_id: input.invoiceId, amount: input.amount, provider: input.provider,
    reference: input.reference, bank_verification: input.bankVerification,
  });
  return res as { payment_id: string; receipt_url: string | null; bank_verification: { status: string; failure_reason?: string } | null };
}

export async function generateFeeInvoices(feeStructureId: string) {
  const res = await callFunction("generate-fee-invoices", { fee_structure_id: feeStructureId });
  return res as { created_count: number; skipped_count: number; total_matched: number };
}

export interface BillingNotification {
  id: string;
  kind: "invoice_issued" | "payment_received" | "invoice_overdue";
  invoice_id: string | null;
  payment_id: string | null;
  amount: number | null;
  read_at: string | null;
  created_at: string;
  student: { first_name: string; last_name: string } | null;
}

const BILLING_KINDS = ["invoice_issued", "payment_received", "invoice_overdue"] as const;

export function useBillingNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["billing-notifications"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("portal_notifications")
        .select("id, kind, invoice_id, payment_id, amount, read_at, created_at, student:students(first_name, last_name)")
        .in("kind", BILLING_KINDS)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as BillingNotification[];
    },
  });
}

export function useUnreadBillingCount(enabled: boolean) {
  return useQuery({
    queryKey: ["billing-notifications-unread-count"],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from("portal_notifications")
        .select("id", { count: "exact", head: true })
        .in("kind", BILLING_KINDS)
        .is("read_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from("portal_notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("portal_notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
  if (error) throw error;
}
