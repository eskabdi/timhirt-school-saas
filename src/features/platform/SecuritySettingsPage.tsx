// Platform-wide security policy, super_admin only. Backed by
// public.system_config's tenant_id-is-null rows (system_config_write
// already restricts writes there to super_admin -- migration 20260719000009
// -- so no new RLS is needed for "only the platform admin can change this").
// Every value here is read live by get_security_settings() (20260806000001):
// check-login-attempt, useIdleLogout, and the password-policy validation on
// AcceptInvitePage/ChangePasswordModal all pick up a change without a
// redeploy -- within seconds for a fresh page load, within the 5-minute
// refetch for a session that's already open.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";

const KEYS = [
  "login_max_attempts", "login_attempt_window_minutes",
  "login_ip_max_attempts", "login_ip_window_minutes",
  "session_timeout_minutes",
  "password_min_length", "password_require_uppercase",
  "password_require_numbers", "password_require_special",
] as const;
type Key = (typeof KEYS)[number];

interface FormState {
  login_max_attempts: string;
  login_attempt_window_minutes: string;
  login_ip_max_attempts: string;
  login_ip_window_minutes: string;
  session_timeout_minutes: string;
  password_min_length: string;
  password_require_uppercase: boolean;
  password_require_numbers: boolean;
  password_require_special: boolean;
}

export function SecuritySettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data: rows } = useQuery({
    queryKey: ["security-settings-rows"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("system_config")
        .select("id,key,value").is("tenant_id", null).in("key", KEYS as unknown as string[]);
      if (err) throw err;
      return data as { id: string; key: Key; value: unknown }[];
    },
  });

  useEffect(() => {
    if (!rows || form) return;
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    setForm({
      login_max_attempts: String(byKey.get("login_max_attempts") ?? 5),
      login_attempt_window_minutes: String(byKey.get("login_attempt_window_minutes") ?? 15),
      login_ip_max_attempts: String(byKey.get("login_ip_max_attempts") ?? 20),
      login_ip_window_minutes: String(byKey.get("login_ip_window_minutes") ?? 15),
      session_timeout_minutes: String(byKey.get("session_timeout_minutes") ?? 60),
      password_min_length: String(byKey.get("password_min_length") ?? 8),
      password_require_uppercase: Boolean(byKey.get("password_require_uppercase")),
      password_require_numbers: Boolean(byKey.get("password_require_numbers")),
      password_require_special: Boolean(byKey.get("password_require_special")),
    });
  }, [rows, form]);

  const save = useMutation({
    mutationFn: async () => {
      if (!rows || !form) return;
      const values: Record<Key, unknown> = {
        login_max_attempts: Number(form.login_max_attempts),
        login_attempt_window_minutes: Number(form.login_attempt_window_minutes),
        login_ip_max_attempts: Number(form.login_ip_max_attempts),
        login_ip_window_minutes: Number(form.login_ip_window_minutes),
        session_timeout_minutes: Number(form.session_timeout_minutes),
        password_min_length: Number(form.password_min_length),
        password_require_uppercase: form.password_require_uppercase,
        password_require_numbers: form.password_require_numbers,
        password_require_special: form.password_require_special,
      };
      for (const [k, v] of Object.entries(values)) {
        if (typeof v === "number" && (!Number.isFinite(v) || v < 1)) {
          throw new Error(t("securitySettings.invalidNumber"));
        }
        const row = rows.find((r) => r.key === k);
        if (!row) continue;
        const { error: err } = await supabase.from("system_config").update({ value: v }).eq("id", row.id);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["security-settings-rows"] });
      qc.invalidateQueries({ queryKey: ["security-settings"] }); // useSecuritySettings, effective immediately
      setError(null);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  if (!form) return null;

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("securitySettings.title")}</h1>
        <p className="mt-1 text-sm text-ink-faint">{t("securitySettings.subtitle")}</p>
      </div>

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t("securitySettings.loginAttempts")}</h2>
        <p className="text-xs text-ink-faint">{t("securitySettings.loginAttemptsHint")}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("securitySettings.maxAttemptsPerAccount")}>
            <Input type="number" min={1} value={form.login_max_attempts}
              onChange={(e) => setField("login_max_attempts", e.target.value)} />
          </Field>
          <Field label={t("securitySettings.windowMinutesPerAccount")}>
            <Input type="number" min={1} value={form.login_attempt_window_minutes}
              onChange={(e) => setField("login_attempt_window_minutes", e.target.value)} />
          </Field>
          <Field label={t("securitySettings.maxAttemptsPerIp")}>
            <Input type="number" min={1} value={form.login_ip_max_attempts}
              onChange={(e) => setField("login_ip_max_attempts", e.target.value)} />
          </Field>
          <Field label={t("securitySettings.windowMinutesPerIp")}>
            <Input type="number" min={1} value={form.login_ip_window_minutes}
              onChange={(e) => setField("login_ip_window_minutes", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t("securitySettings.idleLogout")}</h2>
        <p className="text-xs text-ink-faint">{t("securitySettings.idleLogoutHint")}</p>
        <Field label={t("securitySettings.idleTimeoutMinutes")}>
          <Input type="number" min={1} className="max-w-xs" value={form.session_timeout_minutes}
            onChange={(e) => setField("session_timeout_minutes", e.target.value)} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold text-ink">{t("securitySettings.passwordPolicy")}</h2>
        <Field label={t("securitySettings.minLength")}>
          <Input type="number" min={1} className="max-w-xs" value={form.password_min_length}
            onChange={(e) => setField("password_min_length", e.target.value)} />
        </Field>
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink">{t("securitySettings.requireUppercase")}</span>
            <Toggle checked={form.password_require_uppercase} label={t("securitySettings.requireUppercase")}
              onChange={(v) => setField("password_require_uppercase", v)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink">{t("securitySettings.requireNumbers")}</span>
            <Toggle checked={form.password_require_numbers} label={t("securitySettings.requireNumbers")}
              onChange={(v) => setField("password_require_numbers", v)} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink">{t("securitySettings.requireSpecial")}</span>
            <Toggle checked={form.password_require_special} label={t("securitySettings.requireSpecial")}
              onChange={(v) => setField("password_require_special", v)} />
          </div>
        </div>
      </Card>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? t("securitySettings.saving") : t("securitySettings.save")}
        </Button>
        {savedAt && !save.isPending && (
          <span className="text-sm text-ok">{t("securitySettings.saved")}</span>
        )}
      </div>
    </div>
  );
}
