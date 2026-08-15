import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { formatETB } from "@/lib/i18n";

export function MyPayslipsPage() {
  const { profile } = useSession();
  const { t, i18n } = useTranslation();
  const { data: payslips } = useQuery({
    queryKey: ["my-payslips", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: emp } = await supabase.from("employees").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!emp) return [];
      const { data } = await supabase.from("payslips")
        .select("id, net_pay, gross, payroll_runs(ec_year, ec_month)").eq("employee_id", emp.id)
        .order("generated_at", { ascending: false });
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("hr.payslip")}</h1>
      <div className="space-y-2">
        {payslips?.map((p) => {
          const run = p.payroll_runs as unknown as { ec_year: number; ec_month: number } | null;
          return (
          <Card key={p.id} className="flex items-center justify-between">
            <span className="font-medium">{run?.ec_year} / {String(run?.ec_month).padStart(2, "0")}</span>
            <span className="font-semibold">{formatETB(Number(p.net_pay), i18n.resolvedLanguage!)}</span>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
