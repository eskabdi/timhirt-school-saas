import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";

export function TransferStudentModal({ studentId, open, onClose }: {
  studentId: string; open: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [transferredTo, setTransferredTo] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      if (!transferredTo.trim() || !date) return;
      const { error: err } = await supabase.from("students").update({
        status: "transferred",
        transferred_to: transferredTo.trim(),
        transferred_reason: reason.trim() || null,
        transferred_on: toIsoDate(date),
      }).eq("id", studentId);
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setTransferredTo(""); setReason(""); setDate(null);
      qc.invalidateQueries({ queryKey: ["student-profile", studentId] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Modal open={open} onClose={onClose} title={t("students.transfer.title")}>
      <div className="space-y-3">
        <p className="text-sm text-ink-faint">{t("students.transfer.subtitle")}</p>
        <Field label={t("students.transfer.transferredTo")}>
          <Input value={transferredTo} onChange={(e) => setTransferredTo(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t("students.transfer.date")}><EthDatePicker value={date} onChange={setDate} /></Field>
        <Field label={t("students.transfer.reason")}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="tertiary" onClick={onClose}>{t("students.cancel")}</Button>
          <Button variant="danger" onClick={() => submit.mutate()} disabled={!transferredTo.trim() || !date || submit.isPending}>
            {submit.isPending ? t("students.transfer.submitting") : t("students.transfer.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
