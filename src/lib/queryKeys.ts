// §6.3 — every key is tenant-scoped to prevent cross-tenant cache bleed.
export const qk = {
  profile: () => ["session", "profile"] as const,
  students: (t: string) => ["tenant", t, "students"] as const,
  student: (t: string, id: string) => ["tenant", t, "students", id] as const,
  classes: (t: string) => ["tenant", t, "classes"] as const,
  attendance: (t: string, classId: string, date: string) =>
    ["tenant", t, "attendance", classId, date] as const,
  holidays: (t: string, date: string) => ["tenant", t, "holidays", date] as const,
  employees: (t: string) => ["tenant", t, "employees"] as const,
  payrollRuns: (t: string) => ["tenant", t, "payroll-runs"] as const,
  leaveRequests: (t: string) => ["tenant", t, "leave-requests"] as const,
  dashboard: (t: string) => ["tenant", t, "dashboard"] as const,
};
