import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function EmployeeListPage() {
  const { t } = useTranslation();
  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id, employee_no, full_name, employee_type, hire_date, status").order("full_name");
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("hr.employees")}</h1>
      {!employees?.length ? (
        <Card className="py-12 text-center text-ink-faint">—</Card>
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">No.</th><th className="px-4 py-2">Name</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Hired</th><th className="px-4 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => (
                <tr key={e.id} className="hover:bg-chalk-sunken">
                  <td className="px-4 py-2"><Link to={`/hr/employees/${e.id}`} className="font-medium hover:underline">{e.employee_no}</Link></td>
                  <td className="px-4 py-2">{e.full_name}</td>
                  <td className="px-4 py-2 capitalize text-ink-faint">{e.employee_type.replace("_", " ")}</td>
                  <td className="px-4 py-2 text-ink-faint"><EthDate value={e.hire_date} /></td>
                  <td className="px-4 py-2 capitalize">{e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
