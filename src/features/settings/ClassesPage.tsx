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

interface ClassRow {
  id: string;
  name: string;
  section: string | null;
  grade_level: number | null;
  capacity: number | null;
}

const emptyForm = { name: "", section: "", gradeLevel: "", capacity: "" };

export function ClassesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<ClassRow | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [deleting, setDeleting] = useState<ClassRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: years } = useQuery({
    queryKey: ["academic-years"],
    queryFn: async () => (await supabase.from("academic_years").select("id,ec_year").eq("status", "active")).data ?? [],
  });
  const { data: classes } = useQuery({
    queryKey: ["classes-admin"],
    queryFn: async () =>
      ((await supabase.from("classes").select("id,name,section,grade_level,capacity").order("grade_level")).data ?? []) as ClassRow[],
  });
  const { data: enrolledCounts } = useQuery({
    queryKey: ["classes-admin-enrolled"],
    queryFn: async () => {
      const { data } = await supabase.from("students").select("class_id").eq("status", "active");
      const counts = new Map<string, number>();
      for (const s of data ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
      return counts;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!years?.[0]) throw new Error("No active academic year — create one first.");
      const { error } = await supabase.from("classes").insert({
        tenant_id: profile!.tenant_id,
        academic_year_id: years[0].id,
        name: form.name,
        section: form.section || null,
        grade_level: form.gradeLevel === "" ? null : Number(form.gradeLevel),
        capacity: form.capacity === "" ? null : Number(form.capacity),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      setForm(emptyForm);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to add class"),
  });

  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("classes").update({
        name: editForm.name,
        section: editForm.section || null,
        grade_level: editForm.gradeLevel === "" ? null : Number(editForm.gradeLevel),
        capacity: editForm.capacity === "" ? null : Number(editForm.capacity),
      }).eq("id", editing!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      setEditing(null);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to update class"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("classes").delete().eq("id", deleting!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      setDeleting(null);
      setError(null);
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to delete class"),
  });

  const openEdit = (c: ClassRow) => {
    setEditing(c);
    setEditForm({
      name: c.name,
      section: c.section ?? "",
      gradeLevel: c.grade_level?.toString() ?? "",
      capacity: c.capacity?.toString() ?? "",
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("crud.classes")}</h1>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <Card className="flex flex-wrap items-end gap-2">
        <Field label={t("common.name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder={t("confirm.gradeExample")} /></Field>
        <Field label={t("crud.section")}><Input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} maxLength={10} placeholder="A" /></Field>
        <Field label={t("crud.gradeLevel")}><Input type="number" min={0} max={12} value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} className="w-24" /></Field>
        <Field label={t("crud.capacity")}><Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="w-24" placeholder={t("crud.unlimited")} /></Field>
        <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>{t("common.add")}</Button>
      </Card>

      <div className="grid gap-2 md:grid-cols-3">
        {classes?.map((c) => {
          const enrolled = enrolledCounts?.get(c.id) ?? 0;
          return (
            <Card key={c.id} className="space-y-2 text-sm">
              <div>
                <p className="font-medium text-ink">{c.name} {c.section}</p>
                <p className="text-xs text-ink-faint">
                  {c.capacity != null ? `${enrolled}/${c.capacity} enrolled` : `${enrolled} enrolled`}
                  {c.grade_level != null ? ` · grade ${c.grade_level}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(c)}>{t("crud.edit")}</Button>
                <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(c)}>{t("crud.delete")}</Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ""}`}>
        <div className="space-y-3">
          <Field label={t("common.name")}><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} maxLength={40} /></Field>
          <Field label={t("crud.section")}><Input value={editForm.section} onChange={(e) => setEditForm({ ...editForm, section: e.target.value })} maxLength={10} /></Field>
          <Field label={t("crud.gradeLevel")}><Input type="number" min={0} max={12} value={editForm.gradeLevel} onChange={(e) => setEditForm({ ...editForm, gradeLevel: e.target.value })} /></Field>
          <Field label={t("crud.capacity")}><Input type="number" min={1} value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} placeholder={t("crud.unlimited")} /></Field>
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
