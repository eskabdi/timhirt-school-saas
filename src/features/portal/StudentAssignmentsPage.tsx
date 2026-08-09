import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function StudentAssignmentsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: assignments } = useQuery({
    queryKey: ["student-assignments", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: student } = await supabase.from("students").select("class_id").eq("user_id", profile!.id).maybeSingle();
      if (!student) return [];
      // Through the join table, not class_id: one assignment targets several
      // sections. Drafts are excluded — a student should not see work a teacher
      // is still preparing.
      const { data } = await supabase.from("assignment_sections")
        .select("assignments!inner(id, title, due_date, status, subjects(name_i18n))")
        .eq("class_id", student.class_id);
      return (data ?? [])
        .map((r) => r.assignments as unknown as { id: string; title: string; due_date: string; status: string; subjects: unknown })
        .filter((a) => a && a.status === "published")
        .sort((a, b) => a.due_date.localeCompare(b.due_date));
    },
  });
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">{t("portalPages.myAssignments")}</h1>
      {assignments?.map((a) => (
        <Card key={a.id} className="flex justify-between text-sm">
          <span>{a.title} — {(a.subjects as any)?.name_i18n?.en}</span><span>{t("common.due")} <EthDate value={a.due_date} /></span>
        </Card>
      ))}
    </div>
  );
}
