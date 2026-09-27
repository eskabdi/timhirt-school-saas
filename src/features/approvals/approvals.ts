// R6 WP-09 (M-06): maker-checker client helpers. The database is the
// enforcement point (20260927000002_r6_maker_checker.sql); these helpers only
// call its RPCs and turn its payloads and errors into something a person can
// read. Nothing here decides who may approve what.
import { supabase } from "@/lib/supabase";

export type ApprovalAction =
  | "manual_payment_accept"
  | "invoice_void"
  | "grade_edit_after_publish"
  | "student_transfer_out";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "executed";

export interface ApprovalRequest {
  id: string;
  action: ApprovalAction | string;
  entity_table: string;
  entity_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  status: ApprovalStatus;
  maker_id: string;
  checker_id: string | null;
  decided_at: string | null;
  expires_at: string;
  reason: string | null;
  decision_reason: string | null;
  created_at: string;
  maker: { full_name: string } | null;
  checker: { full_name: string } | null;
}

export const APPROVAL_SELECT =
  "id, action, entity_table, entity_id, payload, payload_hash, status, maker_id, checker_id, decided_at, expires_at, reason, decision_reason, created_at, " +
  "maker:users!approval_requests_maker_id_fkey(full_name), checker:users!approval_requests_checker_id_fkey(full_name)";

export interface DiffRow { field: string; from: unknown; to: unknown }

/** Context keys used for linking, not for display. */
const HIDDEN_FIELDS = new Set(["invoice_id"]);

/** The `from`/`to` pair the server stored, one row per field that changes,
 * plus any top-level context fields (amount, provider…) as unchanged rows. */
export function diffRows(payload: Record<string, unknown>): DiffRow[] {
  const from = isRecord(payload.from) ? payload.from : {};
  const to = isRecord(payload.to) ? payload.to : {};
  const rows: DiffRow[] = [];
  for (const key of Object.keys(payload)) {
    if (key === "from" || key === "to" || HIDDEN_FIELDS.has(key)) continue;
    rows.push({ field: key, from: payload[key], to: payload[key] });
  }
  for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
    rows.push({ field: key, from: from[key] ?? null, to: to[key] ?? null });
  }
  return rows;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Error codes raised by the maker-checker RPCs and enforcement triggers. */
export const APPROVAL_ERRORS = [
  "approval_required", "maker_cannot_decide", "not_allowed", "approval_not_pending",
  "approval_expired", "payload_tampered", "payload_mismatch", "reason_required",
  "approval_already_pending", "entity_changed", "invoice_has_payments", "invoice_already_void",
  "invoice_void", "approval_not_needed", "invalid_score", "invalid_remark", "no_change",
  "invalid_state", "invalid_transferred_to", "invalid_transferred_on", "reason_too_long",
  "invalid_settings",
] as const;
export type ApprovalErrorKey = (typeof APPROVAL_ERRORS)[number] | "unknown";

/** Maps a PostgREST/Postgres error to one of APPROVAL_ERRORS by its message. */
export function approvalErrorKey(err: unknown): ApprovalErrorKey {
  const message = typeof err === "object" && err !== null && "message" in err
    ? String((err as { message: unknown }).message) : String(err ?? "");
  const match = APPROVAL_ERRORS.find((k) => new RegExp(`\\b${k}\\b`).test(message));
  return match ?? "unknown";
}

export function isExpired(req: Pick<ApprovalRequest, "status" | "expires_at">, now = Date.now()): boolean {
  return req.status === "expired" || (req.status === "pending" && Date.parse(req.expires_at) <= now);
}

export async function submitApproval(action: Exclude<ApprovalAction, "manual_payment_accept">, entityId: string,
  changes: Record<string, unknown>, reason: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("submit_approval", {
    p_action: action, p_entity_id: entityId, p_changes: changes, p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

export async function decideApproval(req: Pick<ApprovalRequest, "id" | "payload_hash">,
  decision: "approved" | "rejected", reason: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("decide_approval", {
    p_id: req.id, p_decision: decision, p_payload_hash: req.payload_hash, p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}
