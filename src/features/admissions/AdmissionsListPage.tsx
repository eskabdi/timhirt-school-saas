// ============================================================================
// Flat list/table of admission applications, replacing the earlier
// stage-column Kanban board -- one row per applicant, with a button per
// stage (Applied/Shortlisted/Offered/Registered/Rejected) to move it there,
// mirroring the Kanban's "→ stage" buttons but without needing five
// separate columns to scan.
//
// Once an application is actually converted into a student
// (converted_student_id set by enroll_admission_application), it drops out
// of this list entirely -- it's no longer something the admissions office
// needs to act on, it's a real student now, found in Students instead.
// Reaching the 'registered' stage on its own does NOT hide a row: enrolling
// is a distinct, deliberate action (picking a section against live
// capacity, assigning an admission number), not something that should
// happen as a side effect of a stage-label click. A row at 'registered'
// shows an "Enroll" action in place of the (now redundant) Registered
// button instead.
// ============================================================================
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { EnrollStudentModal } from "./EnrollStudentModal";

const STAGES = ["applied", "shortlisted", "offered", "registered", "rejected"] as const;
const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
} as const;

interface EnrollTarget {
  id: string; tenant_id: string; desired_grade: string | null;
  applicant_first_name: string | null; applicant_last_name: string | null; photo_path: string | null;
}

export function AdmissionsListPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = useState<EnrollTarget | null>(null);

  const { data: apps } = useQuery({
    queryKey: ["admissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_applications")
        .select("id, applicant_name, date_of_birth, desired_grade, stage, tenant_id, applicant_first_name, applicant_last_name, photo_path")
        .is("converted_student_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const { error } = await supabase.from("admission_applications").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admissions"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("admissions.title")}</h1>

      {!apps?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("students.empty")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr>
                <th className="px-4 py-3">{t("admissions.name")}</th>
                <th className="px-4 py-3">{t("admissions.grade")}</th>
                <th className="px-4 py-3">{t("admissions.dob")}</th>
                <th className="px-4 py-3">{t("students.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {apps.map((a) => (
                <tr key={a.id} className="hover:bg-sidebar">
                  <td className="px-4 py-3">
                    <Link to={`/admissions/${a.id}`} className="font-medium text-navy hover:underline">{a.applicant_name}</Link>
                  </td>
                  <td className="px-4 py-3 text-ink-faint">{a.desired_grade ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-faint"><EthDate value={a.date_of_birth} /></td>
                  <td className="px-4 py-3">
                    <Badge tone={STAGE_TONE[a.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{t(`admissions.stage.${a.stage}`)}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {STAGES.filter((s) => s !== a.stage).map((s) => (
                        <button
                          key={s}
                          onClick={() => move.mutate({ id: a.id, stage: s })}
                          className="rounded-control bg-sidebar px-2 py-1 text-xs text-ink-faint hover:bg-line"
                        >
                          {t(`admissions.stage.${s}`)}
                        </button>
                      ))}
                      {a.stage === "registered" && (
                        <button
                          onClick={() => setEnrolling({
                            id: a.id, tenant_id: a.tenant_id, desired_grade: a.desired_grade,
                            applicant_first_name: a.applicant_first_name, applicant_last_name: a.applicant_last_name,
                            photo_path: a.photo_path,
                          })}
                          className="rounded-control bg-ok-tint px-2 py-1 text-xs font-semibold text-ok hover:opacity-80"
                        >
                          {t("admissions.enroll.submit")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {enrolling && <EnrollStudentModal application={enrolling} onClose={() => setEnrolling(null)} />}
    </div>
  );
}
