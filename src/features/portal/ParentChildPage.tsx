import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { StudentDashboardView } from "./StudentDashboardView";

export function ParentChildPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile } = useSession();

  // More than one linked child? Show a way back to the chooser. An only
  // child skips straight from /portal to here, so the link would just be
  // noise -- RLS still allows it (is_guardian_of), it's a UX call only.
  const { data: siblingCount } = useQuery({
    queryKey: ["my-children-count", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { count } = await supabase.from("guardians").select("id", { count: "exact", head: true }).eq("user_id", profile!.id);
      return count ?? 0;
    },
  });

  if (!id) return null;

  return (
    <div className="space-y-4">
      {siblingCount != null && siblingCount > 1 && (
        <Link to="/portal" className="text-sm text-navy hover:underline">← {t("portalPages.myChildren")}</Link>
      )}
      <StudentDashboardView studentId={id} />
    </div>
  );
}
