// ============================================================================
// End-of-year grade promotion / rollover (K-12 workflow stages 10-11).
// Bulk-moves active students from one academic year's classes into the next
// year's classes, one grade up (grade_level + 1). This doubles as
// re-enrollment for continuing students -- there's no separate "confirm
// re-enrollment" step for families here; a student not carried forward
// simply isn't mapped to a target class.
//
// Students in a class with no available next-grade class (e.g. the school's
// highest grade) are marked "Graduate" instead of promoted, flipping
// students.status to 'graduated'.
// ============================================================================
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { EthDate } from "@/components/EthDate";

interface YearRow { id: string; ec_year: number; status: string }
interface PromotionRunRow { id: string; run_at: string; reverted_at: string | null }

async function classesWithCounts(yearId: string) {
  const { data: classes } = await supabase.from("classes")
    .select("id, name, section, grade_level, capacity").eq("academic_year_id", yearId)
    .order("grade_level").order("section");
  const ids = (classes ?? []).map((c) => c.id);
  const { data: active } = ids.length
    ? await supabase.from("students").select("class_id").eq("status", "active").in("class_id", ids)
    : { data: [] as { class_id: string }[] };
  const counts = new Map<string, number>();
  for (const s of active ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
  return (classes ?? []).map((c) => ({ ...c, enrolled: counts.get(c.id) ?? 0 }));
}

const GRADUATE = "__graduate__";

export function PromotionPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [sourceYearId, setSourceYearId] = useState("");
  const [targetYearId, setTargetYearId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  const { data: years } = useQuery({
    queryKey: ["promotion-years"],
    queryFn: async () => (await supabase.from("academic_years").select("id, ec_year, status").order("ec_year")).data as YearRow[] ?? [],
  });

  const { data: sourceClasses } = useQuery({
    queryKey: ["promotion-source-classes", sourceYearId],
    enabled: !!sourceYearId,
    queryFn: () => classesWithCounts(sourceYearId),
  });

  const { data: targetClasses } = useQuery({
    queryKey: ["promotion-target-classes", targetYearId],
    enabled: !!targetYearId,
    queryFn: () => classesWithCounts(targetYearId),
  });

  // Pre-fill each source class with the target-year class one grade up, when
  // exactly one such class exists (an unambiguous grade_level+1 match).
  useEffect(() => {
    if (!sourceClasses || !targetClasses) return;
    setMapping((prev) => {
      const next = { ...prev };
      for (const s of sourceClasses) {
        if (next[s.id] !== undefined) continue;
        if (s.grade_level == null) { next[s.id] = ""; continue; }
        const matches = targetClasses.filter((t) => t.grade_level === s.grade_level! + 1);
        next[s.id] = matches.length === 1 ? matches[0]!.id : "";
      }
      return next;
    });
  }, [sourceClasses, targetClasses]);

  const [promoteError, setPromoteError] = useState<string | null>(null);

  // A move is over capacity if its mapped target's current enrollment plus
  // every OTHER source class also mapped to that same target in this batch
  // would exceed capacity -- mirrors the server-side check in
  // promote_students_batch so the button disables correctly even when two
  // source classes only overflow a shared target in combination.
  const overCapacityClassIds = new Set(
    (sourceClasses ?? [])
      .filter((s) => {
        const choice = mapping[s.id];
        if (!choice || choice === GRADUATE) return false;
        const target = targetClasses?.find((t) => t.id === choice);
        if (!target || target.capacity == null) return false;
        const incoming = (sourceClasses ?? [])
          .filter((other) => mapping[other.id] === choice)
          .reduce((a, other) => a + other.enrolled, 0);
        return target.enrolled + incoming > target.capacity;
      })
      .map((s) => s.id),
  );
  const hasCapacityConflict = overCapacityClassIds.size > 0;

  const promote = useMutation({
    mutationFn: async () => {
      if (!sourceClasses) return;
      const moves = sourceClasses
        .filter((s) => mapping[s.id] && s.enrolled > 0)
        .map((s) => {
          const choice = mapping[s.id]!;
          return choice === GRADUATE
            ? { source_class_id: s.id, graduate: true }
            : { source_class_id: s.id, target_class_id: choice };
        });
      if (!moves.length) return null;
      const { data, error } = await supabase.rpc("promote_students_batch", { p_moves: moves });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { promoted: row?.promoted_count ?? 0, graduated: row?.graduated_count ?? 0, runId: row?.run_id as string | undefined };
    },
    onSuccess: (r) => {
      setPromoteError(null);
      if (!r) return;
      setResult(`${r.promoted} student(s) promoted, ${r.graduated} graduated.`);
      qc.invalidateQueries({ queryKey: ["promotion-source-classes"] });
      qc.invalidateQueries({ queryKey: ["promotion-target-classes"] });
      qc.invalidateQueries({ queryKey: ["promotion-runs"] });
    },
    onError: (e) => {
      setResult(null);
      setPromoteError(e instanceof Error ? e.message : String(e));
    },
  });

  const { data: recentRuns } = useQuery({
    queryKey: ["promotion-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("promotion_runs").select("id, run_at, reverted_at")
        .order("run_at", { ascending: false }).limit(5);
      if (error) throw error;
      return (data ?? []) as PromotionRunRow[];
    },
  });
  const [revertResult, setRevertResult] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  const revert = useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc("revert_promotion_run", { p_run_id: runId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return { reverted: row?.reverted_count ?? 0, skipped: row?.skipped_count ?? 0 };
    },
    onSuccess: (r) => {
      setRevertError(null);
      setRevertResult(
        r.skipped > 0
          ? t("promotion.revertPartial", { reverted: r.reverted, skipped: r.skipped })
          : t("promotion.revertComplete", { reverted: r.reverted }),
      );
      qc.invalidateQueries({ queryKey: ["promotion-runs"] });
      qc.invalidateQueries({ queryKey: ["promotion-source-classes"] });
      qc.invalidateQueries({ queryKey: ["promotion-target-classes"] });
    },
    onError: (e) => {
      setRevertResult(null);
      setRevertError(e instanceof Error ? e.message : String(e));
    },
  });

  if (!profile) return null;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("promotion.title")}</h1>
      <p className="max-w-2xl text-sm text-ink-faint">
        {t("help.promotionNote")}
      </p>

      <Card className="flex flex-wrap gap-4">
        <Field label={t("promotion.fromYear")}>
          <select value={sourceYearId} onChange={(e) => { setSourceYearId(e.target.value); setMapping({}); }}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="">—</option>
            {years?.map((y) => <option key={y.id} value={y.id}>{y.ec_year} EC ({y.status})</option>)}
          </select>
        </Field>
        <Field label={t("promotion.toYear")}>
          <select value={targetYearId} onChange={(e) => { setTargetYearId(e.target.value); setMapping({}); }}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="">—</option>
            {years?.filter((y) => y.id !== sourceYearId).map((y) => <option key={y.id} value={y.id}>{y.ec_year} EC ({y.status})</option>)}
          </select>
        </Field>
      </Card>

      {sourceYearId && targetYearId && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="p-3">{t("promotion.sourceClass")}</th>
                <th className="p-3">{t("promotion.enrolled")}</th>
                <th className="p-3">{t("promotion.promoteTo")}</th>
              </tr>
            </thead>
            <tbody>
              {sourceClasses?.map((s) => {
                const overCapacity = overCapacityClassIds.has(s.id);
                return (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="p-3">{s.name} {s.section}{s.grade_level != null ? ` (grade ${s.grade_level})` : ""}</td>
                    <td className="p-3 tabular-nums">{s.enrolled}</td>
                    <td className="p-3">
                      <select value={mapping[s.id] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [s.id]: e.target.value }))}
                        className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink">
                        <option value="">{t("promotion.unmapped")}</option>
                        <option value={GRADUATE}>{t("promotion.graduate")}</option>
                        {targetClasses?.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.section}{t.capacity != null ? ` (${t.enrolled}/${t.capacity})` : ""}
                          </option>
                        ))}
                      </select>
                      {overCapacity && <p className="mt-1 text-xs text-danger">{t("promotion.exceedsCapacity")}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {result && <p className="text-sm text-ok">{result}</p>}
      {promoteError && <p className="text-sm text-danger">{promoteError}</p>}

      <Button onClick={() => promote.mutate()} disabled={!sourceClasses?.length || promote.isPending || hasCapacityConflict}>
        {promote.isPending ? t("promotion.promoting") : t("promotion.runPromotion")}
      </Button>

      {!!recentRuns?.length && (
        <Card className="space-y-2">
          <h2 className="font-display text-lg font-semibold text-ink">{t("promotion.recentRuns")}</h2>
          {revertResult && <p className="text-sm text-ok">{revertResult}</p>}
          {revertError && <p className="text-sm text-danger">{revertError}</p>}
          <div className="divide-y divide-line">
            {recentRuns.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink"><EthDate value={r.run_at} /></span>
                {r.reverted_at ? (
                  <span className="text-xs text-ink-faint">{t("promotion.reverted")}</span>
                ) : (
                  <Button variant="tertiary" onClick={() => revert.mutate(r.id)} disabled={revert.isPending}>
                    {t("promotion.undo")}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
