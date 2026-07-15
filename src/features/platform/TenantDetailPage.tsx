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

  const { data: tenant } = useQuery({
    queryKey: ["tenant", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants")
        .select("id, name, slug, status, created_at").eq("id", id).single();
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

  if (!tenant) return null;

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
        </dl>
      </Card>

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
