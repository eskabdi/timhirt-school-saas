// Classes list PDF export -- same house style as timetable/timetable-pdf.ts
// (navy letterhead, pdf-lib dynamic import, Ethiopic fallback fetched only
// when needed) but a plain portrait table rather than a day/period grid.

export interface ClassesPdfRow { name: string; section: string; gradeLevel: string; capacity: string; enrolled: string }

export interface ClassesPdfInput {
  schoolName: string;
  title: string;
  columns: string[];
  rows: ClassesPdfRow[];
  issuedOn: string;
  issuedLabel: string;
}

const NON_LATIN = /[\u0100-\uffff]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildClassesPdf(input: ClassesPdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.016, 0.086, 0.208); // #041635
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);
  const LINE = rgb(0.9, 0.91, 0.92);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const allText = [input.schoolName, input.title, input.issuedLabel, ...input.columns, ...input.rows.flatMap((r) => Object.values(r))].join("");
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
      console.error("classes-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }
  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[\u0100-\uffff]/g, "").trim() || "-");

  const PAGE_W = 595, PAGE_H = 842; // A4 portrait
  const M = 40;
  const rowsPerPage = 30;
  const colW = [(PAGE_W - 2 * M) * 0.32, (PAGE_W - 2 * M) * 0.16, (PAGE_W - 2 * M) * 0.18, (PAGE_W - 2 * M) * 0.17, (PAGE_W - 2 * M) * 0.17];

  const pageChunks: ClassesPdfRow[][] = [];
  for (let i = 0; i < input.rows.length; i += rowsPerPage) pageChunks.push(input.rows.slice(i, i + rowsPerPage));
  if (pageChunks.length === 0) pageChunks.push([]);

  pageChunks.forEach((chunk, pageIndex) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: NAVY });
    const nameFont = pick(input.schoolName);
    page.drawText(safe(input.schoolName, nameFont), { x: M, y: PAGE_H - 26, size: 14, font: nameFont ?? bold, color: rgb(1, 1, 1) });
    const titleFont = pick(input.title);
    page.drawText(safe(input.title, titleFont), { x: M, y: PAGE_H - 42, size: 9, font: titleFont ?? regular, color: rgb(0.85, 0.87, 0.96) });

    let y = PAGE_H - 80;
    const headerH = 20;
    page.drawRectangle({ x: M, y: y - headerH, width: PAGE_W - 2 * M, height: headerH, color: rgb(0.95, 0.96, 0.97) });
    let x = M;
    input.columns.forEach((col, i) => {
      const cFont = pick(col);
      page.drawText(safe(col, cFont), { x: x + 6, y: y - 14, size: 8, font: cFont ?? bold, color: NAVY });
      x += colW[i]!;
    });
    y -= headerH;

    const rowH = 20;
    chunk.forEach((row) => {
      y -= rowH;
      page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color: LINE });
      const values = [row.name, row.section, row.gradeLevel, row.capacity, row.enrolled];
      let cx = M;
      values.forEach((v, i) => {
        const vFont = pick(v);
        page.drawText(safe(v, vFont), { x: cx + 6, y: y + 6, size: 8, font: vFont ?? regular, color: INK });
        cx += colW[i]!;
      });
    });

    const issued = `${input.issuedLabel}: ${input.issuedOn} — ${pageIndex + 1}/${pageChunks.length}`;
    const isf = pick(issued);
    page.drawText(safe(issued, isf), { x: M, y: 20, size: 7, font: isf ?? regular, color: FAINT });
  });

  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
