import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) { setError(t("auth.invalid")); return; }
    setBusy(true);
    const { error: authErr } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (authErr) { setError(t("auth.invalid")); return; }
    nav("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="absolute right-4 top-4"><LanguageSwitcher /></div>
      <div className="w-full max-w-sm rounded-panel border border-line bg-card p-8 shadow-lg">
        <h1 className="mb-1 font-display text-2xl font-bold text-navy">{t("app.name")}</h1>
        <p className="mb-6 text-sm text-ink-faint">{t("app.tagline")}</p>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label={t("auth.email")}>
            <Input type="email" autoComplete="username" required maxLength={254}
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t("auth.password")}>
            <Input type="password" autoComplete="current-password" required maxLength={200}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? t("auth.signingIn") : t("auth.signIn")}
          </Button>
        </form>
      </div>
    </div>
  );
}
