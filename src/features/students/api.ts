// Typed Supabase calls — no `.eq('tenant_id', …)` needed for security (RLS
// injects it server-side); parameterized by PostgREST structurally (§8.1).
import { supabase } from "@/lib/supabase";
import type { StudentInput } from "./schemas";

export async function listStudents(search?: string) {
  let q = supabase.from("students")
    .select("id, admission_no, first_name, last_name, status, gender, date_of_birth, class:classes(id, name, section)")
    .order("last_name");
  if (search) q = q.textSearch("search_vector", search, { type: "websearch" });
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function createStudent(tenantId: string, input: StudentInput) {
  const { data, error } = await supabase.from("students").insert({
    tenant_id: tenantId,
    ...input,
    date_of_birth: input.date_of_birth.toISOString().slice(0, 10),
  }).select("id").single();
  if (error) throw error;
  return data;
}

export async function listClasses() {
  const { data, error } = await supabase.from("classes").select("id, name, section").order("name");
  if (error) throw error;
  return data;
}
