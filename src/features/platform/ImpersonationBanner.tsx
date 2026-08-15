import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getActiveImpersonation, endImpersonation } from "./impersonation";

// Mounted app-wide (DashboardShell) since an active impersonation applies
// to whatever the target user's own session can reach, not one specific
// page. Reads sessionStorage directly rather than React state/context --
// this banner and the session swap that creates it are decoupled by a full
// page reload (TenantDetailPage.tsx), so there is no live component tree
// to carry state across that boundary.
export function ImpersonationBanner() {
  const { t } = useTranslation();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = getActiveImpersonation();

  if (!active) return null;

  const stop = async () => {
    setError(null);
    setEnding(true);
    try {
      await endImpersonation();
      window.location.href = "/platform/tenants";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEnding(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-danger px-4 py-2 text-sm text-white">
      <span>{t("platformPagesX.impersonationBanner", { name: active.targetName })}</span>
      <div className="flex items-center gap-3">
        {error && <span className="text-xs">{error}</span>}
        <button type="button" onClick={stop} disabled={ending}
          className="rounded-control bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30">
          {ending ? t("platformPagesX.impersonationEnding") : t("platformPagesX.impersonationEnd")}
        </button>
      </div>
    </div>
  );
}
