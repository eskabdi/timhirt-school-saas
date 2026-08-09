// "Add New" event/holiday editor. Opens either from the Add Event button or
// from a click on a calendar day, in which case that day arrives prefilled as
// the start date.
//
// The Event/Holiday tabs pick which event_type the row is saved with: a holiday
// is what colours a day cell across the whole school, an event is a dated entry
// that sits inside the day. Everything else on the form is shared, so the tabs
// switch a value rather than swapping the form.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { EthDatePicker } from "@/components/EthDatePicker";
import { RoleVisibility } from "@/components/ui/RoleVisibility";
import { toIsoDate } from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";

export const EVENT_COLORS = [
  "#E53935", "#FB8C00", "#FDD835", "#43A047", "#00897B",
  "#00ACC1", "#8E24AA", "#D81B60", "#1E88E5",
];

export interface EventRow {
  id: string;
  event_date: string;
  end_date: string | null;
  name_i18n: Record<string, string>;
  event_type: string;
  notes: string | null;
  color: string | null;
  visible_to_roles: string[] | null;
  all_schools: boolean;
}

type Tab = "event" | "holiday";

export function EventFormModal({ open, onClose, initialDate, editing }: {
  open: boolean;
  onClose: () => void;
  /** Prefilled start date — set when the user clicked a calendar cell. */
  initialDate?: Date | null;
  editing?: EventRow | null;
}) {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>("event");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState<Date | null>(null);
  const [end, setEnd] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [color, setColor] = useState(EVENT_COLORS[0]!);
  const [roles, setRoles] = useState<string[]>([]);
  const [allSchools, setAllSchools] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset per opening: a stale title from the last event must not appear on the
  // next day the user clicks.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setTab(editing.event_type === "holiday" || editing.event_type === "national" ? "holiday" : "event");
      setTitle(editing.name_i18n?.[i18n.resolvedLanguage ?? "en"] ?? editing.name_i18n?.en ?? "");
      setStart(new Date(editing.event_date + "T00:00:00Z"));
      setEnd(editing.end_date ? new Date(editing.end_date + "T00:00:00Z") : null);
      setNotes(editing.notes ?? "");
      setColor(editing.color ?? EVENT_COLORS[0]!);
      setRoles(editing.visible_to_roles ?? []);
      setAllSchools(editing.all_schools);
    } else {
      setTab("event");
      setTitle("");
      setStart(initialDate ?? null);
      setEnd(null);
      setNotes("");
      setColor(EVENT_COLORS[0]!);
      setRoles([]);
      setAllSchools(false);
    }
  }, [open, editing, initialDate, i18n.resolvedLanguage]);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t("eventForm.titleRequired"));
      if (!start) throw new Error(t("eventForm.startRequired"));
      if (end && end < start) throw new Error(t("eventForm.endBeforeStart"));
      const row = {
        tenant_id: profile!.tenant_id,
        event_date: toIsoDate(start),
        end_date: end ? toIsoDate(end) : null,
        name_i18n: { [i18n.resolvedLanguage ?? "en"]: title.trim(), en: title.trim() },
        event_type: tab === "holiday" ? "holiday" : "custom",
        notes: notes.trim() || null,
        color,
        visible_to_roles: roles.length ? roles : null,
        all_schools: allSchools,
      };
      const { error: err } = editing
        ? await supabase.from("calendar_events").update(row).eq("id", editing.id)
        : await supabase.from("calendar_events").insert(row);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("eventForm.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("calendar_events").delete().eq("id", editing!.id);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar-events"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("eventForm.saveFailed")),
  });

  const tabBtn = (v: Tab, label: string) => (
    <button type="button" onClick={() => setTab(v)}
      className={cn("-mb-px border-b-2 px-4 pb-2 text-sm font-medium",
        tab === v ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink")}>
      {label}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? t("eventForm.editTitle") : t("eventForm.addNew")} size="lg">
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <div className="mb-4 flex gap-2 border-b border-line">
        {tabBtn("event", t("eventForm.tabEvent"))}
        {tabBtn("holiday", t("eventForm.tabHoliday"))}
      </div>

      <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        <Field label={`${t("assignments.titleLabel")} *`}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={`${t("eventForm.startDate")} *`}>
            <EthDatePicker value={start} onChange={setStart} />
          </Field>
          {/* Optional: a single-day event leaves this empty and stores end_date null. */}
          <Field label={t("eventForm.endDate")}>
            <EthDatePicker value={end} onChange={setEnd} />
          </Field>
        </div>
        <Field label={t("eventForm.notes")}>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={1000}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>

        <div className="space-y-1">
          <p className="text-sm font-semibold text-ink">{t("eventForm.eventColor")}</p>
          <div className="flex flex-wrap gap-2">
            {EVENT_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)}
                aria-label={c} aria-pressed={color === c}
                className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: c, outline: color === c ? "2px solid var(--brand-ink, #171A2B)" : undefined, outlineOffset: 2 }}>
                {color === c ? "✓" : ""}
              </button>
            ))}
          </div>
        </div>

        <RoleVisibility selected={roles} onChange={setRoles} />

        <label className="flex items-center gap-3 pt-1 text-sm text-ink">
          <span className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
            allSchools ? "bg-navy" : "bg-line")}>
            <input type="checkbox" checked={allSchools} onChange={(e) => setAllSchools(e.target.checked)}
              className="peer absolute inset-0 z-10 cursor-pointer opacity-0" />
            <span className={cn("pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              allSchools ? "left-[22px]" : "left-0.5")} />
          </span>
          {t("eventForm.applyAllSchools")}
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        {/* Deleting was reachable from the old list view; keep it available now
            that editing happens here instead. */}
        {editing ? (
          <Button variant="ghost" className="text-danger" onClick={() => {
            if (window.confirm(t("eventForm.deleteConfirm"))) remove.mutate();
          }} disabled={remove.isPending}>
            {t("crud.delete")}
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t("eventForm.saving") : t("eventForm.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
