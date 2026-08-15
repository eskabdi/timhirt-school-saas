import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";
import { useAttendanceNotifications } from "@/features/attendance/notifications";
import { markNotificationRead, markAllNotificationsRead } from "@/features/fees/api";
import { StudentDashboardView } from "./StudentDashboardView";
import { StudentLeaveRequestPanel } from "./StudentLeaveRequestPanel";

function AttendanceNotificationsBanner() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: notifications } = useAttendanceNotifications(true);
  const unread = notifications?.filter((n) => !n.read_at) ?? [];

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-notifications"] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => markAllNotificationsRead(unread.map((n) => n.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance-notifications"] }),
  });

  if (!unread.length) return null;

  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">{t("attendance.notifications.title")} ({unread.length})</p>
        <button type="button" className="text-xs text-navy hover:underline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
          {t("attendance.notifications.markAllRead")}
        </button>
      </div>
      <div className="divide-y divide-line">
        {unread.map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <p className="text-ink">
              {t(`attendance.notifications.${n.kind}`, {
                student: n.student ? `${n.student.first_name} ${n.student.last_name}` : "",
                date: n.attendance ? <EthDate value={n.attendance.attendance_date} /> : "",
              })}
            </p>
            <button type="button" className="shrink-0 text-xs text-ink-faint hover:text-ink" onClick={() => markRead.mutate(n.id)}>
              {t("attendance.notifications.markRead")}
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

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
      <AttendanceNotificationsBanner />
      <StudentDashboardView studentId={id} />
      <StudentLeaveRequestPanel studentId={id} />
    </div>
  );
}
