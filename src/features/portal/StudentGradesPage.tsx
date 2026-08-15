import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";

export function StudentGradesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: grades } = useQuery({
    queryKey: ["student-grades", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: student } = await supabase.from("students").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!student) return [];
      const { data } = await supabase.from("grades").select("score, subjects(name_i18n), exams(name_i18n, max_score)").eq("student_id", student.id);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">{t("portalPages.myGrades")}</h1>
      {grades?.map((g, i) => {
        const subject = g.subjects as unknown as { name_i18n: Record<string, string> } | null;
        const exam = g.exams as unknown as { name_i18n: Record<string, string>; max_score: number } | null;
        return (
        <Card key={i} className="flex justify-between text-sm">
          <span>{subject?.name_i18n?.en} — {exam?.name_i18n?.en}</span>
          <span className="font-semibold">{g.score} / {exam?.max_score}</span>
        </Card>
        );
      })}
    </div>
  );
}
