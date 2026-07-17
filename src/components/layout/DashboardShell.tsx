import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { EthDate } from "@/components/EthDate";
import { useSession } from "@/features/auth/useSession";
import { useEnabledModules } from "@/features/auth/useEnabledModules";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const ADMIN_REG = ["school_admin", "registrar"];
const FINANCE = ["school_admin", "accountant"];
const HR = ["school_admin", "hr_officer"];
const HR_FINANCE = ["school_admin", "hr_officer", "accountant"];
const TEACH = ["school_admin", "teacher"];
const STAFF = ["school_admin", "teacher", "hr_officer", "accountant", "registrar"];

interface NavItem { to: string; key: string; roles: string[]; module?: string; end?: boolean }
interface NavSection { section?: string; items: NavItem[] }

// Mirrors the exact role/module gates in src/app/router.tsx — every route
// defined there gets a link here, so nothing built is unreachable from the UI.
const NAV: NavSection[] = [
  {
    items: [
      { to: "/", key: "nav.dashboard", roles: STAFF, end: true },
    ],
  },
  {
    section: "nav.section.academics",
    items: [
      { to: "/students", key: "nav.students", roles: ADMIN_REG, module: "sis" },
      { to: "/admissions", key: "nav.admissions", roles: ADMIN_REG, module: "admissions" },
      { to: "/id-cards", key: "nav.idCards", roles: ADMIN_REG, module: "id_cards" },
      { to: "/attendance", key: "nav.attendance", roles: TEACH, module: "attendance" },
      { to: "/attendance/overview", key: "nav.attendanceOverview", roles: TEACH, module: "attendance" },
      { to: "/timetable", key: "nav.timetable", roles: TEACH, module: "timetable" },
      { to: "/gradebook", key: "nav.gradebook", roles: TEACH, module: "gradebook" },
      { to: "/assignments", key: "nav.assignments", roles: TEACH, module: "assignments" },
    ],
  },
  {
    section: "nav.section.finance",
    items: [
      { to: "/fees/structures", key: "nav.feeStructures", roles: ["school_admin"], module: "fees" },
      { to: "/fees/invoices", key: "nav.invoices", roles: FINANCE, module: "fees" },
      { to: "/inventory", key: "nav.inventory", roles: FINANCE, module: "inventory" },
      { to: "/reports", key: "nav.reports", roles: FINANCE, module: "reporting" },
    ],
  },
  {
    section: "nav.section.operations",
    items: [
      { to: "/communication", key: "nav.communication", roles: ["school_admin"], module: "communication" },
      { to: "/hostel", key: "nav.hostel", roles: ["school_admin"], module: "hostel" },
      { to: "/discipline", key: "nav.discipline", roles: ["school_admin"], module: "discipline" },
      { to: "/clinic", key: "nav.clinic", roles: ["school_admin"], module: "clinic" },
      { to: "/library", key: "nav.library", roles: ["school_admin"], module: "library" },
      { to: "/transport", key: "nav.transport", roles: ["school_admin"], module: "transport" },
      { to: "/events", key: "nav.events", roles: ["school_admin"], module: "events" },
    ],
  },
  {
    section: "nav.section.hr",
    items: [
      { to: "/hr/employees", key: "nav.employees", roles: HR, module: "hr_payroll" },
      { to: "/hr/leave", key: "nav.leave", roles: HR, module: "hr_payroll" },
      { to: "/hr/payroll", key: "nav.payroll", roles: HR_FINANCE, module: "hr_payroll" },
    ],
  },
  {
    section: "nav.section.mySpace",
    items: [
      { to: "/my/timetable", key: "nav.myTimetable", roles: ["teacher"], module: "timetable" },
      { to: "/my/leave", key: "nav.myLeave", roles: STAFF, module: "hr_payroll" },
      { to: "/my/payslips", key: "nav.myPayslips", roles: STAFF, module: "hr_payroll" },
    ],
  },
  {
    section: "nav.section.settings",
    items: [
      { to: "/classes", key: "nav.classes", roles: ["school_admin"] },
      { to: "/subjects", key: "nav.subjects", roles: ["school_admin"] },
      { to: "/settings/academic-years", key: "nav.academicYears", roles: ["school_admin"] },
      { to: "/settings/grading-scales", key: "nav.gradingScales", roles: ["school_admin"] },
      { to: "/settings/branding", key: "nav.branding", roles: ["school_admin"] },
      { to: "/settings/users", key: "nav.users", roles: ["school_admin"] },
      { to: "/settings/calendar", key: "nav.calendarSettings", roles: ["school_admin"] },
    ],
  },
  {
    items: [
      { to: "/portal", key: "nav.portal", roles: ["student", "parent"], end: true },
      { to: "/portal/timetable", key: "nav.timetable", roles: ["student"] },
      { to: "/portal/grades", key: "nav.grades", roles: ["student"] },
      { to: "/portal/attendance", key: "nav.attendance", roles: ["student"] },
      { to: "/portal/assignments", key: "nav.assignments", roles: ["student"] },
      { to: "/portal/pay", key: "nav.makePayment", roles: ["parent"] },
    ],
  },
];

export function DashboardShell() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const modules = useEnabledModules();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  const isSuperAdmin = profile?.role === "super_admin";

  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex min-h-screen bg-page">
      <aside className="flex w-60 flex-col border-r border-line bg-sidebar">
        <div className="border-b border-line px-5 py-4">
          <h1 className="font-display text-xl font-bold text-navy">{t("app.name")}</h1>
          <p className="text-xs text-ink-faint">{t("app.tagline")}</p>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((section, si) => {
            const items = section.items.filter((n) =>
              (!profile || isSuperAdmin || n.roles.includes(profile.role))
              && (!n.module || isSuperAdmin || modules?.has(n.module)),
            );
            if (items.length === 0) return null;

            const hasActiveRoute = items.some((n) =>
              n.end ? location.pathname === n.to : location.pathname.startsWith(n.to));
            const isOpen = !section.section || !collapsed.has(section.section) || hasActiveRoute;

            return (
              <div key={si} className="space-y-1">
                {section.section && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.section!)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint hover:text-ink"
                  >
                    {t(section.section)}
                    <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-180" : "")} aria-hidden>
                      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className={cn("space-y-1 overflow-hidden", section.section && "pl-1")}>
                    {items.map((n) => (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.end ?? false}
                        className={({ isActive }) =>
                          cn("block rounded-control px-3 py-2 text-sm transition-colors",
                             isActive ? "bg-navy font-semibold text-white" : "text-ink-soft hover:bg-navy-wash")}
                      >
                        {t(n.key)}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <button onClick={signOut} className="border-t border-line px-5 py-3 text-left text-sm text-ink-faint hover:text-ink">
          {t("nav.signOut")}
        </button>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-card px-6 py-3">
          <div className="text-sm text-ink-faint">
            {t("dashboard.today")}: <span className="font-medium text-ink"><EthDate value={new Date()} /></span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-soft">{profile?.full_name}</span>
            <LanguageSwitcher />
          </div>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
