// CalendarPreferencesPage.tsx already saves tenant_configs.settings.calendar.
// geezNumerals correctly, but nothing ever read it back -- EthDate.tsx's geez
// prop just defaulted to false everywhere. This hook is the missing link:
// EthDate reads it directly so every one of its ~50 call sites picks up the
// tenant's real preference without threading a prop through each of them.
//
// Same queryKey CalendarPreferencesPage.tsx already invalidates on save, so
// toggling the setting refreshes every rendered <EthDate/> immediately.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";

export function useGeezNumerals(): boolean {
  const { profile } = useSession();
  const { data } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  return (data?.settings as { calendar?: { geezNumerals?: boolean } } | undefined)?.calendar?.geezNumerals ?? false;
}
