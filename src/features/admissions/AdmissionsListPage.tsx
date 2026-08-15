// ============================================================================
// Flat list/table of admission applications -- one row per applicant, with a
// Review action opening the review sheet (process-step checklist + enrollment
// status). Status changes live there rather than as per-stage buttons on the
// row: the vocabulary grew to seven statuses, and a reviewer setting one
// almost always ticks a step in the same pass.
//
// Once an application is actually converted into a student
// (converted_student_id set by enroll_admission_application), it drops out
// of this list entirely -- it's no longer something the admissions office
// needs to act on, it's a real student now, found in Students instead.
// Reaching the 'registered' stage on its own does NOT hide a row: enrolling
// is a distinct, deliberate action (picking a section against live
// capacity; the Student Number is generated automatically), not one that should
// happen as a side effect of a stage-label click. A row at 'registered'
// shows an "Enroll" action in place of the (now redundant) Registered
// button instead.
// ============================================================================
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { EthDate } from "@/components/EthDate";
import { EnrollStudentModal } from "./EnrollStudentModal";
import { AdmissionReviewModal, type ReviewApplication } from "./AdmissionReviewModal";
import { onRowDoubleClick } from "@/lib/utils";

const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
  incomplete_application: "late", provisionally_accepted: "navy", accepted: "ok",
  waitlisted: "late", enrolled: "ok",
} as const;

interface EnrollTarget {
  id: string; tenant_id: string; desired_grade: string | null;
  applicant_first_name: string | null; applicant_last_name: string | null; photo_path: string | null;
}

export function AdmissionsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [enrolling, setEnrolling] = useState<EnrollTarget | null>(null);
  const [reviewing, setReviewing] = useState<ReviewApplication | null>(null);
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["admissions", page],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("admission_applications")
        .select("id, applicant_name, date_of_birth, desired_grade, stage, tenant_id, applicant_first_name, applicant_last_name, photo_path, converted_student_id, application_complete, meets_academic_requirements, meets_financial_requirements, documents_verified, acceptance_letter_sent, student_accepted, possible_duplicate_of", { count: "exact" })
        .is("converted_student_id", null)
        .order("created_at", { ascending: false })
        .range(...pageRange(page));
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const apps = data?.rows;


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
                <tr key={a.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, `/admissions/${a.id}`)}>
                  <td className="px-4 py-3">
                    <Link to={`/admissions/${a.id}`} className="font-medium text-navy hover:underline">{a.applicant_name}</Link>
                    {a.possible_duplicate_of && <Badge tone="late" className="ml-2">{t("admissions.duplicate.badge")}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-ink-faint">{a.desired_grade ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-faint"><EthDate value={a.date_of_birth} /></td>
                  <td className="px-4 py-3">
                    <Badge tone={STAGE_TONE[a.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{String(t(`admissionReview.status.${a.stage}`, { defaultValue: a.stage }))}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => setReviewing(a as ReviewApplication)}
                        className="rounded-control bg-navy-wash px-2.5 py-1 text-xs font-medium text-navy hover:bg-line"
                      >
                        {t("admissionReview.review")}
                      </button>
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
          <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} className="px-4" />
        </Panel>
      )}

      <AdmissionReviewModal
        application={reviewing}
        open={!!reviewing}
        onClose={() => setReviewing(null)}
      />

      {enrolling && <EnrollStudentModal application={enrolling} onClose={() => setEnrolling(null)} />}
    </div>
  );
}
