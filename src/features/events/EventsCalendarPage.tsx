import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";
import { tField } from "@/lib/i18n";
import { toIsoDate } from "@/lib/ethiopian-date";

const TYPE_TONE = { holiday: "navy", exam_window: "danger", national: "ok", custom: "neutral" } as const;
const TYPES = ["holiday", "exam_window", "national", "custom"] as const;
type EventType = (typeof TYPES)[number];

interface EventRow {
  id: string;
  event_date: string;
  name_i18n: Record<string, string>;
  event_type: string;
}
type FormState = { name: string; date: Date | null; type: EventType };
const emptyForm: FormState = { name: "", date: null, type: "holiday" };

export function EventsCalendarPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);
  const [deleting, setDeleting] = useState<EventRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: events } = useQuery({
    queryKey: ["calendar-events"],
    queryFn: async () =>
      ((await supabase.from("calendar_events").select("id, event_date, name_i18n, event_type").order("event_date")).data ?? []) as EventRow[],
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("calendar_events").insert({
        tenant_id: profile!.tenant_id, name_i18n: { en: form.name }, event_date: toIsoDate(form.date!), event_type: form.type,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); setShowCreate(false); setForm(emptyForm); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("calendar_events").update({
        name_i18n: { en: editForm.name }, event_date: toIsoDate(editForm.date!), event_type: editForm.type,
      }).eq("id", editing!.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("calendar_events").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const openEdit = (e: EventRow) => {
    setEditing(e);
    setEditForm({ name: tField(e.name_i18n, "en"), date: new Date(e.event_date + "T00:00:00"), type: e.event_type as EventType });
  };

  const fields = (f: FormState, set: (f: FormState) => void) => (
    <div className="space-y-3">
      <Field label={t("common.name")}><Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder={t("confirm.ethiopianNewYear")} /></Field>
      <Field label={t("crud.date")}><EthDatePicker value={f.date} onChange={(d) => set({ ...f, date: d })} /></Field>
      <Field label={t("crud.type")}>
        <select value={f.type} onChange={(e) => set({ ...f, type: e.target.value as EventType })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          {TYPES.map((ty) => <option key={ty} value={ty}>{t(`events.eventType.${ty}`)}</option>)}
        </select>
      </Field>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("events.title")}</h1>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }}>+ {t("crud.addEvent")}</Button>
      </div>

      {error && <Card className="border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <div className="space-y-2">
        {events?.map((e) => (
          <Card key={e.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ink">{tField(e.name_i18n, i18n.resolvedLanguage!)}</p>
              <p className="text-sm text-ink-faint"><EthDate value={e.event_date} /></p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={TYPE_TONE[e.event_type as keyof typeof TYPE_TONE] ?? "neutral"}>{t(`events.eventType.${e.event_type}`)}</Badge>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(e)}>{t("crud.edit")}</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(e)}>{t("crud.delete")}</Button>
            </div>
          </Card>
        ))}
        {!events?.length && <Card className="py-12 text-center text-ink-faint">{t("crud.noEvents")}</Card>}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("crud.addEvent")}>
        {fields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name || !form.date || create.isPending}>{t("crud.create")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("crud.editEvent")}>
        {fields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={!editForm.name || !editForm.date || update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("crud.deleteEvent")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting && tField(deleting.name_i18n, i18n.resolvedLanguage!)}</span>?</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
