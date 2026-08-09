import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";

const SEVERITY_TONE: Record<string, "late" | "danger" | "neutral"> = { minor: "neutral", moderate: "late", major: "danger" };
const STATUS_TONE: Record<string, "ok" | "navy" | "danger"> = { open: "navy", resolved: "ok", escalated: "danger" };
const CATEGORIES = ["conduct", "attendance", "academic", "property", "safety", "other"];
const SEVERITIES = ["minor", "moderate", "major"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Incident { id: string; incident_date: string; category: string | null; severity: string; action_taken: string | null; status: string; }
interface Merit { id: string; title: string; points: number; category: string | null; awarded_on: string; }

export function BehavioralTab({ studentId, readOnly = false }: { studentId: string; readOnly?: boolean }) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showIncident, setShowIncident] = useState(false);
  const [showMerit, setShowMerit] = useState(false);
  const [inc, setInc] = useState({ date: null as Date | null, category: "conduct", severity: "minor", description: "", action: "" });
  const [merit, setMerit] = useState({ title: "", category: "academic", points: "10" });
  const [error, setError] = useState<string | null>(null);

  const { data: incidents } = useQuery({
    queryKey: ["discipline", studentId],
    queryFn: async () => ((await supabase.from("discipline_incidents").select("id, incident_date, category, severity, action_taken, status").eq("student_id", studentId).order("incident_date", { ascending: false })).data ?? []) as Incident[],
  });
  const { data: merits } = useQuery({
    queryKey: ["merits", studentId],
    queryFn: async () => ((await supabase.from("student_merits").select("id, title, points, category, awarded_on").eq("student_id", studentId).order("awarded_on", { ascending: false })).data ?? []) as Merit[],
  });

  const logIncident = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("discipline_incidents").insert({
        tenant_id: profile!.tenant_id, student_id: studentId, incident_date: toIsoDate(inc.date!),
        category: inc.category, severity: inc.severity, description: inc.description || inc.category,
        action_taken: inc.action || null, status: "open", reported_by: profile!.id, points: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discipline"] }); setShowIncident(false); setInc({ date: null, category: "conduct", severity: "minor", description: "", action: "" }); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("errors.generic")),
  });
  const addMerit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("student_merits").insert({
        tenant_id: profile!.tenant_id, student_id: studentId, title: merit.title,
        category: merit.category, points: Number(merit.points || 0), awarded_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["merits"] }); setShowMerit(false); setMerit({ title: "", category: "academic", points: "10" }); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  // Behavioral Trends: net points per month over the last 5 calendar months.
  const trend = useMemo(() => {
    const now = new Date();
    const buckets: { label: string; key: string; value: number }[] = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      buckets.push({ label: MON[d.getUTCMonth()]!, key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`, value: 0 });
    }
    const bump = (dateStr: string, delta: number) => { const d = new Date(dateStr + "T00:00:00Z"); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`; const b = buckets.find((x) => x.key === k); if (b) b.value += delta; };
    for (const m of merits ?? []) bump(m.awarded_on, m.points);
    for (const i of incidents ?? []) bump(i.incident_date, -(i.severity === "major" ? 15 : i.severity === "moderate" ? 8 : 3));
    const max = Math.max(1, ...buckets.map((b) => Math.abs(b.value)));
    return { buckets, max };
  }, [merits, incidents]);

  return (
    <div className="space-y-4">
      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      {/* Disciplinary Incident Log */}
      <Card className="p-0">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-semibold text-ink">{t("behavioralTab.incidentLog")}</h2>
          {!readOnly && <Button className="no-print" onClick={() => setShowIncident(true)}>+ {t("behavioralTab.logIncident")}</Button>}
        </div>
        <table className="w-full text-sm">
          <thead className="border-y border-line text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("discipline.date")}</th><th className="px-4 py-2">{t("behavioralTab.category")}</th><th className="px-4 py-2">{t("discipline.severity")}</th><th className="px-4 py-2">{t("audit.action")}</th><th className="px-4 py-2">{t("students.status")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {incidents?.length ? incidents.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 text-ink"><EthDate value={r.incident_date} /></td>
                <td className="px-4 py-3 text-ink-soft">{r.category ? t(`behavioralTab.categories.${r.category}`, r.category) : "—"}</td>
                <td className="px-4 py-3"><Badge tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{t(`discipline.severityLevel.${r.severity}`, r.severity)}</Badge></td>
                <td className="px-4 py-3 text-ink-soft">{r.action_taken ?? "—"}</td>
                <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] ?? "navy"}>{t(`behavioralTab.statuses.${r.status}`, r.status)}</Badge></td>
              </tr>
            )) : <tr><td colSpan={5} className="py-16 text-center text-ink-faint">{t("behavioralTab.noIncidents")}</td></tr>}
          </tbody>
        </table>
      </Card>

      {/* Merits & Awards */}
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-ink">{t("behavioralTab.merits")}</h2>
          {!readOnly && <Button variant="ghost" className="no-print border border-line px-2 py-1 text-xs" onClick={() => setShowMerit(true)}>+ {t("behavioralTab.add")}</Button>}
        </div>
        {merits?.length ? merits.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded-lg border border-ok/30 bg-ok-tint/40 px-3 py-2">
            <span className="flex items-center gap-2 text-sm text-ink"><span className="text-ok">🏅</span>{m.title}</span>
            <span className="text-sm font-semibold text-ok">+{m.points}</span>
          </div>
        )) : (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-tint/40 px-3 py-3 text-sm text-ink-faint"><span className="text-ok">🏅</span>{t("behavioralTab.noAwards")}</div>
            <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok-tint/40 px-3 py-3 text-sm text-ink-faint"><span className="text-ok">✔</span>{t("behavioralTab.noPoints")}</div>
          </>
        )}
      </Card>

      {/* Behavioral Trends */}
      <Card>
        <h2 className="mb-3 font-semibold text-ink">{t("behavioralTab.trends")}</h2>
        <div className="flex h-28 gap-3">
          {trend.buckets.map((b) => {
            const h = Math.max(6, (Math.abs(b.value) / trend.max) * 100);
            const top = b.value === Math.max(...trend.buckets.map((x) => x.value)) && b.value !== 0;
            return (
              <div key={b.key} className="flex flex-1 flex-col gap-1">
                {/* flex-1 gives this track a definite height, so the bar's % resolves. */}
                <div className="flex flex-1 items-end">
                  <div className="w-full rounded-t" style={{ height: `${h}%`, background: top ? "var(--navy, #1E2A70)" : "#E9EAF7" }} title={`${b.value}`} />
                </div>
                <span className="text-center text-[10px] uppercase text-ink-faint">{b.label}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Log incident modal */}
      {!readOnly && <Modal open={showIncident} onClose={() => setShowIncident(false)} title={t("behavioralTab.logIncident")}>
        <div className="space-y-3">
          <Field label={t("discipline.date")}><EthDatePicker value={inc.date} onChange={(d) => setInc({ ...inc, date: d })} /></Field>
          <Field label={t("behavioralTab.category")}>
            <select value={inc.category} onChange={(e) => setInc({ ...inc, category: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink capitalize">
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`behavioralTab.categories.${c}`, c)}</option>)}
            </select>
          </Field>
          <Field label={t("discipline.severity")}>
            <select value={inc.severity} onChange={(e) => setInc({ ...inc, severity: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink capitalize">
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`discipline.severityLevel.${s}`, s)}</option>)}
            </select>
          </Field>
          <Field label={t("discipline.description")}><Input value={inc.description} onChange={(e) => setInc({ ...inc, description: e.target.value })} /></Field>
          <Field label={t("behavioralTab.actionTaken")}><Input value={inc.action} onChange={(e) => setInc({ ...inc, action: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowIncident(false)}>{t("discipline.cancel")}</Button>
          <Button onClick={() => logIncident.mutate()} disabled={!inc.date || logIncident.isPending}>{t("behavioralTab.logIncident")}</Button>
        </div>
      </Modal>}

      {/* Add merit modal */}
      {!readOnly && <Modal open={showMerit} onClose={() => setShowMerit(false)} title={t("behavioralTab.addMerit")}>
        <div className="space-y-3">
          <Field label={t("assignments.titleLabel")}><Input value={merit.title} onChange={(e) => setMerit({ ...merit, title: e.target.value })} placeholder={t("behavioralTab.meritPlaceholder")} /></Field>
          <Field label={t("behavioralTab.category")}>
            <select value={merit.category} onChange={(e) => setMerit({ ...merit, category: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink capitalize">
              {["academic", "sports", "arts", "leadership", "conduct", "service", "other"].map((c) => <option key={c} value={c}>{t(`behavioralTab.categories.${c}`, c)}</option>)}
            </select>
          </Field>
          <Field label={t("behavioralTab.points")}><Input type="number" value={merit.points} onChange={(e) => setMerit({ ...merit, points: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowMerit(false)}>{t("discipline.cancel")}</Button>
          <Button onClick={() => addMerit.mutate()} disabled={!merit.title || addMerit.isPending}>{t("behavioralTab.add")}</Button>
        </div>
      </Modal>}
    </div>
  );
}
