// Undo a half-built onboard-tenant run (R6 WP-01 round 3, review RG R3-1).
//
// Deleting only the tenant row cannot work once the admin user exists:
// users_tenant_id_fkey and academic_years_tenant_id_fkey are ON DELETE NO
// ACTION, so the delete failed, the error was ignored, and the tenant, its
// admin and the invited auth user all stayed behind (a retry then hit "slug
// taken" / "already registered"). This removes the dependants first, then the
// tenant, then the invited auth user, and reports every step that failed
// (logged without ids) instead of pretending it rolled back.
export interface RollbackClient {
  from(table: string): { delete(): { eq(col: string, v: string): PromiseLike<{ error: { message: string } | null }> } };
  auth: { admin: { deleteUser(id: string): PromiseLike<{ error: { message: string } | null }> } };
}

export const ROLLBACK_ORDER = ["periods", "tenant_configs", "academic_years", "users"] as const;

export async function rollbackTenant(db: RollbackClient, tenantId: string, invitedUserId: string | undefined): Promise<string[]> {
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
  if (invitedUserId) await step("auth_user", () => db.auth.admin.deleteUser(invitedUserId));
  return failed;
}
