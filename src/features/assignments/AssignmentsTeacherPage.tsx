import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { tField } from "@/lib/i18n";

export function AssignmentsTeacherPage() {
  const { t, i18n } = useTranslation();
  const { data: assignments } = useQuery({
    queryKey: ["assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("assignments")
        .select("id, title, due_date, classes(name, section), subjects(name_i18n)").order("due_date");
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("assignments.title")}</h1>
        <Link to="/assignments/new"><Button>{t("assignments.new")}</Button></Link>
      </div>
      <div className="space-y-2">
        {assignments?.map((a) => (
          <Card key={a.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ink">{a.title}</p>
              <p className="text-sm text-ink-faint">{(a.classes as any)?.name} {(a.classes as any)?.section} · {tField((a.subjects as any)?.name_i18n, i18n.resolvedLanguage!)}</p>
            </div>
            <p className="text-sm text-ink-faint">{t("assignments.due")} <EthDate value={a.due_date} /></p>
          </Card>
        ))}
      </div>
    </div>
  );
}
