import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function StudentPortalPage() {
  const { profile } = useSession();
  const { data: student } = useQuery({
    queryKey: ["my-student-profile", profile?.id],
    enabled: !!profile,
    queryFn: async () => (await supabase.from("students").select("first_name,last_name,class:classes(name,section)").eq("user_id", profile!.id).maybeSingle()).data,
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">Welcome, {student?.first_name}</h1>
      <p className="text-ink-faint">Today: <EthDate value={new Date()} /></p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card><p className="text-xs uppercase text-ink-faint">Class</p><p className="mt-1 font-semibold">{(student?.class as any)?.name} {(student?.class as any)?.section}</p></Card>
      </div>
    </div>
  );
}
