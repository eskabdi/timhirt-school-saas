import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { EthDate } from "@/components/EthDate";
import { useSession } from "@/features/auth/useSession";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", key: "nav.dashboard", roles: ["school_admin", "teacher", "hr_officer", "accountant", "registrar"] },
  { to: "/students", key: "nav.students", roles: ["school_admin", "registrar", "teacher"] },
  { to: "/attendance", key: "nav.attendance", roles: ["school_admin", "teacher"] },
  { to: "/hr/payroll", key: "nav.payroll", roles: ["school_admin", "hr_officer", "accountant"] },
  { to: "/hr/leave", key: "nav.leave", roles: ["school_admin", "hr_officer"] },
];

export function DashboardShell() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-line bg-chalk-raised">
        <div className="border-b border-line px-5 py-4">
          <h1 className="font-display text-xl font-bold">{t("app.name")}</h1>
          <p className="text-xs text-ink-faint">{t("app.tagline")}</p>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.filter((n) => !profile || profile.role === "super_admin" || n.roles.includes(profile.role)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                cn("block rounded-card px-3 py-2 text-sm",
                   isActive ? "bg-meskel-wash font-semibold text-ink" : "text-ink-soft hover:bg-chalk-sunken")}
            >
              {t(n.key)}
            </NavLink>
          ))}
        </nav>
        <button onClick={signOut} className="border-t border-line px-5 py-3 text-left text-sm text-ink-faint hover:text-ink">
          {t("nav.signOut")}
        </button>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-chalk-raised px-6 py-3">
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
