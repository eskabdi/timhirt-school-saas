import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/Avatar";
import { PlatformNav } from "./PlatformNav";

export function PlatformShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-page md:flex-row">
      <div className="relative z-50 flex items-center gap-2.5 border-b border-line bg-card px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label={t(mobileNavOpen ? "nav.closeMenu" : "nav.openMenu")}
          aria-expanded={mobileNavOpen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-navy hover:bg-navy-wash"
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
        <Avatar name={t("app.name")} size="sm" />
        <span className="truncate font-display text-sm font-bold text-navy">{t("app.name")}</span>
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/50 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      <PlatformNav mobileNavOpen={mobileNavOpen} />

      <main className="min-w-0 flex-1 overflow-x-auto p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
