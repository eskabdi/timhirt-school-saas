import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

// Hero variant reserved for the single most important number on a screen —
// here, today's attendance. Not every stat gets this treatment.
function StatCard({ label, value, hero = false }: { label: string; value: string | number; hero?: boolean }) {
  return (
    <Card className={cn(hero && "border-navy bg-navy text-white")}>
      <p className={cn("text-xs font-medium uppercase tracking-wide", hero ? "text-white/70" : "text-ink-faint")}>{label}</p>
      <p className="mt-2 font-display text-3xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? "";

  // super_admin has no tenant — this tenant-scoped dashboard has nothing to
  // show them (every stat below would sit at "—" forever) and their real
  // surface is the platform console. LoginPage always lands everyone here
  // first, so redirect on arrival rather than leaving them stranded.
  if (profile?.role === "super_admin") return <Navigate to="/platform" replace />;

  const { data } = useQuery({
    queryKey: qk.dashboard(tenantId),
    enabled: !!tenantId,
    queryFn: async () => {
      const [{ count: students }, { count: attendanceToday }] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("attendance").select("id", { count: "exact", head: true })
          .eq("attendance_date", new Date().toISOString().slice(0, 10)).eq("status", "present"),
      ]);
      return { students: students ?? 0, attendanceToday: attendanceToday ?? 0 };
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">
        {t("dashboard.welcome")}, {profile?.full_name}
      </h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={t("dashboard.studentsCard")} value={data?.students ?? "—"} />
        <StatCard label={t("dashboard.attendanceCard")} value={data?.attendanceToday ?? "—"} hero />
        <StatCard label={t("dashboard.payrollCard")} value="—" />
        <StatCard label={t("dashboard.feesCard")} value="—" />
      </div>
    </div>
  );
}
