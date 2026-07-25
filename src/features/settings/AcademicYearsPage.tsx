import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { toEthiopian, toGregorian } from "@/lib/ethiopian-date";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";

const YEAR_STATUS_TONE = { active: "ok", closed: "neutral", draft: "navy" } as const;

export function AcademicYearsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [ecYear, setEcYear] = useState(toEthiopian(new Date()).year);

  const { data: years } = useQuery({
    queryKey: ["academic-years"],
    queryFn: async () => (await supabase.from("academic_years").select("id, ec_year, starts_on, ends_on, status").order("ec_year", { ascending: false })).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      const startsOn = toGregorian({ year: ecYear, month: 1, day: 1 });
      const endsOn = toGregorian({ year: ecYear, month: 13, day: 5 });
      const { error } = await supabase.from("academic_years").insert({
        tenant_id: profile!.tenant_id, ec_year: ecYear,
        label_i18n: { en: `${ecYear} E.C.`, am: `${ecYear} ዓ.ም` },
        starts_on: startsOn.toISOString().slice(0, 10), ends_on: endsOn.toISOString().slice(0, 10),
        status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["academic-years"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("settingsPages.academicYears")}</h1>
      <Card className="flex items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-ink-faint">{t("common.ecYear")}</label>
          <input type="number" value={ecYear} onChange={(e) => setEcYear(Number(e.target.value))}
            className="w-28 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>{t("settingsPages.createYear")}</Button>
      </Card>
      <div className="space-y-2">
        {years?.map((y) => (
          <Card key={y.id} className="flex items-center justify-between">
            <span className="font-medium text-ink">{y.ec_year} E.C.</span>
            <span className="text-sm text-ink-faint"><EthDate value={y.starts_on} /> — <EthDate value={y.ends_on} /></span>
            <Badge tone={YEAR_STATUS_TONE[y.status as keyof typeof YEAR_STATUS_TONE] ?? "neutral"}>{y.status}</Badge>
          </Card>
        ))}
      </div>
    </div>
  );
}
