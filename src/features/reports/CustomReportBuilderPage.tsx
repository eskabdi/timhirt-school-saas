import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { tField } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

const SOURCES = [{ k: "students", icon: "👥" }, { k: "attendance", icon: "🗓" }, { k: "grades", icon: "☆" }, { k: "finance", icon: "▤" }] as const;
const GRADES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"];
// Column ids are stable keys, not display text: they persist in the report
// definition and must not change when the user switches language.
const COLUMN_GROUPS: { groupKey: string; cols: string[] }[] = [
  { groupKey: "identification", cols: ["studentFullName", "studentIdNumber", "dobEc"] },
  { groupKey: "performance", cols: ["overallGpa", "semesterRank", "behavioralGrade"] },
  { groupKey: "contact", cols: ["guardianPhone", "emergencyAddress"] },
];
const DEFAULT_COLS = new Set(["studentFullName", "studentIdNumber", "overallGpa", "semesterRank", "guardianPhone"]);

export function CustomReportBuilderPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const { i18n } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<string>("students");
  const [grades, setGrades] = useState<Set<string>>(new Set());
  const [section, setSection] = useState("");
  const [gender, setGender] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [minGrade, setMinGrade] = useState("0");
  const [maxGrade, setMaxGrade] = useState("100");
  const [includeFailures, setIncludeFailures] = useState(false);
  const [topPerformers, setTopPerformers] = useState(false);
  const [threshold, setThreshold] = useState(85);
  const [payment, setPayment] = useState("Partial");
  const [cols, setCols] = useState<Set<string>>(new Set(DEFAULT_COLS));
  const [saved, setSaved] = useState(false);

  const { data: subjects } = useQuery({ queryKey: ["crb-subjects"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n,code").order("code")).data ?? [] });
  const { data: preview } = useQuery({
    queryKey: ["crb-preview", [...grades].join(), gender],
    queryFn: async () => {
      let q = supabase.from("students").select("id, admission_no, first_name, last_name, gender, status, class:classes(name, section, grade_level)").limit(5);
      if (gender) q = q.eq("gender", gender);
      const { data } = await q;
      let rows = data ?? [];
      if (grades.size) rows = rows.filter((r) => { const gl = (r.class as { grade_level?: number } | null)?.grade_level; return gl != null && grades.has(`G${gl}`); });
      return rows;
    },
  });

  const toggle = <T,>(set: Set<T>, val: T, upd: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(val)) n.delete(val); else n.add(val); upd(n); };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const config = { grades: [...grades], section, gender, subjectId, minGrade, maxGrade, includeFailures, topPerformers, threshold, payment, columns: [...cols] };
      const { error } = await supabase.from("report_templates").insert({ tenant_id: profile!.tenant_id, name: name || "Untitled report", description: description || null, data_source: source, config, created_by: profile!.id });
      if (error) throw error;
    },
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });

  const gradeName = (r: { class: unknown }) => { const c = r.class as { name?: string; section?: string; grade_level?: number } | null; return c?.grade_level != null ? `Grade ${c.grade_level}${c.section ?? ""}` : c?.name ?? "—"; };
  const chip = "rounded-control px-3 py-1.5 text-sm font-medium";
  const sel = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

  const selectedCount = useMemo(() => cols.size, [cols]);

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">{t("customReport.title")}</h1>
            <p className="text-sm text-ink-faint">{t("customReport.subtitle")}</p>
          </div>
          <div className="rounded-lg border border-dashed border-navy/40 bg-navy-wash p-3">
            <p className="mb-2 text-xs font-bold text-navy">{t("customReport.primarySource")}</p>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => (
                <button key={s.k} onClick={() => setSource(s.k)} className={`${chip} ${source === s.k ? "bg-navy text-white" : "bg-card text-ink-soft border border-line"}`}>{s.icon} {t(`customReport.${s.k}`)}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.reportName")}</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("customReport.reportNamePlaceholder")} /></div>
          <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.description")}</label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("customReport.descriptionPlaceholder")} /></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Demographic */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">👤 {t("customReport.demographicFilters")}</h2>
          <div>
            <p className="mb-2 text-sm text-ink-soft">{t("customReport.gradeLevelMulti")}</p>
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => <button key={g} onClick={() => toggle(grades, g, setGrades)} className={`${chip} ${grades.has(g) ? "bg-navy text-white" : "bg-navy-wash text-ink-soft"}`}>{g}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.section")}</label><select value={section} onChange={(e) => setSection(e.target.value)} className={sel}><option value="">{t("customReport.allSections")}</option><option>A</option><option>B</option><option>C</option></select></div>
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.gender")}</label><select value={gender} onChange={(e) => setGender(e.target.value)} className={sel}><option value="">{t("customReport.all")}</option><option value="male">{t("customReport.male")}</option><option value="female">{t("customReport.female")}</option></select></div>
          </div>
        </Card>

        {/* Academic */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">📖 {t("customReport.academicFilters")}</h2>
          <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.subject")}</label><select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={sel}><option value="">{t("customReport.allSubjects")}</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!) || s.code}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.minGrade")}</label><Input type="number" value={minGrade} onChange={(e) => setMinGrade(e.target.value)} /></div>
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.maxGrade")}</label><Input type="number" value={maxGrade} onChange={(e) => setMaxGrade(e.target.value)} /></div>
          </div>
          <div className="flex gap-4 text-sm text-ink-soft">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeFailures} onChange={(e) => setIncludeFailures(e.target.checked)} />{t("customReport.includeFailures")}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={topPerformers} onChange={(e) => setTopPerformers(e.target.checked)} />{t("customReport.topPerformers")}</label>
          </div>
        </Card>

        {/* Columns */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink">▥ {t("customReport.selectColumns")}</h2>
            <Badge tone="navy">{t("customReport.selectedCount", { count: selectedCount })}</Badge>
          </div>
          <p className="text-xs text-ink-faint">{t("customReport.columnsHint")}</p>
          {COLUMN_GROUPS.map((grp) => (
            <div key={grp.groupKey}>
              <p className="mb-1 text-xs font-semibold uppercase text-ink-faint">{t(`customReport.${grp.groupKey}`)}</p>
              {grp.cols.map((col) => (
                <label key={col} className="flex items-center justify-between border-b border-line py-2 text-sm text-ink">
                  {t(`customReport.${col}`)}
                  <input type="checkbox" checked={cols.has(col)} onChange={() => toggle(cols, col, setCols)} />
                </label>
              ))}
            </div>
          ))}
          <button onClick={() => setCols(new Set(COLUMN_GROUPS.flatMap((g) => g.cols)))} className="w-full rounded-control bg-navy-wash py-2 text-sm font-medium text-navy">{t("customReport.selectAllFields")}</button>
        </Card>

        {/* Attendance */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">🗓 {t("customReport.attendanceFilters")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.startDate")}</label><Input type="date" /></div>
            <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.endDate")}</label><Input type="date" /></div>
          </div>
          <div>
            <div className="flex justify-between text-sm"><span className="text-ink-soft">{t("customReport.attendanceThreshold")}</span><span className="font-semibold text-navy">Below {threshold}%</span></div>
            <input type="range" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full" />
          </div>
        </Card>

        {/* Financials */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">▤ {t("customReport.financials")}</h2>
          <div>
            <p className="mb-1 text-sm text-ink-soft">{t("customReport.paymentStatus")}</p>
            <div className="flex overflow-hidden rounded-control border border-line">
              {["Paid", "Partial", "Overdue"].map((p) => <button key={p} onClick={() => setPayment(p)} className={`flex-1 px-3 py-2 text-sm ${payment === p ? "bg-warn text-white" : "bg-card text-ink-soft"}`}>{p}</button>)}
            </div>
          </div>
          <div><label className="mb-1 block text-sm text-ink-soft">{t("customReport.feeCategory")}</label><select className={sel}><option>{t("customReport.tuitionFee")}</option><option>{t("customReport.transportFee")}</option><option>{t("customReport.libraryFee")}</option></select></div>
        </Card>
      </div>

      {/* Live preview */}
      <Card className="p-0">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-display text-lg font-bold text-ink">{t("customReport.livePreview")}</h2>
          <span className="text-xs italic text-ink-faint">{t("customReport.showingFirst")}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("customReport.studentId")}</th><th className="px-4 py-2">{t("customReport.fullName")}</th><th className="px-4 py-2">{t("customReport.grade")}</th><th className="px-4 py-2">{t("customReport.gpa")}</th><th className="px-4 py-2">{t("customReport.attendancePct")}</th><th className="px-4 py-2">{t("customReport.status")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {preview?.length ? preview.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-ink">{r.admission_no}</td>
                <td className="px-4 py-3 font-medium text-ink">{r.first_name} {r.last_name}</td>
                <td className="px-4 py-3 text-ink-soft">{gradeName(r)}</td>
                <td className="px-4 py-3 text-ink-soft">—</td>
                <td className="px-4 py-3 text-ink-soft">—</td>
                <td className="px-4 py-3"><Badge tone={r.status === "active" ? "ok" : "danger"}>{r.status === "active" ? "ACTIVE" : "AT RISK"}</Badge></td>
              </tr>
            )) : <tr><td colSpan={6} className="py-10 text-center text-ink-faint">{t("customReport.noMatching")}</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 bg-navy-wash">
        <div className="flex gap-2">
          <Button variant="ghost" className="border border-line" onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>🔖 {saved ? "Saved!" : "Save Template"}</Button>
          <Button variant="ghost" className="border border-line">⏱ {t("customReport.scheduleRecurring")}</Button>
        </div>
        <div className="flex gap-2">
          <Button className="bg-warn text-white hover:opacity-90">⬇ {t("customReport.exportXlsx")}</Button>
          <Button>▤ {t("customReport.generatePdf")}</Button>
        </div>
      </Card>
    </div>
  );
}
