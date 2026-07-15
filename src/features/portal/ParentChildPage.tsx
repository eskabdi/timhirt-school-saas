import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

export function ParentChildPage() {
  const { id } = useParams();
  const { data: student } = useQuery({
    queryKey: ["child", id],
    queryFn: async () => (await supabase.from("students").select("first_name,last_name,class:classes(name,section)").eq("id", id).single()).data,
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{student?.first_name} {student?.last_name}</h1>
      <Card>{(student?.class as any)?.name} {(student?.class as any)?.section}</Card>
    </div>
  );
}
