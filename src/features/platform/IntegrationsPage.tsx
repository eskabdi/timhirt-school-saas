// Self-service credential entry for the Telebirr H5 C2B gateway and SMS
// provider secrets (§21.9-adjacent). Chapa and Stripe are canceled — neither
// is wired into this codebase anymore. Credentials are write-only from the
// browser's perspective: once saved, this page never re-displays a secret
// value, only a "configured" badge — the actual secret lives in Supabase
// Vault, readable only by service_role via the manage-integration-
// credentials Edge Function (migration 011). The one deliberate exception is
// Telebirr's OWN public key (config.our_public_key_pem): it is not secret,
// and displaying it is the only way an admin can hand it to Ethio Telecom's
// merchant portal.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, FieldGroup } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { CopyButton } from "@/components/ui/CopyButton";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";

type IntegrationRow = {
  provider: string;
  display_name: string;
  configured: boolean;
  updated_at: string | null;
  config: Record<string, string> | null;
};

// labelKey rather than label: this map is built at module load, where the
// i18n `t` from a component hook does not exist and would also freeze the
// string against later language switches.
const PROVIDER_FIELDS: Record<string, { key: string; labelKey: string; type?: string }[]> = {
  sms_smsala: [{ key: "api_key", labelKey: "platformPagesX.apiKey", type: "password" }],
  sms_geezsms: [{ key: "api_key", labelKey: "platformPagesX.apiKey", type: "password" }],
  sms_afromessage: [
    { key: "api_key", labelKey: "platformPagesX.apiKey", type: "password" },
    { key: "sender_id", labelKey: "platformPagesX.senderId" },
  ],
};

const SMS_PROVIDERS = ["sms_smsala", "sms_afromessage", "sms_geezsms"] as const;

async function callManageCredentials(body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-integration-credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save credentials");
  return res.json();
}

function ProviderCard({ provider, displayName, configured, updatedAt }: {
  provider: string; displayName: string; configured: boolean; updatedAt: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => callManageCredentials({ provider, credentials: values }),
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

function TelebirrCard({ integration }: { integration: IntegrationRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const config = integration.config ?? {};
  const [fabricAppSecret, setFabricAppSecret] = useState("");
  const [fabricAppKey, setFabricAppKey] = useState(config.fabric_app_key ?? "");
  const [appid, setAppid] = useState(config.appid ?? "");
  const [merchCode, setMerchCode] = useState(config.merch_code ?? "");
  const [telebirrPublicKeyPem, setTelebirrPublicKeyPem] = useState(config.telebirr_public_key_pem ?? "");

  const save = useMutation({
    mutationFn: () => callManageCredentials({
      provider: "telebirr",
      credentials: { fabric_app_secret: fabricAppSecret },
      config: {
        fabric_app_key: fabricAppKey, appid, merch_code: merchCode,
        telebirr_public_key_pem: telebirrPublicKeyPem,
      },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-integrations"] });
      setOpen(false);
      setFabricAppSecret("");
    },
  });

  const doGenerateKeypair = async () => {
    if (config.our_public_key_pem && !confirm(t("platformPagesX.regenerateWarning"))) return;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telebirr-generate-keypair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to generate keypair");
    qc.invalidateQueries({ queryKey: ["platform-integrations"] });
  };

  const allFilled = fabricAppSecret.trim() && fabricAppKey.trim() && appid.trim() && merchCode.trim();

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="font-medium">{integration.display_name}</p>
          <Badge tone="neutral">{t("platformPagesX.testbedBadge")}</Badge>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : integration.configured ? "Update" : "Configure"}
        </Button>
      </div>
      <p className="text-xs text-ink-faint">
        {integration.configured
          ? <>Configured{integration.updated_at && <> · {t("platformPagesX.updated")} <EthDate value={integration.updated_at.slice(0, 10)} /></>}</>
          : "Not configured"}
      </p>
      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <Field label={t("platformPagesX.fabricAppKey")}>
            <Input value={fabricAppKey} maxLength={500} autoComplete="off"
              onChange={(e) => setFabricAppKey(e.target.value)} />
          </Field>
          <Field label={t("platformPagesX.fabricAppSecret")}>
            <Input type="password" value={fabricAppSecret} maxLength={500} autoComplete="off"
              onChange={(e) => setFabricAppSecret(e.target.value)} />
          </Field>
          <Field label={t("platformPagesX.appId")}>
            <Input value={appid} maxLength={500} autoComplete="off"
              onChange={(e) => setAppid(e.target.value)} />
          </Field>
          <Field label={t("platformPagesX.merchCode")}>
            <Input value={merchCode} maxLength={500} autoComplete="off"
              onChange={(e) => setMerchCode(e.target.value)} />
          </Field>
          <Field label={t("platformPagesX.theirPublicKey")} hint={t("platformPagesX.theirPublicKeyHint")}>
            <textarea
              value={telebirrPublicKeyPem} maxLength={2000}
              onChange={(e) => setTelebirrPublicKeyPem(e.target.value)}
              rows={4}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Button onClick={() => save.mutate()} disabled={!allFilled || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isError && <p className="text-sm text-danger">{(save.error as Error).message}</p>}
          <p className="text-xs text-ink-faint">{t("help.vaultNote")}</p>
        </div>
      )}
      <div className="mt-4 space-y-2 border-t border-line pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("platformPagesX.ourPublicKey")}</p>
        {config.our_public_key_pem ? (
          <div className="flex items-start gap-2">
            <pre className="max-h-32 flex-1 overflow-auto rounded-control border border-line bg-sidebar p-2 text-xs">{config.our_public_key_pem}</pre>
            <CopyButton value={config.our_public_key_pem} />
          </div>
        ) : (
          <p className="text-xs text-ink-faint">{t("platformPagesX.keypairNotGenerated")}</p>
        )}
        <Button
          variant="ghost"
          onClick={() => { void doGenerateKeypair(); }}
        >
          {t("platformPagesX.generateKeypair")}
        </Button>
      </div>
    </Card>
  );
}

function ActiveSmsProviderSelector() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: row } = useQuery({
    queryKey: ["active-sms-provider"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_config")
        .select("id, value").is("tenant_id", null).eq("key", "active_sms_provider").maybeSingle();
      if (error) throw error;
      return data as { id: string; value: string | null } | null;
    },
  });

  const setActive = useMutation({
    mutationFn: async (value: string | null) => {
      if (!row) return;
      const { error } = await supabase.from("system_config").update({ value }).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["active-sms-provider"] }),
  });

  return (
    <Card>
      <FieldGroup label={t("platformPagesX.activeSmsProvider")} hint={t("platformPagesX.smsProviderUnverified")}>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="active-sms-provider" checked={!row?.value}
              onChange={() => setActive.mutate(null)} />
            {t("platformPagesX.smsProviderNone")}
          </label>
          {SMS_PROVIDERS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="radio" name="active-sms-provider" checked={row?.value === p}
                onChange={() => setActive.mutate(p)} />
              {p.replace("sms_", "")}
            </label>
          ))}
        </div>
      </FieldGroup>
    </Card>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data: integrations } = useQuery({
    queryKey: ["platform-integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("platform_integrations")
        .select("provider, display_name, configured, updated_at, config").order("provider");
      if (error) throw error;
      return data as IntegrationRow[];
    },
  });

  const [from, to] = pageRange(page);
  const visibleIntegrations = (integrations ?? []).slice(from, to + 1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("platformPagesX.integrations")}</h1>
      <p className="text-sm text-ink-faint">
        {t("help.integrationsNote")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleIntegrations.map((i) => (
          i.provider === "telebirr"
            ? <TelebirrCard key={i.provider} integration={i} />
            : (
              <ProviderCard
                key={i.provider}
                provider={i.provider}
                displayName={i.display_name}
                configured={i.configured}
                updatedAt={i.updated_at}
              />
            )
        ))}
      </div>
      <Pagination page={page} totalCount={integrations?.length ?? 0} onPageChange={setPage} />
      <ActiveSmsProviderSelector />
    </div>
  );
}
