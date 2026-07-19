import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { listStudents } from "./api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";
import { onRowDoubleClick } from "@/lib/utils";

export function StudentsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: students, isLoading } = useQuery({
    queryKey: ["students", search],
    queryFn: () => listStudents(search || undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("students.title")}</h1>
        <Link to="/students/new"><Button>{t("students.add")}</Button></Link>
      </div>
      <Input placeholder={t("students.search")} value={search}
        onChange={(e) => setSearch(e.target.value)} maxLength={100} className="max-w-sm" />

      {isLoading ? (
        <p className="text-ink-faint">…</p>
      ) : !students?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("students.empty")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-3">{t("students.admissionNo")}</th>
                <th className="px-5 py-3">{t("students.firstName")}</th>
                <th className="px-5 py-3">{t("students.lastName")}</th>
                <th className="px-5 py-3">{t("students.class")}</th>
                <th className="px-5 py-3">{t("students.dob")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {students.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, `/students/${s.id}`)}>
                  <td className="px-5 py-3">
                    <Link to={`/students/${s.id}`} className="font-medium text-navy hover:underline">{s.admission_no}</Link>
                  </td>
                  <td className="px-5 py-3 text-ink">{s.first_name}</td>
                  <td className="px-5 py-3 text-ink">{s.last_name}</td>
                  <td className="px-5 py-3 text-ink-faint">{(s.class as any)?.name} {(s.class as any)?.section}</td>
                  <td className="px-5 py-3 text-ink-faint"><EthDate value={s.date_of_birth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
