// Merges the former separate Users / Roles / Permissions Matrix settings
// pages into one tabbed module. Same hand-rolled tab pattern as
// StaffProfilePage.tsx / StudentDetailPage.tsx -- no shared Tabs primitive
// exists in src/components/ui/ yet, so this replicates rather than invents.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UsersTab } from "./UsersTab";
import { RolesTab } from "./RolesTab";
import { PermissionsMatrixTab } from "./PermissionsMatrixTab";

const TABS = ["users", "roles", "permissionsMatrix"] as const;
type Tab = (typeof TABS)[number];

export function AccessManagementPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("users");

  const tabLabels: Record<Tab, string> = {
    users: t("nav.users"),
    roles: t("nav.roles"),
    permissionsMatrix: t("nav.permissionsMatrix"),
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("accessManagement.title")}</h1>
        <p className="text-sm text-ink-faint">{t("accessManagement.subtitle")}</p>
      </div>

      <div className="flex gap-6 border-b border-line">
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`border-b-2 pb-2 text-sm font-semibold transition-colors ${
              tab === tb ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink"
            }`}
          >
            {tabLabels[tb]}
          </button>
        ))}
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "roles" && <RolesTab />}
      {tab === "permissionsMatrix" && <PermissionsMatrixTab />}
    </div>
  );
}
