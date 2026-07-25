// Self-service credential entry for Chapa/Telebirr/Stripe/SMS gateways
// (§21.9-adjacent — chosen over removing online payments entirely: this
// closes the "who sets the Chapa key" gap without cutting a core feature).
// Credentials are write-only from the browser's perspective: once saved,
// this page never re-displays the value, only a "configured" badge — the
// actual secret lives in Supabase Vault, readable only by service_role via
// the manage-integration-credentials Edge Function (migration 011).
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { EthDate } from "@/components/EthDate";

// labelKey rather than label: this map is built at module load, where the
// i18n `t` from a component hook does not exist and would also freeze the
// string against later language switches.
const PROVIDER_FIELDS: Record<string, { key: string; labelKey: string; type?: string }[]> = {
  chapa: [
    { key: "secret_key", labelKey: "platformPagesX.secretKey", type: "password" },
    { key: "webhook_secret", labelKey: "platformPagesX.webhookSecret", type: "password" },
  ],
  telebirr: [{ key: "secret_key", labelKey: "platformPagesX.secretKey", type: "password" }],
  stripe: [
    { key: "secret_key", labelKey: "platformPagesX.secretKey", type: "password" },
    { key: "webhook_secret", labelKey: "platformPagesX.webhookSecret", type: "password" },
  ],
  sms_geezsms: [{ key: "api_key", labelKey: "platformPagesX.apiKey", type: "password" }],
  sms_afromessage: [
    { key: "api_key", labelKey: "platformPagesX.apiKey", type: "password" },
    { key: "sender_id", labelKey: "platformPagesX.senderId" },
  ],
};

function ProviderCard({ provider, displayName, configured, updatedAt }: {
  provider: string; displayName: string; configured: boolean; updatedAt: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-integration-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ provider, credentials: values }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save credentials");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-integrations"] });
      setOpen(false);
      setValues({});
    },
  });

  const fields = PROVIDER_FIELDS[provider] ?? [];
  const allFilled = fields.every((f) => values[f.key]?.trim());

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{displayName}</p>
          <p className="text-xs text-ink-faint">
            {configured
              ? <>Configured{updatedAt && <> · {t("platformPagesX.updated")} <EthDate value={updatedAt.slice(0, 10)} /></>}</>
              : "Not configured"}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : configured ? "Update" : "Configure"}
        </Button>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {fields.map((f) => (
            <Field key={f.key} label={t(f.labelKey)}>
              <Input
                type={f.type ?? "text"}
                value={values[f.key] ?? ""}
                maxLength={500}
                autoComplete="off"
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          <Button onClick={() => save.mutate()} disabled={!allFilled || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isError && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
          <p className="text-xs text-ink-faint">
            {t("help.vaultNote")}
          </p>
        </div>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const { data: integrations } = useQuery({
    queryKey: ["platform-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_integrations")
        .select("provider, display_name, configured, updated_at").order("provider");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("platformPagesX.integrations")}</h1>
      <p className="text-sm text-ink-faint">
        {t("help.integrationsNote")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {integrations?.map((i) => (
          <ProviderCard
            key={i.provider}
            provider={i.provider}
            displayName={i.display_name}
            configured={i.configured}
            updatedAt={i.updated_at}
          />
        ))}
      </div>
    </div>
  );
}
