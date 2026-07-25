import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { tField } from "@/lib/i18n";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { ReportStat, ReportSection } from "./ReportComponents";

const STATUS_TONE = { pending: "neutral", partial: "late", paid: "ok", overdue: "danger" } as const;

interface Invoice { id: string; student_id: string; fee_structure_id: string; amount_due: number; amount_paid: number; status: string; }
interface StudentRow { id: string; class_id: string; }
interface ClassRow { id: string; name: string; section: string | null; }
interface FeeStructureRow { id: string; name_i18n: Record<string, string>; amount: number; billing_cycle: string; }

function fmtEtb(n: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ETB`;
}

export function FeesReportPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";

  const { data, isLoading } = useQuery({
    queryKey: ["fees-report"],
    queryFn: async () => {
      const [{ data: invoices, error: e1 }, { data: students, error: e2 }, { data: classes, error: e3 }, { data: structures, error: e4 }] =
        await Promise.all([
          supabase.from("fee_invoices").select("id, student_id, fee_structure_id, amount_due, amount_paid, status").limit(5000),
          supabase.from("students").select("id, class_id").limit(5000),
          supabase.from("classes").select("id, name, section").limit(500),
          supabase.from("fee_structures").select("id, name_i18n, amount, billing_cycle").limit(500),
        ]);
      if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4;
      return {
        invoices: (invoices ?? []) as Invoice[],
        students: (students ?? []) as StudentRow[],
        classes: (classes ?? []) as ClassRow[],
        structures: (structures ?? []) as FeeStructureRow[],
      };
    },
  });

  const perClass = useMemo(() => {
    if (!data) return [];
    const classById = new Map(data.classes.map((c) => [c.id, c]));
    const studentClass = new Map(data.students.map((s) => [s.id, s.class_id]));
    const rows = new Map<string, { due: number; paid: number; students: Set<string> }>();
    for (const inv of data.invoices) {
      const classId = studentClass.get(inv.student_id);
      if (!classId) continue;
      const row = rows.get(classId) ?? { due: 0, paid: 0, students: new Set<string>() };
      row.due += Number(inv.amount_due);
      row.paid += Number(inv.amount_paid);
      row.students.add(inv.student_id);
      rows.set(classId, row);
    }
    return Array.from(rows.entries())
      .map(([classId, row]) => {
        const cls = classById.get(classId);
        const label = cls ? `${cls.name}${cls.section ? ` - ${cls.section}` : ""}` : "—";
        const rate = row.due > 0 ? (row.paid / row.due) * 100 : 0;
        return { classId, label, due: row.due, paid: row.paid, rate, students: row.students.size };
      })
      .sort((a, b) => b.due - a.due);
  }, [data]);

  const perStructure = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, { count: number; due: number; paid: number }>();
    for (const inv of data.invoices) {
      const row = counts.get(inv.fee_structure_id) ?? { count: 0, due: 0, paid: 0 };
      row.count += 1;
      row.due += Number(inv.amount_due);
      row.paid += Number(inv.amount_paid);
      counts.set(inv.fee_structure_id, row);
    }
    return data.structures.map((s) => {
      const row = counts.get(s.id) ?? { count: 0, due: 0, paid: 0 };
      return { id: s.id, name: tField(s.name_i18n, locale) || "—", cycle: s.billing_cycle, amount: s.amount, ...row };
    }).sort((a, b) => b.due - a.due);
  }, [data, locale]);

  const statusCounts = useMemo(() => {
    const rows = new Map<string, number>();
    for (const inv of data?.invoices ?? []) rows.set(inv.status, (rows.get(inv.status) ?? 0) + 1);
    return Array.from(rows.entries());
  }, [data]);

  const totals = useMemo(() => {
    const due = (data?.invoices ?? []).reduce((s, i) => s + Number(i.amount_due), 0);
    const paid = (data?.invoices ?? []).reduce((s, i) => s + Number(i.amount_paid), 0);
    return { due, paid, rate: due > 0 ? (paid / due) * 100 : 0 };
  }, [data]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("reportPages.feesTitle")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ReportStat label={t("reportPages.totalDue")} value={isLoading ? "—" : fmtEtb(totals.due)} />
        <ReportStat label={t("reportPages.totalCollected")} value={isLoading ? "—" : fmtEtb(totals.paid)} tone="ok" />
        <ReportStat label={t("reportPages.collectionRate")} value={isLoading ? "—" : `${totals.rate.toFixed(1)}%`} tone="navy" />
        <ReportStat label={t("reportPages.classesBilled")} value={isLoading ? "—" : perClass.length} />
      </div>

      <ReportSection title={t("reportPages.paymentStatus")}>
        <div className="flex flex-wrap gap-2">
          {statusCounts.length === 0 ? (
            <p className="text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : statusCounts.map(([status, count]) => (
            <Badge key={status} tone={STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral"}>
              {status}: {count}
            </Badge>
          ))}
        </div>
      </ReportSection>

      <Panel>
        <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.collectionByClass")}</h2></div>
        {!perClass.length ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-5 py-2">{t("common.class")}</th><th className="px-5 py-2">{t("reportPages.students")}</th><th className="px-5 py-2">{t("common.due")}</th><th className="px-5 py-2">{t("reportPages.collected")}</th><th className="px-5 py-2">{t("reportPages.rate")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perClass.map((row) => (
                <tr key={row.classId} className="hover:bg-sidebar">
                  <td className="px-5 py-3 font-medium text-ink">{row.label}</td>
                  <td className="px-5 py-3 text-ink-soft">{row.students}</td>
                  <td className="px-5 py-3 text-ink-soft">{fmtEtb(row.due)}</td>
                  <td className="px-5 py-3 text-ok">{fmtEtb(row.paid)}</td>
                  <td className="px-5 py-3 text-ink-soft">{row.rate.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel>
        <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.byFeeStructure")}</h2></div>
        {!perStructure.length ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-5 py-2">{t("common.name")}</th><th className="px-5 py-2">{t("reportPages.cycle")}</th><th className="px-5 py-2">{t("fees.amount")}</th><th className="px-5 py-2">{t("reportPages.invoices")}</th><th className="px-5 py-2">{t("reportPages.collected")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perStructure.map((row) => (
                <tr key={row.id} className="hover:bg-sidebar">
                  <td className="px-5 py-3 font-medium text-ink">{row.name}</td>
                  <td className="px-5 py-3 capitalize text-ink-soft">{row.cycle}</td>
                  <td className="px-5 py-3 text-ink-soft">{fmtEtb(row.amount)}</td>
                  <td className="px-5 py-3 text-ink-soft">{row.count}</td>
                  <td className="px-5 py-3 text-ok">{fmtEtb(row.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
