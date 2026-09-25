// Self-service credential entry for SMS provider secrets. No online payment
// gateway is wired in this version: Chapa and Stripe were canceled and the
// Telebirr H5 C2B gateway was decommissioned in R6 WP-00 (C-01). Credentials
// are write-only from the browser's perspective: once saved, this page never
// re-displays a secret value, only a "configured" badge — the actual secret
// lives in Supabase Vault, readable only by service_role via the
// manage-integration-credentials Edge Function (migration 011).
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, FieldGroup } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import {
  buildCredentialsPayload,
  providerFieldKeys,
  PROVIDERS,
  type CredentialsPayload,
  type Provider,
} from "./integrationPayload";

type IntegrationRow = {
  provider: string;
  display_name: string;
  configured: boolean;
  updated_at: string | null;
};

// labelKey rather than label: this map is built at module load, where the
// i18n `t` from a component hook does not exist and would also freeze the
// string against later language switches. Which keys each provider takes, and
// whether each is a secret, comes from the server's allow-list (keys.ts).
const FIELD_LABEL_KEYS: Record<string, string> = {
  api_key: "platformPagesX.apiKey",
  sender_id: "platformPagesX.senderId",
};

async function callManageCredentials(body: CredentialsPayload) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-integration-credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`manage-integration-credentials ${res.status}`);
  return res.json();
}

function isProvider(p: string): p is Provider {
  return (PROVIDERS as readonly string[]).includes(p);
}

function ProviderCard({ provider, displayName, configured, updatedAt }: {
  provider: Provider; displayName: string; configured: boolean; updatedAt: string | null;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => callManageCredentials(buildCredentialsPayload(provider, values)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform-integrations"] });
      setOpen(false);
      setValues({});
    },
  });

  const fields = providerFieldKeys(provider);
  const allFilled = fields.every((f) => values[f.key]?.trim());

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">{displayName}</p>
          <p className="text-xs text-ink-faint">
            {configured
              ? <>{t("platformPagesX.configured")}{updatedAt && <> · {t("platformPagesX.updated")} <EthDate value={updatedAt} /></>}</>
              : t("platformPagesX.notConfigured")}
          </p>
        </div>
        <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? t("common.cancel") : configured ? t("platformPagesX.update") : t("platformPagesX.configure")}
        </Button>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {fields.map((f) => (
            <Field key={f.key} label={t(FIELD_LABEL_KEYS[f.key] ?? f.key)}>
              <Input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                maxLength={500}
                autoComplete="off"
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              />
            </Field>
          ))}
          <Button onClick={() => save.mutate()} disabled={!allFilled || save.isPending}>
            {save.isPending ? t("platformPagesX.saving") : t("common.save")}
          </Button>
          {save.isError && <p role="alert" className="text-sm text-danger">{t("platformPagesX.saveFailed")}</p>}
          <p className="text-xs text-ink-faint">
            {t("help.vaultNote")}
          </p>
        </div>
      )}
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
          {PROVIDERS.map((p) => (
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
        .select("provider, display_name, configured, updated_at").order("provider");
      if (error) throw error;
      return data as IntegrationRow[];
    },
  });

  const [from, to] = pageRange(page);
  // Only providers the credentials endpoint accepts are listed (and counted).
  const providerRows = (integrations ?? []).filter((i) => isProvider(i.provider));
  const visibleIntegrations = providerRows.slice(from, to + 1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("platformPagesX.integrations")}</h1>
      <p className="text-sm text-ink-faint">
        {t("help.integrationsNote")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {visibleIntegrations.map((i) => isProvider(i.provider) && (
          <ProviderCard
            key={i.provider}
            provider={i.provider}
            displayName={i.display_name}
            configured={i.configured}
            updatedAt={i.updated_at}
          />
        ))}
      </div>
      <Pagination page={page} totalCount={providerRows.length} onPageChange={setPage} />
      <ActiveSmsProviderSelector />
    </div>
  );
}
