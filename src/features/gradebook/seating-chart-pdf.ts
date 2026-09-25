// Exam seating chart PDF -- same house style as settings/classes-pdf.ts
// (navy letterhead, pdf-lib dynamic import, Ethiopic fallback fetched only
// when needed) but a room grid of seats rather than a row table.

// R5-C6. Static import is bundle-safe (documentTemplate.ts uses `import type`).
import { templateRenderer, type DocTemplate } from "@/lib/documentTemplate";

export interface SeatingChartPdfSeat { row: number; col: number; label: string; studentName: string | null }

export interface SeatingChartPdfInput {
  schoolName: string;
  title: string;
  rows: number;
  cols: number;
  seats: SeatingChartPdfSeat[];
  issuedOn: string;
  /** R5-C6: per C3's matrix a seating chart takes header/footer only. */
  template?: DocTemplate | null;
  issuedLabel: string;
}

const NON_LATIN = /[Ā-￿]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildSeatingChartPdf(input: SeatingChartPdfInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const tpl = templateRenderer({ rgb, degrees }, input.template ?? null);
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.016, 0.086, 0.208);
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);
  const LINE = rgb(0.75, 0.77, 0.8);
  const EMPTY_FILL = rgb(0.96, 0.97, 0.98);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const allText = [input.schoolName, input.title, input.issuedLabel, ...input.seats.map((s) => s.studentName ?? "")].join("");
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
      console.error("seating-chart-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }
  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[Ā-￿]/g, "").trim() || "-");

  const PAGE_W = 842, PAGE_H = 595; // A4 landscape -- a seat grid reads wider than tall
  const M = 40;
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: PAGE_H - 56, width: PAGE_W, height: 56, color: NAVY });
  const nameFont = pick(input.schoolName);
  page.drawText(safe(input.schoolName, nameFont), { x: M, y: PAGE_H - 26, size: 14, font: nameFont ?? bold, color: rgb(1, 1, 1) });
  const titleFont = pick(input.title);
  page.drawText(safe(input.title, titleFont), { x: M, y: PAGE_H - 42, size: 9, font: titleFont ?? regular, color: rgb(0.85, 0.87, 0.96) });

  // Configured header line, just under the letterhead. No-op when unset.
  tpl.header(page, regular, M, PAGE_H - 70);

  const gridTop = PAGE_H - 90;
  const gridBottom = 40;
  const gridLeft = M;
  const gridRight = PAGE_W - M;
  const cellW = (gridRight - gridLeft) / input.cols;
  const cellH = Math.min(90, (gridTop - gridBottom) / input.rows);

  const byPos = new Map(input.seats.map((s) => [`${s.row}:${s.col}`, s]));

  for (let r = 0; r < input.rows; r++) {
    for (let c = 0; c < input.cols; c++) {
      const seat = byPos.get(`${r + 1}:${c + 1}`);
      const x = gridLeft + c * cellW;
      const y = gridTop - (r + 1) * cellH;
      page.drawRectangle({
        x: x + 3, y: y + 3, width: cellW - 6, height: cellH - 6,
        borderColor: LINE, borderWidth: 1, color: seat?.studentName ? undefined : EMPTY_FILL,
      });
      if (seat) {
        const labelFont = pick(seat.label);
        page.drawText(safe(seat.label, labelFont), { x: x + 10, y: y + cellH - 20, size: 8, font: labelFont ?? bold, color: FAINT });
        const nameText = seat.studentName ?? "—";
        const nFont = pick(nameText);
        page.drawText(safe(nameText, nFont), { x: x + 10, y: y + cellH / 2 - 4, size: 9, font: nFont ?? regular, color: INK, maxWidth: cellW - 20 });
      }
    }
  }

  const issued = `${input.issuedLabel}: ${input.issuedOn}`;
  const isf = pick(issued);
  page.drawText(safe(issued, isf), { x: M, y: 18, size: 7, font: isf ?? regular, color: FAINT });
  tpl.footer(page, regular, PAGE_W, 32);

  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
