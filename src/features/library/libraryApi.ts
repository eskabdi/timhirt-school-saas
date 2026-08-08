// Typed Supabase calls + process-library-circulation caller for the library
// module. RLS injects tenant_id server-side (§8.1) -- no .eq('tenant_id', …)
// needed for direct reads/writes here. Checkout/return/renew/holds/bulk
// rent-return all go through the Edge Function (service_role only writes on
// library_checkouts/library_holds -- see the RLS comments in the rebuild
// migration), never a direct client insert.
import { supabase } from "@/lib/supabase";
import { callFunction } from "@/lib/functions";

export interface LibraryBookRow {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  publisher: string | null;
  grade_label: string | null;
}

export interface BookFilters {
  search?: string;
  gradeLabel?: string;
}

const BOOK_COLUMNS = "id,title,author,isbn,category,publisher,grade_label";

export async function listBooks(filters: BookFilters = {}, range?: [number, number]) {
  let q = supabase.from("library_books").select(BOOK_COLUMNS, { count: "exact" }).order("title");
  if (filters.search) q = q.or(`title.ilike.%${filters.search}%,author.ilike.%${filters.search}%,isbn.ilike.%${filters.search}%`);
  if (filters.gradeLabel) q = q.eq("grade_label", filters.gradeLabel);
  if (range) q = q.range(range[0], range[1]);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as LibraryBookRow[], count: count ?? 0 };
}

/** Unfiltered/unpaginated -- used by the "Rent to Class" book checklist so it
 *  offers every title, not just whatever page the catalog table is on. */
export async function listAllBooks(): Promise<LibraryBookRow[]> {
  const { data, error } = await supabase.from("library_books").select(BOOK_COLUMNS).order("title");
  if (error) throw error;
  return (data ?? []) as LibraryBookRow[];
}

export interface BookInput {
  title: string; author: string; isbn: string; category: string; publisher: string; gradeLabel: string;
}

export async function createBook(tenantId: string, input: BookInput) {
  const { error } = await supabase.from("library_books").insert({
    tenant_id: tenantId, title: input.title.trim(),
    author: input.author.trim() || null, isbn: input.isbn.trim() || null,
    category: input.category.trim() || null, publisher: input.publisher.trim() || null,
    grade_label: input.gradeLabel || null,
  });
  if (error) throw error;
}

export async function updateBook(id: string, input: BookInput) {
  const { error } = await supabase.from("library_books").update({
    title: input.title.trim(), author: input.author.trim() || null, isbn: input.isbn.trim() || null,
    category: input.category.trim() || null, publisher: input.publisher.trim() || null,
    grade_label: input.gradeLabel || null,
  }).eq("id", id);
  if (error) throw error;
}

export async function deleteBook(id: string) {
  const { error } = await supabase.from("library_books").delete().eq("id", id);
  if (error) throw error;
}

/** {total, available} copy counts per book, tenant-wide -- one lightweight
 *  query rather than N per-row count queries (same reasoning as
 *  listEnrolledCounts in classesApi.ts). */
export async function listCopyCounts(): Promise<Map<string, { total: number; available: number }>> {
  const { data, error } = await supabase.from("library_book_copies").select("book_id,status");
  if (error) throw error;
  const counts = new Map<string, { total: number; available: number }>();
  for (const c of data ?? []) {
    const cur = counts.get(c.book_id) ?? { total: 0, available: 0 };
    cur.total += 1;
    if (c.status === "available") cur.available += 1;
    counts.set(c.book_id, cur);
  }
  return counts;
}

export interface CopyRow {
  id: string;
  barcode: string;
  status: string;
  acquired_on: string;
}

export async function listCopies(bookId: string): Promise<CopyRow[]> {
  const { data, error } = await supabase.from("library_book_copies")
    .select("id,barcode,status,acquired_on").eq("book_id", bookId).order("barcode");
  if (error) throw error;
  return data ?? [];
}

export async function addCopy(tenantId: string, bookId: string, barcode: string) {
  const { error } = await supabase.from("library_book_copies")
    .insert({ tenant_id: tenantId, book_id: bookId, barcode: barcode.trim() });
  if (error) throw error;
}

export async function withdrawCopy(copyId: string) {
  const { error } = await supabase.from("library_book_copies").update({ status: "withdrawn" }).eq("id", copyId);
  if (error) throw error;
}

/** Distinct class names in grade_level order -- the same "one row per grade,
 *  not per section" dedupe FeeStructuresPage uses, since grade_label matches
 *  classes.name convention (freeform on the books table, but populated from
 *  this same list so it never drifts). */
export async function listGradeOptions(): Promise<string[]> {
  const { data, error } = await supabase.from("classes").select("name,grade_level").order("grade_level");
  if (error) throw error;
  const seen = new Map<string, number | null>();
  for (const c of data ?? []) if (!seen.has(c.name)) seen.set(c.name, c.grade_level);
  return [...seen.keys()];
}

export interface ClassOption { id: string; name: string; section: string | null; grade_level: number | null }

export async function listActiveClasses(): Promise<ClassOption[]> {
  const { data, error } = await supabase.from("classes").select("id,name,section,grade_level").order("grade_level").order("section");
  if (error) throw error;
  return data ?? [];
}

export interface StudentOption { id: string; first_name: string; last_name: string; admission_no: string }

export async function searchStudents(term: string): Promise<StudentOption[]> {
  if (term.trim().length < 2) return [];
  const { data, error } = await supabase.from("students")
    .select("id,first_name,last_name,admission_no").eq("status", "active")
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,admission_no.ilike.%${term}%`)
    .limit(10);
  if (error) throw error;
  return data ?? [];
}

export interface CheckoutRow {
  id: string;
  student_id: string;
  due_on: string;
  checked_out_on: string;
  checkout_type: "lending" | "rental";
  renewal_count: number;
  copy: { barcode: string; book: { title: string } | null } | null;
  student: { first_name: string; last_name: string; admission_no: string } | null;
}

export async function listActiveCheckouts(): Promise<CheckoutRow[]> {
  const { data, error } = await supabase.from("library_checkouts")
    .select("id,student_id,due_on,checked_out_on,checkout_type,renewal_count,"
      + "copy:library_book_copies(barcode,book:library_books(title)),"
      + "student:students(first_name,last_name,admission_no)")
    .eq("status", "checked_out").order("due_on");
  if (error) throw error;
  return (data ?? []) as unknown as CheckoutRow[];
}

export interface HoldRow {
  id: string;
  status: string;
  requested_on: string;
  expires_on: string | null;
  book: { title: string } | null;
  student: { first_name: string; last_name: string } | null;
}

export async function listHolds(): Promise<HoldRow[]> {
  const { data, error } = await supabase.from("library_holds")
    .select("id,status,requested_on,expires_on,book:library_books(title),student:students(first_name,last_name)")
    .in("status", ["waiting", "ready"]).order("requested_on");
  if (error) throw error;
  return (data ?? []) as unknown as HoldRow[];
}

export interface FineRow {
  id: string;
  amount: number;
  status: string;
  checkout: { student: { first_name: string; last_name: string } | null; copy: { book: { title: string } | null } | null } | null;
}

export async function listPendingFines(): Promise<FineRow[]> {
  const { data, error } = await supabase.from("library_fines")
    .select("id,amount,status,checkout:library_checkouts(student:students(first_name,last_name),"
      + "copy:library_book_copies(book:library_books(title)))")
    .eq("status", "pending").order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as FineRow[];
}

export async function markFinePaid(fineId: string) {
  const { error } = await supabase.from("library_fines")
    .update({ status: "paid", paid_on: new Date().toISOString().slice(0, 10) }).eq("id", fineId);
  if (error) throw error;
}

export async function waiveFine(fineId: string, reason: string) {
  const { error } = await supabase.from("library_fines")
    .update({ status: "waived", waived_reason: reason.trim() || null }).eq("id", fineId);
  if (error) throw error;
}

export interface LibrarySettingsRow {
  loan_days_default: number;
  max_renewals: number;
  fine_per_day: number;
  hold_expiry_days: number;
  max_active_checkouts: number;
}

export async function getSettings(tenantId: string): Promise<LibrarySettingsRow | null> {
  const { data, error } = await supabase.from("library_settings")
    .select("loan_days_default,max_renewals,fine_per_day,hold_expiry_days,max_active_checkouts")
    .eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveSettings(tenantId: string, input: LibrarySettingsRow) {
  const { error } = await supabase.from("library_settings").upsert({ tenant_id: tenantId, ...input });
  if (error) throw error;
}

// -------- process-library-circulation actions --------

export async function findCopyByBarcode(barcode: string): Promise<{ id: string; status: string; book: { id: string; title: string } | null } | null> {
  const { data, error } = await supabase.from("library_book_copies")
    .select("id,status,book:library_books(id,title)").eq("barcode", barcode.trim()).maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as { id: string; status: string; book: { id: string; title: string } | null } | null;
}

export const checkoutCopy = (copyId: string, studentId: string, checkoutType: "lending" | "rental" = "lending") =>
  callFunction("process-library-circulation", { action: "checkout", copy_id: copyId, student_id: studentId, checkout_type: checkoutType });

export const returnCheckout = (checkoutId: string) =>
  callFunction("process-library-circulation", { action: "return", checkout_id: checkoutId });

export const renewCheckout = (checkoutId: string) =>
  callFunction("process-library-circulation", { action: "renew", checkout_id: checkoutId });

export const placeHold = (bookId: string, studentId: string) =>
  callFunction("process-library-circulation", { action: "place_hold", book_id: bookId, student_id: studentId });

export const cancelHold = (holdId: string) =>
  callFunction("process-library-circulation", { action: "cancel_hold", hold_id: holdId });

export const scanOverdue = (): Promise<{ scanned: number; notified_count: number }> =>
  callFunction("process-library-circulation", { action: "scan_overdue" });

export interface BulkRentResult { results: Record<string, { issued: number; no_copy_available: string[] }> }
export const bulkRent = (classId: string, bookIds: string[]): Promise<BulkRentResult> =>
  callFunction("process-library-circulation", { action: "bulk_rent", class_id: classId, book_ids: bookIds });

export const bulkReturn = (classId: string): Promise<{ returned_count: number }> =>
  callFunction("process-library-circulation", { action: "bulk_return", class_id: classId });
