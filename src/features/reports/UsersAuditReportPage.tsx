import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { ReportStat, ReportSection } from "./ReportComponents";

const ACTION_TONE = { insert: "ok", update: "navy", delete: "danger" } as const;
const ROLE_LABEL: Record<string, string> = {
  school_admin: "School Admin", teacher: "Teacher", hr_officer: "HR Officer",
  accountant: "Accountant", registrar: "Registrar", librarian: "Librarian", student: "Student", parent: "Parent",
};

interface UserRow { id: string; role: string; created_at: string; }
interface AuditLog { id: number; action: string; table_name: string; actor_id: string | null; created_at: string; }

export function UsersAuditReportPage() {
  const { t } = useTranslation();
  const [rolePage, setRolePage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["users-audit-report"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const [{ data: users, error: e1 }, { data: logs, error: e2 }] = await Promise.all([
        supabase.from("users").select("id, role, created_at").limit(5000),
        supabase.from("audit_logs").select("id, action, table_name, actor_id, created_at")
          .gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(1000),
      ]);
      if (e1) throw e1; if (e2) throw e2;
      return { users: (users ?? []) as UserRow[], logs: (logs ?? []) as AuditLog[] };
    },
  });

  const { data: actorNames } = useQuery({
    queryKey: ["users-audit-report", "actors"],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, full_name");
      return new Map((data ?? []).map((u) => [u.id, u.full_name]));
    },
  });

  const byRole = useMemo(() => {
    const rows = new Map<string, number>();
    for (const u of data?.users ?? []) rows.set(u.role, (rows.get(u.role) ?? 0) + 1);
    return Array.from(rows.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const byTable = useMemo(() => {
    const rows = new Map<string, number>();
    for (const l of data?.logs ?? []) rows.set(l.table_name, (rows.get(l.table_name) ?? 0) + 1);
    return Array.from(rows.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [data]);

  const byAction = useMemo(() => {
    const rows = new Map<string, number>();
    for (const l of data?.logs ?? []) rows.set(l.action, (rows.get(l.action) ?? 0) + 1);
    return Array.from(rows.entries());
  }, [data]);

  const recent = data?.logs.slice(0, 15) ?? [];

  // Slicing here only affects what's rendered — byRole (and the stat cards
  // above, sourced from the full data.users/data.logs arrays) keeps
  // reporting the complete totals.
  const [roleFrom, roleTo] = pageRange(rolePage);
  const visibleByRole = byRole.slice(roleFrom, roleTo + 1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("reportPages.usersAuditTitle")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ReportStat label={t("reportPages.totalUsers")} value={isLoading ? "—" : (data?.users.length ?? 0)} />
        <ReportStat label={t("reportPages.changes30d")} value={isLoading ? "—" : (data?.logs.length ?? 0)} tone="navy" />
        {byAction.map(([action, count]) => (
          <ReportStat key={action} label={`${action.toUpperCase()} ${t("reportPages.eventsSuffix")}`} value={count} tone={ACTION_TONE[action as keyof typeof ACTION_TONE]} />
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.usersByRole")}</h2></div>
          {!byRole.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {visibleByRole.map(([role, count]) => (
                  <tr key={role}>
                    <td className="px-5 py-3 text-ink-soft">{ROLE_LABEL[role] ?? role}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={rolePage} totalCount={byRole.length} onPageChange={setRolePage} className="px-5" />
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.mostChangedTables")}</h2></div>
          {!byTable.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {byTable.map(([tableName, count]) => (
                  <tr key={tableName}>
                    <td className="px-5 py-3 font-mono text-xs text-ink-soft">{tableName}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <ReportSection title={t("reportPages.recentActivity")} action={<Link to="/settings/audit-logs" className="text-sm font-medium text-navy hover:underline">{t("reportPages.viewFullAuditLog")}</Link>}>
        {!recent.length ? (
          <p className="text-sm text-ink-faint">{t("noRecordsYet")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-faint">
              <tr><th className="py-2">{t("reportPages.time")}</th><th className="py-2">{t("reportPages.user")}</th><th className="py-2">{t("audit.action")}</th><th className="py-2">{t("reportPages.table")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recent.map((log) => (
                <tr key={log.id}>
                  <td className="py-2 text-xs text-ink-faint"><EthDate value={new Date(log.created_at)} /></td>
                  <td className="py-2 text-ink-soft">{actorNames?.get(log.actor_id ?? "") ?? "—"}</td>
                  <td className="py-2"><Badge tone={ACTION_TONE[log.action as keyof typeof ACTION_TONE] ?? "neutral"}>{log.action.toUpperCase()}</Badge></td>
                  <td className="py-2 font-mono text-xs text-ink-soft">{log.table_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportSection>
    </div>
  );
}
