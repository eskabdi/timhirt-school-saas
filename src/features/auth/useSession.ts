// Central session/profile hook. Route guards read this — but guards are UX
// only; RLS is the authoritative enforcement (§6.2).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import i18n from "@/lib/i18n";

export interface Profile {
  id: string;
  tenant_id: string | null;
  role: string;
  full_name: string;
  email: string;
  locale: "en" | "am" | "om";
}

export function useSession() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
      if (!session) queryClient.clear(); // §6.3 — clear cache on sign-out
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const { data: profile, isLoading } = useQuery({
    queryKey: qk.profile(),
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.from("users")
        .select("id, tenant_id, role, full_name, email, locale").eq("id", userId!).maybeSingle();
      if (error) throw error;
      if (data && data.locale && data.locale !== i18n.resolvedLanguage) {
        i18n.changeLanguage(data.locale);
      }
      return data;
    },
  });

  return {
    userId,
    profile: profile ?? null,
    isAuthenticated: userId !== null && userId !== undefined,
    isLoading: userId === undefined || (!!userId && isLoading),
  };
}
