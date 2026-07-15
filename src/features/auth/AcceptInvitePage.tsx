// Landing page for the invite-tenant-admin / onboard-tenant email link.
// Supabase's client auto-parses the access_token/refresh_token out of the
// URL hash the invite link lands on (detectSessionInUrl, default true) and
// establishes a session before this page needs it -- but that's a real
// account with no password set yet, so it can't sign in again later without
// one. This page is the only place that ever calls updateUser({ password }).
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const schema = z.object({
  password: z.string().min(8).max(200),
  confirm: z.string(),
});

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) { setError(t("auth.acceptInvite.tooShort")); return; }
    if (password !== confirm) { setError(t("auth.acceptInvite.mismatch")); return; }
    setBusy(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateErr) { setError(updateErr.message); return; }
    nav("/", { replace: true });
  };

  if (hasSession === null) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-chalk px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-sm rounded-card border border-line bg-chalk-raised p-8">
        <h1 className="mb-1 font-display text-2xl font-bold">{t("auth.acceptInvite.title")}</h1>
        {!hasSession ? (
          <p className="mt-4 text-sm text-danger">{t("auth.acceptInvite.invalidLink")}</p>
        ) : (
          <>
            <p className="mb-6 text-sm text-ink-faint">{t("auth.acceptInvite.subtitle")}</p>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <Field label={t("auth.acceptInvite.newPassword")}>
                <Input type="password" autoComplete="new-password" required minLength={8} maxLength={200}
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field label={t("auth.acceptInvite.confirmPassword")}>
                <Input type="password" autoComplete="new-password" required minLength={8} maxLength={200}
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full justify-center">
                {busy ? t("auth.acceptInvite.submitting") : t("auth.acceptInvite.submit")}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
