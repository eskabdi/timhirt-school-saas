// Tenant detail view: identity + status, its school_admin roster, and an
// "Invite admin" form that calls invite-tenant-admin (adds a school_admin to
// this EXISTING tenant — distinct from onboard-tenant's "create a brand-new
// tenant plus its first admin", used on the list page).
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { EthDate } from "@/components/EthDate";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { startImpersonation } from "./impersonation";

const STATUS_TONE = { active: "ok", suspended: "danger" } as const;

const inviteSchema = z.object({
  admin_email: z.string().email().max(254),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]),
});
type InviteInput = z.infer<typeof inviteSchema>;

async function callInviteTenantAdmin(tenantId: string, input: InviteInput) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-tenant-admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ tenant_id: tenantId, ...input }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed to send invite");
  return res.json();
}

function InviteAdminForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const { register, handleSubmit, formState: { errors } } = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { default_locale: "am" },
  });
  const qc = useQueryClient();

  const invite = useMutation({
    mutationFn: (input: InviteInput) => callInviteTenantAdmin(tenantId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-admins", tenantId] });
      onDone();
    },
  });

  return (
    <Card className="max-w-md">
      <h2 className="mb-4 font-display text-lg font-bold text-ink">{t("platformPagesX.inviteAdmin")}</h2>
      <form onSubmit={handleSubmit((v) => invite.mutate(v))} className="space-y-4" noValidate>
        <Field label={t("platformPagesX.fullName")} error={errors.admin_full_name?.message}>
          <Input maxLength={120} {...register("admin_full_name")} />
        </Field>
        <Field label={t("common.email")} error={errors.admin_email?.message}>
          <Input type="email" maxLength={254} {...register("admin_email")} />
        </Field>
        <Field label={t("common.locale")} error={errors.default_locale?.message}>
          <select {...register("default_locale")} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="am">{t("platformPagesX.amharic")}</option>
            <option value="en">{t("platformPagesX.english")}</option>
            <option value="om">{t("platformPagesX.oromo")}</option>
          </select>
        </Field>
        {invite.isError && <p role="alert" className="text-sm text-danger">{(invite.error as Error).message}</p>}
        {invite.isSuccess && <p className="text-sm text-ink-faint">{t("platformPagesX.inviteSent")}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>{t("common.cancel")}</Button>
        </div>
      </form>
    </Card>
  );
}

export function TenantDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [inviting, setInviting] = useState(false);
  const [impersonating, setImpersonating] = useState<{ id: string; full_name: string } | null>(null);
  const [impersonateReason, setImpersonateReason] = useState("");
  const [impersonateError, setImpersonateError] = useState<string | null>(null);
  const qc = useQueryClient();

  const impersonate = useMutation({
    mutationFn: async () => {
      if (!impersonating || impersonateReason.trim().length < 3) return;
      await startImpersonation(impersonating.id, impersonateReason.trim());
    },
    onSuccess: () => {
      setImpersonating(null);
      setImpersonateReason("");
      setImpersonateError(null);
      // A full reload, not client-side navigation -- every cached React
      // Query result and in-memory auth context was built under the
      // super_admin's own identity and must not leak across the swap.
      // Lands on "/", the tenant's own dashboard (the platform console
      // their old role could reach is not reachable by this new one).
      window.location.href = "/";
    },
    onError: (e) => setImpersonateError(e instanceof Error ? e.message : String(e)),
  });

  const { data: tenant } = useQuery({
    queryKey: ["tenant", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants")
        .select("id, name, slug, status, created_at, tier_key").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: admins } = useQuery({
    queryKey: ["tenant-admins", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("users")
        .select("id, full_name, email, locale").eq("tenant_id", id).eq("role", "school_admin").order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const { data: tiers } = useQuery({
    queryKey: ["subscription-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_tiers").select("key, display_name").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: modules } = useQuery({
    queryKey: ["modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modules").select("key, display_name").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: tierModuleKeys } = useQuery({
    queryKey: ["tier-modules", tenant?.tier_key],
    queryFn: async () => {
      const { data, error } = await supabase.from("tier_modules").select("module_key").eq("tier_key", tenant!.tier_key);
      if (error) throw error;
      return new Set(data.map((m) => m.module_key));
    },
    enabled: !!tenant?.tier_key,
  });

  const { data: overrides } = useQuery({
    queryKey: ["tenant-module-overrides", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_module_overrides")
        .select("module_key, enabled").eq("tenant_id", id);
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const setTier = useMutation({
    mutationFn: async (tierKey: string) => {
      const { error } = await supabase.from("tenants").update({ tier_key: tierKey }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant", id] }),
  });

  const setOverride = useMutation({
    mutationFn: async ({ moduleKey, enabled }: { moduleKey: string; enabled: boolean | null }) => {
      if (enabled === null) {
        const { error } = await supabase.from("tenant_module_overrides").delete()
          .eq("tenant_id", id).eq("module_key", moduleKey);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tenant_module_overrides")
          .upsert({ tenant_id: id, module_key: moduleKey, enabled });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-module-overrides", id] }),
  });

  if (!tenant) return null;

  const overrideFor = (moduleKey: string) => overrides?.find((o) => o.module_key === moduleKey)?.enabled ?? null;
  const effectiveFor = (moduleKey: string) => overrideFor(moduleKey) ?? tierModuleKeys?.has(moduleKey) ?? false;

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/platform/tenants" className="text-sm text-ink-faint hover:text-ink">{t("platformPagesX.backToTenants")}</Link>

      <Card>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold text-ink">{tenant.name}</h1>
          <Badge tone={STATUS_TONE[tenant.status as keyof typeof STATUS_TONE] ?? "neutral"}>{tenant.status}</Badge>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-faint">{t("platformPagesX.slug")}</dt><dd className="font-medium text-ink">{tenant.slug}</dd></div>
          <div><dt className="text-ink-faint">{t("platformPagesX.created")}</dt><dd className="font-medium text-ink"><EthDate value={tenant.created_at.slice(0, 10)} /></dd></div>
          <div>
            <dt className="text-ink-faint">{t("platformPagesX.subscriptionTier")}</dt>
            <dd className="font-medium">
              <select
                value={tenant.tier_key}
                disabled={setTier.isPending}
                onChange={(e) => setTier.mutate(e.target.value)}
                className="mt-1 rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
              >
                {tiers?.map((t) => <option key={t.key} value={t.key}>{t.display_name}</option>)}
              </select>
            </dd>
          </div>
        </dl>
      </Card>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">{t("platformPagesX.modules")}</h2>
        <p className="mb-3 text-sm text-ink-faint">
          {t("help.inheritedFrom", { tier: tiers?.find((tr) => tr.key === tenant.tier_key)?.display_name ?? tenant.tier_key })}
        </p>
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("common.module")}</th><th className="px-4 py-2">{t("platformPagesX.enabled")}</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {modules?.map((m) => {
                const override = overrideFor(m.key);
                const effective = effectiveFor(m.key);
                return (
                  <tr key={m.key}>
                    <td className="px-4 py-2 font-medium text-ink">{m.display_name}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={setOverride.isPending}
                        onClick={() => setOverride.mutate({ moduleKey: m.key, enabled: !effective })}
                        aria-pressed={effective}
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-control border transition-colors disabled:opacity-50",
                          effective ? "border-navy bg-navy-wash text-navy" : "border-line text-ink-faint hover:bg-sidebar",
                        )}
                      >
                        {effective ? "✓" : ""}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-ink-faint">
                      {override !== null && (
                        <button
                          type="button"
                          className="hover:text-ink hover:underline"
                          onClick={() => setOverride.mutate({ moduleKey: m.key, enabled: null })}
                        >
                          overridden — reset to tier default
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">{t("platformPagesX.admins")}</h2>
          {!inviting && <Button onClick={() => setInviting(true)}>{t("platformPagesX.inviteAdmin")}</Button>}
        </div>

        {inviting && id && (
          <div className="mb-4">
            <InviteAdminForm tenantId={id} onDone={() => setInviting(false)} />
          </div>
        )}

        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("common.name")}</th><th className="px-4 py-2">{t("common.email")}</th><th className="px-4 py-2">{t("common.locale")}</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {admins?.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 font-medium text-ink">{a.full_name}</td>
                  <td className="px-4 py-2 text-ink-faint">{a.email}</td>
                  <td className="px-4 py-2 uppercase text-ink">{a.locale}</td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" className="text-xs text-navy hover:underline"
                      onClick={() => { setImpersonating(a); setImpersonateReason(""); setImpersonateError(null); }}>
                      {t("platformPagesX.impersonate")}
                    </button>
                  </td>
                </tr>
              ))}
              {admins?.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-faint">{t("platformPagesX.noAdmins")}</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>

      <Modal open={!!impersonating} onClose={() => setImpersonating(null)} title={t("platformPagesX.impersonateTitle")}>
        <div className="space-y-3">
          <p className="text-sm text-ink-faint">
            {t("platformPagesX.impersonateSubtitle", { name: impersonating?.full_name ?? "" })}
          </p>
          <Field label={t("platformPagesX.impersonateReason")}>
            <textarea value={impersonateReason} onChange={(e) => setImpersonateReason(e.target.value)}
              maxLength={500} rows={3} minLength={3}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
          {impersonateError && <p className="text-sm text-danger">{impersonateError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onClick={() => setImpersonating(null)}>{t("students.cancel")}</Button>
            <Button variant="danger" onClick={() => impersonate.mutate()}
              disabled={impersonateReason.trim().length < 3 || impersonate.isPending}>
              {impersonate.isPending ? t("platformPagesX.impersonateStarting") : t("platformPagesX.impersonateConfirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
