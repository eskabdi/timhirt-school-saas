// Custom-role CRUD. Was PermissionsMatrixPage's sibling RolesPage.tsx --
// relocated as a tab, logic unchanged. Since 20260817000006, a role's
// permissions here take real effect via has_resource_permission() once a
// user is assigned to it (Users tab), on the same resources the Permissions
// Matrix tab covers.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { z } from "zod";

interface Role {
  id: string;
  name: string;
  description: string | null;
  is_builtin: boolean;
}

interface Permission {
  id: string;
  key: string;
  module: string;
  resource: string;
  action: string;
  description: string | null;
}

interface RolePermission {
  role_id: string;
  permission_id: string;
}

const RoleFormSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});

type RoleFormData = z.infer<typeof RoleFormSchema>;

export function RolesTab() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const queryClient = useQueryClient();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const [formData, setFormData] = useState<RoleFormData>({ name: "", description: "" });
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ["roles", profile?.tenant_id, page],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, count } = await supabase
        .from("roles")
        .select("*", { count: "exact" })
        .eq("tenant_id", profile!.tenant_id!)
        .order("name")
        .range(...pageRange(page));
      return { rows: (data as Role[]) || [], count: count ?? 0 };
    },
  });
  const roles = rolesData?.rows;

  const { data: allPermissions } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const { data } = await supabase.from("permissions").select("*").order("module, resource");
      return (data as Permission[]) || [];
    },
  });

  const { data: rolePermissions } = useQuery({
    queryKey: ["role-permissions", selectedRole?.id],
    enabled: !!selectedRole,
    queryFn: async () => {
      const { data } = await supabase
        .from("role_permissions")
        .select("*")
        .eq("role_id", selectedRole!.id);
      return (data as RolePermission[]) || [];
    },
  });

  const createRoleMutation = useMutation({
    mutationFn: async (data: RoleFormData) => {
      const { error } = await supabase.from("roles").insert([
        {
          tenant_id: profile!.tenant_id!,
          name: data.name,
          description: data.description || null,
          is_builtin: false,
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setShowCreateDialog(false);
      setFormData({ name: "", description: "" });
    },
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: async (permissionIds: string[]) => {
      if (!selectedRole) return;

      await supabase.from("role_permissions").delete().eq("role_id", selectedRole.id);

      if (permissionIds.length > 0) {
        const { error } = await supabase.from("role_permissions").insert(
          permissionIds.map((pid) => ({
            role_id: selectedRole.id,
            permission_id: pid,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-permissions"] });
      setShowPermissionsDialog(false);
    },
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (roleId: string) => {
      const { error } = await supabase.from("roles").delete().eq("id", roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      setSelectedRole(null);
    },
  });

  const handleCreateRole = async () => {
    try {
      RoleFormSchema.parse(formData);
      await createRoleMutation.mutateAsync(formData);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenPermissionsDialog = () => {
    if (!selectedRole || !rolePermissions) return;
    setSelectedPermissions(new Set(rolePermissions.map((rp) => rp.permission_id)));
    setShowPermissionsDialog(true);
  };

  const handleSavePermissions = async () => {
    await updatePermissionsMutation.mutateAsync(Array.from(selectedPermissions));
  };

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(permissionId)) next.delete(permissionId);
      else next.add(permissionId);
      return next;
    });
  };

  const groupedPermissions = allPermissions?.reduce(
    (acc, perm) => {
      const key = perm.module;
      if (!acc[key]) acc[key] = [];
      acc[key].push(perm);
      return acc;
    },
    {} as Record<string, Permission[]>
  ) || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-faint">{t("rolesPage.effectNote")}</p>
        <Button variant="primary" onClick={() => setShowCreateDialog(true)}>
          {t("rolesPage.createRole")}
        </Button>
      </div>

      {rolesLoading ? (
        <div className="text-center text-ink-faint">{t("common.loading")}</div>
      ) : !roles || roles.length === 0 ? (
        <div className="text-center text-ink-faint">{t("rolesPage.empty")}</div>
      ) : (
        <div className="grid gap-4">
          {roles.map((role) => (
            <div
              key={role.id}
              onClick={() => setSelectedRole(role)}
              className={`rounded-lg border p-4 transition-colors cursor-pointer ${
                selectedRole?.id === role.id
                  ? "border-navy bg-navy-wash"
                  : "border-line hover:border-navy-wash"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-ink">{role.name}</h3>
                  {role.description && (
                    <p className="mt-1 text-sm text-ink-faint">{role.description}</p>
                  )}
                </div>
                {role.is_builtin && (
                  <span className="text-xs font-medium text-ink-faint uppercase tracking-wide">
                    {t("rolesPage.builtin")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Pagination page={page} totalCount={rolesData?.count ?? 0} onPageChange={setPage} />

      {selectedRole && !selectedRole.is_builtin && (
        <div className="flex gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={handleOpenPermissionsDialog}>
            {t("rolesPage.managePermissions")}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm(t("rolesPage.confirmDelete"))) {
                deleteRoleMutation.mutate(selectedRole.id);
              }
            }}
          >
            {t("rolesPage.deleteRole")}
          </Button>
        </div>
      )}

      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-lg">
            <h2 className="text-lg font-bold text-ink mb-4">{t("rolesPage.createRole")}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-ink">
                  {t("rolesPage.roleName")}
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                  placeholder={t("rolesPage.roleNamePlaceholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink">
                  {t("rolesPage.description")}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm"
                  placeholder={t("rolesPage.descriptionPlaceholder")}
                  rows={3}
                />
              </div>
              <div className="flex gap-2 justify-end pt-4 border-t border-line">
                <Button variant="ghost" onClick={() => setShowCreateDialog(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onClick={handleCreateRole} disabled={createRoleMutation.isPending}>
                  {t("common.create")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPermissionsDialog && selectedRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-2xl rounded-lg bg-card p-6 shadow-lg max-h-96 overflow-y-auto">
            <h2 className="text-lg font-bold text-ink mb-4">
              {t("rolesPage.managePermissionsFor")} {selectedRole.name}
            </h2>
            <div className="space-y-6">
              {Object.entries(groupedPermissions).map(([module, perms]) => (
                <div key={module}>
                  <h4 className="font-semibold text-ink mb-3 capitalize">{module}</h4>
                  <div className="space-y-2">
                    {perms.map((perm) => (
                      <label key={perm.id} className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPermissions.has(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="mt-1"
                        />
                        <div>
                          <div className="font-medium text-sm text-ink">{perm.key}</div>
                          {perm.description && (
                            <div className="text-xs text-ink-faint">{perm.description}</div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end border-t border-line pt-4 mt-4">
              <Button variant="ghost" onClick={() => setShowPermissionsDialog(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={handleSavePermissions}
                disabled={updatePermissionsMutation.isPending}
              >
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
