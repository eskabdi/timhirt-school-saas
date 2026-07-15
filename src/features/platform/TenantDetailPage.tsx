// Tenant detail view: identity + status, its school_admin roster, and an
// "Invite admin" form that calls invite-tenant-admin (adds a school_admin to
// this EXISTING tenant — distinct from onboard-tenant's "create a brand-new
// tenant plus its first admin", used on the list page).
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
import { cn } from "@/lib/utils";

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
      <h2 className="mb-4 font-display text-lg font-bold">Invite admin</h2>
      <form onSubmit={handleSubmit((v) => invite.mutate(v))} className="space-y-4" noValidate>
        <Field label="Full name" error={errors.admin_full_name?.message}>
          <Input maxLength={120} {...register("admin_full_name")} />
        </Field>
        <Field label="Email" error={errors.admin_email?.message}>
          <Input type="email" maxLength={254} {...register("admin_email")} />
        </Field>
        <Field label="Locale" error={errors.default_locale?.message}>
          <select {...register("default_locale")} className="w-full rounded-card border border-line px-3 py-2 text-sm">
            <option value="am">Amharic</option>
            <option value="en">English</option>
            <option value="om">Afaan Oromoo</option>
          </select>
        </Field>
        {invite.isError && <p role="alert" className="text-sm text-danger">{(invite.error as Error).message}</p>}
        {invite.isSuccess && <p className="text-sm text-ink-faint">Invite sent — they'll get an email to set their password.</p>}
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? "Sending…" : "Send invite"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function TenantDetailPage() {
  const { id } = useParams();
  const [inviting, setInviting] = useState(false);
  const qc = useQueryClient();

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
      <Link to="/platform/tenants" className="text-sm text-ink-faint hover:text-ink">&larr; Tenants</Link>

      <Card>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">{tenant.name}</h1>
          <span className="rounded-full bg-chalk-sunken px-3 py-1 text-xs font-medium capitalize">{tenant.status}</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">Slug</dt><dd className="font-medium">{tenant.slug}</dd></div>
          <div><dt className="text-ink-faint">Created</dt><dd className="font-medium"><EthDate value={tenant.created_at.slice(0, 10)} /></dd></div>
          <div>
            <dt className="text-ink-faint">Subscription tier</dt>
            <dd className="font-medium">
              <select
                value={tenant.tier_key}
                disabled={setTier.isPending}
                onChange={(e) => setTier.mutate(e.target.value)}
                className="mt-1 rounded-card border border-line px-2 py-1 text-sm"
              >
                {tiers?.map((t) => <option key={t.key} value={t.key}>{t.display_name}</option>)}
              </select>
            </dd>
          </div>
        </dl>
      </Card>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold">Modules</h2>
        <p className="mb-3 text-sm text-ink-faint">
          Inherited from the {tiers?.find((t) => t.key === tenant.tier_key)?.display_name ?? tenant.tier_key} tier.
          Toggle a module to override it for this tenant only, or reset to go back to the tier default.
        </p>
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">Module</th><th className="px-4 py-2">Enabled</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {modules?.map((m) => {
                const override = overrideFor(m.key);
                const effective = effectiveFor(m.key);
                return (
                  <tr key={m.key}>
                    <td className="px-4 py-2 font-medium">{m.display_name}</td>
                    <td className="px-4 py-2">
                      <button
                        type="button"
                        disabled={setOverride.isPending}
                        onClick={() => setOverride.mutate({ moduleKey: m.key, enabled: !effective })}
                        aria-pressed={effective}
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-card border transition-colors disabled:opacity-50",
                          effective ? "border-meskel bg-meskel-wash text-ink" : "border-line text-ink-faint hover:bg-chalk-sunken",
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
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Admins</h2>
          {!inviting && <Button onClick={() => setInviting(true)}>Invite admin</Button>}
        </div>

        {inviting && id && (
          <div className="mb-4">
            <InviteAdminForm tenantId={id} onDone={() => setInviting(false)} />
          </div>
        )}

        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Locale</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {admins?.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2 font-medium">{a.full_name}</td>
                  <td className="px-4 py-2 text-ink-faint">{a.email}</td>
                  <td className="px-4 py-2 uppercase">{a.locale}</td>
                </tr>
              ))}
              {admins?.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-ink-faint">No admins yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
