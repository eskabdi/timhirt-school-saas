import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { formatETB, tField } from "@/lib/i18n";
import { cn, onRowDoubleClick } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { issueFeeDocumentUrl, markAllNotificationsRead, markNotificationRead, useBillingNotifications, generateFeeInvoices } from "./api";
import { IconReceipt, IconCheckCircle, IconWarningTriangle, IconDownload, IconPlusDoc, IconCalendarSmall } from "./icons";

const STATUS_TONE = { pending: "neutral", partial: "navy", paid: "ok", overdue: "danger" } as const;
const SELECT_CLS = "rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

interface StudentRow {
  id: string; first_name: string; last_name: string;
  class: { name: string; section: string | null } | null;
}
interface InvoiceRow {
  id: string; student_id: string; due_date: string;
  amount_due: number; amount_paid: number; status: string; line_count: number;
  student: StudentRow | null;
}

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

function GenerateInvoicesModal({ open, onClose, onGenerated }: {
  open: boolean; onClose: () => void; onGenerated: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [feeStructureId, setFeeStructureId] = useState("");
  const [result, setResult] = useState<{ created: number; skipped: number; total: number } | null>(null);

  const { data: feeStructures } = useQuery({
    queryKey: ["invoices-fee-structures-modal"],
    enabled: open,
    queryFn: async () => (await supabase.from("fee_structures").select("id, name_i18n, amount").order("created_at")).data ?? [],
  });

  const generate = useMutation({
    mutationFn: () => generateFeeInvoices(feeStructureId),
    onSuccess: (res) => {
      setResult({ created: res.created_count, skipped: res.skipped_count, total: res.total_matched });
      onGenerated();
    },
  });

  const close = () => { setFeeStructureId(""); setResult(null); onClose(); };

  return (
    <Modal open={open} onClose={close} title={t("fees.generateInvoices")}>
      <div className="space-y-4">
        <Field label={t("fees.feeStructure")}>
          <select value={feeStructureId} onChange={(e) => { setFeeStructureId(e.target.value); setResult(null); }} className={`w-full ${SELECT_CLS}`}>
            <option value="">{t("fees.filters.selectFeeStructure")}</option>
            {feeStructures?.map((f) => (
              <option key={f.id} value={f.id}>
                {tField(f.name_i18n as Record<string, string>, i18n.resolvedLanguage!)} — {formatETB(Number(f.amount), i18n.resolvedLanguage!)}
              </option>
            ))}
          </select>
        </Field>

        {result && (
          <p className="rounded-control bg-ok-tint px-3 py-2 text-sm text-ok">
            {t("fees.generateResult", { created: result.created, skipped: result.skipped, total: result.total })}
          </p>
        )}
        {generate.isError && <p role="alert" className="text-sm text-danger">{generate.error instanceof Error ? generate.error.message : t("fees.payFailed")}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>{t("common.cancel")}</Button>
          <Button onClick={() => generate.mutate()} disabled={!feeStructureId || generate.isPending}>
            {generate.isPending ? t("fees.generating") : t("fees.generateInvoices")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [feeStructureId, setFeeStructureId] = useState("");
  const [status, setStatus] = useState("");
  const [classId, setClassId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);
  const qc = useQueryClient();

  const isStaffOrParent = profile?.role === "school_admin" || profile?.role === "accountant" || profile?.role === "parent" || profile?.role === "student";
  const canManage = profile?.role === "school_admin" || profile?.role === "accountant";

  const { data: feeStructureOptions } = useQuery({
    queryKey: ["invoices-fee-structures"],
    queryFn: async () => (await supabase.from("fee_structures").select("id, name_i18n").order("created_at")).data ?? [],
  });
  const { data: classOptions } = useQuery({
    queryKey: ["invoices-classes"],
    queryFn: async () => (await supabase.from("classes").select("id, name, section").order("grade_level")).data ?? [],
  });

  // Real "current term" label, sourced the same way AttendanceOverviewPage
  // resolves its Term filter -- the academic term whose date range contains
  // today -- rather than a fabricated one.
  const { data: activeYear } = useQuery({
    queryKey: ["invoices-active-year"],
    queryFn: async () => (await supabase.from("academic_years").select("id, ec_year").eq("status", "active").maybeSingle()).data,
  });
  const { data: terms } = useQuery({
    queryKey: ["invoices-terms", activeYear?.id],
    enabled: !!activeYear?.id,
    queryFn: async () => (await supabase.from("academic_terms")
      .select("term_no, name_i18n, starts_on, ends_on").eq("academic_year_id", activeYear!.id).order("term_no")).data ?? [],
  });
  const currentTerm = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return terms?.find((term) => term.starts_on <= todayIso && todayIso <= term.ends_on) ?? null;
  }, [terms]);

  // fee_structure_id and class_id both live below invoice_summary's grain
  // (it's grouped by header), so a filter on either resolves to a set of
  // header ids first via fee_invoices/students, then narrows the header
  // query -- same two-step pattern InvoicesPage already uses to attach
  // student names to a grouped view.
  async function resolveHeaderIdFilter(): Promise<string[] | null> {
    let ids: string[] | null = null;
    if (feeStructureId) {
      const { data } = await supabase.from("fee_invoices").select("invoice_header_id").eq("fee_structure_id", feeStructureId);
      ids = [...new Set((data ?? []).map((r) => r.invoice_header_id))];
    }
    if (classId) {
      const { data: studentsInClass } = await supabase.from("students").select("id").eq("class_id", classId);
      const studentIds = (studentsInClass ?? []).map((s) => s.id);
      const { data: headers } = studentIds.length
        ? await supabase.from("invoice_headers").select("id").in("student_id", studentIds)
        : { data: [] as { id: string }[] };
      const classHeaderIds = (headers ?? []).map((h) => h.id);
      ids = ids ? ids.filter((id) => classHeaderIds.includes(id)) : classHeaderIds;
    }
    return ids;
  }

  async function fetchInvoiceRows(pageArg?: number): Promise<{ rows: InvoiceRow[]; count: number }> {
    const headerIds = await resolveHeaderIdFilter();
    let query = supabase.from("invoice_summary")
      .select("id, student_id, due_date, amount_due, amount_paid, status, line_count", { count: "exact" });
    if (headerIds) query = query.in("id", headerIds.length ? headerIds : ["00000000-0000-0000-0000-000000000000"]);
    if (status) query = query.eq("status", status);
    if (dateFrom) query = query.gte("due_date", dateFrom);
    if (dateTo) query = query.lte("due_date", dateTo);
    query = query.order("due_date", { ascending: false });
    if (pageArg != null) query = query.range(...pageRange(pageArg));
    const { data, error, count } = await query;
    if (error) throw error;
    const studentIds = [...new Set((data ?? []).map((r) => r.student_id))];
    const { data: students, error: studentsErr } = studentIds.length
      ? await supabase.from("students").select("id, first_name, last_name, class:classes(name, section)").in("id", studentIds)
      : { data: [] as StudentRow[], error: null };
    if (studentsErr) throw studentsErr;
    const studentById = new Map((students ?? []).map((s) => [s.id, s as unknown as StudentRow]));
    const rows = (data ?? []).map((r) => ({ ...r, student: studentById.get(r.student_id) ?? null })) as InvoiceRow[];
    return { rows, count: count ?? 0 };
  }

  const filterKey = [feeStructureId, status, classId, dateFrom, dateTo];

  const { data } = useQuery({
    queryKey: ["invoices", page, ...filterKey],
    queryFn: () => fetchInvoiceRows(page),
  });
  const invoices = data?.rows;

  // Un-paginated aggregate for the stat cards -- respects the same filters
  // as the ledger below it, so the header always summarizes what's on screen.
  const { data: totals } = useQuery({
    queryKey: ["invoices-totals", ...filterKey],
    queryFn: async () => {
      const { rows } = await fetchInvoiceRows();
      const billed = rows.reduce((s, r) => s + Number(r.amount_due), 0);
      const paid = rows.reduce((s, r) => s + Number(r.amount_paid), 0);
      const outstandingAccounts = new Set(rows.filter((r) => Number(r.amount_due) - Number(r.amount_paid) > 0).map((r) => r.student_id)).size;
      return { billed, paid, outstanding: billed - paid, outstandingAccounts };
    },
  });

  const exportReport = useMutation({
    mutationFn: async () => {
      const { rows } = await fetchInvoiceRows();
      const header = ["Student", "Due Date", "Amount Due", "Amount Paid", "Balance", "Status"];
      const lines = rows.map((r) => [
        csvCell(`${r.student?.first_name ?? ""} ${r.student?.last_name ?? ""}`.trim()),
        csvCell(r.due_date),
        csvCell(Number(r.amount_due).toFixed(2)),
        csvCell(Number(r.amount_paid).toFixed(2)),
        csvCell((Number(r.amount_due) - Number(r.amount_paid)).toFixed(2)),
        csvCell(r.status),
      ].join(","));
      const csv = [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
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

  const collectionPct = totals && totals.billed > 0 ? (totals.paid / totals.billed) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {currentTerm && activeYear && (
            <p className="text-xs font-semibold uppercase tracking-wide text-gold-bright">
              {t("fees.termLabel", { term: tField(currentTerm.name_i18n as Record<string, string>, i18n.resolvedLanguage!), year: activeYear.ec_year })}
            </p>
          )}
          <h1 className="font-display text-2xl font-bold text-ink">{t("fees.invoicesTitle")}</h1>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="tertiary" onClick={() => exportReport.mutate()} disabled={exportReport.isPending}>
              <IconDownload className="h-4 w-4" />
              {exportReport.isPending ? t("fees.generating") : t("fees.exportReport")}
            </Button>
            <Button onClick={() => setShowGenerate(true)}>
              <IconPlusDoc className="h-4 w-4" />
              {t("fees.generateInvoices")}
            </Button>
          </div>
        )}
      </div>

      {isStaffOrParent && <BillingNotificationsBanner />}

      {totals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="relative overflow-hidden">
            <IconReceipt className="h-5 w-5 text-ink-faint" />
            <p className="mt-2 text-sm font-semibold text-ink-faint">{t("fees.totalBilled")}</p>
            <p className="mt-1 font-display text-2xl font-bold text-ink">{formatETB(totals.billed, i18n.resolvedLanguage!)}</p>
            <p className="mt-1 text-xs text-ink-faint">{t("fees.totalBilledCaption")}</p>
          </Card>

          <Card className="relative overflow-hidden bg-navy text-white">
            <IconCheckCircle className="h-5 w-5 text-gold-bright" />
            <p className="mt-2 text-sm font-semibold text-gold-bright">{t("fees.totalPaid")}</p>
            <p className="mt-1 font-display text-2xl font-bold text-white">{formatETB(totals.paid, i18n.resolvedLanguage!)}</p>
            <p className="mt-1 text-xs text-white/70">{t("fees.collectionEfficiency", { pct: collectionPct.toFixed(1) })}</p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-gold-bright" style={{ width: `${Math.min(100, collectionPct)}%` }} />
            </div>
          </Card>

          <Card className="relative overflow-hidden">
            <IconWarningTriangle className="h-5 w-5 text-danger" />
            <p className="mt-2 text-sm font-semibold text-danger">{t("fees.outstanding")}</p>
            <p className="mt-1 font-display text-2xl font-bold text-danger">{formatETB(totals.outstanding, i18n.resolvedLanguage!)}</p>
            <p className="mt-1 text-xs text-ink-faint">{t("fees.outstandingCaption", { count: totals.outstandingAccounts })}</p>
          </Card>
        </div>
      )}

      <Panel className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-base font-bold text-ink">{t("fees.invoiceLedger")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={feeStructureId} onChange={(e) => { setFeeStructureId(e.target.value); setPage(1); }} className={SELECT_CLS}>
              <option value="">{t("fees.filters.allFeeStructures")}</option>
              {feeStructureOptions?.map((f) => (
                <option key={f.id} value={f.id}>{tField(f.name_i18n as Record<string, string>, i18n.resolvedLanguage!)}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={SELECT_CLS}>
              <option value="">{t("fees.filters.allStatuses")}</option>
              <option value="pending">{t("fees.invoiceStatus.pending")}</option>
              <option value="partial">{t("fees.invoiceStatus.partial")}</option>
              <option value="paid">{t("fees.invoiceStatus.paid")}</option>
              <option value="overdue">{t("fees.invoiceStatus.overdue")}</option>
            </select>
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setPage(1); }} className={SELECT_CLS}>
              <option value="">{t("fees.filters.allGradesSections")}</option>
              {classOptions?.map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.section ?? ""}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink-faint">
              <IconCalendarSmall className="h-4 w-4" />
              <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="bg-transparent text-ink outline-none" aria-label={t("fees.filters.dateFrom")} />
              <span>–</span>
              <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="bg-transparent text-ink outline-none" aria-label={t("fees.filters.dateTo")} />
            </label>
          </div>
        </div>

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
            {invoices?.map((inv) => (
              <tr key={inv.id}
                className={cn("cursor-pointer hover:bg-sidebar", inv.status !== "paid" && "bg-danger-tint")}
                onDoubleClick={onRowDoubleClick(navigate, inv.id)}>
                <td className="px-4 py-2 font-medium text-ink">
                  <Link to={inv.id} className="hover:underline">{inv.student?.first_name} {inv.student?.last_name}</Link>
                  {inv.line_count > 1 && <span className="ml-1.5 text-xs font-normal text-ink-faint">({t("fees.lineCount", { count: inv.line_count })})</span>}
                </td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={inv.due_date} /></td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(inv.amount_due), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink">{formatETB(Number(inv.amount_due) - Number(inv.amount_paid), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2"><Badge dot tone={STATUS_TONE[inv.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`fees.invoiceStatus.${inv.status}`)}</Badge></td>
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
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-4" />
      </Panel>

      <GenerateInvoicesModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        onGenerated={() => {
          qc.invalidateQueries({ queryKey: ["invoices"] });
          qc.invalidateQueries({ queryKey: ["invoices-totals"] });
        }}
      />
    </div>
  );
}
