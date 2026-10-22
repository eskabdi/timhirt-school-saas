// The school's calendar editor (F-01 slice 2a, 20261022000001). A draft is
// edited directly; publishing it, and every change once it is published, is a
// request a second person approves under Approvals. The database decides all
// of it (permissions, locks, ranges, the freeze while a publish request
// waits); this component only offers what the server would accept and
// explains a refusal in the user's language.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";
import { tField } from "@/lib/i18n";
import { fromIsoDate, toIsoDate } from "@/lib/ethiopian-date";
import {
  deleteDraftEntry, editorErrorKey, fetchCalendarRequests, fetchSchoolEntries, requestChange, requestPublish,
  saveDraftEntry, type DayTypeRow, type EffectiveEntry, type EntryInput, type SchoolEntry,
} from "./api";

interface FormState {
  entryId: string | null;
  /** Kept when an entry that replaces a MoE/regional date is edited. */
  overridesEntryId: string | null;
  dayType: string;
  startsOn: string;
  endsOn: string;
  names: { en: string; am: string; om: string };
}

type Notice = { tone: "ok" | "error"; text: string; seq: number };

export function CalendarEditor({ calendarId, status, dayTypes, selectedIso, selectedEntries, canPublish, lang }: {
  calendarId: string;
  status: "draft" | "published";
  dayTypes: DayTypeRow[];
  selectedIso: string | null;
  /** The effective entries on the selected day (to offer removing an unlocked MoE/regional one). */
  selectedEntries: EffectiveEntry[];
  canPublish: boolean;
  lang: string;
}) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const ids = useId();
  const published = status === "published";
  // Scoped to the school and user like the rest of the page (§6.3).
  const scope = [profile?.tenant_id ?? null, profile?.id ?? null];
  const entries = useQuery({
    queryKey: ["academic-calendar", ...scope, "school-entries", calendarId],
    queryFn: () => fetchSchoolEntries(calendarId),
  });
  const requests = useQuery({
    queryKey: ["academic-calendar", ...scope, "requests", calendarId],
    queryFn: () => fetchCalendarRequests(calendarId),
  });
  const publishPending = requests.data?.some((r) => r.action === "academic_calendar_publish") ?? false;
  const pendingEntries = useMemo(() => new Set((requests.data ?? [])
    .filter((r) => r.action === "academic_calendar_change").map((r) => r.entity_id)), [requests.data]);
  // A draft waiting for its publish approval is frozen (the server refuses edits).
  const frozen = !published && publishPending;

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const editable = dayTypes.filter((d) => !d.derived && !d.authority_only);
  const typeLabel = (code: string) => tField(dayTypes.find((d) => d.code === code)?.label_i18n, lang) || code;
  const say = (tone: Notice["tone"], text: string) => setNotice((prev) => ({ tone, text, seq: (prev?.seq ?? 0) + 1 }));
  const failed = (err: unknown) => say("error", t(`academicCalendar.editor.error.${editorErrorKey(err)}`));
  const done = (key: string) => {
    say("ok", t(`academicCalendar.editor.${key}`));
    setForm(null);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["academic-calendar"] });
    void qc.invalidateQueries({ queryKey: ["approvals-pending-count"] });
  };
  const why = () => reason.trim() || null;

  const save = useMutation({
    mutationFn: (f: FormState) => {
      const input: EntryInput = {
        day_type_code: f.dayType, starts_on: f.startsOn, ends_on: f.endsOn,
        name_i18n: Object.fromEntries(Object.entries(f.names).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
        overrides_entry_id: f.overridesEntryId,
      };
      return published
        ? requestChange(f.entryId ? "update" : "add", f.entryId ?? calendarId, input, why())
        : saveDraftEntry(calendarId, f.entryId, input);
    },
    onSuccess: () => done(published ? "sent" : "saved"),
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: async (e: SchoolEntry) => {
      if (published) await requestChange("delete", e.id, null, why());
      else await deleteDraftEntry(e.id);
    },
    onSuccess: () => done(published ? "sent" : "deleted"),
    onError: failed,
  });
  // Removing an unlocked MoE/regional date for this school only.
  const suppress = useMutation({
    mutationFn: (e: EffectiveEntry) => {
      const input: EntryInput = {
        day_type_code: e.day_type_code, starts_on: e.starts_on, ends_on: e.ends_on, name_i18n: e.name_i18n,
        overrides_entry_id: e.entry_id, suppressed: true,
      };
      return published ? requestChange("add", calendarId, input, why()) : saveDraftEntry(calendarId, null, input);
    },
    onSuccess: () => done(published ? "sent" : "saved"),
    onError: failed,
  });
  const publish = useMutation({
    mutationFn: () => requestPublish(calendarId, why()),
    onSuccess: () => done("publishSent"),
    onError: failed,
  });
  const busy = save.isPending || remove.isPending || suppress.isPending || publish.isPending;

  const openForm = (f: FormState) => { setFormError(null); setForm(f); };
  const submit = () => {
    if (!form) return;
    if (!Object.values(form.names).some((v) => v.trim())) return setFormError(t("academicCalendar.editor.needName"));
    if (!form.startsOn || !form.endsOn || form.endsOn < form.startsOn) return setFormError(t("academicCalendar.editor.needRange"));
    setFormError(null);
    save.mutate(form);
  };

  // A date the school already replaces or removes, or a request waits on, is not offered again.
  const suppressedTargets = new Set([
    ...(entries.data ?? []).map((e) => e.overrides_entry_id),
    ...(requests.data ?? []).map((r) => r.overrides_entry_id),
  ].filter((id): id is string => !!id));
  const removable = selectedEntries.filter((e) => e.level !== "school" && !e.locked && !suppressedTargets.has(e.entry_id));

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">{t("academicCalendar.editor.title")}</h2>
        {publishPending && <Badge tone="late">{t("academicCalendar.editor.publishPending")}</Badge>}
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        {published ? t("academicCalendar.editor.publishedNote") : frozen ? t("academicCalendar.editor.frozenNote") : t("academicCalendar.editor.draftNote")}
      </p>

      <p key={notice?.seq ?? 0} ref={noticeRef} tabIndex={-1} role={notice?.tone === "error" ? "alert" : "status"}
        className={`mt-2 text-sm focus:outline-none ${notice?.tone === "error" ? "text-danger" : "text-ok"}`}>
        {notice?.text ?? ""}
      </p>
      {(entries.isError || requests.isError) && (
        <p role="alert" className="text-sm text-danger">{t("academicCalendar.editor.loadFailed")}</p>
      )}

      {(published || (!published && canPublish && !frozen)) && (
        <label className="mt-2 block text-sm">
          <span className="text-ink">{t("academicCalendar.editor.reason")}</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
            className="mt-1 w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          <span className="block text-xs text-ink-soft">{t("academicCalendar.editor.reasonHint")}</span>
        </label>
      )}

      {selectedIso && !frozen && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <p className="text-sm text-ink"><EthDate value={selectedIso} /></p>
          <div className="flex flex-wrap gap-2">
            <Button variant="tertiary" disabled={busy}
              onClick={() => openForm({ entryId: null, overridesEntryId: null, dayType: editable[0]?.code ?? "", startsOn: selectedIso, endsOn: selectedIso, names: { en: "", am: "", om: "" } })}>
              {t("academicCalendar.editor.addHere")}
            </Button>
            {removable.map((e) => (
              <Button key={e.entry_id} variant="tertiary" disabled={busy} onClick={() => suppress.mutate(e)}>
                {t("academicCalendar.editor.removeForSchool", { name: tField(e.name_i18n, lang) })}
              </Button>
            ))}
          </div>
        </div>
      )}

      {form && (
        <EntryForm form={form} setForm={setForm} types={editable} lang={lang} error={formError} busy={busy}
          submitLabel={published ? t("academicCalendar.editor.sendForApproval") : t("academicCalendar.editor.save")}
          onSubmit={submit} onCancel={() => setForm(null)} />
      )}

      {/* A list, not a table: it wraps at phone width instead of scrolling the page (WCAG 1.4.10). */}
      <h3 id={`${ids}-entries`} className="mt-3 text-sm font-medium text-ink">{t("academicCalendar.editor.entriesTitle")}</h3>
      {entries.data?.length === 0 && <p className="mt-1 text-sm text-ink-soft">{t("academicCalendar.editor.noEntries")}</p>}
      <ul aria-labelledby={`${ids}-entries`} className="mt-1 divide-y divide-line text-sm">
        {entries.data?.map((e) => {
          const name = tField(e.name_i18n, lang);
          const pending = pendingEntries.has(e.id);
          return (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <div className="min-w-0">
                <p className="text-ink">
                  {e.suppressed ? t("academicCalendar.editor.removedLabel", { name }) : name}
                  {pending && <> <Badge tone="late">{t("academicCalendar.editor.pending")}</Badge></>}
                </p>
                <p className="flex min-w-0 flex-wrap gap-x-1 text-xs text-ink-soft">
                  <span>{typeLabel(e.day_type_code)} ·</span>
                  <EthDate value={e.starts_on} />{e.ends_on !== e.starts_on && <><span>–</span><EthDate value={e.ends_on} /></>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {!e.suppressed && (
                  <Button variant="ghost" disabled={busy || pending || frozen} aria-label={t("academicCalendar.editor.editNamed", { name })}
                    onClick={() => openForm({ entryId: e.id, overridesEntryId: e.overrides_entry_id, dayType: e.day_type_code, startsOn: e.starts_on, endsOn: e.ends_on,
                      names: { en: e.name_i18n.en ?? "", am: e.name_i18n.am ?? "", om: e.name_i18n.om ?? "" } })}>
                    {published ? t("academicCalendar.editor.requestChange") : t("academicCalendar.editor.edit")}
                  </Button>
                )}
                <Button variant="ghost" disabled={busy || pending || frozen}
                  aria-label={t(e.suppressed ? "academicCalendar.editor.restoreNamed" : "academicCalendar.editor.deleteNamed", { name })}
                  onClick={() => remove.mutate(e)}>
                  {e.suppressed ? t("academicCalendar.editor.restore")
                    : published ? t("academicCalendar.editor.requestRemoval") : t("academicCalendar.editor.delete")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {!published && canPublish && (
        <div className="mt-3 border-t border-line pt-3">
          <Button onClick={() => publish.mutate()} disabled={busy || frozen} aria-describedby={`${ids}-publish`}>
            {t("academicCalendar.editor.publish")}
          </Button>
          <p id={`${ids}-publish`} className="mt-1 text-xs text-ink-soft">{t("academicCalendar.editor.publishHint")}</p>
        </div>
      )}
    </Card>
  );
}

function EntryForm({ form, setForm, types, lang, error, busy, submitLabel, onSubmit, onCancel }: {
  form: FormState; setForm: (f: FormState) => void; types: DayTypeRow[]; lang: string; error: string | null;
  busy: boolean; submitLabel: string; onSubmit: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const typeRef = useRef<HTMLSelectElement>(null);
  // Focus moves into the form when it opens (WCAG 2.4.3).
  useEffect(() => { typeRef.current?.focus(); }, [form.entryId]);
  const pick = (key: "startsOn" | "endsOn") => (d: Date) => setForm({ ...form, [key]: toIsoDate(d) });
  return (
    <form className="mt-3 space-y-3 rounded-panel border border-line p-3" aria-labelledby={`${ids}-title`}
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <h3 id={`${ids}-title`} className="text-sm font-semibold text-ink">
        {form.entryId ? t("academicCalendar.editor.editTitle") : t("academicCalendar.editor.addTitle")}
      </h3>
      <div>
        <label htmlFor={`${ids}-type`} className="block text-sm text-ink">{t("academicCalendar.editor.type")}</label>
        <select id={`${ids}-type`} ref={typeRef} value={form.dayType} onChange={(e) => setForm({ ...form, dayType: e.target.value })}
          className="mt-1 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          {types.map((d) => <option key={d.code} value={d.code}>{tField(d.label_i18n, lang)}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span id={`${ids}-from`} className="block text-sm text-ink">{t("academicCalendar.editor.from")}</span>
          <EthDatePicker labelledBy={`${ids}-from`} value={form.startsOn ? fromIsoDate(form.startsOn) : null} onChange={pick("startsOn")} />
        </div>
        <div>
          <span id={`${ids}-to`} className="block text-sm text-ink">{t("academicCalendar.editor.to")}</span>
          <EthDatePicker labelledBy={`${ids}-to`} value={form.endsOn ? fromIsoDate(form.endsOn) : null} onChange={pick("endsOn")} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["en", "am", "om"] as const).map((k) => (
          <label key={k} className="block text-sm">
            <span className="text-ink">{t(`academicCalendar.editor.name_${k}`)}</span>
            <input type="text" value={form.names[k]} maxLength={200}
              onChange={(e) => setForm({ ...form, names: { ...form.names, [k]: e.target.value } })}
              className="mt-1 w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-soft">{t("academicCalendar.editor.nameHint")}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{submitLabel}</Button>
        <Button type="button" variant="tertiary" onClick={onCancel}>{t("academicCalendar.editor.cancel")}</Button>
      </div>
    </form>
  );
}
