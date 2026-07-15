import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";

export function HostelPage() {
  const { data } = useQuery({
    queryKey: ["hostel_allocations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hostel_allocations").select("id,room_id,student_id,starts_on,ends_on").limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Hostel</h1>
      {!data?.length ? (
        <Card className="py-12 text-center text-ink-faint">No records yet.</Card>
      ) : (
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {data.map((row: Record<string, unknown>, i: number) => (
                <tr key={i} className="hover:bg-chalk-sunken">
                  {Object.values(row).map((v, j) => (
                    <td key={j} className="px-4 py-2">{String(v ?? "—")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
