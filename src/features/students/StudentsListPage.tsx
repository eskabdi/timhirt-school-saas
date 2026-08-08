import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { listStudents, listClasses } from "./api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { onRowDoubleClick } from "@/lib/utils";
import { useGradeCycles, gradeCycleKeyFor } from "@/lib/gradeCycles";
import { tField } from "@/lib/i18n";

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

export function StudentsListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [classId, setClassId] = useState("");
  const [status, setStatus] = useState("");
  const [gender, setGender] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [page, setPage] = useState(1);

  const { data: classes } = useQuery({ queryKey: ["classes-for-filter"], queryFn: listClasses });
  const { data: cycles } = useGradeCycles();

  const cycleClassIds = useMemo(() => {
    if (!cycleId) return undefined;
    const cyc = cycles?.find((c) => c.id === cycleId);
    if (!cyc) return undefined;
    return (classes ?? []).filter((c) => c.grade_level != null && gradeCycleKeyFor(c.grade_level) === cyc.key).map((c) => c.id);
  }, [cycleId, cycles, classes]);

  const filters = {
    search: search || undefined, classId: classId || undefined,
    classIds: cycleClassIds, status: status || undefined, gender: gender || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["students", filters, page],
    queryFn: () => listStudents(filters, pageRange(page)),
  });
  const students = data?.rows;

  const hasActiveFilters = !!(search || classId || status || gender || cycleId);
  // Any filter change re-queries from the top — page 2 of an old, wider
  // result set is meaningless once the filter narrows it.
  const clearFilters = () => { setSearch(""); setClassId(""); setStatus(""); setGender(""); setCycleId(""); setPage(1); };
  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("students.title")}</h1>
        <Link to="/students/new"><Button>{t("students.add")}</Button></Link>
      </div>

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Field label={t("students.search")}>
            <Input placeholder={t("students.search")} value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t("students.class")}>
            <select className={SELECT_CLS} value={classId} onChange={(e) => setFilter(setClassId)(e.target.value)}>
              <option value="">{t("crud.allClasses")}</option>
              {classes?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.section ? ` - ${c.section}` : ""}</option>
              ))}
            </select>
          </Field>
          <Field label={t("gradeCycles.cycle")}>
            <select className={SELECT_CLS} value={cycleId} onChange={(e) => setFilter(setCycleId)(e.target.value)}>
              <option value="">{t("gradeCycles.allGrades")}</option>
              {cycles?.map((c) => <option key={c.id} value={c.id}>{tField(c.name_i18n, i18n.resolvedLanguage!)}</option>)}
            </select>
          </Field>
          <Field label={t("students.status")}>
            <select className={SELECT_CLS} value={status} onChange={(e) => setFilter(setStatus)(e.target.value)}>
              <option value="">{t("students.allStatuses")}</option>
              <option value="active">{t("students.active")}</option>
              <option value="graduated">{t("students.graduated")}</option>
              <option value="transferred">{t("students.transferred")}</option>
            </select>
          </Field>
          <Field label={t("students.gender")}>
            <select className={SELECT_CLS} value={gender} onChange={(e) => setFilter(setGender)(e.target.value)}>
              <option value="">{t("students.allGenders")}</option>
              <option value="male">{t("students.male")}</option>
              <option value="female">{t("students.female")}</option>
              <option value="other">{t("students.other")}</option>
            </select>
          </Field>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" className="border border-line" onClick={clearFilters}>{t("students.clearFilters")}</Button>
        )}
      </Card>

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
          <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-5" />
        </Panel>
      )}
    </div>
  );
}
