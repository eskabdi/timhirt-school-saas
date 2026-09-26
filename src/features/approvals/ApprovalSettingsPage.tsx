import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantSettings } from "@/features/settings/useCalendarPrefs";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { approvalErrorKey } from "./approvals";

export interface ApprovalSettings { manualPaymentEnabled: boolean; thresholdEtb: number }

/** settings.approvals → form values; anything malformed reads as the safe default (approval on, threshold 0). */
export function parseApprovalSettings(raw: unknown): ApprovalSettings {
  const a = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const actions = a.actions && typeof a.actions === "object" && !Array.isArray(a.actions) ? (a.actions as Record<string, unknown>) : {};
  const threshold = typeof a.manual_payment_threshold_etb === "number" && a.manual_payment_threshold_etb >= 0 ? a.manual_payment_threshold_etb : 0;
  return { manualPaymentEnabled: actions.manual_payment_accept !== false, thresholdEtb: threshold };
}

// R6 WP-09: the tenant's maker-checker rules. Only manual-payment approval can
// be switched off or given a threshold; invoice voids, grade changes after
// publication and transfers out are platform minimums and always need a
// second person. Saved through set_approval_settings, which merges only
// settings.approvals on the server.
export function ApprovalSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings, isSuccess, isError } = useTenantSettings();
  const [form, setForm] = useState<ApprovalSettings>({ manualPaymentEnabled: true, thresholdEtb: 0 });
  const [threshold, setThreshold] = useState("0");

  useEffect(() => {
    if (!isSuccess) return;
    const parsed = parseApprovalSettings((settings as Record<string, unknown> | null)?.approvals);
    setForm(parsed);
    setThreshold(String(parsed.thresholdEtb));
  }, [isSuccess, settings]);

  const thresholdValue = Number(threshold);
  const thresholdValid = threshold.trim() !== "" && Number.isFinite(thresholdValue) && thresholdValue >= 0 && thresholdValue <= 10_000_000;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_approval_settings", {
        p_manual_payment_enabled: form.manualPaymentEnabled, p_manual_payment_threshold_etb: thresholdValue,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-config"] }),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("approvals.settings.title")}</h1>
        <p className="text-sm text-ink-soft">{t("approvals.settings.subtitle")}</p>
      </div>
      {isError && <p role="alert" className="text-sm text-danger">{t("approvals.settings.loadFailed")}</p>}
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">{t("approvals.settings.manualPayments")}</span>
            <Toggle checked={form.manualPaymentEnabled} disabled={!isSuccess}
              onChange={(v) => { save.reset(); setForm((f) => ({ ...f, manualPaymentEnabled: v })); }}
              label={t("approvals.settings.manualPayments")} />
          </div>
          <Field label={t("approvals.settings.threshold")} hint={t("approvals.settings.thresholdHint")}
            error={thresholdValid ? undefined : t("approvals.settings.thresholdInvalid")}>
            <Input inputMode="decimal" value={threshold} disabled={!isSuccess || !form.manualPaymentEnabled}
              onChange={(e) => { save.reset(); setThreshold(e.target.value); }} />
          </Field>
          <div>
            <h2 className="text-sm font-semibold text-ink">{t("approvals.settings.alwaysTitle")}</h2>
            <ul className="mt-1 list-disc pl-5 text-sm text-ink-soft">
              <li>{t("approvals.action.invoice_void")}</li>
              <li>{t("approvals.action.grade_edit_after_publish")}</li>
              <li>{t("approvals.action.student_transfer_out")}</li>
            </ul>
          </div>
          <Button onClick={() => save.mutate()} disabled={!isSuccess || !thresholdValid || save.isPending}>
            {t("approvals.settings.save")}
          </Button>
          <p role="status" className="text-sm text-ok">{save.isSuccess ? t("approvals.settings.saved") : ""}</p>
          {save.isError && <p role="alert" className="text-sm text-danger">{t(`approvals.error.${approvalErrorKey(save.error)}`)}</p>}
        </div>
      </Card>
    </div>
  );
}
