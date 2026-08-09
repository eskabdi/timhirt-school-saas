// Per-tenant SAML SSO configuration: register/update/remove the school's IdP
// (manage-sso-provider) and activate SSO-provisioned users who are sitting
// at role='pending' (activate-sso-user) -- the only path that can promote
// them, since nothing else in this codebase can change a user's role after
// creation (see that Edge Function's own comment).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { Modal } from "@/components/ui/Modal";

interface SsoProvider {
  id: string;
  domain: string;
  metadata_url: string;
  enabled: boolean;
}

interface PendingUser {
  id: string;
  full_name: string;
  email: string;
}

const ACTIVATABLE_ROLES = ["teacher", "registrar", "hr_officer", "accountant", "librarian"] as const;

async function callEdgeFunction(slug: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

export function SsoTab() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? null;
  const qc = useQueryClient();

  const [domain, setDomain] = useState("");
  const [metadataUrl, setMetadataUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activating, setActivating] = useState<PendingUser | null>(null);
  const [activateRole, setActivateRole] = useState<(typeof ACTIVATABLE_ROLES)[number]>("teacher");
  const [staffNo, setStaffNo] = useState("");
  const [activateError, setActivateError] = useState<string | null>(null);

  const { data: provider } = useQuery({
    queryKey: ["sso-provider", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_sso_providers")
        .select("id, domain, metadata_url, enabled").eq("tenant_id", tenantId!).maybeSingle();
      if (error) throw error;
      const row = data as SsoProvider | null;
      if (row) { setDomain(row.domain); setMetadataUrl(row.metadata_url); setEnabled(row.enabled); }
      return row;
    },
  });

  const { data: pendingUsers } = useQuery({
    queryKey: ["pending-sso-users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("users")
        .select("id, full_name, email").eq("role", "pending").order("full_name");
      if (error) throw error;
      return (data as PendingUser[]) ?? [];
    },
  });

  const saveProvider = useMutation({
    mutationFn: () => callEdgeFunction("manage-sso-provider", {
      action: provider ? "update" : "create",
      domain, metadata_url: metadataUrl, ...(provider ? { enabled } : {}),
    }),
    onSuccess: () => { setFormError(null); qc.invalidateQueries({ queryKey: ["sso-provider", tenantId] }); },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteProvider = useMutation({
    mutationFn: () => callEdgeFunction("manage-sso-provider", { action: "delete" }),
    onSuccess: () => {
      setDomain(""); setMetadataUrl(""); setEnabled(false); setFormError(null);
      qc.invalidateQueries({ queryKey: ["sso-provider", tenantId] });
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const activateUser = useMutation({
    mutationFn: () => callEdgeFunction("activate-sso-user", {
      user_id: activating!.id, role: activateRole,
      ...(activateRole === "teacher" ? { staff_no: staffNo } : {}),
    }),
    onSuccess: () => {
      setActivating(null); setStaffNo(""); setActivateError(null);
      qc.invalidateQueries({ queryKey: ["pending-sso-users", tenantId] });
    },
    onError: (err: Error) => setActivateError(err.message),
  });

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader title={t("ssoTab.title")} />
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => { e.preventDefault(); setFormError(null); saveProvider.mutate(); }}
        >
          <Field label={t("ssoTab.domainLabel")} hint={t("ssoTab.domainHint")}>
            <Input value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
              placeholder={t("ssoTab.domainPlaceholder")} disabled={!!provider} required />
          </Field>
          <Field label={t("ssoTab.metadataUrlLabel")}>
            <Input type="url" value={metadataUrl} onChange={(e) => setMetadataUrl(e.target.value)}
              placeholder={t("ssoTab.metadataUrlPlaceholder")} required />
          </Field>
          {provider && (
            <div className="flex items-center gap-3">
              <Toggle checked={enabled} onChange={setEnabled} label={t("ssoTab.enabledLabel")} />
              <span className="text-sm text-ink">{t("ssoTab.enabledLabel")}</span>
            </div>
          )}
          {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
          <div className="flex items-center justify-between">
            <Button type="submit" variant="primary" disabled={saveProvider.isPending}>
              {saveProvider.isPending ? t("ssoTab.saving") : t("ssoTab.save")}
            </Button>
            {provider && (
              <Button type="button" variant="ghost"
                onClick={() => { if (confirm(t("ssoTab.deleteConfirm"))) deleteProvider.mutate(); }}
                disabled={deleteProvider.isPending}>
                {t("ssoTab.delete")}
              </Button>
            )}
          </div>
          {!provider && <p className="text-sm text-ink-faint">{t("ssoTab.notConfigured")}</p>}
        </form>
      </Panel>

      <Panel>
        <PanelHeader title={t("ssoTab.pendingUsersTitle")} />
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-2">{t("common.name")}</th>
              <th className="px-4 py-2">{t("common.email")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pendingUsers?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-ink">{u.full_name}</td>
                <td className="px-4 py-2 text-ink-faint">{u.email}</td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" onClick={() => { setActivating(u); setActivateError(null); setStaffNo(""); }}>
                    {t("ssoTab.activate")}
                  </Button>
                </td>
              </tr>
            ))}
            {pendingUsers?.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-ink-faint">{t("ssoTab.noPendingUsers")}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Modal open={!!activating} onClose={() => setActivating(null)} title={t("ssoTab.activateFor", { name: activating?.full_name })}>
        <div className="space-y-4">
          <Field label={t("ssoTab.chooseRole")}>
            <select
              value={activateRole}
              onChange={(e) => setActivateRole(e.target.value as typeof activateRole)}
              className="h-11 w-full rounded-control border border-line bg-sidebar px-3 text-sm text-ink"
            >
              {ACTIVATABLE_ROLES.map((r) => (
                <option key={r} value={r}>{t(`roles.${r}`)}</option>
              ))}
            </select>
          </Field>
          {activateRole === "teacher" && (
            <Field label={t("teachers.staffNo")}>
              <Input value={staffNo} onChange={(e) => setStaffNo(e.target.value)} required />
            </Field>
          )}
          {activateError && <p role="alert" className="text-sm text-danger">{activateError}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setActivating(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={activateUser.isPending}
              onClick={() => { setActivateError(null); activateUser.mutate(); }}>
              {t("ssoTab.activate")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
