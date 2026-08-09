import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

export function ParentPortalPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: children, isLoading } = useQuery({
    queryKey: ["my-children", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data } = await supabase.from("guardians").select("student_id, students(first_name,last_name,class:classes(name,section))").eq("user_id", profile!.id);
      return data ?? [];
    },
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;

  // A single child's dashboard *is* the guardian's dashboard -- skip the
  // chooser and land directly on the student-specific view. Multiple
  // children still need a way to pick which one.
  if (children && children.length === 1) {
    return <Navigate to={`/portal/child/${children[0]!.student_id}`} replace />;
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("portalPages.myChildren")}</h1>
      {!children?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("students.empty")}</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {children.map((c) => {
            const student = c.students as unknown as {
              first_name: string; last_name: string; class: { name: string; section: string | null } | null;
            } | null;
            return (
            <Link key={c.student_id} to={`/portal/child/${c.student_id}`}>
              <Card className="hover:border-navy">
                <p className="font-medium text-ink">{student?.first_name} {student?.last_name}</p>
                <p className="text-sm text-ink-faint">{student?.class?.name} {student?.class?.section}</p>
              </Card>
            </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
