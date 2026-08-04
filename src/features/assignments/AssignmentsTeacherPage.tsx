import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { tField } from "@/lib/i18n";

export function AssignmentsTeacherPage() {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(1);
  const { data: assignments } = useQuery({
    queryKey: ["assignments", page],
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("assignments")
        .select("id, title, due_date, status, classes(name, section), subjects(name_i18n)", { count: "exact" })
        .order("due_date")
        .range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("assignments.title")}</h1>
        <Link to="/assignments/new"><Button>{t("assignments.new")}</Button></Link>
      </div>
      <div className="space-y-2">
        {assignments?.rows.map((a) => (
          <Card key={a.id} className="flex items-center justify-between">
            <div>
              <Link to={`/assignments/${a.id}`} className="font-medium text-ink hover:text-navy hover:underline">
                {a.title}
              </Link>
              {a.status === "draft" && (
                <span className="ml-2 rounded bg-sidebar px-1.5 py-0.5 text-xs text-ink-faint">
                  {t("assignments.draft")}
                </span>
              )}
              <p className="text-sm text-ink-faint">{(a.classes as any)?.name} {(a.classes as any)?.section} · {tField((a.subjects as any)?.name_i18n, i18n.resolvedLanguage!)}</p>
            </div>
            <p className="text-sm text-ink-faint">{t("assignments.due")} <EthDate value={a.due_date} /></p>
          </Card>
        ))}
      </div>
      <Pagination page={page} totalCount={assignments?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
