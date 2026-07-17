// [INSA §5 PUBLIC] H-2 fix: calls the rate-limited verify-id Edge Function,
// never the verify_id_card() RPC directly — anon's execute grant on that RPC
// is revoked (migration 010) precisely so this is the only path in, and a
// scripted scanner can't enumerate verify_code values unrate-limited.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function IDVerificationPage() {
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <Card className="w-full max-w-sm text-center">
        <h1 className="mb-4 font-display text-xl font-bold text-ink">Verify ID / Certificate</h1>
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Verification code" maxLength={64} />
          <Button onClick={verify} disabled={busy || !code}>{busy ? "…" : "Check"}</Button>
        </div>
        {result && (
          <div className="mt-4 rounded-panel bg-sidebar p-4 text-sm">
            {result.valid ? (
              <p className="text-ok">✓ Valid {result.subject_type} record — {result.tenant_name}</p>
            ) : (
              <p className="text-danger">Not found or invalid code.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
