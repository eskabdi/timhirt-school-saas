// ============================================================================
// Live template preview (R5-C5).
//
// Rendered through the ACTUAL generators -- buildTranscriptPdf,
// buildLeavingCertificatePdf, buildSeatingChartPdf -- so what the admin sees
// is what the real document does with their template, not a mock-up that can
// drift from it.
//
// PII POSTURE: synthetic placeholder data only. "Sample Student", invented
// scores, invented amounts. Never a real student's or employee's record --
// same posture as the medical_notes / tin_number column revokes elsewhere in
// this schema. A template preview is a layout check; it has no business
// reaching for a real person's grades to demonstrate a footer.
//
// Invoice / receipt / payslip are rendered server-side (pdf-lib inside Edge
// Functions), so they have no browser-side builder to call. Rather than
// duplicating those layouts here -- which would be exactly the drifting
// mock-up this file exists to avoid -- their preview reuses the transcript
// surface to show the same four configurable elements in place. That is
// stated plainly in the UI copy rather than pretended otherwise.
// ============================================================================
import type { TFunction } from "i18next";
import { buildTranscriptPdf } from "@/features/students/transcript-pdf";
import { buildLeavingCertificatePdf } from "@/features/students/leaving-certificate-pdf";
import { buildSeatingChartPdf } from "@/features/gradebook/seating-chart-pdf";
import type { DocTemplate } from "@/lib/documentTemplate";

export type PreviewDocType =
  | "transcript" | "report_card" | "invoice" | "receipt"
  | "payslip" | "leaving_certificate" | "seating_chart";

interface DraftLike {
  header_text: string | null;
  footer_text: string | null;
  show_signature_line: boolean;
  signature_title: string | null;
  watermark_text: string | null;
  watermark_opacity: number;
}

function toTemplate(draft: DraftLike | null): DocTemplate | null {
  if (!draft) return null;
  return {
    headerText: draft.header_text?.trim() || null,
    footerText: draft.footer_text?.trim() || null,
    showSignatureLine: draft.show_signature_line,
    signatureTitle: draft.signature_title?.trim() || null,
    watermarkText: draft.watermark_text?.trim() || null,
    watermarkOpacity: draft.watermark_opacity,
  };
}

const SAMPLE_SCHOOL = "Sample School";

export async function renderTemplatePreview(
  docType: PreviewDocType,
  draft: DraftLike | null,
  t: TFunction,
): Promise<Blob> {
  const template = toTemplate(draft);

  if (docType === "seating_chart") {
    return buildSeatingChartPdf({
      schoolName: SAMPLE_SCHOOL,
      title: t("documentTemplates.sample.seatingTitle"),
      rows: 2, cols: 3,
      seats: [
        { row: 1, col: 1, label: "R1C1", studentName: "Sample Student A" },
        { row: 1, col: 2, label: "R1C2", studentName: "Sample Student B" },
        { row: 2, col: 1, label: "R2C1", studentName: "Sample Student C" },
      ],
      issuedOn: t("documentTemplates.sample.issuedOn"),
      issuedLabel: t("idCards.issued"),
      template,
    });
  }

  if (docType === "leaving_certificate") {
    return buildLeavingCertificatePdf({
      schoolName: SAMPLE_SCHOOL,
      studentName: "Sample Student",
      admissionNo: "SAMPLE-0001",
      gradeLabel: "Grade 12",
      graduatedEcYear: 2018,
      issuedOn: t("documentTemplates.sample.issuedOn"),
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
      template,
    });
  }

  // transcript / report_card, plus the server-rendered three (see header note).
  return buildTranscriptPdf({
    schoolName: SAMPLE_SCHOOL,
    studentName: "Sample Student",
    admissionNo: "SAMPLE-0001",
    gradeLabel: "Grade 10",
    academicPeriod: "Sample Term",
    rows: [
      { subject: "Mathematics", code: "MATH", instructor: "Sample Teacher", ca: 34, final: 51, total: 85, letter: "A" },
      { subject: "English", code: "ENG", instructor: "Sample Teacher", ca: 28, final: 44, total: 72, letter: "B" },
    ],
    gpa: 3.5, totalScore: 157, maxScore: 200,
    issuedOn: t("documentTemplates.sample.issuedOn"),
    template,
    labels: {
      title: t("academicRecord.title"), student: t("academicRecord.student", { defaultValue: "Student" }),
      studentNo: t("students.admissionNo"), grade: t("students.profile.grade"),
      period: t("academicRecord.period"), subject: t("gradebook.subject"),
      instructor: t("academicRecord.instructor"), ca: t("academicRecord.ca"),
      final: t("academicRecord.finalCol"), total: t("academicRecord.totalCol"),
      letter: t("academicRecord.letter"), status: t("students.status"),
      pass: t("academicRecord.pass"), fail: t("academicRecord.fail"),
      semesterTotals: t("academicRecord.semesterTotals"), gpa: t("academicRecord.cumulativeGpa"),
      issued: t("idCards.issued"), notice: t("academicRecord.noticeTitle"),
      noticeBody: t("academicRecord.noticeBody"),
      conductTitle: t("academicRecord.conductTitle"), noIncidents: t("academicRecord.conductNone"),
      meritPointsTotal: t("academicRecord.meritPointsTotal"),
    },
  });
}
