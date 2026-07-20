import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";

// Mirrors the core audit_logs schema (20260713000001_core.sql): append-only,
// PII-redacted, written by public.audit_trigger().
interface AuditLog {
  id: number;
  action: string; // stored lowercase: 'insert' | 'update' | 'delete'
  table_name: string;
  row_id: string | null;
  actor_id: string | null;
  created_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

export function AuditLogsPage() {
  const { t } = useTranslation();
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [tableFilter, setTableFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const { data: logs, isLoading } = useQuery({
    queryKey: ["audit-logs", startDate, endDate, tableFilter, actionFilter],
    queryFn: async () => {
      let q = supabase.from("audit_logs")
        .select("*")
        .gte("created_at", startDate + "T00:00:00Z")
        .lte("created_at", endDate + "T23:59:59Z")
        .order("created_at", { ascending: false })
        .limit(500);

      if (tableFilter) q = q.eq("table_name", tableFilter);
      if (actionFilter) q = q.eq("action", actionFilter.toLowerCase());

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });

  const { data: users } = useQuery({
    queryKey: ["audit-users"],
    queryFn: async () => {
      const { data, error } = await supabase.from("users")
        .select("id, full_name, email")
        .limit(1000);
      if (error) throw error;
      return new Map((data ?? []).map((u) => [u.id, u]));
    },
  });

  const tables = useMemo(() => {
    const ts = new Set(logs?.map((l) => l.table_name) ?? []);
    return Array.from(ts).sort();
  }, [logs]);

  const downloadCsv = () => {
    if (!logs) return;
    const rows = logs.map((l) => [
      l.created_at,
      l.action.toUpperCase(),
      l.table_name,
      users?.get(l.actor_id as any)?.full_name || l.actor_id || "—",
      l.row_id ?? "—",
    ]);
    const csv = [
      [t("audit.timestamp"), t("audit.action"), t("audit.table"), t("audit.user"), t("audit.recordId")],
      ...rows,
    ].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("audit.title")}</h1>

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-faint">{t("audit.fromDate")}</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-faint">{t("audit.toDate")}</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-faint">{t("audit.table")}</label>
            <select
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">—</option>
              {tables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink-faint">{t("audit.action")}</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
            >
              <option value="">—</option>
              <option value="INSERT">INSERT</option>
              <option value="UPDATE">UPDATE</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>
        </div>
        <Button onClick={downloadCsv} disabled={!logs || logs.length === 0}>
          {t("audit.downloadCsv")}
        </Button>
      </Card>

      {isLoading ? (
        <Card className="py-12 text-center text-ink-faint">{t("audit.loading")}</Card>
      ) : !logs || logs.length === 0 ? (
        <Card className="py-12 text-center text-ink-faint">{t("audit.noRecords")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-4 py-3">{t("audit.timestamp")}</th>
                <th className="px-4 py-3">{t("audit.user")}</th>
                <th className="px-4 py-3">{t("audit.action")}</th>
                <th className="px-4 py-3">{t("audit.table")}</th>
                <th className="px-4 py-3">{t("audit.recordId")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-sidebar">
                  <td className="px-4 py-3 text-xs text-ink-faint">
                    <EthDate value={new Date(log.created_at)} /> {log.created_at.slice(11, 19)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="text-ink-soft">{users?.get(log.actor_id as any)?.full_name || "—"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-control px-2 py-1 text-xs font-medium ${
                        log.action === "insert"
                          ? "bg-ok-tint text-ok"
                          : log.action === "update"
                            ? "bg-navy-wash text-navy"
                            : "bg-danger-tint text-danger"
                      }`}
                    >
                      {log.action.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">{log.table_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                    {log.row_id ? `${log.row_id.slice(0, 8)}…` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
