import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { StudentDashboardView } from "./StudentDashboardView";

export function StudentPortalPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: student, isLoading } = useQuery({
    queryKey: ["my-student-id", profile?.id],
    enabled: !!profile,
    queryFn: async () => (await supabase.from("students").select("id").eq("user_id", profile!.id).maybeSingle()).data,
  });

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (!student) return <p className="text-ink-faint">{t("students.empty")}</p>;

  return <StudentDashboardView studentId={student.id} />;
}
