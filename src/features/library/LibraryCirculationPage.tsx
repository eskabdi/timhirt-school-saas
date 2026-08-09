import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { FieldGroup } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import {
  findCopyByBarcode, searchStudents, checkoutCopy, listActiveCheckouts, returnCheckout, renewCheckout,
  listHolds, cancelHold, listPendingFines, markFinePaid, waiveFine, scanOverdue,
  type StudentOption,
} from "./libraryApi";

// Ethiopia is a single fixed UTC+3 offset year-round (no DST) -- same
// reasoning as todayLocal() in the Edge Function, kept local to this file
// since it's the only frontend page that needs "is this due date already
// past, right now" rather than a stored/derived server value.
function today(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function LibraryCirculationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [barcode, setBarcode] = useState("");
  const [copy, setCopy] = useState<Awaited<ReturnType<typeof findCopyByBarcode>>>(null);
  const [studentTerm, setStudentTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<StudentOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const { data: studentResults } = useQuery({
    queryKey: ["library-student-search", studentTerm],
    queryFn: () => searchStudents(studentTerm),
    enabled: studentTerm.trim().length >= 2 && !selectedStudent,
  });
  const { data: checkouts } = useQuery({ queryKey: ["library-active-checkouts"], queryFn: listActiveCheckouts });
  const { data: holds } = useQuery({ queryKey: ["library-holds"], queryFn: listHolds });
  const { data: fines } = useQuery({ queryKey: ["library-fines"], queryFn: listPendingFines });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["library-active-checkouts"] });
    qc.invalidateQueries({ queryKey: ["library-holds"] });
    qc.invalidateQueries({ queryKey: ["library-fines"] });
    qc.invalidateQueries({ queryKey: ["library-copy-counts"] });
  };

  const lookup = useMutation({
    mutationFn: () => findCopyByBarcode(barcode),
    onSuccess: (found) => {
      setCopy(found);
      setError(found ? null : t("library.copyNotFound"));
    },
  });

  const checkout = useMutation({
    mutationFn: () => checkoutCopy(copy!.id, selectedStudent!.id, "lending"),
    onSuccess: () => {
      invalidateAll();
      setBarcode(""); setCopy(null); setStudentTerm(""); setSelectedStudent(null); setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? t(`library.error.${e.message}`, e.message) : "Checkout failed"),
  });

  const doReturn = useMutation({
    mutationFn: (checkoutId: string) => returnCheckout(checkoutId),
    onSuccess: () => invalidateAll(),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Return failed"),
  });
  const doRenew = useMutation({
    mutationFn: (checkoutId: string) => renewCheckout(checkoutId),
    onSuccess: () => invalidateAll(),
    onError: (e: unknown) => setError(e instanceof Error ? t(`library.error.${e.message}`, e.message) : "Renew failed"),
  });
  const doCancelHold = useMutation({
    mutationFn: (holdId: string) => cancelHold(holdId),
    onSuccess: () => invalidateAll(),
  });
  const doMarkPaid = useMutation({
    mutationFn: (fineId: string) => markFinePaid(fineId),
    onSuccess: () => invalidateAll(),
  });
  const doWaive = useMutation({
    mutationFn: (fineId: string) => waiveFine(fineId, window.prompt(t("library.waive")) ?? ""),
    onSuccess: () => invalidateAll(),
  });
  const doScanOverdue = useMutation({
    mutationFn: () => scanOverdue(),
    onSuccess: (res) => {
      invalidateAll();
      setScanResult(t("library.overdueRemindersSent", { count: res.notified_count }));
    },
  });

  const todayStr = today();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink">{t("library.circulation")}</h1>
        <Button variant="ghost" className="border border-line" onClick={() => doScanOverdue.mutate()} disabled={doScanOverdue.isPending}>
          {t("library.sendOverdueReminders")}
        </Button>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}
      {scanResult && <Card className="border border-line py-3 text-sm text-ink">{scanResult}</Card>}

      <Card className="space-y-4 p-5">
        <h2 className="font-display text-lg font-bold text-ink">{t("library.checkoutDesk")}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldGroup label={t("library.barcode")}>
            <div className="flex gap-2">
              <Input
                autoFocus value={barcode}
                onChange={(e) => { setBarcode(e.target.value); setCopy(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && barcode.trim()) lookup.mutate(); }}
              />
              <Button type="button" onClick={() => lookup.mutate()} disabled={!barcode.trim() || lookup.isPending}>{t("library.lookUp")}</Button>
            </div>
            {copy && (
              <p className="mt-1 text-xs text-ink-soft">
                {copy.book?.title} — <Badge tone={copy.status === "available" ? "ok" : "danger"}>{t(`library.copyStatus.${copy.status}`)}</Badge>
              </p>
            )}
          </FieldGroup>
          <FieldGroup label={t("students.search")}>
            <Input
              value={selectedStudent ? `${selectedStudent.first_name} ${selectedStudent.last_name} (${selectedStudent.admission_no})` : studentTerm}
              onChange={(e) => { setStudentTerm(e.target.value); setSelectedStudent(null); }}
              placeholder={t("students.search")}
            />
            {!selectedStudent && (studentResults?.length ?? 0) > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-control border border-line bg-card">
                {studentResults!.map((s) => (
                  <button key={s.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-sidebar"
                    onClick={() => { setSelectedStudent(s); setStudentTerm(""); }}>
                    {s.first_name} {s.last_name} — {s.admission_no}
                  </button>
                ))}
              </div>
            )}
          </FieldGroup>
        </div>
        <Button
          onClick={() => checkout.mutate()}
          disabled={!copy || copy.status !== "available" || !selectedStudent || checkout.isPending}
        >
          {t("library.checkoutDesk")}
        </Button>
      </Card>

      <Panel>
        <PanelHeader title={t("library.circulation")} />
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-5 py-3">{t("students.search")}</th>
              <th className="px-5 py-3">{t("library.title")}</th>
              <th className="px-5 py-3">{t("library.dueOn")}</th>
              <th className="px-5 py-3">{t("students.status")}</th>
              <th className="px-5 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(checkouts ?? []).map((c) => {
              const overdue = c.due_on < todayStr;
              return (
                <tr key={c.id} className="hover:bg-sidebar">
                  <td className="px-5 py-3 text-ink">{c.student ? `${c.student.first_name} ${c.student.last_name}` : "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{c.copy?.book?.title ?? "—"} <span className="text-xs text-ink-faint">({c.copy?.barcode})</span></td>
                  <td className="px-5 py-3"><EthDate value={c.due_on} /></td>
                  <td className="px-5 py-3">
                    <div className="flex gap-1.5">
                      <Badge tone={c.checkout_type === "rental" ? "navy" : "neutral"}>{t(`library.${c.checkout_type}`)}</Badge>
                      {overdue && <Badge tone="danger">{t("library.overdue")}</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-3 text-xs">
                      {c.checkout_type === "lending" && (
                        <button type="button" className="font-medium text-navy hover:underline" onClick={() => doRenew.mutate(c.id)}>{t("library.renew")}</button>
                      )}
                      <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => doReturn.mutate(c.id)}>{t("library.return")}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(checkouts ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-faint">{t("library.noBooks")}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <PanelHeader title={t("library.holdsQueue")} />
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-5 py-3">{t("library.title")}</th>
              <th className="px-5 py-3">{t("students.search")}</th>
              <th className="px-5 py-3">{t("students.status")}</th>
              <th className="px-5 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(holds ?? []).map((h) => (
              <tr key={h.id} className="hover:bg-sidebar">
                <td className="px-5 py-3 text-ink">{h.book?.title ?? "—"}</td>
                <td className="px-5 py-3 text-ink-soft">{h.student ? `${h.student.first_name} ${h.student.last_name}` : "—"}</td>
                <td className="px-5 py-3"><Badge tone={h.status === "ready" ? "ok" : "neutral"}>{t(`library.holdStatus.${h.status}`)}</Badge></td>
                <td className="px-5 py-3 text-right">
                  <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => doCancelHold.mutate(h.id)}>{t("crud.cancel")}</button>
                </td>
              </tr>
            ))}
            {(holds ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-ink-faint">{t("library.noBooks")}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel>
        <PanelHeader title={t("library.fines")} />
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-5 py-3">{t("students.search")}</th>
              <th className="px-5 py-3">{t("library.title")}</th>
              <th className="px-5 py-3">{t("fees.amount")}</th>
              <th className="px-5 py-3 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(fines ?? []).map((f) => (
              <tr key={f.id} className="hover:bg-sidebar">
                <td className="px-5 py-3 text-ink">{f.checkout?.student ? `${f.checkout.student.first_name} ${f.checkout.student.last_name}` : "—"}</td>
                <td className="px-5 py-3 text-ink-soft">{f.checkout?.copy?.book?.title ?? "—"}</td>
                <td className="px-5 py-3 text-ink">ETB {Number(f.amount).toFixed(2)}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-3 text-xs">
                    <button type="button" className="font-medium text-navy hover:underline" onClick={() => doMarkPaid.mutate(f.id)}>{t("library.markPaid")}</button>
                    <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => doWaive.mutate(f.id)}>{t("library.waive")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {(fines ?? []).length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-ink-faint">{t("library.noBooks")}</td></tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
