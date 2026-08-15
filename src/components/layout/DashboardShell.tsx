import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { EthDate } from "@/components/EthDate";
import { Avatar } from "@/components/ui/Avatar";
import { useSession } from "@/features/auth/useSession";
import { useEnabledModules } from "@/features/auth/useEnabledModules";
import { ChangePasswordModal } from "@/features/auth/ChangePasswordModal";
import { ImpersonationBanner } from "@/features/platform/ImpersonationBanner";
import { useBrandTheme } from "@/features/settings/useBrandTheme";
import { supabase } from "@/lib/supabase";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const ADMIN_REG = ["school_admin", "registrar"];
const FINANCE = ["school_admin", "accountant"];
const HR = ["school_admin", "hr_officer"];
const HR_FINANCE = ["school_admin", "hr_officer", "accountant"];
const TEACH = ["school_admin", "teacher"];
const LIBRARY = ["school_admin", "librarian"];
const STAFF = ["school_admin", "teacher", "hr_officer", "accountant", "registrar", "librarian"];

interface NavItem { to: string; key: string; roles: string[]; module?: string; end?: boolean }
interface NavGroup { key: string; items: NavItem[] }
interface NavSection { section?: string; items?: NavItem[]; groups?: NavGroup[] }

// Mirrors the exact role/module gates in src/app/router.tsx — every route
// defined there gets a link here, so nothing built is unreachable from the UI.
const NAV: NavSection[] = [
  {
    items: [
      { to: "/", key: "nav.dashboard", roles: STAFF, end: true },
      { to: "/messages", key: "nav.messages", roles: STAFF },
    ],
  },
  {
    section: "nav.section.mySpace",
    items: [
      { to: "/my/timetable", key: "nav.myTimetable", roles: ["teacher"], module: "timetable" },
      { to: "/my/classes", key: "nav.myClasses", roles: ["teacher"], module: "timetable" },
    ],
  },
  {
    section: "nav.section.studentLifecycle",
    items: [
      { to: "/students", key: "nav.students", roles: ADMIN_REG, module: "sis" },
      { to: "/admissions", key: "nav.admissions", roles: ADMIN_REG, module: "admissions" },
      { to: "/id-cards", key: "nav.idCards", roles: ADMIN_REG, module: "id_cards" },
      // No `module` key -- leaving certificates are available at every tier,
      // not gated behind id_cards despite the naming similarity.
      { to: "/leaving-certificates", key: "nav.leavingCertificates", roles: ADMIN_REG },
      { to: "/attendance", key: "nav.attendance", roles: TEACH, module: "attendance" },
      // No `module` key -- same "not a toggleable module" call as messages.
      { to: "/student-leave-requests", key: "nav.studentLeaveRequests", roles: TEACH },
      { to: "/attendance/overview", key: "nav.attendanceOverview", roles: TEACH, module: "attendance" },
      { to: "/assignments", key: "nav.assignments", roles: TEACH, module: "assignments" },
      { to: "/gradebook", key: "nav.gradebook", roles: TEACH, module: "gradebook" },
    ],
  },
  {
    section: "nav.section.academicScheduling",
    items: [
      { to: "/classes", key: "nav.classes", roles: ["school_admin"] },
      { to: "/subjects", key: "nav.subjects", roles: ["school_admin"] },
      { to: "/settings/teachers", key: "nav.teachers", roles: ["school_admin"] },
      { to: "/settings/academic-years", key: "nav.academicYears", roles: ["school_admin"] },
      { to: "/timetable", key: "nav.timetable", roles: TEACH, module: "timetable" },
      { to: "/settings/grading-scales", key: "nav.gradingScales", roles: ["school_admin"] },
      { to: "/settings/promotion", key: "nav.promotion", roles: ["school_admin"] },
    ],
  },
  {
    section: "nav.section.studentWelfare",
    items: [
      { to: "/communication", key: "nav.communication", roles: ["school_admin"], module: "communication" },
      { to: "/communication/notices", key: "nav.notices", roles: ["school_admin"], module: "communication" },
      { to: "/hostel", key: "nav.hostel", roles: ["school_admin"], module: "hostel" },
      { to: "/discipline", key: "nav.discipline", roles: ["school_admin"], module: "discipline" },
      { to: "/clinic", key: "nav.clinic", roles: ["school_admin"], module: "clinic" },
      { to: "/library", key: "nav.library", roles: LIBRARY, module: "library" },
      { to: "/library/circulation", key: "nav.libraryCirculation", roles: LIBRARY, module: "library" },
      { to: "/transport", key: "nav.transport", roles: ["school_admin"], module: "transport" },
      { to: "/events", key: "nav.events", roles: ["school_admin"], module: "events" },
    ],
  },
  {
    section: "nav.section.financeResource",
    items: [
      { to: "/fees/structures", key: "nav.feeStructures", roles: ["school_admin"], module: "fees" },
      { to: "/fees/invoices", key: "nav.invoices", roles: FINANCE, module: "fees" },
      { to: "/inventory", key: "nav.inventory", roles: FINANCE, module: "inventory" },
    ],
  },
  {
    section: "nav.section.reportsAnalytics",
    items: [
      { to: "/reports", key: "nav.academicStudentsReport", roles: FINANCE, module: "reporting" },
      { to: "/reports/custom", key: "nav.customReport", roles: ["school_admin"] },
      { to: "/reports/financial", key: "nav.financialReport", roles: FINANCE, module: "reporting" },
      { to: "/reports/fees", key: "nav.feesReport", roles: FINANCE, module: "reporting" },
      { to: "/reports/hr-payroll", key: "nav.hrPayrollReport", roles: HR_FINANCE, module: "hr_payroll" },
      { to: "/reports/users-audit", key: "nav.usersAuditReport", roles: ["school_admin"] },
    ],
  },
  {
    section: "nav.section.hrPayroll",
    items: [
      { to: "/hr/employees", key: "nav.employees", roles: HR, module: "hr_payroll" },
      { to: "/hr/leave", key: "nav.leave", roles: HR, module: "hr_payroll" },
      { to: "/hr/payroll", key: "nav.payroll", roles: HR_FINANCE, module: "hr_payroll" },
    ],
  },
  {
    section: "nav.section.settings",
    groups: [
      {
        key: "nav.section.settingsConfiguration",
        items: [
          { to: "/settings/calendar", key: "nav.calendarSettings", roles: ["school_admin"] },
          { to: "/settings/branding", key: "nav.branding", roles: ["school_admin"] },
          { to: "/settings/import-export", key: "nav.importExport", roles: ["school_admin"] },
          { to: "/settings/id-card-template", key: "nav.idCardTemplate", roles: ["school_admin"] },
          { to: "/settings/library", key: "nav.librarySettings", roles: LIBRARY, module: "library" },
        ],
      },
      {
        key: "nav.section.settingsSystemAdmin",
        items: [
          { to: "/settings/access", key: "nav.accessManagement", roles: ["school_admin"] },
          { to: "/settings/configuration", key: "nav.configuration", roles: ["school_admin"] },
          { to: "/settings/health-monitoring", key: "nav.healthMonitoring", roles: ["school_admin"] },
          { to: "/settings/audit-logs", key: "nav.auditLogs", roles: ["school_admin"] },
          { to: "/settings/backups", key: "nav.backups", roles: ["school_admin"] },
        ],
      },
    ],
  },
  {
    items: [
      { to: "/portal", key: "nav.portal", roles: ["student", "parent"], end: true },
      { to: "/portal/timetable", key: "nav.timetable", roles: ["student"] },
      { to: "/portal/grades", key: "nav.grades", roles: ["student"] },
      { to: "/portal/attendance", key: "nav.attendance", roles: ["student"] },
      { to: "/portal/assignments", key: "nav.assignments", roles: ["student"] },
      { to: "/portal/pay", key: "nav.makePayment", roles: ["parent", "student"] },
      { to: "/portal/library", key: "nav.library", roles: ["parent", "student"], module: "library" },
    ],
  },
];

// SELF-SERVICE PORTAL: shown under the user-icon dropdown, not the sidebar.
const USER_MENU_LINKS: NavItem[] = [
  { to: "/my/leave", key: "nav.myLeave", roles: STAFF, module: "hr_payroll" },
  { to: "/my/payslips", key: "nav.myPayslips", roles: STAFF, module: "hr_payroll" },
];

// Every collapsible section + subgroup starts closed; the one containing the
// active route still auto-opens, so the current page is never hidden.
const ALL_COLLAPSIBLE_KEYS = NAV.flatMap((s) =>
  s.section ? [s.section, ...(s.groups ?? []).map((g) => g.key)] : []);

export function DashboardShell() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const modules = useEnabledModules();
  useBrandTheme(); // tenant palette -> :root CSS variables (whole-app theming)
  const queryClient = useQueryClient();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ALL_COLLAPSIBLE_KEYS));
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = profile?.role === "super_admin";

  const { data: tenant } = useQuery({
    queryKey: ["sidebar-tenant", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenants").select("name").eq("id", profile!.tenant_id!).single()).data,
  });
  // Shares the ["tenant-config", …] key with BrandingPage, so saving branding
  // refreshes the nav name + logo immediately.
  const { data: brandConfig } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  // No realtime in this codebase (TanStack Query refetch is the established
  // pattern) -- a light interval is the "new message" signal for the nav badge.
  const { data: unreadMessages } = useQuery({
    queryKey: ["messages-unread", profile?.id],
    enabled: !!profile?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("messages").select("id", { count: "exact", head: true })
        .eq("recipient_id", profile!.id).is("read_at", null);
      return count ?? 0;
    },
  });
  // Same "light interval, no realtime" pattern as unreadMessages above, for
  // the portal billing feed (invoice issued / payment received) on the
  // /portal/pay nav item -- parent/student only, RLS already scopes
  // portal_notifications to recipient_id = auth.uid() with no staff bypass.
  const { data: unreadBilling } = useQuery({
    queryKey: ["billing-notifications-unread", profile?.id],
    enabled: !!profile?.id && (profile?.role === "parent" || profile?.role === "student"),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("portal_notifications").select("id", { count: "exact", head: true })
        .is("read_at", null).in("kind", ["invoice_issued", "payment_received", "invoice_overdue"]);
      return count ?? 0;
    },
  });
  // Same "light interval, no realtime" pattern as unreadBilling above, for
  // the two library notification kinds (book_overdue/book_hold_ready) on
  // the /portal/library nav item.
  const { data: unreadLibrary } = useQuery({
    queryKey: ["library-notifications-unread", profile?.id],
    enabled: !!profile?.id && (profile?.role === "parent" || profile?.role === "student"),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("portal_notifications").select("id", { count: "exact", head: true })
        .is("read_at", null).in("kind", ["book_overdue", "book_hold_ready"]);
      return count ?? 0;
    },
  });
  // Same "light interval, no realtime" pattern as unreadBilling above, for
  // the two attendance notification kinds (attendance_absent/attendance_late)
  // -- guardian-only (the trigger never notifies the student themselves), so
  // shown on the /portal landing nav item since parents have no dedicated
  // /portal/attendance route (that one is student-only).
  const { data: unreadAttendance } = useQuery({
    queryKey: ["attendance-notifications-unread", profile?.id],
    enabled: !!profile?.id && profile?.role === "parent",
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count } = await supabase.from("portal_notifications").select("id", { count: "exact", head: true })
        .is("read_at", null).in("kind", ["attendance_absent", "attendance_late"]);
      return count ?? 0;
    },
  });
  const branding = brandConfig?.settings?.branding as { nameEn?: string; nameAm?: string; nameOm?: string; motto?: string; logoPath?: string | null } | undefined;
  const lang = i18n.resolvedLanguage;
  const brandName =
    (lang === "am" ? branding?.nameAm : lang === "om" ? branding?.nameOm : branding?.nameEn) ||
    branding?.nameEn || tenant?.name || t("app.name");
  // The tenant's own motto (Branding page) replaces the generic app tagline
  // once one is set -- a school's identity line, not ours.
  const motto = branding?.motto || t("app.tagline");
  const logoUrl = branding?.logoPath
    ? supabase.storage.from("branding").getPublicUrl(branding.logoPath).data.publicUrl
    : null;
  const visibleUserMenuLinks = USER_MENU_LINKS.filter((n) =>
    (!profile || isSuperAdmin || n.roles.includes(profile.role))
    && (!n.module || isSuperAdmin || modules?.has(n.module)));

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [userMenuOpen]);

  // The drawer is a mobile-only affordance for reaching a link, not a page
  // of its own -- close it the moment navigation actually happens so it
  // never sits open over the page the user just chose.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <ImpersonationBanner />
      {/* Full-width signature bar — DESIGN.md §2: primary -> primary-container
          gradient grounds the institution's identity; gold carries the date
          and the tagline underline, "jewelry" against the deep navy. */}
      <header className="relative z-50 flex items-center justify-between gap-2 bg-gradient-to-r from-navy to-navy-container px-3 py-3 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={t(mobileNavOpen ? "nav.closeMenu" : "nav.openMenu")}
            aria-expanded={mobileNavOpen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white hover:bg-white/10 md:hidden"
          >
            {mobileNavOpen ? (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden>
                <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
              </svg>
            )}
          </button>
          {logoUrl
            ? <img src={logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-gold/60" />
            : <Avatar name={brandName} size="md" className="bg-white/10 ring-2 ring-gold/60" />}
          <div className="hidden min-w-0 md:block">
            <h1 className="truncate font-display text-base font-bold leading-tight text-white">{brandName}</h1>
            <p className="truncate text-xs font-medium text-gold-bright underline decoration-gold/50 underline-offset-2">{motto}</p>
          </div>
        </div>
        <div className="hidden shrink-0 text-sm text-white/70 md:block">
          {t("dashboard.today")}: <span className="font-semibold text-gold-bright"><EthDate value={new Date()} /></span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <LanguageSwitcher variant="dark" />
          <NavLink to="/messages" aria-label={t("nav.messages")}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-gold-bright hover:bg-white/10">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden>
              <path d="M10 2a6 6 0 0 0-6 6v3.09c0 .45-.16.89-.46 1.24L2.4 13.9c-.86 1-.15 2.6 1.18 2.6h12.84c1.33 0 2.04-1.6 1.18-2.6l-1.14-1.57A2 2 0 0 1 16 11.1V8a6 6 0 0 0-6-6Z" />
              <path d="M8.2 17.5a1.8 1.8 0 0 0 3.6 0h-3.6Z" />
            </svg>
            {!!unreadMessages && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-bold text-white">
                {unreadMessages}
              </span>
            )}
          </NavLink>
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-expanded={userMenuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-pill px-2 py-1.5 hover:bg-white/10"
            >
              <Avatar name={profile?.full_name ?? "?"} size="sm" className="ring-2 ring-gold/60" />
              <span className="hidden text-sm text-white sm:inline">{profile?.full_name}</span>
              <svg viewBox="0 0 12 12" className={cn("h-3 w-3 text-white/60 transition-transform", userMenuOpen ? "rotate-180" : "")} aria-hidden>
                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {userMenuOpen && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 rounded-panel bg-card py-1 text-left shadow-ambient-lg">
                {visibleUserMenuLinks.length > 0 && (
                  <>
                    <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint/80">
                      {t("nav.section.selfServicePortal")}
                    </div>
                    {visibleUserMenuLinks.map((n) => (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className={({ isActive }) =>
                          cn("block px-4 py-2 text-left text-sm",
                             isActive ? "bg-navy-wash font-medium text-navy" : "text-ink hover:bg-sidebar")}
                      >
                        {t(n.key)}
                      </NavLink>
                    ))}
                    <div className="border-t border-line" />
                  </>
                )}
                <div className="px-4 py-2 text-xs text-ink-faint">
                  {t("userMenu.role")}: <span className="font-medium text-ink">{profile ? t(`roles.${profile.role}`) : "—"}</span>
                </div>
                <div className="border-t border-line" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setChangingPassword(true); setUserMenuOpen(false); }}
                  className="block w-full px-4 py-2 text-left text-sm text-ink hover:bg-sidebar"
                >
                  {t("userMenu.changePassword")}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={signOut}
                  className="block w-full px-4 py-2 text-left text-sm text-danger hover:bg-danger-tint"
                >
                  {t("userMenu.logout")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}

      <div className="flex flex-1">
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-ink/50 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col bg-sidebar transition-transform duration-200",
            "md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0",
            mobileNavOpen && "translate-x-0",
          )}
        >
          <nav className="flex-1 divide-y divide-line overflow-y-auto p-3 pt-4">
            {NAV.map((section, si) => {
            const visible = (n: NavItem) =>
              (!profile || isSuperAdmin || n.roles.includes(profile.role))
              && (!n.module || isSuperAdmin || modules?.has(n.module));
            const isActiveRoute = (n: NavItem) =>
              n.end ? location.pathname === n.to : location.pathname.startsWith(n.to);

            if (section.groups) {
              const groups = section.groups
                .map((g) => ({ ...g, items: g.items.filter(visible) }))
                .filter((g) => g.items.length > 0);
              if (groups.length === 0) return null;

              const hasActiveRoute = groups.some((g) => g.items.some(isActiveRoute));
              const isOpen = !section.section || !collapsed.has(section.section) || hasActiveRoute;

              return (
                <div key={si} className="space-y-1 py-3 first:pt-0">
                  {section.section && (
                    <button
                      type="button"
                      onClick={() => toggleSection(section.section!)}
                      aria-expanded={isOpen}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-xs uppercase tracking-wide text-navy",
                        hasActiveRoute ? "font-bold underline underline-offset-2" : "font-semibold",
                      )}
                    >
                      {t(section.section)}
                      <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-180" : "")} aria-hidden>
                        <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                    <div className="space-y-3 overflow-hidden pl-4">
                      {groups.map((g) => {
                        const groupHasActive = g.items.some(isActiveRoute);
                        const groupOpen = !collapsed.has(g.key) || groupHasActive;
                        return (
                          <div key={g.key} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => toggleSection(g.key)}
                              aria-expanded={groupOpen}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-[11px] uppercase tracking-wide text-navy",
                                groupHasActive ? "font-bold underline underline-offset-2" : "font-semibold",
                              )}
                            >
                              {t(g.key)}
                              <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", groupOpen ? "rotate-180" : "")} aria-hidden>
                                <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", groupOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                              <div className="space-y-1 overflow-hidden pl-4">
                                {g.items.map((n) => (
                                  <NavLink
                                    key={n.to}
                                    to={n.to}
                                    end={n.end ?? false}
                                    className={({ isActive }) =>
                                      cn("relative block rounded-control px-3 py-2 text-sm transition-colors",
                                         isActive
                                           ? "bg-navy font-semibold text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-gold-bright"
                                           : "text-ink-soft hover:bg-navy-wash")}
                                  >
                                    {t(n.key)}
                                  </NavLink>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            }

            const items = (section.items ?? []).filter(visible);
            if (items.length === 0) return null;

            const hasActiveRoute = items.some(isActiveRoute);
            const isOpen = !section.section || !collapsed.has(section.section) || hasActiveRoute;

            return (
              <div key={si} className="space-y-1 py-3 first:pt-0">
                {section.section && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.section!)}
                    aria-expanded={isOpen}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 pb-1 text-left text-xs uppercase tracking-wide text-navy",
                      hasActiveRoute ? "font-bold underline underline-offset-2" : "font-semibold",
                    )}
                  >
                    {t(section.section)}
                    <svg viewBox="0 0 12 12" className={cn("h-3 w-3 transition-transform", isOpen ? "rotate-180" : "")} aria-hidden>
                      <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className={cn("space-y-1 overflow-hidden", section.section && "pl-4")}>
                    {items.map((n) => (
                      <NavLink
                        key={n.to}
                        to={n.to}
                        end={n.end ?? false}
                        className={({ isActive }) =>
                          cn("relative flex items-center justify-between rounded-control px-3 py-2 text-sm transition-colors",
                             isActive
                               ? "bg-navy font-semibold text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-gold-bright"
                               : "text-ink-soft hover:bg-navy-wash")}
                      >
                        {t(n.key)}
                        {n.to === "/messages" && !!unreadMessages && (
                          <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {unreadMessages}
                          </span>
                        )}
                        {n.to === "/portal/pay" && !!unreadBilling && (
                          <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {unreadBilling}
                          </span>
                        )}
                        {n.to === "/portal/library" && !!unreadLibrary && (
                          <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {unreadLibrary}
                          </span>
                        )}
                        {n.to === "/portal" && !!unreadAttendance && (
                          <span className="rounded-pill bg-danger px-1.5 py-0.5 text-[11px] font-semibold text-white">
                            {unreadAttendance}
                          </span>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6">
        <Outlet />
      </main>
      </div>
    </div>
  );
}
