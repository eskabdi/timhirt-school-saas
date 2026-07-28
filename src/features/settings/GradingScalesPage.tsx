// Grading Scales (nav: Academic & Scheduling).
//
// The whole table is edited in place and committed by one Save Changes, rather
// than saving per row: the bands are a single coherent ladder — moving A's floor
// from 85 to 87 only makes sense alongside whatever B+ becomes — and letting
// half a ladder reach the database would produce a scale with a gap in it.
//
// Discard restores the last saved state, so an abandoned edit costs nothing.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Toggle } from "@/components/ui/Toggle";
import { cn } from "@/lib/utils";

interface Band {
  id: string;
  letter: string;
  min_percent: string;
  gpa_points: string;
  description_en: string;
  description_am: string;
  is_pass: boolean;
  /** Client-only rows have no database id yet. */
  isNew?: boolean;
}

interface ScaleRow {
  id: string;
  name: string;
  description: string | null;
  grade_bands: {
    id: string; letter: string; min_percent: number; gpa_points: number;
    description_i18n: Record<string, string> | null; is_pass: boolean; sort_order: number;
  }[];
}

const blankBand = (): Band => ({
  id: crypto.randomUUID(), letter: "", min_percent: "0", gpa_points: "0",
  description_en: "", description_am: "", is_pass: true, isNew: true,
});

export function GradingScalesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [bands, setBands] = useState<Band[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: scale, isLoading } = useQuery({
    queryKey: ["grading-scale", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("grading_scales")
        .select("id, name, description, grade_bands(id, letter, min_percent, gpa_points, description_i18n, is_pass, sort_order)")
        .eq("is_default", true).maybeSingle();
      if (err) throw err;
      return data as ScaleRow | null;
    },
  });

  // Highest floor first, the way a grade table is read.
  const hydrate = (s: ScaleRow | null | undefined): Band[] =>
    [...(s?.grade_bands ?? [])]
      .sort((a, b) => b.min_percent - a.min_percent)
      .map((b) => ({
        id: b.id, letter: b.letter,
        min_percent: String(b.min_percent), gpa_points: String(b.gpa_points),
        description_en: b.description_i18n?.en ?? "", description_am: b.description_i18n?.am ?? "",
        is_pass: b.is_pass,
      }));

  useEffect(() => { setBands(hydrate(scale)); setDirty(false); }, [scale]);

  const patch = (id: string, key: keyof Band, value: string | boolean) => {
    setBands((prev) => prev.map((b) => (b.id === id ? { ...b, [key]: value } : b)));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (bands.length === 0) throw new Error(t("gradingScales.needOneBand"));
      const letters = new Set<string>();
      for (const b of bands) {
        if (!b.letter.trim()) throw new Error(t("gradingScales.letterRequired"));
        if (letters.has(b.letter.trim())) throw new Error(t("gradingScales.duplicateLetter", { letter: b.letter.trim() }));
        letters.add(b.letter.trim());
        const min = Number(b.min_percent), gpa = Number(b.gpa_points);
        if (!Number.isFinite(min) || min < 0 || min > 100) throw new Error(t("gradingScales.minPercentInvalid", { letter: b.letter }));
        if (!Number.isFinite(gpa) || gpa < 0 || gpa > 5) throw new Error(t("gradingScales.gpaInvalid", { letter: b.letter }));
      }

      // Create the tenant's default scale on first save — the page is otherwise
      // unreachable for a school that has never configured one.
      let scaleId = scale?.id;
      if (!scaleId) {
        const { data, error: err } = await supabase.from("grading_scales")
          .insert({
            tenant_id: profile!.tenant_id,
            name: t("gradingScales.defaultScaleName"),
            description: t("gradingScales.defaultScaleDesc"),
            is_default: true,
          }).select("id").single();
        if (err) throw err;
        scaleId = data.id as string;
      }

      // Replace the ladder wholesale: rows may have been added, removed, or had
      // their letter changed, and the unique key is (scale_id, letter).
      const { error: delErr } = await supabase.from("grade_bands").delete().eq("scale_id", scaleId);
      if (delErr) throw delErr;

      const { error: insErr } = await supabase.from("grade_bands").insert(
        bands.map((b, i) => ({
          scale_id: scaleId!, tenant_id: profile!.tenant_id,
          letter: b.letter.trim(),
          min_percent: Number(b.min_percent),
          gpa_points: Number(b.gpa_points),
          description_i18n: { en: b.description_en.trim(), am: b.description_am.trim() },
          is_pass: b.is_pass,
          sort_order: i,
        })),
      );
      if (insErr) throw insErr;
      await supabase.from("grading_scales").update({ updated_at: new Date().toISOString() }).eq("id", scaleId);
    },
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ["grading-scale"] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("gradingScales.saveFailed")),
  });

  const cell = "w-full rounded-control border border-line bg-card px-2 py-1.5 text-sm text-ink";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-ink">
          {t("gradingScales.title")}
        </h1>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty || save.isPending}
            onClick={() => { setBands(hydrate(scale)); setDirty(false); setError(null); }}>
            {t("gradingScales.discard")}
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => { setError(null); save.mutate(); }}>
            {save.isPending ? t("gradingScales.saving") : t("gradingScales.saveChanges")}
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold text-ink">{scale?.name ?? t("gradingScales.defaultScaleName")}</h2>
            <p className="text-sm text-ink-faint">{scale?.description ?? t("gradingScales.defaultScaleDesc")}</p>
          </div>
          <button type="button"
            onClick={() => { setBands((p) => [...p, blankBand()]); setDirty(true); }}
            className="text-sm font-medium text-navy hover:underline">
            ⊕ {t("gradingScales.addGradeLevel")}
          </button>
        </div>

        {isLoading ? (
          <p className="p-5 text-sm text-ink-faint">{t("gradingScales.loading")}</p>
        ) : bands.length === 0 ? (
          <p className="p-5 text-sm text-ink-faint">{t("gradingScales.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-line bg-navy-wash text-left text-xs font-semibold uppercase tracking-wide text-navy">
                  <th className="px-4 py-3">{t("gradingScales.letterGrade")}</th>
                  <th className="px-4 py-3">{t("gradingScales.minPercent")}</th>
                  <th className="px-4 py-3">{t("gradingScales.gpaPoints")}</th>
                  <th className="px-4 py-3">{t("gradingScales.description")}</th>
                  <th className="px-4 py-3">{t("gradingScales.status")}</th>
                  <th className="px-4 py-3"><span className="sr-only">{t("gradingScales.remove")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bands.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3">
                      <input value={b.letter} maxLength={4} aria-label={t("gradingScales.letterGrade")}
                        onChange={(e) => patch(b.id, "letter", e.target.value)}
                        className={cn(cell, "w-16 text-center font-semibold text-navy")} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input type="number" min={0} max={100} value={b.min_percent}
                          aria-label={t("gradingScales.minPercent")}
                          onChange={(e) => patch(b.id, "min_percent", e.target.value)}
                          className={cn(cell, "w-20")} />
                        <span className="text-sm text-ink-faint">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" min={0} max={5} step="0.1" value={b.gpa_points}
                        aria-label={t("gradingScales.gpaPoints")}
                        onChange={(e) => patch(b.id, "gpa_points", e.target.value)}
                        className={cn(cell, "w-20")} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row">
                        <input value={b.description_am} placeholder={t("gradingScales.amharicPlaceholder")}
                          aria-label={t("gradingScales.amharicLabel")}
                          onChange={(e) => patch(b.id, "description_am", e.target.value)}
                          className={cn(cell, "sm:w-40")} />
                        <input value={b.description_en} placeholder={t("gradingScales.englishPlaceholder")}
                          aria-label={t("gradingScales.englishLabel")}
                          onChange={(e) => patch(b.id, "description_en", e.target.value)}
                          className={cn(cell, "sm:w-40")} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Toggle checked={b.is_pass} onChange={(v) => patch(b.id, "is_pass", v)}
                          label={t("gradingScales.passFailFor", { letter: b.letter || "—" })} />
                        <span className={cn("text-xs font-medium", b.is_pass ? "text-ok" : "text-danger")}>
                          {b.is_pass ? t("gradingScales.pass") : t("gradingScales.fail")}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button"
                        onClick={() => { setBands((p) => p.filter((x) => x.id !== b.id)); setDirty(true); }}
                        className="text-xs text-danger hover:underline">
                        {t("gradingScales.remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
