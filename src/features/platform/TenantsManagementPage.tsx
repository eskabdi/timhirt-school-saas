// Tenant (school) registration CRUD for the platform console. Creation goes
// through the onboard-tenant Edge Function (super_admin JWT) rather than a
// raw insert, so the invited school_admin, tenant_configs row, and current
// EC academic year are always created together (§DEPLOYMENT.md §3-4) instead
// of leaving an orphan tenant with no admin able to sign in. Editing name/
// status is a direct RLS-protected table write (tenants_write policy already
// scopes "for all" to super_admin) — no Edge Function needed for that part.
// slug is create-only: it's embedded in the public /apply/:tenantSlug URL,
// so changing it later would break any link already shared with applicants.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { onRowDoubleClick } from "@/lib/utils";

const STATUS_TONE = { active: "ok", suspended: "danger" } as const;

const tenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Lowercase letters, numbers, hyphens"),
  admin_email: z.string().email().max(254),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]),
});
type TenantInput = z.infer<typeof tenantSchema>;

function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

async function callOnboardTenant(input: TenantInput) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/onboard-tenant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed to create tenant");
  return res.json();
}

function NewTenantForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<TenantInput>({
    resolver: zodResolver(tenantSchema),
    defaultValues: { default_locale: "am" },
  });
  const qc = useQueryClient();
  const [slugEdited, setSlugEdited] = useState(false);

  const create = useMutation({
    mutationFn: callOnboardTenant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-tenants"] });
      onDone();
    },
  });

  return (
    <Card className="max-w-xl">
      <h2 className="mb-4 font-display text-lg font-bold text-ink">{t("platformPagesX.newTenant")}</h2>
      <form
        onSubmit={handleSubmit((v) => create.mutate(v))}
        className="space-y-4"
        noValidate
      >
        <Field label={t("platformPagesX.schoolName")} error={errors.name?.message}>
          <Input
            maxLength={120}
            {...register("name", {
              onChange: (e) => { if (!slugEdited) setValue("slug", slugify(e.target.value)); },
            })}
          />
        </Field>
        <Field label={t("platformPagesX.slugHint")} error={errors.slug?.message}>
          <Input
            maxLength={40}
            {...register("slug", { onChange: () => setSlugEdited(true) })}
          />
        </Field>
        <Field label={t("platformPagesX.adminFullName")} error={errors.admin_full_name?.message}>
          <Input maxLength={120} {...register("admin_full_name")} />
        </Field>
        <Field label={t("platformPagesX.adminEmail")} error={errors.admin_email?.message}>
          <Input type="email" maxLength={254} {...register("admin_email")} />
        </Field>
        <Field label={t("platformPagesX.defaultLocale")} error={errors.default_locale?.message}>
          <select {...register("default_locale")} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="am">{t("platformPagesX.amharic")}</option>
            <option value="en">{t("platformPagesX.english")}</option>
            <option value="om">{t("platformPagesX.oromo")}</option>
          </select>
        </Field>
        {create.isError && <p role="alert" className="text-sm text-danger">{(create.error as Error).message}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create tenant"}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>{t("common.cancel")}</Button>
        </div>
      </form>
    </Card>
  );
}

export function TenantsManagementPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["platform-tenants", page],
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("tenants")
        .select("id, name, slug, status, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const tenants = data?.rows;

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("tenants").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform-tenants"] }); setEditingId(null); },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "active" | "suspended" }) => {
      const { error } = await supabase.from("tenants").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-tenants"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("reportPages.tenants")}</h1>
        {!creating && <Button onClick={() => setCreating(true)}>{t("platformPagesX.newTenant")}</Button>}
      </div>

      {creating && <NewTenantForm onDone={() => setCreating(false)} />}

      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-2">{t("common.name")}</th>
              <th className="px-4 py-2">{t("platformPagesX.slug")}</th>
              <th className="px-4 py-2">{t("students.status")}</th>
              <th className="px-4 py-2">{t("platformPagesX.created")}</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tenants?.map((row) => (
              <tr
                key={row.id}
                className={editingId === row.id ? undefined : "cursor-pointer"}
                onDoubleClick={editingId === row.id ? undefined : onRowDoubleClick(navigate, `/platform/tenants/${row.id}`)}
              >
                <td className="px-4 py-2 font-medium">
                  {editingId === row.id ? (
                    <Input
                      autoFocus
                      value={editName}
                      maxLength={120}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editName.trim()) rename.mutate({ id: row.id, name: editName.trim() });
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : <Link to={`/platform/tenants/${row.id}`} className="text-navy hover:underline">{row.name}</Link>}
                </td>
                <td className="px-4 py-2 text-ink-faint">{row.slug}</td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>{row.status}</Badge>
                </td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={row.created_at.slice(0, 10)} /></td>
                <td className="px-4 py-2 text-right">
                  {editingId === row.id ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        disabled={!editName.trim() || rename.isPending}
                        onClick={() => rename.mutate({ id: row.id, name: editName.trim() })}
                      >
                        Save
                      </Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>{t("common.cancel")}</Button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" onClick={() => { setEditingId(row.id); setEditName(row.name); }}>
                        Edit
                      </Button>
                      {row.status === "suspended" ? (
                        <Button variant="ghost" onClick={() => setStatus.mutate({ id: row.id, status: "active" })}>
                          Reactivate
                        </Button>
                      ) : (
                        <Button variant="danger" onClick={() => setStatus.mutate({ id: row.id, status: "suspended" })}>
                          Suspend
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-4" />
      </Panel>
    </div>
  );
}
