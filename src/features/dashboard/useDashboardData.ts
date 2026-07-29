// Every query the dashboard runs, in one place.
//
// The heavy cards go through RPCs (20260729000002_dashboard.sql) rather than
// selecting rows and reducing in the browser: "students above 10% absence" is
// an aggregate over the whole attendance table for the term, and shipping that
// to the client to count it would be several thousand rows to render five.
//
// Every RPC is tenant-scoped and role-gated server-side, so a caller who may
// not see a card gets zeros rather than an error and the card renders empty
// instead of taking the page down.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toIsoDate } from "@/lib/ethiopian-date";

export interface Breakdown { key: string; count: number }

export interface Overview {
  students: number;
  staff: number;
  parents: number;
  by_gender: Breakdown[];
  by_ethnicity: Breakdown[];
}

export interface AtRiskAbsence {
  student_id: string; admission_no: string; full_name: string;
  grade: string; absences: number; absence_pct: number;
}

export interface LowGpa {
  student_id: string; admission_no: string; full_name: string;
  grade: string; cgpa: number;
}

export interface AttendanceDay {
  day: string; present: number; absent: number; half_day: number;
}

export interface Billing {
  collected: number; overdue: number; to_be_collected: number;
  by_fee_type: { name_i18n: Record<string, string>; total: number }[];
}

export interface Alerts {
  messages: number; applications: number;
  course_requests: number; missing_attendance: number;
}

/** Sunday of the week containing `d`, which is where the weekly chart starts. */
export function weekStart(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() - out.getUTCDay());
  return out;
}

const key = (tenant: string, ...rest: (string | null)[]) =>
  ["tenant", tenant, "dashboard", ...rest] as const;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data as T;
}

export function useOverview(tenantId: string, academicYearId: string | null) {
  return useQuery({
    queryKey: key(tenantId, "overview", academicYearId),
    enabled: !!tenantId,
    queryFn: () => rpc<Overview>("dashboard_overview", { p_academic_year_id: academicYearId }),
  });
}

export function useAcademicYears(tenantId: string) {
  return useQuery({
    queryKey: key(tenantId, "academic-years"),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_years")
        .select("id, ec_year, label_i18n, status")
        .order("ec_year", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Notices whose visibility window covers today, in the order the board sets. */
export function useNotices(tenantId: string) {
  const today = toIsoDate(new Date());
  return useQuery({
    queryKey: key(tenantId, "notices", today),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notices")
        .select("id, title_i18n, body_html, visible_from, visible_to")
        .lte("visible_from", today)
        .gte("visible_to", today)
        .order("sort_order")
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Events for the calendar panel — a generous window either side of today so
 *  paging a month back or forward does not refetch. */
export function useCalendarEvents(tenantId: string) {
  const now = new Date();
  const from = toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1)));
  const to = toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 4, 0)));
  return useQuery({
    queryKey: key(tenantId, "events", from),
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select("id, event_date, event_type, name_i18n")
        .gte("event_date", from).lte("event_date", to);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAttendanceWeek(tenantId: string, start: Date) {
  const iso = toIsoDate(start);
  return useQuery({
    queryKey: key(tenantId, "attendance-week", iso),
    enabled: !!tenantId,
    queryFn: async () => {
      const [days, missing] = await Promise.all([
        rpc<AttendanceDay[]>("dashboard_attendance_week", { p_week_start: iso }),
        rpc<number>("dashboard_missing_attendance", {
          p_from: iso,
          p_to: toIsoDate(new Date(start.getTime() + 6 * 86_400_000)),
        }),
      ]);
      return { days: days ?? [], missing: missing ?? 0 };
    },
  });
}

export function useAtRisk(tenantId: string, from: string, to: string) {
  return useQuery({
    queryKey: key(tenantId, "at-risk", from, to),
    enabled: !!tenantId,
    queryFn: async () => {
      const [absence, gpa] = await Promise.all([
        rpc<AtRiskAbsence[]>("dashboard_high_absence", {
          p_from: from, p_to: to, p_threshold: 10, p_limit: 5,
        }),
        rpc<LowGpa[]>("dashboard_lowest_gpa", { p_limit: 5 }),
      ]);
      return { absence: absence ?? [], gpa: gpa ?? [] };
    },
  });
}

export function useBilling(tenantId: string, from: string, to: string) {
  return useQuery({
    queryKey: key(tenantId, "billing", from, to),
    enabled: !!tenantId,
    queryFn: () => rpc<Billing>("dashboard_billing", { p_from: from, p_to: to }),
  });
}

export function useAlerts(tenantId: string, from: string, to: string) {
  return useQuery({
    queryKey: key(tenantId, "alerts", from, to),
    enabled: !!tenantId,
    queryFn: () => rpc<Alerts>("dashboard_alerts", { p_from: from, p_to: to }),
  });
}

export function useTenantName(tenantId: string) {
  return useQuery({
    queryKey: key(tenantId, "name"),
    enabled: !!tenantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("name").eq("id", tenantId).maybeSingle();
      return data?.name ?? null;
    },
  });
}
