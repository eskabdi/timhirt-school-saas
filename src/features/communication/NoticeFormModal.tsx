// Add / edit a notice board entry.
//
// "Visible to All School" and the per-role list are deliberately independent:
// ticking All School publishes to everyone and makes the role list moot, while
// leaving it off restricts to the roles chosen. RLS enforces the same rule, so
// an unchecked role cannot read the notice regardless of what the UI does.
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
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { RoleVisibility } from "@/components/ui/RoleVisibility";
import { toIsoDate } from "@/lib/ethiopian-date";

export interface NoticeRow {
  id: string;
  title_i18n: Record<string, string>;
  body_html: string | null;
  visible_from: string;
  visible_to: string;
  sort_order: number;
  visible_all_school: boolean;
  visible_to_roles: string[] | null;
}

export function NoticeFormModal({ open, onClose, editing }: {
  open: boolean; onClose: () => void; editing?: NoticeRow | null;
}) {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [sortOrder, setSortOrder] = useState("0");
  const [allSchool, setAllSchool] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setTitle(editing.title_i18n?.[i18n.resolvedLanguage ?? "en"] ?? editing.title_i18n?.en ?? "");
      setBody(editing.body_html ?? "");
      setFrom(new Date(editing.visible_from + "T00:00:00Z"));
      setTo(new Date(editing.visible_to + "T00:00:00Z"));
      setSortOrder(String(editing.sort_order));
      setAllSchool(editing.visible_all_school);
      setRoles(editing.visible_to_roles ?? []);
    } else {
      setTitle(""); setBody(""); setFrom(null); setTo(null);
      setSortOrder("0"); setAllSchool(false); setRoles([]);
    }
  }, [open, editing, i18n.resolvedLanguage]);

  const save = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error(t("notices.titleRequired"));
      if (!from || !to) throw new Error(t("notices.datesRequired"));
      if (to < from) throw new Error(t("notices.toBeforeFrom"));
      const row = {
        tenant_id: profile!.tenant_id,
        title_i18n: { [i18n.resolvedLanguage ?? "en"]: title.trim(), en: title.trim() },
        body_html: body.trim() || null,
        visible_from: toIsoDate(from),
        visible_to: toIsoDate(to),
        sort_order: Number(sortOrder) || 0,
        visible_all_school: allSchool,
        visible_to_roles: roles.length ? roles : null,
        created_by: profile?.id ?? null,
      };
      const { error: err } = editing
        ? await supabase.from("notices").update(row).eq("id", editing.id)
        : await supabase.from("notices").insert(row);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notices"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("notices.saveFailed")),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("notices").delete().eq("id", editing!.id);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notices"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("notices.saveFailed")),
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? t("notices.editTitle") : t("notices.addTitle")} size="xl">
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        <Field label={`${t("assignments.titleLabel")} *`}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} autoFocus />
        </Field>

        <RichTextEditor value={body} onChange={setBody} placeholder={t("notices.bodyPlaceholder")} />

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={`${t("notices.visibleFrom")} *`}>
            <EthDatePicker value={from} onChange={setFrom} />
          </Field>
          <Field label={`${t("notices.visibleTo")} *`}>
            <EthDatePicker value={to} onChange={setTo} />
          </Field>
        </div>

        <div className="grid items-center gap-3 md:grid-cols-2">
          <Field label={t("notices.sortOrder")}>
            <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pt-5 text-sm text-ink">
            <input type="checkbox" checked={allSchool} onChange={(e) => setAllSchool(e.target.checked)} />
            {t("notices.visibleAllSchool")}
          </label>
        </div>

        <RoleVisibility selected={roles} onChange={setRoles} title={t("notices.visibleToProfile")} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        {editing ? (
          <Button variant="ghost" className="text-danger"
            onClick={() => { if (window.confirm(t("notices.deleteConfirm"))) remove.mutate(); }}
            disabled={remove.isPending}>
            {t("crud.delete")}
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? t("notices.submitting") : t("notices.submit")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
