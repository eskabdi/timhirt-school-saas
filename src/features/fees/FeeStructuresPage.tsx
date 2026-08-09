import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { formatETB, tField } from "@/lib/i18n";
import { useGradeCycles } from "@/lib/gradeCycles";
import { generateFeeInvoices } from "./api";
import { useTranslation } from "react-i18next";

const CYCLES = ["monthly", "term", "annual", "once"] as const;
type Cycle = (typeof CYCLES)[number];
type ScopeType = "all" | "class" | "grade" | "cycle";
const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

interface FeeRow {
  id: string;
  name_i18n: Record<string, string>;
  amount: number;
  billing_cycle: string;
  class_id: string | null;
  grade_level: number | null;
  grade_cycle_id: string | null;
}
type FormState = {
  name: string; amount: string; cycle: Cycle;
  scopeType: ScopeType; classId: string; gradeLevel: string; gradeCycleId: string;
};
const emptyForm: FormState = { name: "", amount: "", cycle: "term", scopeType: "all", classId: "", gradeLevel: "", gradeCycleId: "" };

// class_id / grade_level / grade_cycle_id are mutually exclusive
// (fee_structures_scope_check, 20260814000003) -- this is the inverse
// mapping, deriving which one a saved row is using for the edit form.
function scopeTypeFor(f: FeeRow): ScopeType {
  if (f.class_id) return "class";
  if (f.grade_level != null) return "grade";
  if (f.grade_cycle_id) return "cycle";
  return "all";
}

export function FeeStructuresPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<FeeRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generateResult, setGenerateResult] = useState<{ id: string; created: number; skipped: number; total: number } | null>(null);

  const { data } = useQuery({
    queryKey: ["fee-structures"],
    queryFn: async () =>
      ((await supabase.from("fee_structures").select("id, name_i18n, amount, billing_cycle, class_id, grade_level, grade_cycle_id")).data ?? []) as FeeRow[],
  });
  const { data: classes } = useQuery({
    queryKey: ["fee-classes"],
    queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level").order("grade_level")).data ?? [],
  });
  const { data: cycles } = useGradeCycles();
  // A "one class" fee scopes to a specific section -- classes has one row
  // per section, so the picker dedupes by name for a clean "pick a grade's
  // representative section" list, mirroring submit-admission's own
  // dedupe-by-name grade list. "Whole grade" (below) is the fix for the
  // pre-existing bug where this dedupe trick was the ONLY way to target a
  // grade and silently applied to just one arbitrary section.
  const grades = useMemo(() => {
    const byName = new Map<string, { id: string; name: string; grade_level: number | null }>();
    for (const c of classes ?? []) if (!byName.has(c.name)) byName.set(c.name, c);
    return [...byName.values()].sort((a, b) => (a.grade_level ?? 999) - (b.grade_level ?? 999));
  }, [classes]);
  const gradeLevels = useMemo(() => {
    const set = new Set<number>();
    for (const c of classes ?? []) if (c.grade_level != null) set.add(c.grade_level);
    return [...set].sort((a, b) => a - b);
  }, [classes]);

  const isFormValid = (f: FormState) =>
    !!f.name && f.amount !== ""
    && (f.scopeType !== "class" || !!f.classId)
    && (f.scopeType !== "grade" || f.gradeLevel !== "")
    && (f.scopeType !== "cycle" || !!f.gradeCycleId);

  const payload = (f: FormState) => ({
    name_i18n: { en: f.name },
    amount: Number(f.amount),
    billing_cycle: f.cycle,
    class_id: f.scopeType === "class" ? (f.classId || null) : null,
    grade_level: f.scopeType === "grade" && f.gradeLevel !== "" ? Number(f.gradeLevel) : null,
    grade_cycle_id: f.scopeType === "cycle" ? (f.gradeCycleId || null) : null,
  });

  const formStateFor = (f: FeeRow): FormState => ({
    name: tField(f.name_i18n, "en"), amount: String(f.amount), cycle: f.billing_cycle as Cycle,
    scopeType: scopeTypeFor(f), classId: f.class_id ?? "",
    gradeLevel: f.grade_level != null ? String(f.grade_level) : "", gradeCycleId: f.grade_cycle_id ?? "",
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("fee_structures")
        .insert({ tenant_id: profile!.tenant_id, ...payload(form) }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    // Auto-generating invoices the moment a fee structure is created closes
    // the gap that left InvoicesPage empty in production: before
    // generate-fee-invoices existed, enroll-finalize-billing was the ONLY
    // code path that ever inserted a fee_invoices row, and it only fires for
    // the one fee_structure_id chosen at admission time -- any fee structure
    // added afterward (or not part of that flow) got zero invoices, forever,
    // with no way to backfill them. This closes it going forward; existing
    // pre-this-feature fee structures still need one manual "Generate
    // Invoices" click each to backfill.
    onSuccess: (newId) => {
      qc.invalidateQueries({ queryKey: ["fee-structures"] });
      setShowCreate(false); setForm(emptyForm); setError(null);
      generate.mutate(newId);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fee_structures").update(payload(editForm)).eq("id", editing!.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fee-structures"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("fee_structures").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fee-structures"] }); setDeleting(null); setError(null); },
    // fee_invoices.fee_structure_id has no ON DELETE clause (defaults to
    // RESTRICT) -- deleting a structure that already has invoices (the
    // common case, since create auto-generates them) fails with 23503.
    // Surface that as the specific reason rather than a raw Postgres
    // message the admin has to decode, and keep the confirm modal open so
    // it's actually visible instead of a banner hidden behind it.
    onError: (e: unknown) => {
      const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
      setError(code === "23503" ? t("crud.feeStructureInUse") : e instanceof Error ? e.message : "Failed");
    },
  });
  const generate = useMutation({
    mutationFn: (feeStructureId: string) => generateFeeInvoices(feeStructureId),
    onSuccess: (res, feeStructureId) =>
      setGenerateResult({ id: feeStructureId, created: res.created_count, skipped: res.skipped_count, total: res.total_matched }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to generate invoices"),
  });

  const scopeLabel = (f: FeeRow) => {
    if (f.class_id) return classes?.find((x) => x.id === f.class_id)?.name ?? "—";
    if (f.grade_level != null) return `${t("crud.grade")} ${f.grade_level}`;
    if (f.grade_cycle_id) {
      const cyc = cycles?.find((c) => c.id === f.grade_cycle_id);
      return cyc ? tField(cyc.name_i18n, i18n.resolvedLanguage!) : "—";
    }
    return t("crud.allClasses");
  };

  const formFields = (f: FormState, set: (f: FormState) => void) => (
    <div className="space-y-3">
      <Field label={t("common.name")}><Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder={t("confirm.tuition")} /></Field>
      <Field label={t("crud.amountEtb")}><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set({ ...f, amount: e.target.value })} /></Field>
      <Field label={t("crud.billingCycle")}>
        <select value={f.cycle} onChange={(e) => set({ ...f, cycle: e.target.value as Cycle })} className={SELECT_CLS}>
          {CYCLES.map((c) => <option key={c} value={c}>{t(`fees.cycle.${c}`)}</option>)}
        </select>
      </Field>
      <Field label={t("gradeCycles.appliesTo")}>
        <select value={f.scopeType} onChange={(e) => set({ ...f, scopeType: e.target.value as ScopeType })} className={SELECT_CLS}>
          <option value="all">{t("crud.allClasses")}</option>
          <option value="class">{t("crud.classOptional")}</option>
          <option value="grade">{t("gradeCycles.wholeGrade")}</option>
          <option value="cycle">{t("gradeCycles.wholeCycle")}</option>
        </select>
      </Field>
      {f.scopeType === "class" && (
        <Field label={t("common.class")}>
          <select value={f.classId} onChange={(e) => set({ ...f, classId: e.target.value })} className={SELECT_CLS}>
            <option value="">—</option>
            {grades.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {f.scopeType === "grade" && (
        <Field label={t("crud.gradeLevel")}>
          <select value={f.gradeLevel} onChange={(e) => set({ ...f, gradeLevel: e.target.value })} className={SELECT_CLS}>
            <option value="">—</option>
            {gradeLevels.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
      )}
      {f.scopeType === "cycle" && (
        <Field label={t("gradeCycles.cycle")}>
          <select value={f.gradeCycleId} onChange={(e) => set({ ...f, gradeCycleId: e.target.value })} className={SELECT_CLS}>
            <option value="">—</option>
            {cycles?.map((c) => <option key={c.id} value={c.id}>{tField(c.name_i18n, i18n.resolvedLanguage!)}</option>)}
          </select>
        </Field>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("fees.structuresTitle")}</h1>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }}>+ {t("crud.addFeeStructure")}</Button>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <div className="grid gap-3 md:grid-cols-2">
        {data?.map((f) => (
          <Card key={f.id} className="space-y-2">
            <div>
              <p className="font-medium text-ink">{tField(f.name_i18n, i18n.resolvedLanguage!)}</p>
              <p className="text-sm text-ink-faint">{t(`fees.cycle.${f.billing_cycle}`)} · {scopeLabel(f)}</p>
              <p className="mt-1 font-display text-xl font-bold text-ink">{formatETB(Number(f.amount), i18n.resolvedLanguage!)}</p>
            </div>
            {generateResult?.id === f.id && (
              <p className="text-xs text-ink-faint">
                {t("gradeCycles.generateInvoicesResult", {
                  created: generateResult.created, skipped: generateResult.skipped, total: generateResult.total,
                })}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setEditing(f); setEditForm(formStateFor(f)); }}>{t("crud.edit")}</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(f)}>{t("crud.delete")}</Button>
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() => generate.mutate(f.id)}
                disabled={generate.isPending}
              >
                {t("gradeCycles.generateInvoices")}
              </Button>
            </div>
          </Card>
        ))}
        {!data?.length && <Card className="py-12 text-center text-ink-faint md:col-span-2">{t("crud.noFeeStructures")}</Card>}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("crud.addFeeStructure")}>
        {formFields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!isFormValid(form) || create.isPending}>{t("crud.create")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("crud.editFeeStructure")}>
        {editing && formFields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={!isFormValid(editForm) || update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => { setDeleting(null); setError(null); }} title={t("crud.deleteFeeStructure")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting && tField(deleting.name_i18n, i18n.resolvedLanguage!)}</span>?</p>
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => { setDeleting(null); setError(null); }}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
