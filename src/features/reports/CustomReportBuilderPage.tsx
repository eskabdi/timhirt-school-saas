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

const SOURCES = [{ k: "students", label: "Students", icon: "👥" }, { k: "attendance", label: "Attendance", icon: "🗓" }, { k: "grades", label: "Grades", icon: "☆" }, { k: "finance", label: "Finance", icon: "▤" }] as const;
const GRADES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12"];
const COLUMN_GROUPS: { group: string; cols: string[] }[] = [
  { group: "Identification", cols: ["Student Full Name", "Student ID Number", "Date of Birth (EC)"] },
  { group: "Performance", cols: ["Overall GPA", "Semester Rank", "Behavioral Grade"] },
  { group: "Contact", cols: ["Guardian Phone", "Emergency Address"] },
];
const DEFAULT_COLS = new Set(["Student Full Name", "Student ID Number", "Overall GPA", "Semester Rank", "Guardian Phone"]);

export function CustomReportBuilderPage() {
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
            <h1 className="font-display text-2xl font-bold text-ink">Custom Report Builder</h1>
            <p className="text-sm text-ink-faint">የሪፖርት ግንባታ መሳሪያ | Create tailored academic and operational reports.</p>
          </div>
          <div className="rounded-lg border border-dashed border-navy/40 bg-navy-wash p-3">
            <p className="mb-2 text-xs font-bold text-navy">Primary Data Source / ዋና የመረጃ ምንጭ</p>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => (
                <button key={s.k} onClick={() => setSource(s.k)} className={`${chip} ${source === s.k ? "bg-navy text-white" : "bg-card text-ink-soft border border-line"}`}>{s.icon} {s.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className="mb-1 block text-sm text-ink-soft">Report Name / የሪፖርት ስም</label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grade 10 Semester 1 At-Risk Students" /></div>
          <div><label className="mb-1 block text-sm text-ink-soft">Description / መግለጫ</label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief summary of report intent..." /></div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Demographic */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">👤 Demographic Filters / የስነ-ሕዝብ ማጣሪያዎች</h2>
          <div>
            <p className="mb-2 text-sm text-ink-soft">Grade Level (Multi-select)</p>
            <div className="flex flex-wrap gap-2">
              {GRADES.map((g) => <button key={g} onClick={() => toggle(grades, g, setGrades)} className={`${chip} ${grades.has(g) ? "bg-navy text-white" : "bg-navy-wash text-ink-soft"}`}>{g}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">Section</label><select value={section} onChange={(e) => setSection(e.target.value)} className={sel}><option value="">All Sections</option><option>A</option><option>B</option><option>C</option></select></div>
            <div><label className="mb-1 block text-sm text-ink-soft">Gender</label><select value={gender} onChange={(e) => setGender(e.target.value)} className={sel}><option value="">All</option><option value="male">Male</option><option value="female">Female</option></select></div>
          </div>
        </Card>

        {/* Academic */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">📖 Academic Filters / የትምህርት ማጣሪያዎች</h2>
          <div><label className="mb-1 block text-sm text-ink-soft">Subject / ትምህርት</label><select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className={sel}><option value="">All subjects</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!) || s.code}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">Min Grade (%)</label><Input type="number" value={minGrade} onChange={(e) => setMinGrade(e.target.value)} /></div>
            <div><label className="mb-1 block text-sm text-ink-soft">Max Grade (%)</label><Input type="number" value={maxGrade} onChange={(e) => setMaxGrade(e.target.value)} /></div>
          </div>
          <div className="flex gap-4 text-sm text-ink-soft">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeFailures} onChange={(e) => setIncludeFailures(e.target.checked)} />Include Failures</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={topPerformers} onChange={(e) => setTopPerformers(e.target.checked)} />Top Performers Only</label>
          </div>
        </Card>

        {/* Columns */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-ink">▥ Select Columns</h2>
            <Badge tone="navy">{selectedCount} Selected</Badge>
          </div>
          <p className="text-xs text-ink-faint">Choose which data points appear in the exported document.</p>
          {COLUMN_GROUPS.map((grp) => (
            <div key={grp.group}>
              <p className="mb-1 text-xs font-semibold uppercase text-ink-faint">{grp.group}</p>
              {grp.cols.map((col) => (
                <label key={col} className="flex items-center justify-between border-b border-line py-2 text-sm text-ink">
                  {col}
                  <input type="checkbox" checked={cols.has(col)} onChange={() => toggle(cols, col, setCols)} />
                </label>
              ))}
            </div>
          ))}
          <button onClick={() => setCols(new Set(COLUMN_GROUPS.flatMap((g) => g.cols)))} className="w-full rounded-control bg-navy-wash py-2 text-sm font-medium text-navy">Select All Fields</button>
        </Card>

        {/* Attendance */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">🗓 Attendance / መገኘት</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-sm text-ink-soft">Start Date</label><Input type="date" /></div>
            <div><label className="mb-1 block text-sm text-ink-soft">End Date</label><Input type="date" /></div>
          </div>
          <div>
            <div className="flex justify-between text-sm"><span className="text-ink-soft">Attendance Threshold (%)</span><span className="font-semibold text-navy">Below {threshold}%</span></div>
            <input type="range" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="w-full" />
          </div>
        </Card>

        {/* Financials */}
        <Card className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-ink">▤ Financials / ክፍያ</h2>
          <div>
            <p className="mb-1 text-sm text-ink-soft">Payment Status</p>
            <div className="flex overflow-hidden rounded-control border border-line">
              {["Paid", "Partial", "Overdue"].map((p) => <button key={p} onClick={() => setPayment(p)} className={`flex-1 px-3 py-2 text-sm ${payment === p ? "bg-warn text-white" : "bg-card text-ink-soft"}`}>{p}</button>)}
            </div>
          </div>
          <div><label className="mb-1 block text-sm text-ink-soft">Fee Category</label><select className={sel}><option>Tuition Fee / የማስተማሪያ ክፍያ</option><option>Transport Fee</option><option>Library Fee</option></select></div>
        </Card>
      </div>

      {/* Live preview */}
      <Card className="p-0">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-display text-lg font-bold text-ink">Live Preview (Sample Data) / ቅድመ እይታ</h2>
          <span className="text-xs italic text-ink-faint">Showing first 5 matching results</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">Student ID</th><th className="px-4 py-2">Full Name</th><th className="px-4 py-2">Grade</th><th className="px-4 py-2">GPA</th><th className="px-4 py-2">Attendance %</th><th className="px-4 py-2">Status</th></tr>
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
            )) : <tr><td colSpan={6} className="py-10 text-center text-ink-faint">No matching students.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 bg-navy-wash">
        <div className="flex gap-2">
          <Button variant="ghost" className="border border-line" onClick={() => saveTemplate.mutate()} disabled={saveTemplate.isPending}>🔖 {saved ? "Saved!" : "Save Template"}</Button>
          <Button variant="ghost" className="border border-line">⏱ Schedule Recurring</Button>
        </div>
        <div className="flex gap-2">
          <Button className="bg-warn text-white hover:opacity-90">⬇ Export XLSX</Button>
          <Button>▤ Generate PDF</Button>
        </div>
      </Card>
    </div>
  );
}
