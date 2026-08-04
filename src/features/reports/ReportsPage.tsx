import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

const STATUS_TONE = { queued: "neutral", processing: "navy", done: "ok", failed: "danger" } as const;
const EXPORT_TYPES = ["enrollment_census", "performance_summary"] as const;
type ExportType = (typeof EXPORT_TYPES)[number];

interface Export { id: string; export_type: string; ec_year: number; status: string; }

export function ReportsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [type, setType] = useState<ExportType>("enrollment_census");
  const [ecYear, setEcYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["moe_exports"],
    queryFn: async () =>
      ((await supabase.from("moe_exports").select("id,export_type,ec_year,status").order("created_at", { ascending: false }).limit(200)).data ?? []) as Export[],
  });
  const { data: activeYear } = useQuery({
    queryKey: ["reports_active_year"],
    queryFn: async () => (await supabase.from("academic_years").select("ec_year").eq("status", "active").maybeSingle()).data,
  });

  const generate = useMutation({
    mutationFn: async () => {
      const yr = ecYear !== "" ? Number(ecYear) : activeYear?.ec_year;
      if (!yr) throw new Error("Enter an Ethiopian year.");
      const { error } = await supabase.from("moe_exports").insert({
        tenant_id: profile!.tenant_id, export_type: type, ec_year: yr, status: "queued", created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["moe_exports"] }); setShow(false); setEcYear(""); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("reports.title")}</h1>
        <Button onClick={() => { setEcYear(activeYear?.ec_year ? String(activeYear.ec_year) : ""); setShow(true); }}>+ {t("reportPages.generateExport")}</Button>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      {!data?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("reports.empty")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("reportPages.export")}</th><th className="px-4 py-2">{t("reportPages.ecYear")}</th><th className="px-4 py-2">{t("students.status")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((row) => (
                <tr key={row.id} className="hover:bg-sidebar">
                  <td className="px-4 py-2 text-ink">{t(`reports.exportType.${row.export_type}`)}</td>
                  <td className="px-4 py-2 text-ink">{row.ec_year}</td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`reports.status.${row.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Modal open={show} onClose={() => setShow(false)} title={t("reportPages.generateMoe")}>
        <div className="space-y-3">
          <Field label={t("reportPages.exportType")}>
            <select value={type} onChange={(e) => setType(e.target.value as ExportType)} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              {EXPORT_TYPES.map((ty) => <option key={ty} value={ty}>{t(`reports.exportType.${ty}`)}</option>)}
            </select>
          </Field>
          <Field label={t("reportPages.ethiopianYear")}><Input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="2018" /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShow(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => generate.mutate()} disabled={generate.isPending}>{t("reportPages.generate")}</Button>
        </div>
      </Modal>
    </div>
  );
}
