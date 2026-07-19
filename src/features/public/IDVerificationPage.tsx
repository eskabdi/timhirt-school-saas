// [INSA §5 PUBLIC] H-2 fix: calls the rate-limited verify-id Edge Function,
// never the verify_id_card() RPC directly — anon's execute grant on that RPC
// is revoked (migration 010) precisely so this is the only path in, and a
// scripted scanner can't enumerate verify_code values unrate-limited.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function IDVerificationPage() {
  const { t } = useTranslation();
  const params = useParams();
  const [code, setCode] = useState(params.code ?? "");
  const [result, setResult] = useState<{ valid: boolean; subject_type?: string; issued_on?: string; tenant_name?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      setResult(res.ok ? await res.json() : { valid: false });
    } catch {
      setResult({ valid: false });
    } finally {
      setBusy(false);
    }
  };

  // Arriving via a scanned QR code (id card back, issue-id-card) means the
  // code is already known — verify immediately instead of making them tap
  // the button on a card they just scanned.
  useEffect(() => {
    if (params.code) verify();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-4 font-display text-xl font-bold text-ink">{t("idCards.verifyTitle")}</h1>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("idCards.verifyPlaceholder")} maxLength={64} />
          <Button onClick={verify} disabled={busy || !code}>{busy ? "…" : t("idCards.check")}</Button>
        </div>
        {result && (
          <div className="mt-4 rounded-panel bg-sidebar p-4 text-sm">
            {result.valid ? (
              <p className="text-ok">
                {t("idCards.validRecord", {
                  type: t(`idCards.subjectType.${result.subject_type}`),
                  tenant: result.tenant_name,
                })}
              </p>
            ) : (
              <p className="text-danger">{t("idCards.notFound")}</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
