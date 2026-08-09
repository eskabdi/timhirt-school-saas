import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import {
  listBooks, listAllBooks, listGradeOptions, listCopyCounts, listActiveClasses,
  createBook, updateBook, deleteBook, listCopies, addCopy, withdrawCopy,
  bulkRent, bulkReturn,
  type LibraryBookRow, type BookInput, type CopyRow, type ClassOption, type GradeOption,
} from "./libraryApi";
import { GRADE_CYCLES, gradeCycleKeyFor, gradeCycleI18nKey } from "@/lib/gradeCycles";

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";
const emptyForm: BookInput = { title: "", author: "", isbn: "", category: "", publisher: "", gradeLabel: "" };

export function LibraryCatalogPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [gradeLabel, setGradeLabel] = useState("");
  const [page, setPage] = useState(1);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<BookInput>(emptyForm);
  const [editing, setEditing] = useState<LibraryBookRow | null>(null);
  const [editForm, setEditForm] = useState<BookInput>(emptyForm);
  const [deleting, setDeleting] = useState<LibraryBookRow | null>(null);
  const [managingCopies, setManagingCopies] = useState<LibraryBookRow | null>(null);
  const [renting, setRenting] = useState(false);
  const [returning, setReturning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: grades } = useQuery({ queryKey: ["library-grade-options"], queryFn: listGradeOptions });
  // Groups the freeform grade_label options under a grade-cycle <optgroup>
  // heading, ordered by GRADE_CYCLES; anything that doesn't map to a known
  // cycle (grade_level null or 0, e.g. KG) falls in a trailing "Other" group.
  const gradeGroups = useMemo(() => {
    const groups = GRADE_CYCLES.map((c) => ({ cycleKey: c.key as string | null, options: [] as GradeOption[] }));
    const other: GradeOption[] = [];
    for (const g of grades ?? []) {
      const cycleKey = gradeCycleKeyFor(g.gradeLevel);
      const group = groups.find((grp) => grp.cycleKey === cycleKey);
      if (group) group.options.push(g); else other.push(g);
    }
    if (other.length) groups.push({ cycleKey: null, options: other });
    return groups.filter((g) => g.options.length > 0);
  }, [grades]);
  const filters = { search: search || undefined, gradeLabel: gradeLabel || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ["library-books", filters, page],
    queryFn: () => listBooks(filters, pageRange(page)),
  });
  const books = data?.rows ?? [];
  const { data: copyCounts } = useQuery({ queryKey: ["library-copy-counts"], queryFn: listCopyCounts });

  const hasActiveFilters = !!(search || gradeLabel);
  const setFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  const clearFilters = () => { setSearch(""); setGradeLabel(""); setPage(1); };

  // 23503 -- deleting a book with checkout history (library_checkouts.copy_id
  // FK is RESTRICT, deliberately: history is worth preserving, not a schema
  // bug to fix). Surfaced as a specific, actionable message instead of a raw
  // Postgres FK-violation string.
  const friendlyError = (e: unknown, fallback: string) => {
    if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "23503") {
      return t("library.deleteHasHistory");
    }
    return e instanceof Error ? e.message : fallback;
  };

  const invalidateBooks = () => {
    qc.invalidateQueries({ queryKey: ["library-books"] });
    qc.invalidateQueries({ queryKey: ["library-grade-options"] });
  };

  const create = useMutation({
    mutationFn: () => createBook(profile!.tenant_id!, form),
    onSuccess: () => { invalidateBooks(); setForm(emptyForm); setAdding(false); setError(null); },
    onError: (e: unknown) => setError(friendlyError(e, "Failed to add book")),
  });
  const update = useMutation({
    mutationFn: () => updateBook(editing!.id, editForm),
    onSuccess: () => { invalidateBooks(); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(friendlyError(e, "Failed to update book")),
  });
  const remove = useMutation({
    mutationFn: () => deleteBook(deleting!.id),
    onSuccess: () => { invalidateBooks(); qc.invalidateQueries({ queryKey: ["library-copy-counts"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(friendlyError(e, "Failed to delete book")),
  });

  const openEdit = (b: LibraryBookRow) => {
    setEditing(b);
    setEditForm({
      title: b.title, author: b.author ?? "", isbn: b.isbn ?? "",
      category: b.category ?? "", publisher: b.publisher ?? "", gradeLabel: b.grade_label ?? "",
    });
  };

  const gradeOptionGroups = (
    <>
      {gradeGroups.map((group) => (
        <optgroup key={group.cycleKey ?? "other"} label={group.cycleKey ? t(`gradeCycles.${gradeCycleI18nKey(group.cycleKey)}`) : t("gradeCycles.otherGrades")}>
          {group.options.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
        </optgroup>
      ))}
    </>
  );

  const gradeField = (value: string, onChange: (v: string) => void) => (
    <Field label={t("library.gradeLabel")}>
      <select className={SELECT_CLS} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("library.generalCirculation")}</option>
        {gradeOptionGroups}
      </select>
    </Field>
  );

  const bookForm = (value: BookInput, onChange: (v: BookInput) => void) => (
    <div className="space-y-3">
      <Field label={t("library.title")}>
        <Input value={value.title} maxLength={200} onChange={(e) => onChange({ ...value, title: e.target.value })} />
      </Field>
      <Field label={t("library.author")}>
        <Input value={value.author} onChange={(e) => onChange({ ...value, author: e.target.value })} />
      </Field>
      <Field label={t("library.isbn")}>
        <Input value={value.isbn} onChange={(e) => onChange({ ...value, isbn: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("library.category")}>
          <Input value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })} />
        </Field>
        <Field label={t("library.publisher")}>
          <Input value={value.publisher} onChange={(e) => onChange({ ...value, publisher: e.target.value })} />
        </Field>
      </div>
      {gradeField(value.gradeLabel, (v) => onChange({ ...value, gradeLabel: v }))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold text-ink">{t("nav.library")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" className="border border-line" onClick={() => setReturning(true)}>{t("library.returnClass")}</Button>
          <Button variant="ghost" className="border border-line" onClick={() => setRenting(true)}>{t("library.rentToClass")}</Button>
          <Button onClick={() => setAdding(true)}>{t("crud.addNew")}</Button>
        </div>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <Card className="space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t("students.search")}>
            <Input placeholder={t("students.search")} value={search} onChange={(e) => setFilter(setSearch)(e.target.value)} maxLength={100} />
          </Field>
          <Field label={t("library.gradeLabel")}>
            <select className={SELECT_CLS} value={gradeLabel} onChange={(e) => setFilter(setGradeLabel)(e.target.value)}>
              <option value="">{t("library.allGrades")}</option>
              {gradeOptionGroups}
            </select>
          </Field>
        </div>
        {hasActiveFilters && <Button variant="ghost" className="border border-line" onClick={clearFilters}>{t("students.clearFilters")}</Button>}
      </Card>

      {isLoading ? (
        <p className="text-ink-faint">…</p>
      ) : books.length === 0 ? (
        <Card className="py-12 text-center text-ink-faint">{t("library.noBooks")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-3">{t("library.title")}</th>
                <th className="px-5 py-3">{t("library.author")}</th>
                <th className="px-5 py-3">{t("library.gradeLabel")}</th>
                <th className="px-5 py-3">{t("library.copies")}</th>
                <th className="px-5 py-3 text-right">{t("crud.edit")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {books.map((b) => {
                const counts = copyCounts?.get(b.id) ?? { total: 0, available: 0 };
                return (
                  <tr key={b.id} className="hover:bg-sidebar">
                    <td className="px-5 py-3 font-medium text-ink">{b.title}</td>
                    <td className="px-5 py-3 text-ink-faint">{b.author ?? "—"}</td>
                    <td className="px-5 py-3 text-ink-faint">{b.grade_label ?? t("library.generalCirculation")}</td>
                    <td className="px-5 py-3 text-ink-faint">{counts.available}/{counts.total}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-3 text-xs">
                        <button type="button" className="font-medium text-navy hover:underline" onClick={() => setManagingCopies(b)}>{t("library.manageCopies")}</button>
                        <button type="button" className="font-medium text-ink-soft hover:underline" onClick={() => openEdit(b)}>{t("crud.edit")}</button>
                        <button type="button" className="font-medium text-danger hover:underline" onClick={() => setDeleting(b)}>{t("crud.delete")}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-5" />
        </Panel>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={t("crud.addNew")}>
        {bookForm(form, setForm)}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.title.trim() || create.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("crud.edit")}>
        {bookForm(editForm, setEditForm)}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={!editForm.title.trim() || update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("crud.delete")}>
        <p className="text-sm text-ink-soft">
          {t("crud.delete")} <span className="font-medium text-ink">{deleting?.title}</span>{t("crud.cannotUndo")}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>

      {managingCopies && (
        <ManageCopiesModal
          book={managingCopies}
          tenantId={profile!.tenant_id!}
          onClose={() => { setManagingCopies(null); qc.invalidateQueries({ queryKey: ["library-copy-counts"] }); }}
        />
      )}
      {renting && <RentToClassModal onClose={() => setRenting(false)} />}
      {returning && <ReturnClassModal onClose={() => setReturning(false)} />}
    </div>
  );
}

function ManageCopiesModal({ book, tenantId, onClose }: { book: LibraryBookRow; tenantId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: copies } = useQuery({ queryKey: ["library-copies", book.id], queryFn: () => listCopies(book.id) });

  const add = useMutation({
    mutationFn: () => addCopy(tenantId, book.id, barcode),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["library-copies", book.id] }); setBarcode(""); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to add copy"),
  });
  const withdraw = useMutation({
    mutationFn: (copyId: string) => withdrawCopy(copyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library-copies", book.id] }),
  });

  const toneFor = (status: string) => status === "available" ? "ok" : status === "checked_out" ? "navy" : "neutral";

  return (
    <Modal open onClose={onClose} title={`${t("library.manageCopies")} — ${book.title}`} size="lg">
      <div className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); if (barcode.trim()) add.mutate(); }}
        >
          <div className="flex-1">
            <Field label={t("library.barcode")}>
              {/* Autofocused: a USB/handheld barcode scanner just types into
                  whatever input has focus, like a keyboard. */}
              <Input autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} maxLength={40} />
            </Field>
          </div>
          <Button type="submit" disabled={!barcode.trim() || add.isPending}>{t("library.addCopy")}</Button>
        </form>

        {(copies ?? []).length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">{t("library.noBooks")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-3 py-2">{t("library.barcode")}</th>
                <th className="px-3 py-2">{t("students.status")}</th>
                <th className="px-3 py-2 text-right"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(copies as CopyRow[]).map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono text-ink">{c.barcode}</td>
                  <td className="px-3 py-2"><Badge tone={toneFor(c.status)}>{t(`library.copyStatus.${c.status}`)}</Badge></td>
                  <td className="px-3 py-2 text-right">
                    {c.status === "available" && (
                      <button type="button" className="text-xs font-medium text-danger hover:underline"
                        onClick={() => withdraw.mutate(c.id)}>{t("library.withdraw")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="ghost" onClick={onClose}>{t("library.close")}</Button>
      </div>
    </Modal>
  );
}

function RentToClassModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [classId, setClassId] = useState("");
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<Record<string, { issued: number; no_copy_available: string[] }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: classes } = useQuery({ queryKey: ["library-classes"], queryFn: listActiveClasses });
  // Unfiltered/unpaginated book list -- the catalog table's paginated `books`
  // state would silently hide titles past page 1 from this checklist.
  const { data: allBooks } = useQuery({ queryKey: ["library-all-books"], queryFn: listAllBooks });

  const selectedClass = useMemo(() => (classes as ClassOption[] | undefined)?.find((c) => c.id === classId), [classes, classId]);

  const toggle = (bookId: string) => {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId); else next.add(bookId);
      return next;
    });
  };

  const rent = useMutation({
    mutationFn: () => bulkRent(classId, [...selectedBooks]),
    onSuccess: (res) => { setResult(res.results); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to rent books"),
  });

  return (
    <Modal open onClose={onClose} title={t("library.rentToClass")} size="lg">
      <div className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <Field label={t("library.selectClass")}>
          <select className={SELECT_CLS} value={classId} onChange={(e) => { setClassId(e.target.value); setResult(null); }}>
            <option value="">{t("library.selectClass")}</option>
            {(classes as ClassOption[] | undefined)?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ""}</option>
            ))}
          </select>
        </Field>

        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">{t("library.booksToRent")}</p>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-control border border-line p-2">
            {(allBooks ?? []).map((b) => (
              <label key={b.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-sidebar">
                <input type="checkbox" checked={selectedBooks.has(b.id)} onChange={() => toggle(b.id)} />
                <span className="text-ink">{b.title}</span>
                {b.grade_label && selectedClass && b.grade_label === selectedClass.name && (
                  <Badge tone="ok" className="ml-auto">{t("library.gradeLabel")}</Badge>
                )}
              </label>
            ))}
          </div>
        </div>

        {result && (
          <div className="space-y-1 rounded-control border border-line p-3 text-sm">
            <p className="font-medium text-ink">{t("library.rentResultsHint")}</p>
            {Object.entries(result).map(([bookId, r]) => {
              const title = allBooks?.find((b) => b.id === bookId)?.title ?? bookId;
              return (
                <p key={bookId} className="text-ink-soft">
                  {title}: {t("library.issued")} {r.issued}
                  {r.no_copy_available.length > 0 && ` — ${r.no_copy_available.length} ${t("library.noCopyAvailable")}`}
                </p>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("library.close")}</Button>
        <Button onClick={() => rent.mutate()} disabled={!classId || selectedBooks.size === 0 || rent.isPending}>
          {t("library.rentToClass")}
        </Button>
      </div>
    </Modal>
  );
}

function ReturnClassModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [classId, setClassId] = useState("");
  const [returnedCount, setReturnedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: classes } = useQuery({ queryKey: ["library-classes"], queryFn: listActiveClasses });

  const doReturn = useMutation({
    mutationFn: () => bulkReturn(classId),
    onSuccess: (res) => { setReturnedCount(res.returned_count); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to return books"),
  });

  return (
    <Modal open onClose={onClose} title={t("library.returnClass")}>
      <div className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <Field label={t("library.selectClass")}>
          <select className={SELECT_CLS} value={classId} onChange={(e) => { setClassId(e.target.value); setReturnedCount(null); }}>
            <option value="">{t("library.selectClass")}</option>
            {(classes as ClassOption[] | undefined)?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.section ? ` — ${c.section}` : ""}</option>
            ))}
          </select>
        </Field>
        {returnedCount !== null && (
          <p className="rounded-control border border-line p-3 text-sm text-ink">
            {t("library.returnedCount")}: {returnedCount}
          </p>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("library.close")}</Button>
        <Button onClick={() => doReturn.mutate()} disabled={!classId || doReturn.isPending}>{t("library.returnClass")}</Button>
      </div>
    </Modal>
  );
}
