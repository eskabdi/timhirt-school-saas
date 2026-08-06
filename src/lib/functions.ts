// Shared Edge Function caller -- promoted out of admissions/enrollApi.ts so
// features/fees/api.ts (and any future caller) doesn't duplicate the
// session-token + fetch boilerplate.
import { supabase } from "@/lib/supabase";

export async function callFunction(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${name} failed`);
  return res.json();
}
