// Role/user matrix over every resource wired to has_resource_permission()
// (20260816000001 pilot + 20260817000001-6 domain migrations + custom-role
// enforcement). Grouped by domain since the resource list is too long for
// one flat grid; each resource's grid only shows the action columns it
// actually has a policy for (e.g. read-only resources show just Read).
//
// The role picker unions the 5 fixed built-in roles with the tenant's own
// custom roles (Roles tab) -- selecting a custom role switches the grid to
// a binary granted/not-granted toggle against role_permissions (no deny
// concept there, same as everywhere else custom roles are additive-only),
// while a fixed role keeps the tri-state default/allow/deny cycle against
// builtin_role_permission_grants.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { cn } from "@/lib/utils";

const ACTIONS = ["create", "read", "update", "delete"] as const;
type Action = (typeof ACTIONS)[number];
const MATRIX_ROLES = ["teacher", "registrar", "accountant", "hr_officer", "librarian"] as const;
type MatrixRole = (typeof MATRIX_ROLES)[number];

const STAFF_ROLES = ["school_admin", "teacher", "registrar", "accountant", "hr_officer", "librarian"] as const;

const DOMAINS: { key: string; resources: string[] }[] = [
  {
    key: "academicsSis",
    resources: [
      "students", "guardians", "teachers", "classes", "subjects", "grades", "attendance", "exams",
      "assignments", "assignment_sections", "assignment_attachments", "assignment_submissions",
      "discipline_incidents", "student_merits", "class_subject_teachers", "periods",
      "academic_years", "academic_terms", "grading_scales", "grade_bands", "report_templates",
      "admission_applications",
    ],
  },
  {
    key: "hrPayroll",
    resources: [
      "employees", "employment_contracts", "salary_components", "employee_salary_components",
      "leave_types", "leave_requests", "leave_balances", "staff_attendance", "payroll_runs",
      "payslips", "payslip_lines", "staff_performance_reviews",
    ],
  },
  { key: "fees", resources: ["fee_structures", "fee_invoices", "payments", "fee_documents", "bank_payment_verifications"] },
  { key: "communication", resources: ["notices", "announcements", "notification_log", "calendar_events"] },
  { key: "idCardsSection", resources: ["id_cards", "id_card_batches"] },
  {
    key: "library",
    resources: [
      "library_books", "library_book_copies", "library_checkouts", "library_holds",
      "library_fines", "library_settings",
    ],
  },
  {
    key: "studentServices",
    resources: ["hostel_allocations", "hostel_visitor_logs", "student_route_assignments", "clinic_visits", "health_conditions"],
  },
  { key: "reports", resources: ["moe_exports"] },
];

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

interface CustomRole {
  id: string;
  name: string;
}

interface CustomRolePermissionRow {
  permission_id: string;
}

export function PermissionsMatrixTab() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const tenantId = profile?.tenant_id ?? null;
  const [overrideUserId, setOverrideUserId] = useState<string>("");
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [selectedRoleValue, setSelectedRoleValue] = useState<string>(`fixed:${MATRIX_ROLES[0]}`);

  const selectedFixedRole = selectedRoleValue.startsWith("fixed:")
    ? (selectedRoleValue.slice("fixed:".length) as MatrixRole)
    : null;
  const selectedCustomRoleId = selectedRoleValue.startsWith("custom:")
    ? selectedRoleValue.slice("custom:".length)
    : null;

  const { data: permissions, isLoading: permissionsLoading } = useQuery({
    queryKey: ["permissions-matrix-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase.from("permissions").select("id, resource, action");
      if (error) throw error;
      return (data as PermissionRow[]) ?? [];
    },
  });

  // O(1) lookups instead of re-scanning `permissions` per resource/cell/render.
  const permissionsByResource = useMemo(() => {
    const map = new Map<string, Map<Action, string>>();
    for (const p of permissions ?? []) {
      if (!ACTIONS.includes(p.action as Action)) continue;
      if (!map.has(p.resource)) map.set(p.resource, new Map());
      map.get(p.resource)!.set(p.action as Action, p.id);
    }
    return map;
  }, [permissions]);

  const permissionId = (resource: string, action: Action) => permissionsByResource.get(resource)?.get(action);

  const actionsFor = (resource: string): Action[] => ACTIONS.filter((a) => permissionsByResource.get(resource)?.has(a));

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

  const { data: customRoles } = useQuery({
    queryKey: ["matrix-custom-roles", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("id, name").eq("tenant_id", tenantId!).order("name");
      if (error) throw error;
      return (data as CustomRole[]) ?? [];
    },
  });

  const { data: customRolePermissions } = useQuery({
    queryKey: ["custom-role-permissions", selectedCustomRoleId],
    enabled: !!selectedCustomRoleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_permissions")
        .select("permission_id")
        .eq("role_id", selectedCustomRoleId!);
      if (error) throw error;
      return (data as CustomRolePermissionRow[]) ?? [];
    },
  });

  // Per-user overrides' "staff member" picker: only actual staff, never
  // student/parent portal accounts (both are valid public.users.role values).
  const { data: tenantUsers } = useQuery({
    queryKey: ["permissions-matrix-users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, role")
        .in("role", STAFF_ROLES)
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
    mutationFn: async ({ role, resource, action }: { role: MatrixRole; resource: string; action: Action }) => {
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

  const toggleCustomRolePermission = useMutation({
    mutationFn: async ({ resource, action }: { resource: string; action: Action }) => {
      if (!selectedCustomRoleId) return;
      const permId = permissionId(resource, action);
      if (!permId) return;
      const granted = customRolePermissions?.some((p) => p.permission_id === permId);
      if (granted) {
        const { error } = await supabase
          .from("role_permissions")
          .delete()
          .eq("role_id", selectedCustomRoleId)
          .eq("permission_id", permId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("role_permissions")
          .insert({ role_id: selectedCustomRoleId, permission_id: permId });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-role-permissions"] }),
  });

  const setOverride = useMutation({
    mutationFn: async ({ resource, action, value }: { resource: string; action: Action; value: "inherit" | "allow" | "deny" }) => {
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

  const roleCellState = (role: MatrixRole, resource: string, action: Action): "default" | "allow" | "deny" => {
    const permId = permissionId(resource, action);
    const row = roleGrants?.find((g) => g.role === role && g.permission_id === permId);
    if (!row) return "default";
    return row.granted ? "allow" : "deny";
  };

  const customRoleCellState = (resource: string, action: Action): boolean => {
    const permId = permissionId(resource, action);
    return !!customRolePermissions?.some((p) => p.permission_id === permId);
  };

  const overrideCellState = (resource: string, action: Action): "inherit" | "allow" | "deny" => {
    const permId = permissionId(resource, action);
    const row = userOverrides?.find((o) => o.permission_id === permId);
    if (!row) return "inherit";
    return row.granted ? "allow" : "deny";
  };

  const toggleDomain = (key: string) => {
    setOpenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <Panel className="space-y-4 p-4">
        <div>
          <h2 className="font-semibold text-ink">{t("permissionsMatrix.roleGrants")}</h2>
          <p className="text-xs text-ink-faint">{t("permissionsMatrix.roleGrantsHint")}</p>
        </div>
        <Field label={t("common.role")}>
          <select
            value={selectedRoleValue}
            onChange={(e) => setSelectedRoleValue(e.target.value)}
            className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
          >
            <optgroup label={t("permissionsMatrix.builtinRoles")}>
              {MATRIX_ROLES.map((role) => (
                <option key={role} value={`fixed:${role}`}>
                  {t(`roles.${role}`)}
                </option>
              ))}
            </optgroup>
            {customRoles && customRoles.length > 0 && (
              <optgroup label={t("permissionsMatrix.customRolesGroup")}>
                {customRoles.map((r) => (
                  <option key={r.id} value={`custom:${r.id}`}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        {selectedCustomRoleId && <p className="text-xs text-ink-faint">{t("permissionsMatrix.customRoleHint")}</p>}
        {permissionsLoading ? (
          <div className="py-6 text-center text-sm text-ink-faint">{t("common.loading")}</div>
        ) : (
          <div className="space-y-3">
            {DOMAINS.map((domain) => {
              const resourcesWithActions = domain.resources.filter((r) => actionsFor(r).length > 0);
              if (resourcesWithActions.length === 0) return null;
              const isOpen = openDomains.has(domain.key);
              return (
                <div key={domain.key} className="overflow-hidden rounded-control border border-line">
                  <button
                    type="button"
                    onClick={() => toggleDomain(domain.key)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between bg-navy px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-white"
                  >
                    {t(`permissionsMatrix.domain.${domain.key}`)}
                    <span className={cn("transition-transform", isOpen ? "rotate-180" : "")}>⌄</span>
                  </button>
                  {isOpen && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                          <tr>
                            <th className="px-4 py-2">{t("permissionsMatrix.resourceColumn")}</th>
                            {ACTIONS.map((a) => (
                              <th key={a} className="px-4 py-2 text-center">{t(`permissionsMatrix.action.${a}`)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {resourcesWithActions.map((resource) => {
                            const actions = actionsFor(resource);
                            return (
                              <tr key={resource}>
                                <td className="px-4 py-2 font-medium text-ink">{t(`permissionsMatrix.resource.${resource}`)}</td>
                                {ACTIONS.map((action) => {
                                  if (!actions.includes(action)) {
                                    return (
                                      <td key={action} className="px-4 py-2 text-center text-ink-faint">—</td>
                                    );
                                  }
                                  if (selectedCustomRoleId) {
                                    const granted = customRoleCellState(resource, action);
                                    return (
                                      <td key={action} className="px-4 py-2 text-center">
                                        <button
                                          type="button"
                                          disabled={toggleCustomRolePermission.isPending}
                                          onClick={() => toggleCustomRolePermission.mutate({ resource, action })}
                                          aria-label={`${t(`permissionsMatrix.resource.${resource}`)} ${t(`permissionsMatrix.action.${action}`)}`}
                                          className={cn(
                                            "inline-flex h-6 w-6 items-center justify-center rounded-control border transition-colors disabled:opacity-50",
                                            granted ? "border-navy bg-navy-wash text-navy" : "border-line text-ink-faint hover:bg-sidebar"
                                          )}
                                        >
                                          {granted ? "✓" : ""}
                                        </button>
                                      </td>
                                    );
                                  }
                                  const state = selectedFixedRole ? roleCellState(selectedFixedRole, resource, action) : "default";
                                  return (
                                    <td key={action} className="px-4 py-2 text-center">
                                      <button
                                        type="button"
                                        disabled={cycleRoleGrant.isPending || !selectedFixedRole}
                                        onClick={() => selectedFixedRole && cycleRoleGrant.mutate({ role: selectedFixedRole, resource, action })}
                                        aria-label={`${selectedFixedRole ? t(`roles.${selectedFixedRole}`) : ""} ${t(`permissionsMatrix.resource.${resource}`)} ${t(`permissionsMatrix.action.${action}`)}`}
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
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
                {u.full_name} — {t(`roles.${u.role}`)}
              </option>
            ))}
          </select>
        </Field>

        {overrideUserId && permissionsLoading && (
          <div className="py-6 text-center text-sm text-ink-faint">{t("common.loading")}</div>
        )}
        {overrideUserId && !permissionsLoading && (
          <div className="space-y-3">
            {DOMAINS.map((domain) => {
              const resourcesWithActions = domain.resources.filter((r) => actionsFor(r).length > 0);
              if (resourcesWithActions.length === 0) return null;
              const isOpen = openDomains.has(`override-${domain.key}`);
              return (
                <div key={domain.key} className="overflow-hidden rounded-control border border-line">
                  <button
                    type="button"
                    onClick={() => toggleDomain(`override-${domain.key}`)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between bg-navy px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-white"
                  >
                    {t(`permissionsMatrix.domain.${domain.key}`)}
                    <span className={cn("transition-transform", isOpen ? "rotate-180" : "")}>⌄</span>
                  </button>
                  {isOpen && (
                    <div className="overflow-x-auto border-t border-line p-4">
                      <table className="w-full min-w-[520px] text-sm">
                        <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                          <tr>
                            <th className="px-4 py-2">{t("permissionsMatrix.resourceColumn")}</th>
                            {ACTIONS.map((a) => (
                              <th key={a} className="px-4 py-2 text-center">{t(`permissionsMatrix.action.${a}`)}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {resourcesWithActions.map((resource) => {
                            const actions = actionsFor(resource);
                            return (
                              <tr key={resource}>
                                <td className="px-4 py-2 font-medium text-ink">{t(`permissionsMatrix.resource.${resource}`)}</td>
                                {ACTIONS.map((action) =>
                                  actions.includes(action) ? (
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
                                  ) : (
                                    <td key={action} className="px-4 py-2 text-center text-ink-faint">—</td>
                                  )
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
