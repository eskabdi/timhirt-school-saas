// Real page, not a thin re-export -- the content (grouped by checkout_type,
// multi-child aware) genuinely differs from any admin page. Relies entirely
// on RLS (library_checkouts_select / library_holds_select / library_fines_select,
// migration 20260813000002) rather than an explicit student_id filter: a
// parent with several children at the school sees every child's rows in one
// list, the same reads a librarian would run tenant-wide just narrow
// themselves to "my own / my children's" rows under a student/parent caller.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { listActiveCheckouts, listHolds, listPendingFines } from "@/features/library/libraryApi";

function today(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function StudentLibraryPage() {
  const { t } = useTranslation();
  const { data: checkouts } = useQuery({ queryKey: ["portal-library-checkouts"], queryFn: listActiveCheckouts });
  const { data: holds } = useQuery({ queryKey: ["portal-library-holds"], queryFn: listHolds });
  const { data: fines } = useQuery({ queryKey: ["portal-library-fines"], queryFn: listPendingFines });

  const rentals = (checkouts ?? []).filter((c) => c.checkout_type === "rental");
  const lendings = (checkouts ?? []).filter((c) => c.checkout_type === "lending");
  const todayStr = today();

  const studentName = (s: { first_name: string; last_name: string } | null) => s ? `${s.first_name} ${s.last_name}` : "—";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("library.myLibrary")}</h1>

      <Panel>
        <PanelHeader title={t("library.thisYearsTextbooks")} />
        {rentals.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-faint">{t("library.noBooks")}</p>
        ) : (
          <div className="divide-y divide-line">
            {rentals.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{c.copy?.book?.title ?? "—"}</p>
                  <p className="text-xs text-ink-faint">{studentName(c.student)}</p>
                </div>
                <span className="text-ink-faint">{t("library.dueOn")}: <EthDate value={c.due_on} /></span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHeader title={t("library.currentlyBorrowed")} />
        {lendings.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-faint">{t("library.noBooks")}</p>
        ) : (
          <div className="divide-y divide-line">
            {lendings.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{c.copy?.book?.title ?? "—"}</p>
                  <p className="text-xs text-ink-faint">{studentName(c.student)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {c.due_on < todayStr && <Badge tone="danger">{t("library.overdue")}</Badge>}
                  <span className="text-ink-faint">{t("library.dueOn")}: <EthDate value={c.due_on} /></span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {(holds ?? []).length > 0 && (
        <Panel>
          <PanelHeader title={t("library.holdsQueue")} />
          <div className="divide-y divide-line">
            {holds!.map((h) => (
              <div key={h.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink">{h.book?.title ?? "—"}</p>
                  <p className="text-xs text-ink-faint">{studentName(h.student)}</p>
                </div>
                <Badge tone={h.status === "ready" ? "ok" : "neutral"}>{t(`library.holdStatus.${h.status}`)}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {(fines ?? []).length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="font-display text-lg font-bold text-ink">{t("library.outstandingFines")}</h2>
          {fines!.map((f) => (
            <div key={f.id} className="flex items-center justify-between text-sm">
              <span className="text-ink-soft">
                {f.checkout?.copy?.book?.title ?? "—"} — {studentName(f.checkout?.student ?? null)}
              </span>
              <span className="font-medium text-danger">ETB {Number(f.amount).toFixed(2)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
