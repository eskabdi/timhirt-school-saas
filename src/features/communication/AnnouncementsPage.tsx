import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { tField } from "@/lib/i18n";

export function AnnouncementsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "staff" | "parents">("all");
  const [page, setPage] = useState(1);

  const { data: announcementsData } = useQuery({
    queryKey: ["announcements", page],
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("announcements")
        .select("id, title_i18n, body_i18n, audience, published_at", { count: "exact" })
        .order("published_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const announcements = announcementsData?.rows;

  const publish = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("announcements").insert({
        tenant_id: profile!.tenant_id, title_i18n: { en: title }, body_i18n: { en: body },
        audience, created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); setTitle(""); setBody(""); },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t("communication.title")}</h1>
      <Card className="max-w-xl space-y-3">
        <Field label={t("communication.titleLabel")}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></Field>
        <Field label={t("communication.message")}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={3000}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>
        <Field label={t("communication.audience")}>
          <select value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="all">{t("communication.all")}</option>
            <option value="staff">{t("communication.staff")}</option>
            <option value="parents">{t("communication.parents")}</option>
          </select>
        </Field>
        <Button onClick={() => publish.mutate()} disabled={!title || !body}>{t("communication.publish")}</Button>
      </Card>
      <div className="space-y-2">
        {announcements?.map((a) => (
          <Card key={a.id}>
            <p className="font-medium text-ink">{tField(a.title_i18n, i18n.resolvedLanguage!)}</p>
            <p className="text-sm text-ink-faint">{tField(a.body_i18n, i18n.resolvedLanguage!)}</p>
          </Card>
        ))}
        <Pagination page={page} totalCount={announcementsData?.count ?? 0} onPageChange={setPage} />
      </div>
    </div>
  );
}
