import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";

export function UsersPage() {
  const { t } = useTranslation();
  const { data: users } = useQuery({
    queryKey: ["tenant-users"],
    queryFn: async () => (await supabase.from("users").select("id, full_name, email, role, locale").order("full_name")).data ?? [],
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("settingsPages.users")}</h1>
      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("common.name")}</th><th className="px-4 py-2">{t("common.email")}</th><th className="px-4 py-2">{t("common.role")}</th><th className="px-4 py-2">{t("common.locale")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium text-ink">{u.full_name}</td>
                <td className="px-4 py-2 text-ink-faint">{u.email}</td>
                <td className="px-4 py-2 capitalize text-ink">{u.role.replace("_", " ")}</td>
                <td className="px-4 py-2 uppercase text-ink">{u.locale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
