// Staff ID Card — standalone renderer (issue-staff-id), not a reuse of the
// student ID card pipeline: see that Edge Function's header comment for why.
// Same generate -> same-origin blob -> preview/print/save shape as
// PrintIDCardModal, but as its own page rather than a modal, since the
// design calls for a dedicated front/back preview with print specifications
// alongside it, not a quick popup.
import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

export function StaffIdCardPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const { data: employee } = useQuery({
    queryKey: ["id-card-employee", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id, full_name, employee_no, job_title, photo_path").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const generate = async () => {
    if (!id) return;
    setLoading(true); setError(null); setBlobUrl(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/issue-staff-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ employee_id: id }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to generate ID card");
      const { url } = await res.json();
      const pdf = await (await fetch(url)).blob();
      setBlobUrl(URL.createObjectURL(pdf));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  };

  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  const print = () => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); };
  const save = () => {
    if (!blobUrl || !employee) return;
    const a = document.createElement("a");
    a.href = blobUrl; a.download = `staff-id-${employee.full_name.replace(/\s+/g, "-").toLowerCase()}.pdf`; a.click();
  };

  if (!employee) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold text-ink">{t("staffIdCard.title")}</h1>
        <p className="text-sm text-ink-faint">{employee.full_name} · {employee.employee_no}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("idCardModal.previewTitle")} />
            <div className="p-4">
              {!blobUrl && !loading && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="text-sm text-ink-faint">{t("staffIdCard.notGeneratedYet")}</p>
                  <Button onClick={generate}>{t("staffIdCard.generate")}</Button>
                </div>
              )}
              {loading && <p className="py-12 text-center text-ink-faint">{t("idCardModal.generating")}</p>}
              {error && <p className="py-6 text-center text-sm text-danger">{error}</p>}
              {blobUrl && (
                <>
                  <p className="mb-2 text-xs text-ink-faint">{t("idCardModal.previewNote")}</p>
                  <iframe ref={frame} src={blobUrl} title={t("idCardModal.previewTitle")} className="h-[420px] w-full rounded-lg border border-line" />
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                    <Button variant="ghost" onClick={generate}>{t("staffIdCard.regenerate")}</Button>
                    <Button variant="ghost" className="border border-line" onClick={save}>⬇ {t("idCardModal.savePdf")}</Button>
                    <Button onClick={print}>🖨 {t("idCardModal.print")}</Button>
                  </div>
                </>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("staffIdCard.printSpecs")} />
            <dl className="space-y-2 p-4 text-sm">
              <div><dt className="text-xs text-ink-faint">{t("staffIdCard.cardSize")}</dt><dd className="font-medium text-ink">{t("staffIdCard.cardSizeValue")}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffIdCard.sides")}</dt><dd className="font-medium text-ink">{t("staffIdCard.frontBack")}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffIdCard.format")}</dt><dd className="font-medium text-ink">PDF, {t("staffIdCard.oneCardPerFile")}</dd></div>
            </dl>
          </Panel>
          <Card className="text-sm text-ink-faint">{t("staffIdCard.reissueNote")}</Card>
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        <Link to={`/hr/employees/${employee.id}`} className="hover:underline">← {employee.full_name}</Link>
      </p>
    </div>
  );
}
