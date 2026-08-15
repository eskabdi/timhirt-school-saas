// R4-D1: audited super-admin impersonation, client-side session-swap
// plumbing. impersonate-user mints a real session for the target user via
// GoTrue's admin.generateLink() + a magiclink token; this module exchanges
// that token for a live session (auth.verifyOtp), saving the super_admin's
// OWN session first so "End impersonation" can restore it exactly, then
// closes the audit row (end-impersonation) only once back in the
// super_admin's own identity.
import { supabase } from "@/lib/supabase";
import { callFunction } from "@/lib/functions";

const STORAGE_KEY = "timhirt_impersonation";

interface StoredImpersonation {
  sessionId: string;
  targetName: string;
  originalAccessToken: string;
  originalRefreshToken: string;
}

export function getActiveImpersonation(): { sessionId: string; targetName: string } | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredImpersonation;
    return { sessionId: parsed.sessionId, targetName: parsed.targetName };
  } catch {
    return null;
  }
}

export async function startImpersonation(targetUserId: string, reason: string): Promise<void> {
  const { data: { session: ownSession } } = await supabase.auth.getSession();
  if (!ownSession) throw new Error("No active session");

  const result = await callFunction("impersonate-user", { target_user_id: targetUserId, reason }) as {
    session_id: string; token_hash: string; target_name: string;
  };

  const stored: StoredImpersonation = {
    sessionId: result.session_id,
    targetName: result.target_name,
    originalAccessToken: ownSession.access_token,
    originalRefreshToken: ownSession.refresh_token,
  };
  // Saved BEFORE swapping -- if verifyOtp throws, sessionStorage still has
  // nothing written yet (this line hasn't run), so a failed swap can't leave
  // a stale "impersonating" banner with no way back.
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  const { error } = await supabase.auth.verifyOtp({ token_hash: result.token_hash, type: "magiclink" });
  if (error) {
    sessionStorage.removeItem(STORAGE_KEY);
    throw error;
  }
}

export async function endImpersonation(): Promise<void> {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const stored = JSON.parse(raw) as StoredImpersonation;

  // Restore the super_admin's own session FIRST -- end-impersonation must
  // run as the actor (requireRole re-derives identity from the live JWT),
  // not as whoever the impersonated session currently is.
  const { error: restoreErr } = await supabase.auth.setSession({
    access_token: stored.originalAccessToken,
    refresh_token: stored.originalRefreshToken,
  });
  sessionStorage.removeItem(STORAGE_KEY);
  if (restoreErr) throw restoreErr;

  await callFunction("end-impersonation", { session_id: stored.sessionId });
}
