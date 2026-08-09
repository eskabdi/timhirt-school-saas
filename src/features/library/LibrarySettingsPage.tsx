import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { getSettings, saveSettings, type LibrarySettingsRow } from "./libraryApi";

interface FormState {
  loanDaysDefault: string;
  maxRenewals: string;
  finePerDay: string;
  holdExpiryDays: string;
  maxActiveCheckouts: string;
}

export function LibrarySettingsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const tenantId = profile!.tenant_id!;

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const { data: row } = useQuery({ queryKey: ["library-settings", tenantId], queryFn: () => getSettings(tenantId) });

  // `row` is `undefined` while the query is in flight and only becomes
  // `null | LibrarySettingsRow` once it settles -- hydrating on that
  // settled value (not a hardcoded placeholder set before the fetch
  // resolves) is what lets the *real* saved settings ever reach the form.
  // Setting form to defaults immediately on mount, guarded only by
  // `if (form) return`, would let that placeholder win the race and the
  // real row would never overwrite it once it arrived.
  useEffect(() => {
    if (row === undefined || form) return;
    setForm({
      loanDaysDefault: String(row?.loan_days_default ?? 14),
      maxRenewals: String(row?.max_renewals ?? 1),
      finePerDay: String(row?.fine_per_day ?? 0),
      holdExpiryDays: String(row?.hold_expiry_days ?? 3),
      maxActiveCheckouts: String(row?.max_active_checkouts ?? 3),
    });
  }, [row, form]);

  const save = useMutation({
    mutationFn: () => {
      const input: LibrarySettingsRow = {
        loan_days_default: Number(form!.loanDaysDefault),
        max_renewals: Number(form!.maxRenewals),
        fine_per_day: Number(form!.finePerDay),
        hold_expiry_days: Number(form!.holdExpiryDays),
        max_active_checkouts: Number(form!.maxActiveCheckouts),
      };
      for (const v of Object.values(input)) {
        if (!Number.isFinite(v) || v < 0) throw new Error(t("securitySettings.invalidNumber"));
      }
      return saveSettings(tenantId, input);
    },
    onSuccess: () => {
      setSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ["library-settings", tenantId] });
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to save settings"),
  });

  if (!form) return null;

  const setField = (key: keyof FormState) => (value: string) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("library.settings.title")}</h1>
        <p className="text-sm text-ink-faint">{t("library.settings.subtitle")}</p>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}
      {savedAt && !error && <Card className="border border-ok bg-ok-tint py-3 text-sm text-ok">{t("library.settings.saved")}</Card>}

      <Card className="space-y-4 p-5">
        <Field label={t("library.settings.loanDaysDefault")}>
          <Input type="number" min={1} value={form.loanDaysDefault} onChange={(e) => setField("loanDaysDefault")(e.target.value)} />
        </Field>
        <Field label={t("library.settings.maxRenewals")}>
          <Input type="number" min={0} value={form.maxRenewals} onChange={(e) => setField("maxRenewals")(e.target.value)} />
        </Field>
        <Field label={t("library.settings.finePerDay")}>
          <Input type="number" min={0} step="0.01" value={form.finePerDay} onChange={(e) => setField("finePerDay")(e.target.value)} />
        </Field>
        <Field label={t("library.settings.holdExpiryDays")}>
          <Input type="number" min={1} value={form.holdExpiryDays} onChange={(e) => setField("holdExpiryDays")(e.target.value)} />
        </Field>
        <Field label={t("library.settings.maxActiveCheckouts")}>
          <Input type="number" min={1} value={form.maxActiveCheckouts} onChange={(e) => setField("maxActiveCheckouts")(e.target.value)} />
        </Field>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("crud.save")}</Button>
      </Card>
    </div>
  );
}
