import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function AdmissionDetailPage() {
  const { id } = useParams();
  const { data } = useQuery({
    queryKey: ["admission", id],
    queryFn: async () => (await supabase.from("admission_applications").select("*").eq("id", id).single()).data,
  });
  if (!data) return null;
  return (
    <Card className="max-w-xl">
      <h1 className="font-display text-xl font-bold">{data.applicant_name}</h1>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-faint">DOB</dt><dd><EthDate value={data.date_of_birth} /></dd></div>
        <div><dt className="text-ink-faint">Stage</dt><dd className="capitalize">{data.stage}</dd></div>
        <div><dt className="text-ink-faint">Guardian</dt><dd>{data.guardian_name}</dd></div>
        <div><dt className="text-ink-faint">Phone</dt><dd>{data.guardian_phone}</dd></div>
      </dl>
    </Card>
  );
}
