// Role/user matrix over the pilot resources wired to has_resource_permission()
// (20260816000001) -- distinct from RolesPage's custom named roles, which
// nothing can be assigned to. See that migration's header comment.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

const PILOT_RESOURCES = ["classes", "subjects", "fee_structures", "calendar_events"] as const;
type Resource = (typeof PILOT_RESOURCES)[number];
const ACTIONS = ["create", "read", "update", "delete"] as const;
type Action = (typeof ACTIONS)[number];
const MATRIX_ROLES = ["teacher", "registrar", "accountant", "hr_officer", "librarian"] as const;
type MatrixRole = (typeof MATRIX_ROLES)[number];

interface PermissionRow {
  id: string;
  resource: string;
  action: string;
}

interface RoleGrantRow {
  role: string;
  permission_id: string;
  granted: boolean;
}

interface OverrideRow {
  permission_id: string;
  granted: boolean;
}

interface TenantUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

export function PermissionsMatrixPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;
  const [overrideUserId, setOverrideUserId] = useState<string>("");

  const { data: permissions } = useQuery({
    queryKey: ["permissions-matrix-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permissions")
        .select("id, resource, action")
        .in("resource", PILOT_RESOURCES as unknown as string[]);
      if (error) throw error;
      return (data as PermissionRow[]) ?? [];
    },
  });

  const permissionId = (resource: Resource, action: Action) =>
    permissions?.find((p) => p.resource === resource && p.action === action)?.id;

  const { data: roleGrants } = useQuery({
    queryKey: ["role-permission-grants", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("builtin_role_permission_grants")
        .select("role, permission_id, granted");
      if (error) throw error;
      return (data as RoleGrantRow[]) ?? [];
    },
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ["permissions-matrix-users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, role")
        .order("full_name");
      if (error) throw error;
      return (data as TenantUser[]) ?? [];
    },
  });

  const { data: userOverrides } = useQuery({
    queryKey: ["user-permission-overrides", overrideUserId],
    enabled: !!overrideUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permission_overrides")
        .select("permission_id, granted")
        .eq("user_id", overrideUserId);
      if (error) throw error;
      return (data as OverrideRow[]) ?? [];
    },
  });

  const cycleRoleGrant = useMutation({
    mutationFn: async ({ role, resource, action }: { role: MatrixRole; resource: Resource; action: Action }) => {
      const permId = permissionId(resource, action);
      if (!permId || !tenantId) return;
      const existing = roleGrants?.find((g) => g.role === role && g.permission_id === permId);
      if (!existing) {
        const { error } = await supabase
          .from("builtin_role_permission_grants")
          .insert({ tenant_id: tenantId, role, permission_id: permId, granted: true });
        if (error) throw error;
      } else if (existing.granted) {
        const { error } = await supabase
          .from("builtin_role_permission_grants")
          .update({ granted: false })
          .eq("permission_id", permId)
          .eq("role", role);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("builtin_role_permission_grants")
          .delete()
          .eq("permission_id", permId)
          .eq("role", role);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permission-grants"] }),
  });

  const setOverride = useMutation({
    mutationFn: async ({ resource, action, value }: { resource: Resource; action: Action; value: "inherit" | "allow" | "deny" }) => {
      const permId = permissionId(resource, action);
      if (!permId || !tenantId || !overrideUserId) return;
      if (value === "inherit") {
        const { error } = await supabase
          .from("user_permission_overrides")
          .delete()
          .eq("user_id", overrideUserId)
          .eq("permission_id", permId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_permission_overrides").upsert(
          { tenant_id: tenantId, user_id: overrideUserId, permission_id: permId, granted: value === "allow" },
          { onConflict: "tenant_id,user_id,permission_id" }
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-permission-overrides"] }),
  });

  const roleCellState = (role: MatrixRole, resource: Resource, action: Action): "default" | "allow" | "deny" => {
    const permId = permissionId(resource, action);
    const row = roleGrants?.find((g) => g.role === role && g.permission_id === permId);
    if (!row) return "default";
    return row.granted ? "allow" : "deny";
  };

  const overrideCellState = (resource: Resource, action: Action): "inherit" | "allow" | "deny" => {
    const permId = permissionId(resource, action);
    const row = userOverrides?.find((o) => o.permission_id === permId);
    if (!row) return "inherit";
    return row.granted ? "allow" : "deny";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("permissionsMatrix.title")}</h1>
        <p className="text-sm text-ink-faint">{t("permissionsMatrix.subtitle")}</p>
      </div>

      <Panel className="space-y-6 p-4">
        <h2 className="font-semibold text-ink">{t("permissionsMatrix.roleGrants")}</h2>
        <p className="text-xs text-ink-faint">{t("permissionsMatrix.roleGrantsHint")}</p>
        {PILOT_RESOURCES.map((resource) => (
          <div key={resource} className="overflow-x-auto">
            <h3 className="mb-2 text-sm font-medium text-ink">{t(`permissionsMatrix.resource.${resource}`)}</h3>
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-4 py-2">{t("common.role")}</th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="px-4 py-2 text-center">{t(`permissionsMatrix.action.${a}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {MATRIX_ROLES.map((role) => (
                  <tr key={role}>
                    <td className="px-4 py-2 font-medium text-ink">{t(`roles.${role}`)}</td>
                    {ACTIONS.map((action) => {
                      const state = roleCellState(role, resource, action);
                      return (
                        <td key={action} className="px-4 py-2 text-center">
                          <button
                            type="button"
                            disabled={cycleRoleGrant.isPending}
                            onClick={() => cycleRoleGrant.mutate({ role, resource, action })}
                            aria-label={`${t(`roles.${role}`)} ${t(`permissionsMatrix.resource.${resource}`)} ${t(`permissionsMatrix.action.${action}`)}`}
                            className={cn(
                              "inline-flex h-6 w-6 items-center justify-center rounded-control border transition-colors disabled:opacity-50",
                              state === "allow" && "border-navy bg-navy-wash text-navy",
                              state === "deny" && "border-danger bg-danger/10 text-danger",
                              state === "default" && "border-line text-ink-faint hover:bg-sidebar"
                            )}
                          >
                            {state === "allow" ? "✓" : state === "deny" ? "✕" : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Panel>

      <Panel className="space-y-4 p-4">
        <h2 className="font-semibold text-ink">{t("permissionsMatrix.userOverrides")}</h2>
        <p className="text-xs text-ink-faint">{t("permissionsMatrix.userOverridesHint")}</p>
        <Field label={t("permissionsMatrix.selectUser")}>
          <select
            value={overrideUserId}
            onChange={(e) => setOverrideUserId(e.target.value)}
            className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <option value="">—</option>
            {tenantUsers?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name} ({u.email})
              </option>
            ))}
          </select>
        </Field>

        {overrideUserId && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-4 py-2">{t("permissionsMatrix.resourceColumn")}</th>
                  {ACTIONS.map((a) => (
                    <th key={a} className="px-4 py-2 text-center">{t(`permissionsMatrix.action.${a}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {PILOT_RESOURCES.map((resource) => (
                  <tr key={resource}>
                    <td className="px-4 py-2 font-medium text-ink">{t(`permissionsMatrix.resource.${resource}`)}</td>
                    {ACTIONS.map((action) => (
                      <td key={action} className="px-4 py-2 text-center">
                        <select
                          value={overrideCellState(resource, action)}
                          disabled={setOverride.isPending}
                          onChange={(e) =>
                            setOverride.mutate({
                              resource,
                              action,
                              value: e.target.value as "inherit" | "allow" | "deny",
                            })
                          }
                          className="rounded-control border border-line bg-card px-2 py-1 text-xs text-ink"
                        >
                          <option value="inherit">{t("permissionsMatrix.inherit")}</option>
                          <option value="allow">{t("permissionsMatrix.allow")}</option>
                          <option value="deny">{t("permissionsMatrix.deny")}</option>
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
