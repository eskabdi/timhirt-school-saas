// Guards around inviteUserByEmail shared by invite-staff and
// invite-tenant-admin. inviteUserByEmail does not fail for an address that
// already has an auth account: it re-sends and returns THAT account. A
// rollback that then deletes "the invited user" would delete someone else's
// account, so every step below fails closed: never invite on an unverified
// duplicate check, never adopt an account this call did not create, never
// delete an account whose profile is not ours.
import { logSafeError } from "./auth-errors.ts";

/** A LIKE/ILIKE pattern matching `s` literally (backslash is Postgres's default escape). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** True when the account GoTrue returned was created by this call, not an
 *  existing one it re-invited (60 s allowance for clock skew). */
export function createdByThisCall(createdAt: string | undefined | null, startedAt: number, skewMs = 60_000): boolean {
  const t = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(t) && t >= startedAt - skewMs;
}

export interface InviteRollbackClient {
  from(table: "users"): {
    select(cols: "id"): { eq(col: "id", v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } };
    delete(): { eq(col: "id", v: string): PromiseLike<{ error: unknown }> };
  };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: unknown }> } };
}

/** Undo an invite made by this call. `ownsProfile`: this call inserted the
 *  public.users row (remove it too). Otherwise a profile for that id means
 *  another request owns the account (a concurrent invite of the same
 *  address), so it is left alone. Never throws; returns what it did. */
export async function rollbackInvitedUser(
  db: InviteRollbackClient, userId: string, ownsProfile: boolean, label: string,
): Promise<"deleted" | "kept" | "failed"> {
  try {
    if (ownsProfile) {
      const { error } = await db.from("users").delete().eq("id", userId);
      if (error) { console.error(`${label}: rollback of the profile failed`, { user_id: userId, ...logSafeError(error) }); return "failed"; }
    } else {
      const { data, error } = await db.from("users").select("id").eq("id", userId).maybeSingle();
      if (error || data) return "kept";   // unknown, or someone else's account: keep it
    }
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) { console.error(`${label}: rollback of the auth user failed`, { user_id: userId, ...logSafeError(error) }); return "failed"; }
    return "deleted";
  } catch (err) {
    console.error(`${label}: rollback failed`, { user_id: userId, ...logSafeError(err) });
    return "failed";
  }
}
