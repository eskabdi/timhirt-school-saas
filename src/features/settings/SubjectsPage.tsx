import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { useGradeCycles } from "@/lib/gradeCycles";
import { tField } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

interface SubjectRow {
  id: string;
  name_i18n: Record<string, string>;
  code: string;
  min_grade: number | null;
  max_grade: number | null;
}

export function SubjectsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [nameEn, setNameEn] = useState("");
  const [nameAm, setNameAm] = useState("");
  const [code, setCode] = useState("");
  const [minGrade, setMinGrade] = useState("");
  const [maxGrade, setMaxGrade] = useState("");
  const [selectedCycleId, setSelectedCycleId] = useState("");
  const [page, setPage] = useState(1);
  const { data: cycles } = useGradeCycles();
  // Grade range is only readonly while a cycle is actively picked -- picking
  // "Custom range" (or never picking one) leaves the fields free-typed.
  const gradeRangeLocked = !!selectedCycleId;

  const [editing, setEditing] = useState<SubjectRow | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editNameEn, setEditNameEn] = useState("");
  const [editNameAm, setEditNameAm] = useState("");
  const [editMinGrade, setEditMinGrade] = useState("");
  const [editMaxGrade, setEditMaxGrade] = useState("");
  const [editSelectedCycleId, setEditSelectedCycleId] = useState("");
  const editGradeRangeLocked = !!editSelectedCycleId;
  const [deleting, setDeleting] = useState<SubjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["subjects-admin", page],
    queryFn: async () => {
      const { data: rows, count } = await supabase.from("subjects")
        .select("id,name_i18n,code,min_grade,max_grade", { count: "exact" })
        .range(...pageRange(page));
      return { rows: (rows ?? []) as SubjectRow[], count: count ?? 0 };
    },
  });
  const subjects = data?.rows;

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("subjects").insert({
        tenant_id: profile!.tenant_id, code, name_i18n: { en: nameEn, am: nameAm },
        min_grade: minGrade === "" ? null : Number(minGrade),
        max_grade: maxGrade === "" ? null : Number(maxGrade),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects-admin"] });
      setNameEn(""); setNameAm(""); setCode(""); setMinGrade(""); setMaxGrade(""); setSelectedCycleId(""); setPage(1);
    },
  });

  const openEdit = (s: SubjectRow) => {
    setEditing(s);
    setEditCode(s.code); setEditNameEn(s.name_i18n?.en ?? ""); setEditNameAm(s.name_i18n?.am ?? "");
    setEditMinGrade(s.min_grade != null ? String(s.min_grade) : "");
    setEditMaxGrade(s.max_grade != null ? String(s.max_grade) : "");
    // Preselect the matching cycle (keeping the range locked) if this
    // subject's stored range exactly matches one; otherwise it's custom.
    const matching = cycles?.find((c) => c.min_grade === s.min_grade && c.max_grade === s.max_grade);
    setEditSelectedCycleId(matching?.id ?? "");
  };

  const update = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("subjects").update({
        code: editCode, name_i18n: { en: editNameEn, am: editNameAm },
        min_grade: editMinGrade === "" ? null : Number(editMinGrade),
        max_grade: editMaxGrade === "" ? null : Number(editMaxGrade),
      }).eq("id", editing!.id);
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects-admin"] });
      setEditing(null); setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("errors.generic")),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("subjects").delete().eq("id", deleting!.id);
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects-admin"] });
      setDeleting(null); setError(null);
    },
    // grades/assignments/timetable_slots/class_subject_teachers all reference
    // subjects with the default RESTRICT -- a subject still in use anywhere
    // fails with 23503 rather than silently orphaning those rows.
    onError: (e: unknown) => {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
      setDeleting(null);
      setError(code === "23503" ? t("crud.subjectInUse") : e instanceof Error ? e.message : t("errors.generic"));
    },
  });

  const rangeLabel = (s: SubjectRow) =>
    s.min_grade != null && s.max_grade != null ? `${s.min_grade}–${s.max_grade}` : t("gradeCycles.allGrades");

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.subjects")}</h1>
      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}
      <Card className="flex flex-wrap items-end gap-2">
        <Field label={t("common.code")}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} /></Field>
        <Field label={t("common.nameEnglish")}><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={80} /></Field>
        <Field label={t("common.nameAmharic")}><Input value={nameAm} onChange={(e) => setNameAm(e.target.value)} maxLength={80} /></Field>
        <Field label={t("gradeCycles.pickCycle")}>
          <select
            className={SELECT_CLS}
            value={selectedCycleId}
            onChange={(e) => {
              const id = e.target.value;
              setSelectedCycleId(id);
              const cyc = cycles?.find((c) => c.id === id);
              if (cyc) { setMinGrade(String(cyc.min_grade)); setMaxGrade(String(cyc.max_grade)); }
            }}
          >
            <option value="">{t("gradeCycles.customRange")}</option>
            {cycles?.map((c) => <option key={c.id} value={c.id}>{tField(c.name_i18n, i18n.resolvedLanguage!)}</option>)}
          </select>
        </Field>
        <Field label={t("gradeCycles.minGrade")}>
          <Input
            type="number" min={0} max={12} value={minGrade} readOnly={gradeRangeLocked}
            onChange={(e) => setMinGrade(e.target.value)}
            className={cn("w-20", gradeRangeLocked && "cursor-not-allowed bg-line/40 text-ink-faint")}
          />
        </Field>
        <Field label={t("gradeCycles.maxGrade")}>
          <Input
            type="number" min={0} max={12} value={maxGrade} readOnly={gradeRangeLocked}
            onChange={(e) => setMaxGrade(e.target.value)}
            className={cn("w-20", gradeRangeLocked && "cursor-not-allowed bg-line/40 text-ink-faint")}
          />
        </Field>
        <Button onClick={() => create.mutate()} disabled={!code || !nameEn}>{t("common.add")}</Button>
      </Card>
      <div className="grid gap-2 md:grid-cols-3">
        {subjects?.map((s) => (
          <Card key={s.id} className="text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-xs text-ink-faint">{s.code}</span> {s.name_i18n?.en}
                <p className="mt-1 text-xs text-ink-faint">{t("gradeCycles.gradeRange")}: {rangeLabel(s)}</p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => openEdit(s)}>{t("crud.edit")}</button>
                <button type="button" className="font-medium text-danger hover:underline" onClick={() => setDeleting(s)}>{t("crud.delete")}</button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} />

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`${t("crud.edit")} ${editing?.code ?? ""}`}>
        <div className="space-y-3">
          <Field label={t("common.code")}><Input value={editCode} onChange={(e) => setEditCode(e.target.value.toUpperCase())} maxLength={12} /></Field>
          <Field label={t("common.nameEnglish")}><Input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)} maxLength={80} /></Field>
          <Field label={t("common.nameAmharic")}><Input value={editNameAm} onChange={(e) => setEditNameAm(e.target.value)} maxLength={80} /></Field>
          <Field label={t("gradeCycles.pickCycle")}>
            <select
              className={SELECT_CLS}
              value={editSelectedCycleId}
              onChange={(e) => {
                const id = e.target.value;
                setEditSelectedCycleId(id);
                const cyc = cycles?.find((c) => c.id === id);
                if (cyc) { setEditMinGrade(String(cyc.min_grade)); setEditMaxGrade(String(cyc.max_grade)); }
              }}
            >
              <option value="">{t("gradeCycles.customRange")}</option>
              {cycles?.map((c) => <option key={c.id} value={c.id}>{tField(c.name_i18n, i18n.resolvedLanguage!)}</option>)}
            </select>
          </Field>
          <div className="flex gap-2">
            <Field label={t("gradeCycles.minGrade")}>
              <Input
                type="number" min={0} max={12} value={editMinGrade} readOnly={editGradeRangeLocked}
                onChange={(e) => setEditMinGrade(e.target.value)}
                className={cn("w-20", editGradeRangeLocked && "cursor-not-allowed bg-line/40 text-ink-faint")}
              />
            </Field>
            <Field label={t("gradeCycles.maxGrade")}>
              <Input
                type="number" min={0} max={12} value={editMaxGrade} readOnly={editGradeRangeLocked}
                onChange={(e) => setEditMaxGrade(e.target.value)}
                className={cn("w-20", editGradeRangeLocked && "cursor-not-allowed bg-line/40 text-ink-faint")}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={() => update.mutate()} disabled={!editCode || !editNameEn || update.isPending}>{t("common.save")}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("crud.delete")}>
        <p className="text-sm text-ink-soft">
          {t("crud.delete")} <span className="font-medium text-ink">{deleting?.code} — {deleting?.name_i18n?.en}</span>{t("crud.cannotUndo")}
        </p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
