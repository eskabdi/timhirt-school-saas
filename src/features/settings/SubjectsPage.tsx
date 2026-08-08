import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { useGradeCycles } from "@/lib/gradeCycles";
import { tField } from "@/lib/i18n";

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

interface SubjectRow {
  id: string;
  name_i18n: Record<string, string>;
  code: string;
  min_grade: number | null;
  max_grade: number | null;
}

export function SubjectsPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [nameEn, setNameEn] = useState("");
  const [nameAm, setNameAm] = useState("");
  const [code, setCode] = useState("");
  const [minGrade, setMinGrade] = useState("");
  const [maxGrade, setMaxGrade] = useState("");
  const [page, setPage] = useState(1);
  const { data: cycles } = useGradeCycles();

  const { data } = useQuery({
    queryKey: ["subjects-admin", page],
    queryFn: async () => {
      const { data: rows, count } = await supabase.from("subjects")
        .select("id,name_i18n,code,min_grade,max_grade", { count: "exact" })
        .range(...pageRange(page));
      return { rows: (rows ?? []) as SubjectRow[], count: count ?? 0 };
    },
  });
  const subjects = data?.rows;

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("subjects").insert({
        tenant_id: profile!.tenant_id, code, name_i18n: { en: nameEn, am: nameAm },
        min_grade: minGrade === "" ? null : Number(minGrade),
        max_grade: maxGrade === "" ? null : Number(maxGrade),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["subjects-admin"] });
      setNameEn(""); setNameAm(""); setCode(""); setMinGrade(""); setMaxGrade(""); setPage(1);
    },
  });

  const rangeLabel = (s: SubjectRow) =>
    s.min_grade != null && s.max_grade != null ? `${s.min_grade}–${s.max_grade}` : t("gradeCycles.allGrades");

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.subjects")}</h1>
      <Card className="flex flex-wrap items-end gap-2">
        <Field label={t("common.code")}><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} /></Field>
        <Field label={t("common.nameEnglish")}><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={80} /></Field>
        <Field label={t("common.nameAmharic")}><Input value={nameAm} onChange={(e) => setNameAm(e.target.value)} maxLength={80} /></Field>
        <Field label={t("gradeCycles.pickCycle")}>
          <select
            className={SELECT_CLS}
            defaultValue=""
            onChange={(e) => {
              const cyc = cycles?.find((c) => c.id === e.target.value);
              if (cyc) { setMinGrade(String(cyc.min_grade)); setMaxGrade(String(cyc.max_grade)); }
              e.target.value = "";
            }}
          >
            <option value="" disabled>{t("gradeCycles.pickCycle")}</option>
            {cycles?.map((c) => <option key={c.id} value={c.id}>{tField(c.name_i18n, i18n.resolvedLanguage!)}</option>)}
          </select>
        </Field>
        <Field label={t("gradeCycles.minGrade")}>
          <Input type="number" min={0} max={12} value={minGrade} onChange={(e) => setMinGrade(e.target.value)} className="w-20" />
        </Field>
        <Field label={t("gradeCycles.maxGrade")}>
          <Input type="number" min={0} max={12} value={maxGrade} onChange={(e) => setMaxGrade(e.target.value)} className="w-20" />
        </Field>
        <Button onClick={() => create.mutate()} disabled={!code || !nameEn}>{t("common.add")}</Button>
      </Card>
      <div className="grid gap-2 md:grid-cols-3">
        {subjects?.map((s) => (
          <Card key={s.id} className="text-sm">
            <span className="font-mono text-xs text-ink-faint">{s.code}</span> {s.name_i18n?.en}
            <p className="mt-1 text-xs text-ink-faint">{t("gradeCycles.gradeRange")}: {rangeLabel(s)}</p>
          </Card>
        ))}
      </div>
      <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} />
    </div>
  );
}
