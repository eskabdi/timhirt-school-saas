// Formatted weekly timetable PDF, generated in the browser. Same house style
// as hr/staff-profile-pdf.ts and students/student-profile-pdf.ts (navy
// letterhead, pdf-lib dynamic import, Ethiopic fallback fetched only when
// needed) but landscape and grid-shaped rather than key-value sections --
// a week's worth of days needs the width.

export interface TimetablePdfCell { subject: string; teacher: string; room: string }

export interface TimetablePdfInput {
  schoolName: string;
  scopeLabel: string;
  periods: { label: string; starts_at: string; ends_at: string }[];
  days: string[];
  cells: (TimetablePdfCell | null)[][]; // [dayIndex][periodIndex]
  issuedOn: string;
  labels: { title: string; issued: string };
}

const NON_LATIN = /[\u0100-\uffff]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildTimetablePdf(input: TimetablePdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.118, 0.165, 0.439);
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const allText = [
    input.schoolName, input.scopeLabel, ...Object.values(input.labels), ...input.days,
    ...input.periods.map((p) => p.label),
    ...input.cells.flat().filter((c): c is TimetablePdfCell => !!c).flatMap((c) => [c.subject, c.teacher, c.room]),
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
      console.error("timetable-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }
  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[\u0100-\uffff]/g, "").trim() || "-");
  const draw = (page: import("pdf-lib").PDFPage, text: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: typeof INK } = {}) => {
    const custom = pick(text);
    const font = custom ?? (opts.bold ? bold : regular);
    page.drawText(safe(text, custom), { x, y, size, font, color: opts.color ?? INK });
  };

  const PAGE_W = 842, PAGE_H = 595; // A4 landscape
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const M = 30;

  // Header
  page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: NAVY });
  const nameFont = pick(input.schoolName);
  page.drawText(safe(input.schoolName, nameFont), { x: M, y: PAGE_H - 26, size: 14, font: nameFont ?? bold, color: rgb(1, 1, 1) });
  const titleFont = pick(input.labels.title);
  page.drawText(safe(input.labels.title, titleFont), { x: M, y: PAGE_H - 42, size: 9, font: titleFont ?? regular, color: rgb(0.85, 0.87, 0.96) });
  const scopeFont = pick(input.scopeLabel);
  const scopeText = safe(input.scopeLabel, scopeFont);
  const scopeWidth = (scopeFont ?? bold).widthOfTextAtSize(scopeText, 12);
  page.drawText(scopeText, { x: PAGE_W - M - scopeWidth, y: PAGE_H - 32, size: 12, font: scopeFont ?? bold, color: rgb(1, 1, 1) });

  // Grid
  const timeColW = 100;
  const dayColW = (PAGE_W - 2 * M - timeColW) / input.days.length;
  const gridTop = PAGE_H - 80;
  const headerRowH = 22;

  page.drawRectangle({ x: M, y: gridTop - headerRowH, width: PAGE_W - 2 * M, height: headerRowH, color: rgb(0.91, 0.92, 0.97) });
  draw(page, "", M + 6, gridTop - 15, 8, { color: FAINT });
  input.days.forEach((d, i) => {
    const x = M + timeColW + i * dayColW;
    const dFont = pick(d);
    const w = (dFont ?? bold).widthOfTextAtSize(safe(d, dFont), 9);
    page.drawText(safe(d, dFont), { x: x + (dayColW - w) / 2, y: gridTop - 15, size: 9, font: dFont ?? bold, color: NAVY });
  });

  const rowH = Math.min(52, (gridTop - headerRowH - 40) / Math.max(1, input.periods.length));
  let y = gridTop - headerRowH;
  input.periods.forEach((p, pi) => {
    y -= rowH;
    page.drawRectangle({ x: M, y, width: PAGE_W - 2 * M, height: rowH, borderColor: rgb(0.88, 0.89, 0.93), borderWidth: 0.5 });
    draw(page, p.label, M + 6, y + rowH - 14, 8, { bold: true });
    draw(page, `${p.starts_at.slice(0, 5)}-${p.ends_at.slice(0, 5)}`, M + 6, y + rowH - 26, 7, { color: FAINT });

    input.days.forEach((_d, di) => {
      const x = M + timeColW + di * dayColW;
      page.drawLine({ start: { x, y }, end: { x, y: y + rowH }, thickness: 0.5, color: rgb(0.88, 0.89, 0.93) });
      const cell = input.cells[di]?.[pi];
      if (cell) {
        draw(page, cell.subject.slice(0, 22), x + 4, y + rowH - 14, 8, { bold: true });
        draw(page, cell.teacher.slice(0, 24), x + 4, y + rowH - 26, 7, { color: FAINT });
        if (cell.room) draw(page, cell.room.slice(0, 16), x + 4, y + rowH - 37, 7, { color: FAINT });
      }
    });
  });

  const issued = `${input.labels.issued}: ${input.issuedOn}`;
  const isf = pick(issued);
  page.drawText(safe(issued, isf), { x: M, y: 14, size: 7, font: isf ?? regular, color: FAINT });

  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
