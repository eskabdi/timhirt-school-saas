// Formatted student profile PDF, generated in the browser.
//
// Same layout and approach as hr/staff-profile-pdf.ts — navy letterhead,
// identity block, photo placeholder, sectioned two-column grids — so the
// two profile reports read as one system. pdf-lib is dynamically imported
// by the caller so it never enters the main bundle, and Ethiopic text (an
// Amharic name, a guardian's name) falls back to the same Noto Serif
// Ethiopic face the ID card and transcript renderers embed, fetched only
// when the document actually contains non-Latin characters.
import { drawPhotoPlaceholder } from "@/lib/pdf-photo-placeholder";

export interface StudentProfilePdfInput {
  schoolName: string;
  studentName: string;
  admissionNo: string;
  gradeLabel: string;
  status: string;
  admissionDateEc: string;
  issuedOn: string;
  demographics: [string, string][];
  enrollment: [string, string][];
  guardian: [string, string][];
  labels: {
    title: string; admissionNo: string; grade: string; status: string; admissionDate: string;
    demographicsSection: string; enrollmentSection: string; guardianSection: string;
    issued: string; photo: string;
  };
}

// Anything above Latin-1 is unencodable by the standard PDF fonts.
const NON_LATIN = /[\u0100-\uffff]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildStudentProfilePdf(input: StudentProfilePdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.118, 0.165, 0.439);
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const allSectionRows = [...input.demographics, ...input.enrollment, ...input.guardian];
  const allText = [
    input.schoolName, input.studentName, input.gradeLabel, input.status, input.admissionDateEc,
    ...Object.values(input.labels), ...allSectionRows.flatMap(([k, v]) => [k, v]),
  ].join("");
  let ethiopic: Awaited<ReturnType<typeof doc.embedFont>> | null = null;
  if (hasNonLatin(allText)) {
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      doc.registerFontkit(fontkit);
      const res = await fetch("/fonts/NotoSerifEthiopic-Regular.ttf");
      if (!res.ok) throw new Error(`font HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const magic = buf.byteLength >= 4 ? new DataView(buf).getUint32(0) : 0;
      if (magic !== 0x00010000 && magic !== 0x74727565 && magic !== 0x4f54544f) {
        throw new Error(`/fonts/NotoSerifEthiopic-Regular.ttf returned ${buf.byteLength}B of non-font data`);
      }
      ethiopic = await doc.embedFont(buf, { subset: true });
    } catch (err) {
      console.error("student-profile-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }

  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[\u0100-\uffff]/g, "").trim() || "-");

  const PAGE_H = 842;
  const page = doc.addPage([595, PAGE_H]); // A4 portrait
  const M = 44;
  let y = PAGE_H - M;

  const draw = (text: string, x: number, size: number, opts: { bold?: boolean; color?: typeof INK } = {}) => {
    const custom = pick(text);
    const font = custom ?? (opts.bold ? bold : regular);
    page.drawText(safe(text, custom), { x, y, size, font, color: opts.color ?? INK });
  };

  // Header
  page.drawRectangle({ x: 0, y: PAGE_H - 76, width: 595, height: 76, color: NAVY });
  y = PAGE_H - 34;
  const nameFont = pick(input.schoolName);
  page.drawText(safe(input.schoolName, nameFont), { x: M, y, size: 16, font: nameFont ?? bold, color: rgb(1, 1, 1) });
  y -= 20;
  const titleFont = pick(input.labels.title);
  page.drawText(safe(input.labels.title, titleFont), { x: M, y, size: 10, font: titleFont ?? regular, color: rgb(0.85, 0.87, 0.96) });

  // Identity block
  y = PAGE_H - 108;
  const identFont = pick(input.studentName);
  page.drawText(safe(input.studentName, identFont), { x: M, y, size: 15, font: identFont ?? bold, color: INK });
  y -= 20;
  const identity: [string, string][] = [
    [input.labels.admissionNo, input.admissionNo],
    [input.labels.grade, input.gradeLabel],
    [input.labels.status, input.status],
    [input.labels.admissionDate, input.admissionDateEc],
  ];
  for (const [label, value] of identity) {
    draw(label, M, 8, { color: FAINT });
    const vf = pick(value);
    page.drawText(safe(value, vf), { x: M + 100, y, size: 9, font: vf ?? regular, color: INK });
    y -= 14;
  }

  // Photo placeholder: no photo is embedded (a signed storage URL would not
  // survive into a downloaded, re-opened file), just a labelled box in the
  // spot a printed photo would occupy, top-right of the identity block.
  const photoFont = pick(input.labels.photo) ?? regular;
  drawPhotoPlaceholder(page, {
    x: 595 - M - 90, y: PAGE_H - 186, size: 90,
    label: safe(input.labels.photo, pick(input.labels.photo)), font: photoFont,
    borderColor: rgb(0.7, 0.72, 0.8), fillColor: rgb(0.97, 0.97, 0.98), textColor: FAINT,
  });

  // Section renderer: a heading bar, then two-column key/value rows.
  const section = (title: string, rows: [string, string][]) => {
    if (!rows.length) return;
    y -= 8;
    page.drawRectangle({ x: M - 6, y: y - 4, width: 595 - 2 * M + 12, height: 16, color: rgb(0.91, 0.92, 0.97) });
    const tf = pick(title);
    page.drawText(safe(title, tf), { x: M, y, size: 9, font: tf ?? bold, color: NAVY });
    y -= 20;
    for (let i = 0; i < rows.length; i += 2) {
      const rowY = y;
      for (let c = 0; c < 2; c++) {
        const pair = rows[i + c];
        if (!pair) continue;
        const [label, value] = pair;
        const x = M + c * 260;
        draw(label, x, 8, { color: FAINT });
        const vf = pick(value);
        page.drawText(safe(value, vf).slice(0, 40), { x, y: rowY - 12, size: 9, font: vf ?? regular, color: INK });
      }
      y -= 30;
      if (y < 100) break; // single page; overflow is truncated rather than corrupt
    }
  };

  section(input.labels.demographicsSection, input.demographics);
  section(input.labels.enrollmentSection, input.enrollment);
  section(input.labels.guardianSection, input.guardian);

  // Footer
  const issued = `${input.labels.issued}: ${input.issuedOn}`;
  const isf = pick(issued);
  page.drawText(safe(issued, isf), { x: M, y: 24, size: 7, font: isf ?? regular, color: FAINT });

  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
