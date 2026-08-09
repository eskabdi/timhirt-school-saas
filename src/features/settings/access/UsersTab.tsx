// Was UsersPage.tsx (read-only user directory) -- relocated as a tab and
// extended with a "Custom roles" column. Assigning a custom role here
// (writes to user_roles) is what actually activates whatever permissions
// that role carries via has_resource_permission() (20260817000006); a role
// with no one assigned to it has zero effect regardless of what's granted
// on the Roles tab.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";

interface TenantUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
  locale: string;
}

interface Role {
  id: string;
  name: string;
}

interface UserRoleRow {
  user_id: string;
  role_id: string | null;
}

export function UsersTab() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? null;
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [assigningUser, setAssigningUser] = useState<TenantUser | null>(null);

  const { data } = useQuery({
    queryKey: ["tenant-users", page],
    queryFn: async () => {
      const { data: rows, error, count } = await supabase.from("users")
        .select("id, full_name, email, role, locale", { count: "exact" })
        .order("full_name").range(...pageRange(page));
      if (error) throw error;
      return { rows: (rows as TenantUser[]) ?? [], count: count ?? 0 };
    },
  });
  const users = data?.rows;

  const { data: allRoles } = useQuery({
    queryKey: ["all-roles-for-assignment", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("id, name").eq("tenant_id", tenantId!).order("name");
      if (error) throw error;
      return (data as Role[]) ?? [];
    },
  });

  const { data: assignments } = useQuery({
    queryKey: ["user-role-assignments", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role_id").eq("tenant_id", tenantId!);
      if (error) throw error;
      return (data as UserRoleRow[]) ?? [];
    },
  });

  const rolesForUser = (userId: string): Role[] => {
    const roleIds = new Set((assignments ?? []).filter((a) => a.user_id === userId && a.role_id).map((a) => a.role_id));
    return (allRoles ?? []).filter((r) => roleIds.has(r.id));
  };

  const toggleAssignment = useMutation({
    mutationFn: async ({ userId, roleId, assign }: { userId: string; roleId: string; assign: boolean }) => {
      if (assign) {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, tenant_id: tenantId, role_id: roleId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role_id", roleId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-role-assignments"] }),
  });

  return (
    <div className="space-y-4">
      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-2">{t("common.name")}</th>
              <th className="px-4 py-2">{t("common.email")}</th>
              <th className="px-4 py-2">{t("common.role")}</th>
              <th className="px-4 py-2">{t("common.locale")}</th>
              <th className="px-4 py-2">{t("usersTab.customRoles")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-ink">{u.full_name}</td>
                <td className="px-4 py-2 text-ink-faint">{u.email}</td>
                <td className="px-4 py-2 capitalize text-ink">{u.role.replace("_", " ")}</td>
                <td className="px-4 py-2 uppercase text-ink">{u.locale}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {rolesForUser(u.id).map((r) => (
                      <Badge key={r.id} tone="neutral">{r.name}</Badge>
                    ))}
                    {rolesForUser(u.id).length === 0 && <span className="text-ink-faint">—</span>}
                  </div>
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" onClick={() => setAssigningUser(u)}>
                    {t("usersTab.editRoles")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-4" />
      </Panel>

      <Modal open={!!assigningUser} onClose={() => setAssigningUser(null)} title={t("usersTab.editRolesFor", { name: assigningUser?.full_name })}>
        {(!allRoles || allRoles.length === 0) ? (
          <p className="text-sm text-ink-faint">{t("usersTab.noCustomRoles")}</p>
        ) : (
          <div className="space-y-2">
            {allRoles.map((r) => {
              const assigned = assigningUser ? rolesForUser(assigningUser.id).some((ar) => ar.id === r.id) : false;
              return (
                <label key={r.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assigned}
                    disabled={toggleAssignment.isPending}
                    onChange={() => {
                      if (!assigningUser) return;
                      toggleAssignment.mutate({ userId: assigningUser.id, roleId: r.id, assign: !assigned });
                    }}
                  />
                  <span className="text-sm text-ink">{r.name}</span>
                </label>
              );
            })}
          </div>
        )}
        <div className="flex justify-end pt-4 mt-4 border-t border-line">
          <Button variant="primary" onClick={() => setAssigningUser(null)}>{t("common.done")}</Button>
        </div>
      </Modal>
    </div>
  );
}
