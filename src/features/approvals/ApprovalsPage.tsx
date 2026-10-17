import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { formatETB, tField } from "@/lib/i18n";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EthDate } from "@/components/EthDate";
import { issueFeeDocumentUrl } from "@/features/fees/api";
import {
  APPROVAL_SELECT, approvalErrorKey, cancelApproval, decideApproval, diffRows, isExpired,
  type ApprovalRequest, type DiffRow,
} from "./approvals";

type View = "waiting" | "mine" | "history";

const STATUS_TONE = {
  pending: "late", approved: "navy", executed: "ok", rejected: "danger", expired: "neutral", cancelled: "neutral",
} as const;

// R6 WP-09 (M-06): the maker-checker inbox. RLS shows a maker their own
// requests and a checker the requests they hold `<resource>:approve` for; the
// decide_approval RPC re-checks everything (tenant, permission, maker ≠
// checker, expiry, payload hash), so the buttons here are a convenience only.
export function ApprovalsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("waiting");

  const { data: requests, isPending, isError } = useQuery({
    queryKey: ["approval-requests", view, profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      let q = supabase.from("approval_requests").select(APPROVAL_SELECT).order("created_at", { ascending: false }).limit(100);
      if (view === "waiting") q = q.eq("status", "pending").neq("maker_id", profile!.id);
      else if (view === "mine") q = q.eq("maker_id", profile!.id);
      else q = q.neq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ApprovalRequest[];
    },
  });

  // The outcome of a decision is announced here, outside the list: in the
  // "waiting" view the decided card leaves the list on refetch, taking any
  // focus or message inside it along (I18N9R-1).
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string; seq: number } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);
  const onDecided = (n?: { tone: "ok" | "error"; text: string }) => {
    if (n) setNotice((prev) => ({ ...n, seq: (prev?.seq ?? 0) + 1 }));
    qc.invalidateQueries({ queryKey: ["approval-requests"] });
    qc.invalidateQueries({ queryKey: ["approvals-pending-count"] });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("approvals.title")}</h1>
        <p className="text-sm text-ink-soft">{t("approvals.subtitle")}</p>
      </div>
      <SegmentedControl<View>
        value={view}
        onChange={(v) => { setView(v); setNotice(null); }}
        options={[
          { value: "waiting", label: t("approvals.view.waiting") },
          { value: "mine", label: t("approvals.view.mine") },
          { value: "history", label: t("approvals.view.history") },
        ]}
      />
      <p key={notice?.seq ?? 0} ref={noticeRef} tabIndex={-1} role={notice?.tone === "error" ? "alert" : "status"}
        className={`text-sm focus:outline-none ${notice?.tone === "error" ? "text-danger" : "text-ok"}`}>
        {notice?.text ?? ""}
      </p>
      {isError && <p role="alert" className="text-sm text-danger">{t("approvals.loadFailed")}</p>}
      {isPending && <p className="text-sm text-ink-soft">{t("approvals.loading")}</p>}
      {!isPending && !isError && requests?.length === 0 && (
        <Card><p className="text-sm text-ink-soft">{t(`approvals.empty.${view}`)}</p></Card>
      )}
      <ul className="space-y-3">
        {requests?.map((r) => (
          <li key={r.id}><ApprovalCard request={r} myId={profile?.id ?? ""} onDecided={onDecided} /></li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalCard({ request: r, myId, onDecided }: {
  request: ApprovalRequest; myId: string; onDecided: (notice?: { tone: "ok" | "error"; text: string }) => void;
}) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  // Keyboard users keep their place (WCAG 2.4.3): the control they pressed is
  // swapped out, so focus moves to what replaces it instead of <body>.
  // The outcome itself goes to the page's notice region (onDecided).
  const [focusTarget, setFocusTarget] = useState<"reason" | "reject" | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const rejectId = useId();
  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "reason") reasonRef.current?.focus();
    else document.getElementById(rejectId)?.focus();
    setFocusTarget(null);
  }, [focusTarget, rejectId]);
  const failed = (err: unknown) => onDecided({ tone: "error", text: t(`approvals.error.${approvalErrorKey(err)}`) });
  const expired = isExpired(r);
  const status = expired ? "expired" : r.status;
  const canDecide = r.status === "pending" && !expired && r.maker_id !== myId;

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const outcome = await decideApproval(r, decision, decision === "rejected" ? reason.trim() : null);
      // An accepted manual payment gets its receipt now; it was held back while
      // the payment was pending. Best effort: the payment is already credited.
      if (outcome === "executed" && r.action === "manual_payment_accept" && typeof r.payload.invoice_id === "string") {
        await issueFeeDocumentUrl("receipt", r.payload.invoice_id, r.entity_id).catch(() => undefined);
      }
      return outcome;
    },
    onSuccess: (outcome) => { setResult(outcome); setRejecting(false); onDecided({ tone: "ok", text: t(`approvals.outcome.${outcome}`) }); },
    // Another checker may have decided it, or it expired or the record moved
    // on: reload so the card shows where it stands now.
    onError: failed,
  });

  // The maker withdraws a request they no longer want decided.
  const withdraw = useMutation({
    mutationFn: () => cancelApproval(r.id),
    onSuccess: (outcome) => { setResult(outcome); onDecided({ tone: "ok", text: t(`approvals.outcome.${outcome}`) }); },
    onError: failed,
  });
  const canWithdraw = r.status === "pending" && !expired && r.maker_id === myId;

  const entityLink = r.action === "invoice_void" ? `/fees/invoices/${r.entity_id}`
    : r.action === "manual_payment_accept" && typeof r.payload.invoice_id === "string" ? `/fees/invoices/${r.payload.invoice_id}`
    : r.action === "student_transfer_out" ? `/students/${r.entity_id}`
    : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-ink">{t(`approvals.action.${r.action}`, { defaultValue: r.action })}</h2>
          <p className="text-xs text-ink-soft">
            {t("approvals.requestedBy", { name: r.maker?.full_name ?? "—" })} · <EthDate value={r.created_at} />
          </p>
        </div>
        <Badge tone={STATUS_TONE[status]}>{t(`approvals.status.${status}`)}</Badge>
      </div>

      {r.reason && <p className="mt-2 text-sm text-ink"><span className="font-medium">{t("approvals.makerReason")}:</span> {r.reason}</p>}

      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">{t("approvals.changes")}</caption>
        <thead>
          <tr className="text-left text-xs text-ink-soft">
            <th scope="col" className="py-1 pr-3 font-medium">{t("approvals.field")}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{t("approvals.from")}</th>
            <th scope="col" className="py-1 font-medium">{t("approvals.to")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {diffRows(r.payload).map((row) => (
            <tr key={row.field} className={row.from !== row.to ? "font-medium" : undefined}>
              <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-soft">
                {t(`approvals.fields.${row.field}`, { defaultValue: row.field })}
              </th>
              <td className="py-1 pr-3 text-ink"><DiffValue row={row} side="from" /></td>
              <td className="py-1 text-ink"><DiffValue row={row} side="to" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {entityLink && <Link to={entityLink} className="mt-2 inline-block text-sm text-navy underline">{t("approvals.openRecord")}</Link>}

      {r.status !== "pending" && (
        <p className="mt-2 text-xs text-ink-soft">
          {r.checker && t("approvals.decidedBy", { name: r.checker.full_name })}
          {r.decided_at && <> · <EthDate value={r.decided_at} /></>}
          {r.decision_reason && <> · {r.decision_reason}</>}
        </p>
      )}
      {r.status === "pending" && !expired && (
        <p className="mt-2 text-xs text-ink-soft">{t("approvals.expires")} <EthDate value={r.expires_at} /></p>
      )}
      {r.status === "pending" && r.maker_id === myId && (
        <p className="mt-2 text-xs text-ink-soft">{t("approvals.ownRequest")}</p>
      )}
      {canWithdraw && !result && (
        <Button className="mt-2" variant="tertiary" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
          {t("approvals.withdraw")}
        </Button>
      )}

      {canDecide && !result && (
        <div className="mt-3 space-y-2">
          {rejecting && (
            <label className="block text-sm">
              <span className="text-ink">{t("approvals.rejectReason")}</span>
              <textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} required
                className="mt-1 w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {!rejecting && (
              <Button onClick={() => decide.mutate("approved")} disabled={decide.isPending}>{t("approvals.approve")}</Button>
            )}
            {rejecting ? (
              <>
                <Button variant="danger" onClick={() => decide.mutate("rejected")} disabled={decide.isPending || !reason.trim()}>
                  {t("approvals.confirmReject")}
                </Button>
                <Button variant="tertiary" onClick={() => { setRejecting(false); setFocusTarget("reject"); }}>{t("approvals.cancel")}</Button>
              </>
            ) : (
              <Button id={rejectId} variant="tertiary" onClick={() => { setRejecting(true); setFocusTarget("reason"); }} disabled={decide.isPending}>{t("approvals.reject")}</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

const MONEY_FIELDS = new Set(["amount", "amount_due", "amount_paid"]);

function DiffValue({ row, side }: { row: DiffRow; side: "from" | "to" }) {
  const { t, i18n } = useTranslation();
  const v = row[side];
  if (v === null || v === undefined || v === "") return <span className="text-ink-soft">—</span>;
  // Names stored as {en, am, om} (exam, subject).
  // The jsonb shape is not CHECKed, so anything but a string renders as "—"
  // rather than taking the whole inbox down (FS-1).
  if (typeof v === "object") {
    const text: unknown = Array.isArray(v) ? null : tField(v as Record<string, string>, i18n.resolvedLanguage ?? "en");
    return typeof text === "string" && text ? <>{text}</> : <span className="text-ink-soft">—</span>;
  }
  if (row.field === "transferred_on" && typeof v === "string") return <EthDate value={v} />;
  if (row.field === "status" && typeof v === "string") return <>{t(`approvals.value.${v}`, { defaultValue: v })}</>;
  if (row.field === "provider" && typeof v === "string") return <>{t(`fees.paymentProvider.${v}`, { defaultValue: v })}</>;
  if (MONEY_FIELDS.has(row.field) && Number.isFinite(Number(v))) return <>{formatETB(Number(v), i18n.resolvedLanguage ?? "en")}</>;
  return <>{String(v)}</>;
}
