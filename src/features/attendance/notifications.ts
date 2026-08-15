// Guardian-facing attendance alert feed (attendance_absent/attendance_late
// portal_notifications rows). Mirrors src/features/fees/api.ts's billing
// notification feed -- same table, same replay-guard idempotency, same
// mark-read mutations, which are generic enough to reuse as-is rather than
// duplicating them here.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface AttendanceNotification {
  id: string;
  kind: "attendance_absent" | "attendance_late";
  attendance_id: string | null;
  read_at: string | null;
  created_at: string;
  student: { first_name: string; last_name: string } | null;
  attendance: { attendance_date: string } | null;
}

const ATTENDANCE_KINDS = ["attendance_absent", "attendance_late"] as const;

export function useAttendanceNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["attendance-notifications"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("portal_notifications")
        .select("id, kind, attendance_id, read_at, created_at, student:students(first_name, last_name), attendance:attendance_id(attendance_date)")
        .in("kind", ATTENDANCE_KINDS)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as AttendanceNotification[];
    },
  });
}
