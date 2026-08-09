// ============================================================================
// Public application status lookup, paired with the /apply stepper. An
// applicant enters just the tracking code they were given at submission
// (no account, no session) and sees where their application stands —
// backed by check-admission-status, which returns only name/grade/stage/
// date, never guardian, document, or payment details.
// ============================================================================
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { EthDate } from "@/components/EthDate";

const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
  incomplete_application: "late", provisionally_accepted: "navy", accepted: "ok",
  waitlisted: "late", enrolled: "ok",
} as const;

interface StatusResult {
  found: boolean;
  applicant_name?: string;
  grade?: string | null;
  stage?: keyof typeof STAGE_TONE;
  submitted_on?: string;
  id_card_url?: string | null;
  invoice_url?: string | null;
  receipt_url?: string | null;
}

export function AdmissionStatusPage() {
  const { tenantSlug } = useParams();
  const { t } = useTranslation(["apply", "common"]);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<StatusResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-admission-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_slug: tenantSlug, tracking_code: code }),
      });
      if (!res.ok) throw new Error("failed");
      setResult((await res.json()) as StatusResult);
    } catch {
      setError(t("status.checkFailed"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-page">
      <header className="flex items-center justify-between bg-gradient-to-r from-navy to-navy-container px-6 py-4">
        <span className="font-display text-lg font-bold text-white">{t("schoolFallback")}</span>
        <LanguageSwitcher variant="dark" />
      </header>

      <div className="mx-auto max-w-md px-4 py-10">
        <Card>
          <h1 className="font-display text-xl font-bold text-ink">{t("status.title")}</h1>
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            <Field label={t("status.codeLabel")}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t("status.codePlaceholder")}
                maxLength={20}
                autoFocus
                required
              />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={checking || !code} className="w-full">
              {checking ? t("status.checking") : t("status.submit")}
            </Button>
          </form>

          {result && (
            result.found ? (
              <div className="mt-6 space-y-3 border-t border-line pt-4">
                {result.stage === "enrolled" && (
                  <div className="rounded-control border-2 border-ok bg-ok-tint/40 p-4 text-center">
                    <p className="font-display text-lg font-bold text-ok">{t("status.congratulations")}</p>
                    <p className="mt-1 text-sm text-ink">{t("status.congratulationsBody", { name: result.applicant_name })}</p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {result.id_card_url ? (
                        <a href={result.id_card_url} target="_blank" rel="noreferrer"
                          className="inline-block rounded-control bg-ok px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                          {t("status.downloadIdCard")}
                        </a>
                      ) : (
                        <p className="text-xs text-ink-faint">{t("status.idCardPending")}</p>
                      )}
                      {result.invoice_url && (
                        <a href={result.invoice_url} target="_blank" rel="noreferrer"
                          className="inline-block rounded-control border border-ok px-4 py-2 text-sm font-semibold text-ok hover:bg-ok-tint/40">
                          {t("status.downloadInvoice")}
                        </a>
                      )}
                      {result.receipt_url && (
                        <a href={result.receipt_url} target="_blank" rel="noreferrer"
                          className="inline-block rounded-control border border-ok px-4 py-2 text-sm font-semibold text-ok hover:bg-ok-tint/40">
                          {t("status.downloadReceipt")}
                        </a>
                      )}
                      {!result.invoice_url && !result.receipt_url && (
                        <p className="text-xs text-ink-faint">{t("status.feeDocsPending")}</p>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{result.applicant_name}</p>
                  {result.stage && <Badge tone={STAGE_TONE[result.stage] ?? "neutral"}>{t(`common:admissions.stage.${result.stage}`)}</Badge>}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-ink-faint">{t("status.grade")}</dt><dd className="text-ink">{result.grade ?? "—"}</dd></div>
                  <div><dt className="text-ink-faint">{t("status.submitted")}</dt><dd className="text-ink">{result.submitted_on && <EthDate value={result.submitted_on} />}</dd></div>
                </dl>
              </div>
            ) : (
              <p className="mt-6 border-t border-line pt-4 text-sm text-ink-faint">{t("status.notFound")}</p>
            )
          )}

          <Link to={`/apply/${tenantSlug}`} className="mt-6 block text-sm text-navy hover:underline">{t("status.backToApply")}</Link>
        </Card>
      </div>
    </div>
  );
}
