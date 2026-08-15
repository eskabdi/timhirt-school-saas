// Leaving certificate PDF -- same house style as student-profile-pdf.ts/
// transcript-pdf.ts (navy letterhead, pdf-lib dynamic import, Ethiopic
// fallback fetched only when needed), laid out as a single centered
// certificate page rather than a table.

export interface LeavingCertificatePdfInput {
  schoolName: string;
  studentName: string;
  admissionNo: string;
  gradeLabel: string;
  graduatedEcYear: number;
  issuedOn: string;
  labels: {
    title: string;
    bodyPrefix: string; // "This is to certify that"
    bodySuffix: string; // "has satisfactorily completed studies and is leaving this institution."
    admissionNo: string;
    grade: string;
    graduatedYear: string;
    issuedOn: string;
    signature: string;
  };
}

const NON_LATIN = /[Ā-￿]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildLeavingCertificatePdf(input: LeavingCertificatePdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.016, 0.086, 0.208);
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);
  const GOLD = rgb(0.72, 0.58, 0.13);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const allText = [
    input.schoolName, input.studentName, input.gradeLabel,
    ...Object.values(input.labels),
  ].join("");
  let ethiopic: Awaited<ReturnType<typeof doc.embedFont>> | null = null;
  if (hasNonLatin(allText)) {
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      doc.registerFontkit(fontkit);
      const res = await fetch("/fonts/NotoSerifEthiopic-Regular.ttf");
      if (!res.ok) throw new Error(`font HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      ethiopic = await doc.embedFont(buf, { subset: true });
    } catch (err) {
      console.error("leaving-certificate-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }
  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[Ā-￿]/g, "").trim() || "-");

  const PAGE_W = 595, PAGE_H = 842; // A4 portrait
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const M = 48;

  page.drawRectangle({ x: M, y: M, width: PAGE_W - 2 * M, height: PAGE_H - 2 * M, borderColor: GOLD, borderWidth: 2 });
  page.drawRectangle({ x: M + 8, y: M + 8, width: PAGE_W - 2 * M - 16, height: PAGE_H - 2 * M - 16, borderColor: NAVY, borderWidth: 0.75 });

  const nameFont = pick(input.schoolName);
  page.drawText(safe(input.schoolName, nameFont), {
    x: PAGE_W / 2 - (input.schoolName.length * 5), y: PAGE_H - 130, size: 16, font: nameFont ?? bold, color: NAVY,
  });

  const titleFont = pick(input.labels.title);
  const titleW = input.labels.title.length * 11;
  page.drawText(safe(input.labels.title, titleFont), { x: PAGE_W / 2 - titleW / 2, y: PAGE_H - 175, size: 20, font: titleFont ?? bold, color: GOLD });

  const bodyLines = [
    { text: input.labels.bodyPrefix, size: 11 },
    { text: input.studentName, size: 18, bold: true },
    { text: input.labels.bodySuffix, size: 11 },
  ];
  let y = PAGE_H - 240;
  for (const line of bodyLines) {
    const f = pick(line.text);
    const font = f ?? (line.bold ? bold : regular);
    const w = line.text.length * (line.size * 0.52);
    page.drawText(safe(line.text, f), { x: PAGE_W / 2 - w / 2, y, size: line.size, font, color: INK, maxWidth: PAGE_W - 2 * M - 40 });
    y -= line.size + 20;
  }

  y -= 30;
  const details: [string, string][] = [
    [input.labels.admissionNo, input.admissionNo],
    [input.labels.grade, input.gradeLabel],
    [input.labels.graduatedYear, String(input.graduatedEcYear)],
  ];
  for (const [label, value] of details) {
    const lf = pick(label);
    const vf = pick(value);
    page.drawText(safe(label, lf), { x: PAGE_W / 2 - 140, y, size: 10, font: lf ?? bold, color: FAINT });
    page.drawText(safe(value, vf), { x: PAGE_W / 2 + 10, y, size: 10, font: vf ?? regular, color: INK });
    y -= 22;
  }

  const issued = `${input.labels.issuedOn}: ${input.issuedOn}`;
  const isf = pick(issued);
  page.drawText(safe(issued, isf), { x: M + 30, y: M + 60, size: 9, font: isf ?? regular, color: FAINT });

  page.drawLine({ start: { x: PAGE_W - M - 180, y: M + 80 }, end: { x: PAGE_W - M - 30, y: M + 80 }, thickness: 0.75, color: FAINT });
  const sigFont = pick(input.labels.signature);
  page.drawText(safe(input.labels.signature, sigFont), { x: PAGE_W - M - 180, y: M + 65, size: 9, font: sigFont ?? regular, color: FAINT });

  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
