import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { onRowDoubleClick } from "@/lib/utils";
import { formatEth } from "@/lib/ethiopian-date";
import {
  listClasses, listEnrolledCounts, listActiveAcademicYears, listTeachers,
  createClass, updateClass, deleteClass,
  type ClassRow, type ClassFilters, type ClassInput,
} from "./classesApi";
import { buildClassesPdf } from "./classes-pdf";

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";
const emptyForm: ClassInput = { name: "", section: "", gradeLevel: "", capacity: "", homeroomTeacherId: "" };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ClassesPage() {
  const { t } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [section, setSection] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<ClassInput>(emptyForm);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState<ClassInput>(emptyForm);
  const [deleting, setDeleting] = useState<ClassRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"pdf" | null>(null);

  const { data: years } = useQuery({ queryKey: ["academic-years"], queryFn: listActiveAcademicYears });
  const { data: teachers } = useQuery({ queryKey: ["teachers-for-classes"], queryFn: listTeachers });
  // Unfiltered, columns-only fetch to populate the grade/section filter
  // options with every real value in use — a school has tens of classes,
  // not thousands, so this is cheap next to the paginated table query below.
  const { data: filterSource } = useQuery({
    queryKey: ["classes-filter-options"],
    queryFn: async () => (await supabase.from("classes").select("grade_level,section")).data ?? [],
  });
  const gradeLevels = useMemo(
    () => [...new Set((filterSource ?? []).map((c) => c.grade_level).filter((g): g is number => g != null))].sort((a, b) => a - b),
    [filterSource],
  );
  const sections = useMemo(
    () => [...new Set((filterSource ?? []).map((c) => c.section).filter((s): s is string => !!s))].sort(),
    [filterSource],
  );

  const filters: ClassFilters = {
    search: search || undefined, gradeLevel: gradeLevel || undefined,
    section: section || undefined, academicYearId: academicYearId || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ["classes-admin", filters, page],
    queryFn: () => listClasses(filters, pageRange(page)),
  });
  const classes = data?.rows ?? [];
  const { data: enrolledCounts } = useQuery({ queryKey: ["classes-admin-enrolled"], queryFn: listEnrolledCounts });

  const hasActiveFilters = !!(search || gradeLevel || section || academicYearId);
  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const clearFilters = () => { setSearch(""); setGradeLevel(""); setSection(""); setAcademicYearId(""); setPage(1); };

  const create = useMutation({
    mutationFn: async () => {
      if (!years?.[0]) throw new Error(t("crud.noAcademicYear"));
      await createClass(profile!.tenant_id!, years[0].id, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      qc.invalidateQueries({ queryKey: ["classes-filter-options"] });
      setForm(emptyForm);
      setAdding(false);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to add class"),
  });

  const update = useMutation({
    mutationFn: () => updateClass(editing!.id, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      qc.invalidateQueries({ queryKey: ["classes-filter-options"] });
      setEditing(null);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to update class"),
  });

  const remove = useMutation({
    mutationFn: () => deleteClass(deleting!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      qc.invalidateQueries({ queryKey: ["classes-filter-options"] });
      setDeleting(null);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to delete class"),
  });

  const openEdit = (c: ClassRow) => {
    setEditing(c);
    setEditForm({
      name: c.name, section: c.section ?? "",
      gradeLevel: c.grade_level?.toString() ?? "", capacity: c.capacity?.toString() ?? "",
      homeroomTeacherId: c.homeroom_teacher_id ?? "",
    });
  };

  // Both exports act on every row matching the current filters, not just the
  // page on screen — a registrar exporting "Grade 3" expects all of Grade 3.
  const exportRows = async () => {
    const { rows } = await listClasses(filters);
    return rows.map((c) => ({
      name: c.name, section: c.section ?? "—",
      gradeLevel: c.grade_level != null ? String(c.grade_level) : "—",
      capacity: c.capacity != null ? String(c.capacity) : t("crud.unlimited"),
      enrolled: String(enrolledCounts?.get(c.id) ?? 0),
    }));
  };

  const exportPdf = async () => {
    setExporting("pdf");
    try {
      const rows = await exportRows();
      const blob = await buildClassesPdf({
        schoolName: t("app.name"), title: t("crud.classes"),
        columns: [t("common.name"), t("crud.section"), t("crud.gradeLevel"), t("crud.capacity"), t("crud.enrolled")],
        rows, issuedOn: formatEth(new Date(), { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") }),
        issuedLabel: t("idCards.issued"),
      });
      downloadBlob(blob, "classes.pdf");
    } finally {
      setExporting(null);
    }
  };

  const exportExcel = async () => {
    const rows = await exportRows();
    const header = [t("common.name"), t("crud.section"), t("crud.gradeLevel"), t("crud.capacity"), t("crud.enrolled")];
    const csv = [header, ...rows.map((r) => [r.name, r.section, r.gradeLevel, r.capacity, r.enrolled])]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), "classes.csv");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink">{t("crud.classes")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="border border-line" onClick={exportPdf} disabled={exporting === "pdf"}>
            ⬇ {exporting === "pdf" ? t("academicRecord.preparing") : t("crud.exportPdf")}
          </Button>
          <Button variant="ghost" className="border border-line" onClick={exportExcel}>⬇ {t("crud.exportExcel")}</Button>
          <Button variant="ghost" className="border border-line" onClick={() => window.print()}>🖨 {t("crud.print")}</Button>
          <Button onClick={() => setAdding(true)}>{t("crud.addNew")}</Button>
        </div>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Field label={t("students.search")}>
            <Input placeholder={t("students.search")} value={search}
              onChange={(e) => setFilter(setSearch)(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t("crud.gradeLevel")}>
            <select className={SELECT_CLS} value={gradeLevel} onChange={(e) => setFilter(setGradeLevel)(e.target.value)}>
              <option value="">{t("crud.allGradeLevels")}</option>
              {gradeLevels.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label={t("crud.section")}>
            <select className={SELECT_CLS} value={section} onChange={(e) => setFilter(setSection)(e.target.value)}>
              <option value="">{t("crud.allSections")}</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label={t("crud.academicYear")}>
            <select className={SELECT_CLS} value={academicYearId} onChange={(e) => setFilter(setAcademicYearId)(e.target.value)}>
              <option value="">{t("crud.allYears")}</option>
              {years?.map((y) => <option key={y.id} value={y.id}>{y.ec_year}</option>)}
            </select>
          </Field>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" className="border border-line" onClick={clearFilters}>{t("students.clearFilters")}</Button>
        )}
      </Card>

      {isLoading ? (
        <p className="text-ink-faint">…</p>
      ) : classes.length === 0 ? (
        <Card className="py-12 text-center text-ink-faint">{t("crud.noClasses")}</Card>
      ) : (
        <Panel id="print-scope">
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-3">{t("common.name")}</th>
                <th className="px-5 py-3">{t("crud.section")}</th>
                <th className="px-5 py-3">{t("crud.gradeLevel")}</th>
                <th className="px-5 py-3">{t("crud.capacity")}</th>
                <th className="px-5 py-3">{t("crud.enrolled")}</th>
                <th className="no-print px-5 py-3 text-right">{t("crud.edit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {classes.map((c) => {
                const enrolled = enrolledCounts?.get(c.id) ?? 0;
                return (
                  <tr key={c.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, `/classes/${c.id}`)}>
                    <td className="px-5 py-3">
                      <Link to={`/classes/${c.id}`} className="font-medium text-navy hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-5 py-3 text-ink">{c.section ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-faint">{c.grade_level ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-faint">{c.capacity ?? t("crud.unlimited")}</td>
                    <td className="px-5 py-3 text-ink-faint">
                      {c.capacity != null ? `${enrolled}/${c.capacity}` : enrolled}
                    </td>
                    <td className="no-print px-5 py-3">
                      <div className="flex justify-end gap-3 text-xs">
                        <Link to={`/classes/${c.id}`} className="font-medium text-navy hover:underline">{t("crud.view")}</Link>
                        <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => openEdit(c)}>{t("crud.edit")}</button>
                        <button type="button" className="font-medium text-danger hover:underline" onClick={() => setDeleting(c)}>{t("crud.delete")}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="no-print px-5" />
        </Panel>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={t("crud.addNew")}>
        <div className="space-y-3">
          <Field label={t("common.name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder={t("confirm.gradeExample")} /></Field>
          <Field label={t("crud.section")}><Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} maxLength={10} placeholder="A" /></Field>
          <Field label={t("crud.gradeLevel")}><Input type="number" min={0} max={12} value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} /></Field>
          <Field label={t("crud.capacity")}><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder={t("crud.unlimited")} /></Field>
          <Field label={t("crud.homeroomTeacher")}>
            <select className={SELECT_CLS} value={form.homeroomTeacherId} onChange={(e) => setForm({ ...form, homeroomTeacherId: e.target.value })}>
              <option value="">{t("crud.notSet")}</option>
              {teachers?.map((tc) => <option key={tc.id} value={tc.id}>{tc.user?.full_name ?? tc.staff_no}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>{t("common.add")}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${t("crud.edit")} ${editing?.name ?? ""}`}>
        <div className="space-y-3">
          <Field label={t("common.name")}><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={40} /></Field>
          <Field label={t("crud.section")}><Input value={editForm.section} onChange={(e) => setEditForm({ ...editForm, section: e.target.value })} maxLength={10} /></Field>
          <Field label={t("crud.gradeLevel")}><Input type="number" min={0} max={12} value={editForm.gradeLevel} onChange={(e) => setEditForm({ ...editForm, gradeLevel: e.target.value })} /></Field>
          <Field label={t("crud.capacity")}><Input type="number" min={1} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} placeholder={t("crud.unlimited")} /></Field>
          <Field label={t("crud.homeroomTeacher")}>
            <select className={SELECT_CLS} value={editForm.homeroomTeacherId} onChange={(e) => setEditForm({ ...editForm, homeroomTeacherId: e.target.value })}>
              <option value="">{t("crud.notSet")}</option>
              {teachers?.map((tc) => <option key={tc.id} value={tc.id}>{tc.user?.full_name ?? tc.staff_no}</option>)}
            </select>
          </Field>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => update.mutate()} disabled={!editForm.name || update.isPending}>{t("common.save")}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("crud.deleteClass")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting?.name} {deleting?.section}</span>{t("crud.cannotUndo")}</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
