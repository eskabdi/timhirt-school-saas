import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { listStudents } from "./api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function StudentsListPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data: students, isLoading } = useQuery({
    queryKey: ["students", search],
    queryFn: () => listStudents(search || undefined),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{t("students.title")}</h1>
        <Link to="/students/new"><Button>{t("students.add")}</Button></Link>
      </div>
      <Input placeholder={t("students.search")} value={search}
        onChange={(e) => setSearch(e.target.value)} maxLength={100} className="max-w-sm" />

      {isLoading ? (
        <p className="text-ink-faint">…</p>
      ) : !students?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("students.empty")}</Card>
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-4 py-2">{t("students.admissionNo")}</th>
                <th className="px-4 py-2">{t("students.firstName")}</th>
                <th className="px-4 py-2">{t("students.lastName")}</th>
                <th className="px-4 py-2">{t("students.class")}</th>
                <th className="px-4 py-2">{t("students.dob")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {students.map((s) => (
                <tr key={s.id} className="hover:bg-chalk-sunken">
                  <td className="px-4 py-2">
                    <Link to={`/students/${s.id}`} className="font-medium text-ink hover:underline">{s.admission_no}</Link>
                  </td>
                  <td className="px-4 py-2">{s.first_name}</td>
                  <td className="px-4 py-2">{s.last_name}</td>
                  <td className="px-4 py-2 text-ink-faint">{(s.class as any)?.name} {(s.class as any)?.section}</td>
                  <td className="px-4 py-2 text-ink-faint"><EthDate value={s.date_of_birth} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
