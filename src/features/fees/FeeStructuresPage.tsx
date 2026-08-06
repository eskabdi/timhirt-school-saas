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
import { useTranslation } from "react-i18next";

const CYCLES = ["monthly", "term", "annual", "once"] as const;
type Cycle = (typeof CYCLES)[number];

interface FeeRow {
  id: string;
  name_i18n: Record<string, string>;
  amount: number;
  billing_cycle: string;
  class_id: string | null;
}
type FormState = { name: string; amount: string; cycle: Cycle; classId: string };
const emptyForm: FormState = { name: "", amount: "", cycle: "term", classId: "" };

export function FeeStructuresPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<FeeRow | null>(null);
  const [deleting, setDeleting] = useState<FeeRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["fee-structures"],
    queryFn: async () =>
      ((await supabase.from("fee_structures").select("id, name_i18n, amount, billing_cycle, class_id")).data ?? []) as FeeRow[],
  });
  const { data: classes } = useQuery({
    queryKey: ["fee-classes"],
    queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level").order("grade_level")).data ?? [],
  });
  // A fee structure scopes to a grade, not a specific section -- classes has
  // one row per section, so the picker dedupes by name and keys the fee to
  // the first section's row in that grade, mirroring the same dedupe-by-name
  // grade list submit-admission already builds for the public form.
  const grades = useMemo(() => {
    const byName = new Map<string, { id: string; name: string; grade_level: number | null }>();
    for (const c of classes ?? []) if (!byName.has(c.name)) byName.set(c.name, c);
    return [...byName.values()].sort((a, b) => (a.grade_level ?? 999) - (b.grade_level ?? 999));
  }, [classes]);

  const payload = (f: FormState) => ({
    name_i18n: { en: f.name },
    amount: Number(f.amount),
    billing_cycle: f.cycle,
    class_id: f.classId || null,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("fee_structures").insert({ tenant_id: profile!.tenant_id, ...payload(form) });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fee-structures"] }); setShowCreate(false); setForm(emptyForm); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => {
      const f: FormState = { name: tField(editing!.name_i18n, "en"), amount: String(editing!.amount), cycle: editing!.billing_cycle as Cycle, classId: editing!.class_id ?? "" };
      const { error } = await supabase.from("fee_structures").update(payload(f)).eq("id", editing!.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fee-structures"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("fee_structures").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fee-structures"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const classLabel = (id: string | null) => {
    if (!id) return "All classes";
    const c = classes?.find((x) => x.id === id);
    return c ? c.name : "—";
  };

  const formFields = (f: FormState, set: (f: FormState) => void) => (
    <div className="space-y-3">
      <Field label={t("common.name")}><Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder={t("confirm.tuition")} /></Field>
      <Field label={t("crud.amountEtb")}><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => set({ ...f, amount: e.target.value })} /></Field>
      <Field label={t("crud.billingCycle")}>
        <select value={f.cycle} onChange={(e) => set({ ...f, cycle: e.target.value as Cycle })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          {CYCLES.map((c) => <option key={c} value={c}>{t(`fees.cycle.${c}`)}</option>)}
        </select>
      </Field>
      <Field label={t("crud.classOptional")}>
        <select value={f.classId} onChange={(e) => set({ ...f, classId: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">{t("crud.allClasses")}</option>
          {grades.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
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
              <p className="text-sm text-ink-faint">{t(`fees.cycle.${f.billing_cycle}`)} · {classLabel(f.class_id)}</p>
              <p className="mt-1 font-display text-xl font-bold text-ink">{formatETB(Number(f.amount), i18n.resolvedLanguage!)}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(f)}>{t("crud.edit")}</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(f)}>{t("crud.delete")}</Button>
            </div>
          </Card>
        ))}
        {!data?.length && <Card className="py-12 text-center text-ink-faint md:col-span-2">{t("crud.noFeeStructures")}</Card>}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("crud.addFeeStructure")}>
        {formFields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name || form.amount === "" || create.isPending}>{t("crud.create")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("crud.editFeeStructure")}>
        {editing && formFields(
          { name: tField(editing.name_i18n, "en"), amount: String(editing.amount), cycle: editing.billing_cycle as Cycle, classId: editing.class_id ?? "" },
          (f) => setEditing({ ...editing, name_i18n: { en: f.name }, amount: Number(f.amount), billing_cycle: f.cycle, class_id: f.classId || null }),
        )}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("crud.deleteFeeStructure")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting && tField(deleting.name_i18n, i18n.resolvedLanguage!)}</span>?</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
