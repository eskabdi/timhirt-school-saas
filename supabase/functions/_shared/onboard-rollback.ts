// Undo a half-built onboard-tenant run (R6 WP-01 round 3, review RG R3-1).
//
// Deleting only the tenant row cannot work once the admin user exists:
// users_tenant_id_fkey and academic_years_tenant_id_fkey are ON DELETE NO
// ACTION, so the delete failed, the error was ignored, and the tenant, its
// admin and the invited auth user all stayed behind (a retry then hit "slug
// taken" / "already registered"). This removes the dependants first, then the
// tenant, and reports every step that failed (logged without ids).
//
// The invited auth user is deleted only when this run created it
// (state-concurrency review): inviteUserByEmail returns the EXISTING user when
// the address already has an account, e.g. another school's admin who has not
// accepted yet. So the auth user is kept if any public.users row still owns
// that id after this tenant's users are removed, or if GoTrue created it
// before this run started.
export interface RollbackClient {
  from(table: string): {
    delete(): { eq(col: string, v: string): PromiseLike<{ error: { message: string } | null }> };
    select(cols: string): { eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> } };
}

export interface InvitedUser {
  id: string;
  /** GoTrue's created_at for the returned user. */
  createdAt: string | undefined;
  /** Epoch ms taken just before the invite call. */
  startedAt: number;
}

export const ROLLBACK_ORDER = ["periods", "tenant_configs", "academic_years", "users"] as const;
/** Allowance for clock skew between the Edge runtime and GoTrue. */
const CLOCK_SKEW_MS = 60_000;

export async function rollbackTenant(db: RollbackClient, tenantId: string, invited: InvitedUser | undefined): Promise<string[]> {
  const failed: string[] = [];
  const step = async (name: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await run();
      if (error) { failed.push(name); console.error(`onboard-tenant rollback: ${name} failed`, { message: error.message }); }
    } catch (err) {
      failed.push(name);
      console.error(`onboard-tenant rollback: ${name} failed`, { message: (err as Error).message });
    }
  };
  for (const table of ROLLBACK_ORDER) await step(table, () => db.from(table).delete().eq("tenant_id", tenantId));
  await step("tenants", () => db.from("tenants").delete().eq("id", tenantId));
  if (invited && (await createdByThisRun(db, invited))) {
    await step("auth_user", () => db.auth.admin.deleteUser(invited.id));
  }
  return failed;
}

async function createdByThisRun(db: RollbackClient, invited: InvitedUser): Promise<boolean> {
  const created = invited.createdAt ? Date.parse(invited.createdAt) : NaN;
  if (!Number.isFinite(created) || created < invited.startedAt - CLOCK_SKEW_MS) return false;
  try {
    const { data, error } = await db.from("users").select("id").eq("id", invited.id).maybeSingle();
    return !error && !data;   // still owned by a profile elsewhere, or unknown: keep it
  } catch {
    return false;
  }
}
