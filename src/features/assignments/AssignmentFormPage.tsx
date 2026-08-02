// Assignment Management — create or edit an assessment and push it to one or
// more sections.
//
// Four panels matching the design: Basic Information, Detailed Instructions
// (rich text + attachments), Deadline, and Grading & Type.
//
// Sections are a chip list rather than a single dropdown because one brief
// routinely goes to every stream of a grade (G10-A and G10-B). The rows live in
// assignment_sections; assignments.class_id is still written with the first
// selected section so any reader that predates the join table keeps working
// (migration 20260728000001).
//
// "Save as Draft" and "Create & Publish" are the same write with a different
// status — a draft is invisible to students until published, which is what lets
// a teacher prepare a week of work in advance.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, FieldGroup } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { Toggle } from "@/components/ui/Toggle";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { toIsoDate } from "@/lib/ethiopian-date";
import { tField } from "@/lib/i18n";

/** Mirrors assignments_category_check. */
const CATEGORIES = [
  "continuous_assessment", "homework", "project", "quiz", "lab_work", "final_exam",
] as const;

/** Mirrors assignments_submission_types_check. At least one is required. */
const SUBMISSION_TYPES = ["file_upload", "online_text", "physical"] as const;
type SubmissionType = (typeof SUBMISSION_TYPES)[number];

const ATTACH_ACCEPT = ".pdf,.doc,.docx,.jpg,.jpeg,.png";
const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

interface ClassRow { id: string; name: string; section: string | null }
interface AttachmentRow { id: string; file_name: string }

/** The edit-mode row. Declared explicitly because PostgREST's generated types
 *  cannot infer a select string that is assembled by concatenation. */
interface ExistingAssignment {
  id: string;
  title: string | null;
  subject_id: string | null;
  description: string | null;
  instructions_html: string | null;
  due_date: string | null;
  due_time: string | null;
  category: string | null;
  max_score: number | null;
  submission_types: string[] | null;
  status: string | null;
  assignment_sections: { class_id: string }[] | null;
  assignment_attachments: AttachmentRow[] | null;
}

export function AssignmentFormPage() {
  const { t, i18n } = useTranslation();
  const { assignmentId } = useParams();
  const nav = useNavigate();
  const { profile } = useSession();
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [addingSection, setAddingSection] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);
  const [dueTime, setDueTime] = useState("23:59");
  const [publishNow, setPublishNow] = useState(true);
  const [category, setCategory] = useState<string>("continuous_assessment");
  const [maxScore, setMaxScore] = useState("100");
  const [subTypes, setSubTypes] = useState<SubmissionType[]>(["file_upload"]);
  const [pending, setPending] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => ((await supabase.from("classes").select("id,name,section").order("name")).data ?? []) as ClassRow[],
  });
  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => (await supabase.from("subjects").select("id,name_i18n").order("code")).data ?? [],
  });

  // Edit mode: load the assignment plus its section rows and attachments.
  const { data: existing } = useQuery({
    queryKey: ["assignment", assignmentId],
    enabled: !!assignmentId,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("assignments")
        .select("id, title, subject_id, description, instructions_html, due_date, due_time, category, "
          + "max_score, submission_types, status, assignment_sections(class_id), "
          + "assignment_attachments(id, path, file_name, size_bytes)")
        .eq("id", assignmentId!).single();
      if (err) throw err;
      return data as unknown as ExistingAssignment;
    },
  });

  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title ?? "");
    setSubjectId(existing.subject_id ?? "");
    setSectionIds((existing.assignment_sections ?? []).map((s) => s.class_id));
    // Rows written before the rich text editor kept plain prose in `description`.
    setInstructions(existing.instructions_html ?? existing.description ?? "");
    setDueDate(existing.due_date ? new Date(`${existing.due_date}T00:00:00Z`) : null);
    setDueTime(String(existing.due_time ?? "23:59").slice(0, 5));
    setCategory(existing.category ?? "continuous_assessment");
    setMaxScore(String(existing.max_score ?? 100));
    setSubTypes((existing.submission_types ?? ["file_upload"]) as SubmissionType[]);
    setPublishNow(existing.status === "published");
  }, [existing]);

  const sectionLabel = (c: ClassRow) => `${c.name}${c.section ? `-${c.section}` : ""}`;
  const chosen = useMemo(
    () => (classes ?? []).filter((c) => sectionIds.includes(c.id)),
    [classes, sectionIds],
  );
  const available = useMemo(
    () => (classes ?? []).filter((c) => !sectionIds.includes(c.id)),
    [classes, sectionIds],
  );

  const toggleSubType = (v: SubmissionType) =>
    setSubTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const tooBig = Array.from(files).find((f) => f.size > ATTACH_MAX_BYTES);
    if (tooBig) { setError(t("assignmentForm.fileTooLarge", { name: tooBig.name })); return; }
    setError(null);
    setPending((prev) => [...prev, ...Array.from(files)]);
  };

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      if (!title.trim()) throw new Error(t("assignmentForm.titleRequired"));
      if (!subjectId) throw new Error(t("assignmentForm.subjectRequired"));
      if (sectionIds.length === 0) throw new Error(t("assignmentForm.sectionRequired"));
      if (!dueDate) throw new Error(t("assignmentForm.dueDateRequired"));
      if (subTypes.length === 0) throw new Error(t("assignmentForm.submissionTypeRequired"));
      const score = Number(maxScore);
      if (!Number.isFinite(score) || score <= 0) throw new Error(t("assignmentForm.maxScoreInvalid"));

      const row = {
        tenant_id: profile!.tenant_id,
        // First selected section only — assignment_sections below is the real list.
        class_id: sectionIds[0],
        subject_id: subjectId,
        title: title.trim(),
        instructions_html: instructions.trim() || null,
        due_date: toIsoDate(dueDate),
        due_time: dueTime,
        category,
        max_score: score,
        submission_types: subTypes,
        status: publish ? "published" : "draft",
        published_at: publish ? new Date().toISOString() : null,
      };

      let id = assignmentId;
      if (id) {
        const { error: err } = await supabase.from("assignments").update(row).eq("id", id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.from("assignments")
          .insert({ ...row, created_by: profile!.id }).select("id").single();
        if (err) throw err;
        id = data.id as string;
      }

      // Replace the section set wholesale — simpler than diffing, and the table
      // is two columns keyed by (assignment_id, class_id).
      await supabase.from("assignment_sections").delete().eq("assignment_id", id!);
      const { error: secErr } = await supabase.from("assignment_sections")
        .insert(sectionIds.map((cid) => ({ assignment_id: id!, class_id: cid, tenant_id: profile!.tenant_id })));
      if (secErr) throw secErr;

      for (const file of pending) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${profile!.tenant_id}/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("assignment-attachments")
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { error: metaErr } = await supabase.from("assignment_attachments").insert({
          assignment_id: id!, tenant_id: profile!.tenant_id, path,
          file_name: file.name.slice(0, 255), mime_type: file.type || null,
          size_bytes: file.size, uploaded_by: profile!.id,
        });
        if (metaErr) throw metaErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["assignment", assignmentId] });
      nav("/assignments");
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("assignmentForm.saveFailed")),
  });

  const submit = (publish: boolean) => { setError(null); save.mutate(publish); };

  return (
    <div className="space-y-5 pb-4">
      <p className="text-sm text-ink-faint">
        <Link to="/assignments" className="hover:underline">{t("nav.assignments")}</Link> › <span className="text-navy">{t("assignmentForm.title")}</span>
      </p>
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("assignmentForm.title")}</h1>
        <p className="mt-1 text-sm text-ink-faint">{t("assignmentForm.subtitle")}</p>
      </div>

      {/* ---------- Basic information ---------- */}
      <Panel>
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
            <span aria-hidden="true" className="mr-2">ⓘ</span>{t("assignmentForm.basicInformation")}
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t("assignmentForm.assignmentTitle")}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150}
                placeholder={t("assignmentForm.titlePlaceholder")} />
            </Field>
            <Field label={t("assignmentForm.subject")}>
              <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                <option value="">{t("assignmentForm.selectSubject")}</option>
                {subjects?.map((s) => (
                  <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!)}</option>
                ))}
              </select>
            </Field>
          </div>

          <FieldGroup label={t("assignmentForm.targetSections")}>
            <div className="flex flex-wrap items-center gap-2 rounded-control border border-line bg-card px-3 py-2">
              {chosen.map((c) => (
                <span key={c.id}
                  className="inline-flex items-center gap-1 rounded bg-navy-wash px-2 py-1 text-xs font-medium text-navy">
                  {sectionLabel(c)}
                  <button type="button" aria-label={t("assignmentForm.removeSection", { name: sectionLabel(c) })}
                    onClick={() => setSectionIds((p) => p.filter((x) => x !== c.id))}
                    className="text-navy/60 hover:text-navy">✕</button>
                </span>
              ))}
              {addingSection ? (
                // No onBlur close: opening a native select can blur the element,
                // which would unmount the picker before the choice registers.
                // It closes on a selection, on Escape, or on the placeholder.
                <select autoFocus value=""
                  onKeyDown={(e) => { if (e.key === "Escape") setAddingSection(false); }}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) setSectionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                    setAddingSection(false);
                  }}
                  className="rounded-control border border-line bg-card px-2 py-1 text-xs text-ink">
                  <option value="">{t("assignmentForm.selectSection")}</option>
                  {available.map((c) => <option key={c.id} value={c.id}>{sectionLabel(c)}</option>)}
                </select>
              ) : (
                <button type="button" onClick={() => setAddingSection(true)}
                  disabled={available.length === 0}
                  className="text-xs font-medium text-navy hover:underline disabled:text-ink-faint disabled:no-underline">
                  {t("assignmentForm.addSection")}
                </button>
              )}
            </div>
          </FieldGroup>
        </div>
      </Panel>

      {/* ---------- Detailed instructions ---------- */}
      <Panel>
        <div className="border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
            <span aria-hidden="true" className="mr-2">🗎</span>{t("assignmentForm.detailedInstructions")}
          </h2>
        </div>
        <div className="space-y-4 p-5">
          <RichTextEditor value={instructions} onChange={setInstructions}
            placeholder={t("assignmentForm.instructionsPlaceholder")} />

          <FieldGroup label={t("assignmentForm.attachments")}>
            <div
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              className="cursor-pointer rounded-control border-2 border-dashed border-line px-4 py-8 text-center hover:border-navy"
            >
              <p className="text-sm text-ink">{t("assignmentForm.dropFiles")}</p>
              <p className="mt-1 text-xs text-ink-faint">{t("assignmentForm.fileTypes")}</p>
              <input ref={fileInput} type="file" multiple accept={ATTACH_ACCEPT} className="hidden"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {(pending.length > 0 || (existing?.assignment_attachments?.length ?? 0) > 0) && (
              <ul className="mt-2 space-y-1">
                {(existing?.assignment_attachments ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-control bg-sidebar px-3 py-1.5 text-xs text-ink">
                    <span className="truncate">{a.file_name}</span>
                    <span className="text-ink-faint">{t("assignmentForm.uploaded")}</span>
                  </li>
                ))}
                {pending.map((f, i) => (
                  <li key={`${f.name}${i}`} className="flex items-center justify-between rounded-control bg-sidebar px-3 py-1.5 text-xs text-ink">
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="text-danger hover:underline"
                      onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                      {t("assignmentForm.removeFile")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FieldGroup>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        {/* ---------- Deadline ---------- */}
        <Panel>
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              <span aria-hidden="true" className="mr-2">🗓</span>{t("assignmentForm.deadline")}
            </h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("assignmentForm.dueDate")}>
                <EthDatePicker value={dueDate} onChange={setDueDate} />
              </Field>
              <Field label={t("assignmentForm.dueTime")}>
                <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
              </Field>
            </div>
            <label className="flex items-center gap-3">
              <Toggle checked={publishNow} onChange={setPublishNow} label={t("assignmentForm.publishImmediately")} />
              <span className="text-sm text-ink">{t("assignmentForm.publishImmediately")}</span>
            </label>
          </div>
        </Panel>

        {/* ---------- Grading & type ---------- */}
        <Panel>
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
              <span aria-hidden="true" className="mr-2">📊</span>{t("assignmentForm.gradingAndType")}
            </h2>
          </div>
          <div className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("assignmentForm.category")}>
                <select value={category} onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{t(`assignmentForm.categories.${c}`)}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("assignmentForm.maxScore")}>
                <Input type="number" min={1} max={1000} value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-navy">
                {t("assignmentForm.submissionType")}
              </legend>
              <div className="space-y-2">
                {SUBMISSION_TYPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" checked={subTypes.includes(s)} onChange={() => toggleSubType(s)} />
                    {t(`assignmentForm.submissionTypes.${s}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Panel>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Panel>
        <div className="flex flex-wrap items-center justify-end gap-3 p-4">
          <Button variant="ghost" disabled={save.isPending} onClick={() => submit(false)}>
            {t("assignmentForm.saveDraft")}
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(true)}>
            {save.isPending ? t("assignmentForm.saving") : t("assignmentForm.createPublish")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
