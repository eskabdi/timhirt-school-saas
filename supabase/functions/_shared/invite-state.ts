// Decisions behind invite-tenant-admin's status and resend actions, kept pure
// so they are tested without GoTrue (invite-state.test.ts). The state comes
// from tenant_admin_invite_states (migration 20261017000001).

export interface InviteState {
  user_id: string;
  password_set: boolean;
  sso_user: boolean;
  email_confirmed: boolean;
  invited_at: string | null;
}

/** Accepted = a password was set, or the admin signs in through SSO (never a
 *  password). Opening the link confirms the address and signs in before any
 *  password exists, and a mail scanner that prefetches it does the same, so
 *  neither counts. */
export const isAccepted = (s: InviteState): boolean => s.password_set || s.sso_user;

/** What the console sees for each admin (no address, no auth metadata). */
export const statusRow = (s: InviteState) => ({ user_id: s.user_id, pending: !isAccepted(s), invited_at: s.invited_at });

/** How a resend reaches the admin: refused once accepted; a fresh invite to an
 *  unconfirmed account; a set-password (recovery) link to a confirmed one, as
 *  GoTrue refuses to invite a confirmed address. */
export type ResendPlan = "already_accepted" | "invite" | "recovery";
export const resendPlan = (s: InviteState): ResendPlan =>
  isAccepted(s) ? "already_accepted" : s.email_confirmed ? "recovery" : "invite";

/** The per-platform-admin limit: the console reads status on every view and
 *  window focus, so it has its own budget and browsing never uses up the one
 *  for sending email. */
export const rateBucket = (action: unknown, userId: string): { key: string; limit: number } =>
  action === "status" ? { key: `invite-status:${userId}`, limit: 60 } : { key: `invite-admin:${userId}`, limit: 10 };
