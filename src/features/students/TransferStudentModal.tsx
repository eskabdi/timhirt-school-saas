import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalErrorKey, submitApproval } from "@/features/approvals/approvals";
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

  // R6 WP-09: a transfer out is a student_transfer_out request; a second
  // person with students:approve applies it (the database refuses a direct
  // status change to 'transferred').
  const [submitted, setSubmitted] = useState(false);
  const submit = useMutation({
    mutationFn: async () => {
      if (!transferredTo.trim() || !date) return;
      await submitApproval("student_transfer_out", studentId, {
        transferred_to: transferredTo.trim(),
        transferred_reason: reason.trim() || null,
        transferred_on: toIsoDate(date),
      }, reason.trim() || null);
    },
    onSuccess: () => {
      setError(null);
      setTransferredTo(""); setReason(""); setDate(null);
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["student-profile", studentId] });
      qc.invalidateQueries({ queryKey: ["approvals-pending-count"] });
    },
    onError: (e) => setError(t(`approvals.error.${approvalErrorKey(e)}`)),
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
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <p role="status" className="text-sm text-ok">{submitted ? t("students.transfer.submittedForApproval") : ""}</p>
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
