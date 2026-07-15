import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold">{value}</p>
    </Card>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? "";

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
      <h1 className="font-display text-2xl font-bold">
        {t("dashboard.welcome")}, {profile?.full_name}
      </h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label={t("dashboard.studentsCard")} value={data?.students ?? "—"} />
        <StatCard label={t("dashboard.attendanceCard")} value={data?.attendanceToday ?? "—"} />
        <StatCard label={t("dashboard.payrollCard")} value="—" />
        <StatCard label={t("dashboard.feesCard")} value="—" />
      </div>
    </div>
  );
}
