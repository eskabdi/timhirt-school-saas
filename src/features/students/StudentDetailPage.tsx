import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

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
      <h1 className="font-display text-2xl font-bold">{student.first_name} {student.last_name}</h1>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-faint">Admission No.</dt><dd className="font-medium">{student.admission_no}</dd></div>
        <div><dt className="text-ink-faint">Class</dt><dd className="font-medium">{student.class?.name} {student.class?.section}</dd></div>
        <div><dt className="text-ink-faint">Date of birth</dt><dd className="font-medium"><EthDate value={student.date_of_birth} /></dd></div>
        <div><dt className="text-ink-faint">Status</dt><dd className="font-medium capitalize">{student.status}</dd></div>
      </dl>
    </Card>
  );
}
