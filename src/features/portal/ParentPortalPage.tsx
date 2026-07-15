import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

export function ParentPortalPage() {
  const { profile } = useSession();
  const { data: children } = useQuery({
    queryKey: ["my-children", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from("guardians").select("student_id, students(first_name,last_name,class:classes(name,section))").eq("user_id", profile!.id);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">My children</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {children?.map((c) => (
          <Link key={c.student_id} to={`/portal/child/${c.student_id}`}>
            <Card className="hover:border-meskel">
              <p className="font-medium">{(c.students as any)?.first_name} {(c.students as any)?.last_name}</p>
              <p className="text-sm text-ink-faint">{(c.students as any)?.class?.name} {(c.students as any)?.class?.section}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
