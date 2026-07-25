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

interface YearRow { id: string; ec_year: number; status: string }

async function classesWithCounts(yearId: string) {
  const { data: classes } = await supabase.from("classes")
    .select("id, name, section, grade_level, capacity").eq("academic_year_id", yearId);
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

  const promote = useMutation({
    mutationFn: async () => {
      if (!sourceClasses) return;
      let promoted = 0, graduated = 0;
      for (const s of sourceClasses) {
        const choice = mapping[s.id];
        if (!choice || s.enrolled === 0) continue;
        if (choice === GRADUATE) {
          const { error } = await supabase.from("students")
            .update({ status: "graduated" }).eq("class_id", s.id).eq("status", "active");
          if (error) throw error;
          graduated += s.enrolled;
        } else {
          const { error } = await supabase.from("students")
            .update({ class_id: choice }).eq("class_id", s.id).eq("status", "active");
          if (error) throw error;
          promoted += s.enrolled;
        }
      }
      return { promoted, graduated };
    },
    onSuccess: (r) => {
      if (!r) return;
      setResult(`${r.promoted} student(s) promoted, ${r.graduated} graduated.`);
      qc.invalidateQueries({ queryKey: ["promotion-source-classes"] });
      qc.invalidateQueries({ queryKey: ["promotion-target-classes"] });
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
                const target = targetClasses?.find((t) => t.id === mapping[s.id]);
                const overCapacity = target?.capacity != null && target.enrolled + s.enrolled > target.capacity;
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

      <Button onClick={() => promote.mutate()} disabled={!sourceClasses?.length || promote.isPending}>
        {promote.isPending ? "Promoting…" : "Run promotion"}
      </Button>
    </div>
  );
}
