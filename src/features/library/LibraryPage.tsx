import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";

interface Book { id: string; title: string; author: string | null; isbn: string | null; copies: number; }
type BookForm = { title: string; author: string; isbn: string; copies: string };
const emptyBook: BookForm = { title: "", author: "", isbn: "", copies: "1" };

interface Checkout {
  id: string; due_on: string; checked_out_on: string; status: string;
  library_books: { title: string } | null; students: { first_name: string; last_name: string } | null;
}

export function LibraryPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<BookForm>(emptyBook);
  const [editing, setEditing] = useState<Book | null>(null);
  const [editForm, setEditForm] = useState<BookForm>(emptyBook);
  const [deleting, setDeleting] = useState<Book | null>(null);
  const [checkout, setCheckout] = useState<Book | null>(null);
  const [coForm, setCoForm] = useState<{ studentId: string; due: Date | null }>({ studentId: "", due: null });
  const [error, setError] = useState<string | null>(null);

  const { data: books } = useQuery({
    queryKey: ["library_books"],
    queryFn: async () => ((await supabase.from("library_books").select("id,title,author,isbn,copies").order("title")).data ?? []) as Book[],
  });
  const { data: students } = useQuery({
    queryKey: ["library_students"],
    queryFn: async () => (await supabase.from("students").select("id,first_name,last_name").eq("status", "active").order("first_name")).data ?? [],
  });
  const { data: active } = useQuery({
    queryKey: ["library_checkouts_active"],
    queryFn: async () =>
      ((await supabase.from("library_checkouts")
        .select("id, due_on, checked_out_on, status, library_books(title), students(first_name,last_name)")
        .neq("status", "returned").order("due_on")).data ?? []) as unknown as Checkout[],
  });

  const bookPayload = (f: BookForm) => ({ title: f.title, author: f.author || null, isbn: f.isbn || null, copies: Number(f.copies || 1) });

  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("library_books").insert({ tenant_id: profile!.tenant_id, ...bookPayload(form) }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library_books"] }); setShowCreate(false); setForm(emptyBook); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("library_books").update(bookPayload(editForm)).eq("id", editing!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library_books"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("library_books").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library_books"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const doCheckout = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("library_checkouts").insert({
        tenant_id: profile!.tenant_id, book_id: checkout!.id, student_id: coForm.studentId,
        checked_out_on: toIsoDate(new Date()), due_on: toIsoDate(coForm.due!), status: "checked_out",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library_checkouts_active"] }); setCheckout(null); setCoForm({ studentId: "", due: null }); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const doReturn = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("library_checkouts").update({ status: "returned", returned_on: toIsoDate(new Date()) }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library_checkouts_active"] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const openEdit = (b: Book) => { setEditing(b); setEditForm({ title: b.title, author: b.author ?? "", isbn: b.isbn ?? "", copies: String(b.copies) }); };

  const bookFields = (f: BookForm, set: (f: BookForm) => void) => (
    <div className="space-y-3">
      <Field label={t("modules.title")}><Input value={f.title} onChange={(e) => set({ ...f, title: e.target.value })} /></Field>
      <Field label={t("modules.author")}><Input value={f.author} onChange={(e) => set({ ...f, author: e.target.value })} /></Field>
      <Field label={t("modules.isbn")}><Input value={f.isbn} onChange={(e) => set({ ...f, isbn: e.target.value })} /></Field>
      <Field label={t("modules.copies")}><Input type="number" min={0} value={f.copies} onChange={(e) => set({ ...f, copies: e.target.value })} /></Field>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("nav.library")}</h1>
        <Button onClick={() => { setForm(emptyBook); setShowCreate(true); }}>+ {t("modules.addBook")}</Button>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      {!books?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("noRecordsYet")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("modules.title")}</th><th className="px-4 py-2">{t("modules.author")}</th><th className="px-4 py-2">{t("modules.isbn")}</th><th className="px-4 py-2">{t("modules.copies")}</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {books.map((b) => (
                <tr key={b.id} className="hover:bg-sidebar">
                  <td className="px-4 py-2 font-medium text-ink">{b.title}</td>
                  <td className="px-4 py-2 text-ink-soft">{b.author ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{b.isbn ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-soft">{b.copies}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setCoForm({ studentId: "", due: null }); setCheckout(b); }}>{t("modules.checkOut")}</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(b)}>{t("crud.edit")}</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(b)}>{t("crud.delete")}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {!!active?.length && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase text-ink-faint">{t("modules.onLoan")}</h2>
          {active.map((c) => (
            <Card key={c.id} className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium text-ink">{c.library_books?.title}</p>
                <p className="text-xs text-ink-faint">
                  {c.students ? `${c.students.first_name} ${c.students.last_name}` : "—"} · due <EthDate value={c.due_on} />
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.status === "overdue" ? "danger" : "neutral"}>{c.status}</Badge>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => doReturn.mutate(c.id)} disabled={doReturn.isPending}>{t("modules.return")}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("modules.addBook")}>
        {bookFields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.title || create.isPending}>{t("crud.create")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("modules.editBook")}>
        {bookFields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={!editForm.title || update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!checkout} onClose={() => setCheckout(null)} title={`Check out — ${checkout?.title ?? ""}`}>
        <div className="space-y-3">
          <Field label={t("clinic.student")}>
            <select value={coForm.studentId} onChange={(e) => setCoForm({ ...coForm, studentId: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              <option value="">{t("modules.selectStudent")}</option>
              {students?.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </Field>
          <Field label={t("modules.dueDate")}><EthDatePicker value={coForm.due} onChange={(d) => setCoForm({ ...coForm, due: d })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setCheckout(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => doCheckout.mutate()} disabled={!coForm.studentId || !coForm.due || doCheckout.isPending}>{t("modules.checkOut")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("modules.deleteBook")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting?.title}</span>?</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
