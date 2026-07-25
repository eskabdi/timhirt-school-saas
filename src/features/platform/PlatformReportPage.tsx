// Cross-tenant platform report. Every query below relies on super_admin's
// unscoped RLS branch (`get_role_for_user(auth.uid()) = 'super_admin'`), so
// counts span all tenants rather than a single school.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { ReportStat, ReportBarChart, ReportSection } from "@/features/reports/ReportComponents";

const TENANT_STATUS_TONE = { active: "ok", trial: "navy", suspended: "danger" } as const;
const ACTION_TONE = { insert: "ok", update: "navy", delete: "danger" } as const;
const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin", school_admin: "School Admin", teacher: "Teacher",
  hr_officer: "HR Officer", accountant: "Accountant", registrar: "Registrar",
  student: "Student", parent: "Parent",
};

interface Tenant { id: string; name: string; slug: string; status: string; tier_key: string; created_at: string; }
interface UserRow { id: string; tenant_id: string | null; role: string; }
interface StudentRow { id: string; tenant_id: string; status: string; }
interface InvoiceRow { tenant_id: string; amount_due: number; amount_paid: number; }
interface TierRow { key: string; display_name: string; sort_order: number; }
interface IntegrationRow { provider: string; display_name: string; configured: boolean; }
interface AuditRow { id: number; tenant_id: string | null; action: string; table_name: string; created_at: string; }

function fmtEtb(n: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ETB`;
}

export function PlatformReportPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["platform-report"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const [tenants, users, students, invoices, tiers, integrations, audit] = await Promise.all([
        supabase.from("tenants").select("id, name, slug, status, tier_key, created_at").limit(1000),
        supabase.from("users").select("id, tenant_id, role").limit(20000),
        supabase.from("students").select("id, tenant_id, status").limit(50000),
        supabase.from("fee_invoices").select("tenant_id, amount_due, amount_paid").limit(50000),
        supabase.from("subscription_tiers").select("key, display_name, sort_order").order("sort_order"),
        supabase.from("platform_integrations").select("provider, display_name, configured"),
        supabase.from("audit_logs").select("id, tenant_id, action, table_name, created_at")
          .gte("created_at", since.toISOString()).order("created_at", { ascending: false }).limit(1000),
      ]);
      for (const r of [tenants, users, students, invoices, tiers, integrations, audit]) {
        if (r.error) throw r.error;
      }
      return {
        tenants: (tenants.data ?? []) as Tenant[],
        users: (users.data ?? []) as UserRow[],
        students: (students.data ?? []) as StudentRow[],
        invoices: (invoices.data ?? []) as InvoiceRow[],
        tiers: (tiers.data ?? []) as TierRow[],
        integrations: (integrations.data ?? []) as IntegrationRow[],
        audit: (audit.data ?? []) as AuditRow[],
      };
    },
  });

  const totals = useMemo(() => {
    if (!data) return null;
    const activeTenants = data.tenants.filter((t) => t.status === "active").length;
    const billed = data.invoices.reduce((s, i) => s + Number(i.amount_due), 0);
    const collected = data.invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
    return {
      tenants: data.tenants.length,
      activeTenants,
      users: data.users.length,
      students: data.students.filter((s) => s.status === "active").length,
      billed,
      collected,
    };
  }, [data]);

  const byTier = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const t of data.tenants) counts.set(t.tier_key, (counts.get(t.tier_key) ?? 0) + 1);
    return data.tiers.map((tier) => ({ label: tier.display_name, value: counts.get(tier.key) ?? 0 }));
  }, [data]);

  const byRole = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const u of data.users) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [data]);

  const perTenant = useMemo(() => {
    if (!data) return [];
    const usersBy = new Map<string, number>();
    for (const u of data.users) if (u.tenant_id) usersBy.set(u.tenant_id, (usersBy.get(u.tenant_id) ?? 0) + 1);
    const studentsBy = new Map<string, number>();
    for (const s of data.students) if (s.status === "active") studentsBy.set(s.tenant_id, (studentsBy.get(s.tenant_id) ?? 0) + 1);
    const billedBy = new Map<string, { due: number; paid: number }>();
    for (const i of data.invoices) {
      const row = billedBy.get(i.tenant_id) ?? { due: 0, paid: 0 };
      row.due += Number(i.amount_due);
      row.paid += Number(i.amount_paid);
      billedBy.set(i.tenant_id, row);
    }
    const activityBy = new Map<string, number>();
    for (const a of data.audit) if (a.tenant_id) activityBy.set(a.tenant_id, (activityBy.get(a.tenant_id) ?? 0) + 1);
    const tierName = new Map(data.tiers.map((t) => [t.key, t.display_name]));

    return data.tenants.map((t) => {
      const billing = billedBy.get(t.id) ?? { due: 0, paid: 0 };
      return {
        ...t,
        tierLabel: tierName.get(t.tier_key) ?? t.tier_key,
        users: usersBy.get(t.id) ?? 0,
        students: studentsBy.get(t.id) ?? 0,
        billed: billing.due,
        collected: billing.paid,
        activity: activityBy.get(t.id) ?? 0,
      };
    }).sort((a, b) => b.students - a.students);
  }, [data]);

  const signupTrend = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const buckets: { key: string; label: string; value: number }[] = [];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS[d.getMonth()] ?? "", value: 0 });
    }
    for (const t of data.tenants) {
      const d = new Date(t.created_at);
      const b = buckets.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (b) b.value += 1;
    }
    return buckets.map(({ label, value }) => ({ label, value }));
  }, [data]);

  const auditByTable = useMemo(() => {
    if (!data) return [];
    const counts = new Map<string, number>();
    for (const a of data.audit) counts.set(a.table_name, (counts.get(a.table_name) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  const recentAudit = data?.audit.slice(0, 12) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">Platform Report</h1>
      <p className="text-sm text-ink-faint">Cross-tenant totals across every school on the platform.</p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <ReportStat label="Tenants" value={isLoading ? "—" : (totals?.tenants ?? 0)} />
        <ReportStat label="Active tenants" value={isLoading ? "—" : (totals?.activeTenants ?? 0)} tone="ok" />
        <ReportStat label="Users" value={isLoading ? "—" : (totals?.users ?? 0)} tone="navy" />
        <ReportStat label="Active students" value={isLoading ? "—" : (totals?.students ?? 0)} />
        <ReportStat label="Total billed" value={isLoading ? "—" : fmtEtb(totals?.billed ?? 0)} />
        <ReportStat label="Total collected" value={isLoading ? "—" : fmtEtb(totals?.collected ?? 0)} tone="ok" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportSection title="Tenants by subscription tier">
          {byTier.length ? <ReportBarChart bars={byTier} /> : <p className="text-sm text-ink-faint">No records yet.</p>}
        </ReportSection>
        <ReportSection title="New tenants — last 6 months">
          {signupTrend.length ? <ReportBarChart bars={signupTrend} /> : <p className="text-sm text-ink-faint">No records yet.</p>}
        </ReportSection>
      </div>

      <Panel className="overflow-x-auto">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold text-ink">Per-tenant breakdown</h2>
        </div>
        {!perTenant.length ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">No tenants yet.</p>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-2">Tenant</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Tier</th>
                <th className="px-5 py-2">Users</th>
                <th className="px-5 py-2">Students</th>
                <th className="px-5 py-2">Billed</th>
                <th className="px-5 py-2">Collected</th>
                <th className="px-5 py-2">Changes 30d</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {perTenant.map((t) => (
                <tr key={t.id} className="hover:bg-sidebar">
                  <td className="px-5 py-3">
                    <Link to={`/platform/tenants/${t.id}`} className="font-medium text-navy hover:underline">{t.name}</Link>
                    <span className="ml-2 text-xs text-ink-faint">{t.slug}</span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={TENANT_STATUS_TONE[t.status as keyof typeof TENANT_STATUS_TONE] ?? "neutral"}>{t.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{t.tierLabel}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{t.users}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{t.students}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{fmtEtb(t.billed)}</td>
                  <td className="px-5 py-3 text-ok tabular-nums">{fmtEtb(t.collected)}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{t.activity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">Users by role</h2></div>
          {!byRole.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No records yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {byRole.map(([role, count]) => (
                  <tr key={role}>
                    <td className="px-5 py-3 text-ink-soft">{ROLE_LABEL[role] ?? role}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink tabular-nums">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">Payment &amp; SMS integrations</h2></div>
          {!data?.integrations.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No integrations registered.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {data.integrations.map((i) => (
                  <tr key={i.provider}>
                    <td className="px-5 py-3 text-ink-soft">{i.display_name}</td>
                    <td className="px-5 py-3 text-right">
                      <Badge tone={i.configured ? "ok" : "neutral"}>{i.configured ? "Configured" : "Not set"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">Most-changed tables (30d)</h2></div>
          {!auditByTable.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">No records yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {auditByTable.map(([tableName, count]) => (
                  <tr key={tableName}>
                    <td className="px-5 py-3 font-mono text-xs text-ink-soft">{tableName}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink tabular-nums">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <ReportSection title="Recent platform activity">
        {!recentAudit.length ? (
          <p className="text-sm text-ink-faint">No records yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-ink-faint">
              <tr><th className="py-2">Time</th><th className="py-2">Tenant</th><th className="py-2">Action</th><th className="py-2">Table</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recentAudit.map((log) => {
                const tenant = data?.tenants.find((t) => t.id === log.tenant_id);
                return (
                  <tr key={log.id}>
                    <td className="py-2 text-xs text-ink-faint"><EthDate value={new Date(log.created_at)} /></td>
                    <td className="py-2 text-ink-soft">{tenant?.name ?? "—"}</td>
                    <td className="py-2"><Badge tone={ACTION_TONE[log.action as keyof typeof ACTION_TONE] ?? "neutral"}>{log.action.toUpperCase()}</Badge></td>
                    <td className="py-2 font-mono text-xs text-ink-soft">{log.table_name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </ReportSection>
    </div>
  );
}
