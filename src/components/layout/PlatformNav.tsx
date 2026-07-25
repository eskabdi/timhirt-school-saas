// Sidebar nav for the /platform/* super_admin console. Every platform route
// in src/app/router.tsx has a link here, grouped the same way the tenant-side
// DashboardShell groups its sections.
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { useSession } from "@/features/auth/useSession";
import { cn } from "@/lib/utils";

interface PlatformLink { to: string; labelKey: string; end?: boolean }
interface PlatformSection { sectionKey?: string; items: PlatformLink[] }

const PLATFORM_NAV: PlatformSection[] = [
  {
    sectionKey: "platformNav.tenantManagement",
    items: [
      { to: "/platform/tenants", labelKey: "platformNav.tenants" },
      { to: "/platform/modules", labelKey: "platformNav.modulesMatrix" },
    ],
  },
  {
    sectionKey: "platformNav.commercial",
    items: [
      { to: "/platform/billing", labelKey: "platformNav.billing" },
      { to: "/platform/integrations", labelKey: "platformNav.integrations" },
    ],
  },
  {
    sectionKey: "platformNav.reportsAnalytics",
    items: [{ to: "/platform/reports", labelKey: "platformNav.platformReport" }],
  },
  {
    sectionKey: "platformNav.configuration",
    items: [{ to: "/platform/statutory", labelKey: "platformNav.statutoryConfig" }],
  },
];

export function PlatformNav() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { profile } = useSession();

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Avatar name={t("app.name")} size="md" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-bold leading-tight text-navy">{t("app.name")}</h1>
          <p className="truncate text-xs text-ink-faint">{t("platformNav.console")}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {PLATFORM_NAV.map((section, si) => (
          <div key={si} className="space-y-1">
            {section.sectionKey && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t(section.sectionKey)}
              </p>
            )}
            <div className={cn("space-y-1", section.sectionKey && "pl-1")}>
              {section.items.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end ?? false}
                  className={({ isActive }) =>
                    cn("block rounded-control px-3 py-2 text-sm transition-colors",
                       isActive ? "bg-navy font-semibold text-white" : "text-ink-soft hover:bg-navy-wash")}
                >
                  {t(l.labelKey)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <Avatar name={profile?.full_name ?? "?"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{profile?.full_name}</p>
            <p className="truncate text-xs text-ink-faint">{t("platformNav.superAdmin")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="block w-full rounded-control px-3 py-2 text-left text-sm text-danger hover:bg-danger-tint"
        >
          {t("platformNav.logOut")}
        </button>
      </div>
    </aside>
  );
}
