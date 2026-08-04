// Notice board. Rows carry their visibility window and audience, because
// "who can see this and until when" is the thing an administrator scans for —
// a notice that quietly expired looks identical to a live one otherwise.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { richTextToPlain } from "@/components/ui/RichText";
import { VISIBILITY_ROLES } from "@/components/ui/RoleVisibility";
import { tField } from "@/lib/i18n";
import { NoticeFormModal, type NoticeRow } from "./NoticeFormModal";

export function NoticesPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NoticeRow | null>(null);
  const [page, setPage] = useState(1);
  const locale = i18n.resolvedLanguage ?? "en";

  const { data: noticesData } = useQuery({
    queryKey: ["notices", profile?.tenant_id, page],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("notices")
        .select("id, title_i18n, body_html, visible_from, visible_to, sort_order, visible_all_school, visible_to_roles", { count: "exact" })
        .order("sort_order")
        .order("visible_from", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as NoticeRow[], count: count ?? 0 };
    },
  });
  const notices = noticesData?.rows;

  const today = new Date().toISOString().slice(0, 10);
  const roleLabel = (role: string) =>
    t(VISIBILITY_ROLES.find((r) => r.role === role)?.labelKey ?? role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t("notices.title")}</h1>
        <Button onClick={() => { setEditing(null); setOpen(true); }}>+ {t("notices.addTitle")}</Button>
      </div>

      {!notices?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("notices.empty")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-4 py-3">{t("assignments.titleLabel")}</th>
                <th className="px-4 py-3">{t("notices.window")}</th>
                <th className="px-4 py-3">{t("notices.audience")}</th>
                <th className="px-4 py-3">{t("notices.sortOrder")}</th>
                <th className="px-4 py-3">{t("students.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {notices.map((n) => {
                const live = n.visible_from <= today && today <= n.visible_to;
                const preview = richTextToPlain(n.body_html);
                return (
                  <tr key={n.id} className="hover:bg-sidebar">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{tField(n.title_i18n, locale)}</p>
                      {preview && <p className="truncate text-xs text-ink-faint">{preview.slice(0, 90)}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      <EthDate value={n.visible_from} /> → <EthDate value={n.visible_to} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      {n.visible_all_school
                        ? t("notices.allSchool")
                        : n.visible_to_roles?.length
                          ? n.visible_to_roles.map(roleLabel).join(", ")
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{n.sort_order}</td>
                    <td className="px-4 py-3">
                      <Badge tone={live ? "ok" : "neutral"}>
                        {live ? t("notices.live") : t("notices.expired")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => { setEditing(n); setOpen(true); }}
                        className="rounded-control bg-navy-wash px-2.5 py-1 text-xs font-medium text-navy hover:bg-line">
                        {t("crud.edit")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination page={page} totalCount={noticesData?.count ?? 0} onPageChange={setPage} className="px-4" />
        </Panel>
      )}

      <NoticeFormModal open={open} onClose={() => setOpen(false)} editing={editing} />
    </div>
  );
}
