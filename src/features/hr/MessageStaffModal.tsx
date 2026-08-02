// Compose a direct message to one staff member, from their Staff Profile.
// "From" is shown read-only -- it isn't a form field, since the real sender
// is whoever is authenticated (sender_id = auth.uid(), enforced by RLS); the
// input here is purely a display convenience.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

export function MessageStaffModal({ open, onClose, recipientUserId, recipientName }: {
  open: boolean; onClose: () => void; recipientUserId: string; recipientName: string;
}) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(""); setBody(""); setError(null);
  }, [open]);

  const send = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t("messages.titleRequired"));
      if (!body.trim()) throw new Error(t("messages.bodyRequired"));
      const { error: err } = await supabase.from("messages").insert({
        tenant_id: profile!.tenant_id,
        sender_id: profile!.id,
        recipient_id: recipientUserId,
        title: title.trim(),
        body: body.trim(),
      });
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages"] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("messages.sendFailed")),
  });

  return (
    <Modal open={open} onClose={onClose} title={t("messages.composeTitle", { name: recipientName })}>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-4">
        <Field label={t("messages.from")}>
          <Input value={profile?.full_name ?? ""} disabled readOnly />
        </Field>
        <Field label={`${t("messages.titleLabel")} *`}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
        </Field>
        <Field label={`${t("messages.bodyLabel")} *`}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} rows={6}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          {send.isPending ? t("messages.sending") : t("messages.send")}
        </Button>
      </div>
    </Modal>
  );
}
