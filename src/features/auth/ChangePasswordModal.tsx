import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

const schema = z.object({
  password: z.string().min(8).max(200),
  confirm: z.string(),
});

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

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
    setSuccess(true);
    setTimeout(onClose, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-panel border border-line bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">{t("auth.changePassword.title")}</h2>
          <button type="button" aria-label={t("auth.changePassword.close")} onClick={onClose} className="text-ink-faint hover:text-ink">✕</button>
        </div>
        {success ? (
          <p className="text-sm text-ok">{t("auth.changePassword.success")}</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label={t("auth.acceptInvite.newPassword")}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} required autoFocus />
            </Field>
            <Field label={t("auth.acceptInvite.confirmPassword")}>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} required />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={busy || !password || !confirm} className="w-full">
              {busy ? t("auth.changePassword.submitting") : t("auth.changePassword.submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
