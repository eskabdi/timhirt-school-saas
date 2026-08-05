import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const idleNotice = searchParams.get("reason") === "idle";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Ticks the countdown shown while locked out; the effect below clears the
  // lock itself once `now` passes `lockedUntil`, so this only needs to run
  // while a lock is active.
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  useEffect(() => {
    if (lockedUntil && now >= lockedUntil) setLockedUntil(null);
  }, [now, lockedUntil]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { setError(t("auth.invalid")); return; }
    setBusy(true);

    // Server-side gate before every attempt -- consumes a token from the
    // same Postgres-backed limiter submit-admission/verify-id use, keyed by
    // both the account and the caller's IP (check-login-attempt). Client-side
    // throttling alone is not a control: it is bypassed by calling the SDK
    // directly, so this call has to happen and has to be trusted over
    // whatever the UI already decided.
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-login-attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: parsed.data.email }),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const retrySeconds = typeof body.retry_after_seconds === "number" ? body.retry_after_seconds : 900;
        setLockedUntil(Date.now() + retrySeconds * 1000);
        setBusy(false);
        return;
      }
      if (!res.ok) { setError(t("auth.invalid")); setBusy(false); return; }
    } catch {
      // Limiter unreachable: fail open on the throttle itself (not a security
      // control worth taking the whole login page down for) and fall through
      // to the real sign-in, which still enforces credentials correctly.
    }

    const { error: authErr } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (authErr) { setError(t("auth.invalid")); return; }
    nav("/", { replace: true });
  };

  const lockedSecondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;
  const lockedMinutes = Math.floor(lockedSecondsLeft / 60);
  const lockedSeconds = lockedSecondsLeft % 60;

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-sm rounded-panel border border-line bg-card p-8 shadow-lg">
        <h1 className="mb-1 font-display text-2xl font-bold text-navy">{t("app.name")}</h1>
        <p className="mb-6 text-sm text-ink-faint">{t("app.tagline")}</p>
        {idleNotice && (
          <p role="status" className="mb-4 rounded-control border border-line bg-page px-3 py-2 text-sm text-ink-faint">
            {t("auth.idleLoggedOut")}
          </p>
        )}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t("auth.email")}>
            <Input type="email" autoComplete="username" required maxLength={254} disabled={!!lockedUntil}
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("auth.password")}>
            <Input type="password" autoComplete="current-password" required maxLength={200} disabled={!!lockedUntil}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {lockedUntil && (
            <p role="alert" className="text-sm text-danger">
              {t("auth.tooManyAttempts", { minutes: lockedMinutes, seconds: String(lockedSeconds).padStart(2, "0") })}
            </p>
          )}
          <Button type="submit" disabled={busy || !!lockedUntil} className="w-full justify-center">
            {busy ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      </div>
    </div>
  );
}
