// ============================================================================
// Ethiopian grade-cycle taxonomy (First Cycle 1-4, Second Cycle 5-8, Lower
// Secondary 9-10, Upper Secondary 11-12). Pure-function mirror of the
// server-side grade_cycle_for() SQL helper (20260814000001_grade_cycles.sql)
// -- same two-independent-implementations approach as this file's namesake
// relationship to _shared/ethiopian-date.ts, so client-side grouping/badges
// don't need a round trip. The database's grade_cycles table remains the
// single source of truth for translated names (name_i18n) and is read via
// useGradeCycles() below; these boundaries must stay in sync with that
// migration's seed data if it's ever changed.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface GradeCycleDef { key: string; minGrade: number; maxGrade: number }

export const GRADE_CYCLES: GradeCycleDef[] = [
  { key: "first_cycle", minGrade: 1, maxGrade: 4 },
  { key: "second_cycle", minGrade: 5, maxGrade: 8 },
  { key: "lower_secondary", minGrade: 9, maxGrade: 10 },
  { key: "upper_secondary", minGrade: 11, maxGrade: 12 },
];

/** Grade 0 (pre-primary/KG) and anything outside 1-12 deliberately return
 *  null -- MoE's cycle taxonomy starts at Grade 1, matching grade_cycle_for(). */
export function gradeCycleKeyFor(gradeLevel: number | null | undefined): string | null {
  if (gradeLevel == null) return null;
  return GRADE_CYCLES.find((c) => gradeLevel >= c.minGrade && gradeLevel <= c.maxGrade)?.key ?? null;
}

/** grade_cycles.key (snake_case, e.g. "first_cycle") -> gradeCycles.* locale
 *  key (camelCase, e.g. "firstCycle") -- t(`gradeCycles.${gradeCycleI18nKey(key)}`). */
export function gradeCycleI18nKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export interface GradeCycleRow {
  id: string;
  key: string;
  name_i18n: Record<string, string>;
  min_grade: number;
  max_grade: number;
}

/** The 4 rows are an effectively-static, platform-wide reference list --
 *  Infinity staleTime avoids refetching them on every navigation. */
export function useGradeCycles() {
  return useQuery({
    queryKey: ["grade-cycles"],
    staleTime: Infinity,
    queryFn: async (): Promise<GradeCycleRow[]> => {
      const { data, error } = await supabase.from("grade_cycles")
        .select("id,key,name_i18n,min_grade,max_grade").order("sort_order");
      if (error) throw error;
      return (data ?? []) as unknown as GradeCycleRow[];
    },
  });
}
