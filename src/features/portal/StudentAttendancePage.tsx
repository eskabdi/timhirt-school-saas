import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function StudentAttendancePage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { data: records } = useQuery({
    queryKey: ["student-attendance", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: student } = await supabase.from("students").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!student) return [];
      const { data } = await supabase.from("attendance").select("attendance_date, status").eq("student_id", student.id).order("attendance_date", { ascending: false }).limit(30);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-2">
      <h1 className="font-display text-2xl font-bold">{t("portalPages.myAttendance")}</h1>
      {records?.map((r, i) => (
        <Card key={i} className="flex justify-between text-sm">
          <EthDate value={r.attendance_date} /><span className="capitalize">{r.status}</span>
        </Card>
      ))}
    </div>
  );
}
