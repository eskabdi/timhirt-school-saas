import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EthDate } from "@/components/EthDate";
import { issueFeeDocumentUrl } from "@/features/fees/api";
import {
  APPROVAL_SELECT, approvalErrorKey, decideApproval, diffRows, isExpired,
  type ApprovalRequest, type DiffRow,
} from "./approvals";

type View = "waiting" | "mine" | "history";

const STATUS_TONE = {
  pending: "late", approved: "navy", executed: "ok", rejected: "danger", expired: "neutral",
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

  const onDecided = () => {
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
        onChange={setView}
        options={[
          { value: "waiting", label: t("approvals.view.waiting") },
          { value: "mine", label: t("approvals.view.mine") },
          { value: "history", label: t("approvals.view.history") },
        ]}
      />
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

function ApprovalCard({ request: r, myId, onDecided }: { request: ApprovalRequest; myId: string; onDecided: () => void }) {
  const { t } = useTranslation();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
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
    onSuccess: (outcome) => { setResult(outcome); setRejecting(false); onDecided(); },
  });

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

      {canDecide && !result && (
        <div className="mt-3 space-y-2">
          {rejecting && (
            <label className="block text-sm">
              <span className="text-ink">{t("approvals.rejectReason")}</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} required
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
                <Button variant="tertiary" onClick={() => setRejecting(false)}>{t("approvals.cancel")}</Button>
              </>
            ) : (
              <Button variant="tertiary" onClick={() => setRejecting(true)} disabled={decide.isPending}>{t("approvals.reject")}</Button>
            )}
          </div>
        </div>
      )}
      <p role="status" className="mt-2 text-sm text-ok">{result ? t(`approvals.outcome.${result}`) : ""}</p>
      {decide.isError && (
        <p role="alert" className="mt-1 text-sm text-danger">{t(`approvals.error.${approvalErrorKey(decide.error)}`)}</p>
      )}
    </Card>
  );
}

function DiffValue({ row, side }: { row: DiffRow; side: "from" | "to" }) {
  const { t } = useTranslation();
  const v = row[side];
  if (v === null || v === undefined || v === "") return <span className="text-ink-soft">—</span>;
  if (row.field === "transferred_on" && typeof v === "string") return <EthDate value={v} />;
  if (row.field === "status" && typeof v === "string") return <>{t(`approvals.value.${v}`, { defaultValue: v })}</>;
  return <>{String(v)}</>;
}
