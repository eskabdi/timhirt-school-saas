import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { toEthiopian, toGregorian } from "@/lib/ethiopian-date";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field } from "@/components/ui/Field";
import { EthDate } from "@/components/EthDate";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { tField } from "@/lib/i18n";

const YEAR_STATUS_TONE = { active: "ok", closed: "neutral", draft: "navy" } as const;

interface Term { id: string; academic_year_id: string; term_no: number; name_i18n: Record<string, string>; starts_on: string; ends_on: string; results_published: boolean }

export function AcademicYearsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [ecYear, setEcYear] = useState(toEthiopian(new Date()).year);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: yearsData } = useQuery({
    queryKey: ["academic-years", page],
    queryFn: async () => {
      const { data, count } = await supabase.from("academic_years")
        .select("id, ec_year, starts_on, ends_on, status", { count: "exact" })
        .order("ec_year", { ascending: false })
        .range(...pageRange(page));
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const years = yearsData?.rows;
  const { data: terms } = useQuery({
    queryKey: ["academic-terms"],
    queryFn: async () => (await supabase.from("academic_terms")
      .select("id, academic_year_id, term_no, name_i18n, starts_on, ends_on, results_published")
      .order("term_no")).data as Term[] ?? [],
  });

  const togglePublish = useMutation({
    mutationFn: async ({ termId, publish }: { termId: string; publish: boolean }) => {
      const { error } = await supabase.from("academic_terms").update(
        publish
          ? { results_published: true, results_published_at: new Date().toISOString(), results_published_by: profile!.id }
          : { results_published: false, results_published_at: null, results_published_by: null },
      ).eq("id", termId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["academic-terms"] }),
  });

  const generateTerms = useMutation({
    mutationFn: async () => {
      setError(null);
      // Reuse the year if it already exists rather than erroring on the
      // unique (tenant_id, ec_year) constraint. Queried directly rather than
      // found in the (paginated) `years` list — the target year may not be
      // on the currently loaded page.
      const { data: existing } = await supabase.from("academic_years")
        .select("id, ec_year, starts_on, ends_on, status").eq("ec_year", ecYear).maybeSingle();
      let year = existing ?? undefined;
      let startsOn = year?.starts_on;
      let endsOn = year?.ends_on;
      if (!year) {
        const gcStart = toGregorian({ year: ecYear, month: 1, day: 1 });
        const gcEnd = toGregorian({ year: ecYear, month: 13, day: 5 });
        startsOn = gcStart.toISOString().slice(0, 10);
        endsOn = gcEnd.toISOString().slice(0, 10);
        const { data, error: yErr } = await supabase.from("academic_years").insert({
          tenant_id: profile!.tenant_id, ec_year: ecYear,
          label_i18n: { en: `${ecYear} E.C.`, am: `${ecYear} ዓ.ም` },
          starts_on: startsOn, ends_on: endsOn, status: "active",
        }).select("id, ec_year, starts_on, ends_on, status").single();
        if (yErr) throw yErr;
        year = data;
      }

      // Every year gets exactly terms 1-4 in one shot -- semester 1 is terms
      // 1+2, semester 2 is terms 3+4 (academic_terms.term_no, no schema
      // change) -- rather than one admin click per term, which used to leave
      // a year with anywhere from 0 to 3 terms and no guardrail against it.
      // Even four-way split of the year's Gregorian span -- a reasonable
      // default the office can see and, if wrong for their calendar,
      // recognize at a glance from the dates shown per term. ignoreDuplicates
      // means re-running this for a year that already has some terms only
      // fills in whatever's missing.
      const totalMs = new Date(endsOn!).getTime() - new Date(startsOn!).getTime();
      const quarterMs = totalMs / 4;
      const rows = [1, 2, 3, 4].map((no) => {
        const sem = Math.ceil(no / 2);
        const termInSem = no - (sem - 1) * 2;
        const termStart = new Date(new Date(startsOn!).getTime() + (no - 1) * quarterMs);
        const termEnd = new Date(new Date(startsOn!).getTime() + no * quarterMs - 86400000);
        return {
          tenant_id: profile!.tenant_id, academic_year_id: year!.id, term_no: no,
          name_i18n: { en: `Semester ${sem} · Term ${termInSem}`, am: `ሴሚስተር ${sem} · ተርም ${termInSem}`, om: `Simistara ${sem} · Termii ${termInSem}` },
          starts_on: termStart.toISOString().slice(0, 10), ends_on: termEnd.toISOString().slice(0, 10),
        };
      });
      const { error: tErr } = await supabase.from("academic_terms")
        .upsert(rows, { onConflict: "tenant_id,academic_year_id,term_no", ignoreDuplicates: true });
      if (tErr) throw tErr;
    },
    onSuccess: () => {
      setPage(1);
      qc.invalidateQueries({ queryKey: ["academic-years"] });
      qc.invalidateQueries({ queryKey: ["academic-terms"] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("errors.generic")),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("settingsPages.academicYears")}</h1>
      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}
      <Card className="flex flex-wrap items-end gap-3">
        <Field label={t("common.ecYear")}>
          <input type="number" value={ecYear} onChange={(e) => setEcYear(Number(e.target.value))}
            className="w-28 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>
        <Button onClick={() => generateTerms.mutate()} disabled={generateTerms.isPending}>
          {generateTerms.isPending ? t("settingsPages.generatingTerms") : t("settingsPages.generateTerms")}
        </Button>
        <p className="w-full text-xs text-ink-faint">{t("settingsPages.generateTermsHint")}</p>
      </Card>
      <div className="space-y-3">
        {years?.map((y) => {
          const yearTerms = terms?.filter((tr) => tr.academic_year_id === y.id) ?? [];
          return (
            <Card key={y.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{y.ec_year} E.C.</span>
                <span className="text-sm text-ink-faint"><EthDate value={y.starts_on} /> — <EthDate value={y.ends_on} /></span>
                <Badge tone={YEAR_STATUS_TONE[y.status as keyof typeof YEAR_STATUS_TONE] ?? "neutral"}>{y.status}</Badge>
              </div>
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("settingsPages.terms")}</p>
                {yearTerms.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {yearTerms.map((tr) => (
                      <div key={tr.id} className="rounded-control border border-line px-3 py-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-ink">{tField(tr.name_i18n, i18n.resolvedLanguage!)}</p>
                          <Badge tone={tr.results_published ? "ok" : "neutral"}>
                            {tr.results_published ? t("settingsPages.resultsPublished") : t("settingsPages.resultsUnpublished")}
                          </Badge>
                        </div>
                        <p className="text-xs text-ink-faint"><EthDate value={tr.starts_on} /> — <EthDate value={tr.ends_on} /></p>
                        <button type="button" className="mt-1 text-xs text-navy hover:underline"
                          onClick={() => togglePublish.mutate({ termId: tr.id, publish: !tr.results_published })}
                          disabled={togglePublish.isPending}>
                          {tr.results_published ? t("settingsPages.unpublishResults") : t("settingsPages.publishResults")}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-ink-faint">{t("settingsPages.noTerms")}</p>}
              </div>
            </Card>
          );
        })}
      </div>
      <Pagination page={page} totalCount={yearsData?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
