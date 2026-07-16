import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";

const STATUS_TONE = { active: "ok", graduated: "navy", transferred: "late" } as const;

export function StudentDetailPage() {
  const { id } = useParams();
  const { data: student } = useQuery({
    queryKey: ["student", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("students")
        .select("*, class:classes(name, section)").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  if (!student) return null;
  return (
    <Card className="max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{student.first_name} {student.last_name}</h1>
        <Badge tone={STATUS_TONE[student.status as keyof typeof STATUS_TONE] ?? "neutral"}>{student.status}</Badge>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-faint">Admission No.</dt><dd className="font-medium text-ink">{student.admission_no}</dd></div>
        <div><dt className="text-ink-faint">Class</dt><dd className="font-medium text-ink">{student.class?.name} {student.class?.section}</dd></div>
        <div><dt className="text-ink-faint">Date of birth</dt><dd className="font-medium text-ink"><EthDate value={student.date_of_birth} /></dd></div>
      </dl>
    </Card>
  );
}
