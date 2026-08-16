// Graduating-cohort report + leaving certificates. Deliberately not part of
// the id_cards module gate despite the naming similarity -- see
// 20260827000001_leaving_certificates.sql's header comment. Available at
// every subscription tier; this page and its route carry no `module` prop.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatEth } from "@/lib/ethiopian-date";
import { buildLeavingCertificatePdf } from "./leaving-certificate-pdf";
import { fetchDocumentTemplate } from "@/lib/documentTemplate";
import { useDocumentSchoolName } from "@/lib/documentBranding";

interface GraduateRow {
  id: string; first_name: string; last_name: string; admission_no: string; graduated_ec_year: number;
  class: { name: string; section: string | null; grade_level: number | null } | null;
}

export function LeavingCertificatesPage() {
  const { t } = useTranslation();
  // R5-B2: shared accessor for the certificate letterhead.
  const schoolName = useDocumentSchoolName();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: graduates, isLoading } = useQuery({
    queryKey: ["leaving-certificates", profile?.tenant_id],
    enabled: !!profile,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("students")
        .select("id, first_name, last_name, admission_no, graduated_ec_year, class:classes(name, section, grade_level)")
        .eq("status", "graduated").not("graduated_ec_year", "is", null)
        .order("graduated_ec_year", { ascending: false }).order("last_name");
      if (err) throw err;
      return (data ?? []) as unknown as GraduateRow[];
    },
  });

  const cohorts = useMemo(() => {
    const groups = new Map<number, GraduateRow[]>();
    for (const g of graduates ?? []) {
      const list = groups.get(g.graduated_ec_year) ?? [];
      list.push(g);
      groups.set(g.graduated_ec_year, list);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [graduates]);

  const download = async (student: GraduateRow) => {
    setError(null);
    setBusyId(student.id);
    try {
      const gradeLabel = student.class?.grade_level != null
        ? `${t("students.profile.grade")} ${student.class.grade_level}${student.class.section ? `-${student.class.section}` : ""}`
        : student.class?.name ?? "—";
      const template = await fetchDocumentTemplate("leaving_certificate");
      const blob = await buildLeavingCertificatePdf({
        schoolName,
        template,
        studentName: `${student.first_name} ${student.last_name}`,
        admissionNo: student.admission_no,
        gradeLabel,
        graduatedEcYear: student.graduated_ec_year,
        issuedOn: formatEth(new Date(), { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") }),
        labels: {
          title: t("leavingCertificates.certTitle"),
          bodyPrefix: t("leavingCertificates.bodyPrefix"),
          bodySuffix: t("leavingCertificates.bodySuffix"),
          admissionNo: t("leavingCertificates.admissionNo"),
          grade: t("leavingCertificates.lastGrade"),
          graduatedYear: t("leavingCertificates.graduatedYear"),
          issuedOn: t("idCards.issued"),
          signature: t("leavingCertificates.signature"),
        },
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("leavingCertificates.title")}</h1>
      <p className="max-w-2xl text-sm text-ink-faint">{t("leavingCertificates.subtitle")}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      {isLoading && <p className="text-sm text-ink-faint">…</p>}
      {!isLoading && !cohorts.length && (
        <Card className="py-12 text-center text-ink-faint">{t("leavingCertificates.empty")}</Card>
      )}
      {cohorts.map(([ecYear, students]) => (
        <Card key={ecYear} className="overflow-x-auto p-0">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">{t("leavingCertificates.cohort", { year: ecYear })} ({students.length})</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="p-3">{t("leavingCertificates.name")}</th>
                <th className="p-3">{t("leavingCertificates.admissionNo")}</th>
                <th className="p-3">{t("leavingCertificates.lastGrade")}</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td className="p-3">{s.first_name} {s.last_name}</td>
                  <td className="p-3">{s.admission_no}</td>
                  <td className="p-3">{s.class?.grade_level != null ? `${s.class.grade_level}${s.class.section ? `-${s.class.section}` : ""}` : s.class?.name ?? "—"}</td>
                  <td className="p-3 text-right">
                    <Button variant="tertiary" onClick={() => download(s)} disabled={busyId === s.id}>
                      {busyId === s.id ? t("leavingCertificates.generating") : t("leavingCertificates.download")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
