// Single typed client. Browser holds ONLY the anon key + user JWT — RLS applies
// to every request; service_role never ships to the client (§3.7).
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: true, persistSession: true } },
);
