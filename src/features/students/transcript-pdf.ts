// Official academic transcript, generated in the browser.
//
// pdf-lib is dynamically imported by buildTranscriptPdf's caller so it never
// enters the main bundle — the transcript is a rarely-pressed button on one
// tab, and pdf-lib plus fontkit are ~400 KB together.
//
// The standard PDF fonts are Latin-only and pdf-lib throws (rather than
// dropping glyphs) on unencodable characters, so any Ethiopic text — the
// school's Amharic name, an Amharic subject label — needs the same
// Noto Serif Ethiopic face the ID card renderer embeds. That font is fetched
// only when the document actually contains non-Latin characters.

export interface TranscriptRow {
  subject: string; code: string; instructor: string;
  ca: number; final: number; total: number; letter: string;
}

// Dates arrive pre-formatted (Ethiopic, via formatEth) by the caller — same
// convention as issuedOn below — so this file never does its own date math.
// R5-C6. Static import is safe for the bundle: documentTemplate.ts imports
// pdf-lib with `import type` only, so nothing of pdf-lib is pulled in here.
import { templateRenderer, type DocTemplate } from "@/lib/documentTemplate";

export interface TranscriptConductRow { dateEc: string; label: string; detail: string; }

export interface TranscriptInput {
  schoolName: string;
  studentName: string;
  admissionNo: string;
  gradeLabel: string;
  academicPeriod: string;
  rows: TranscriptRow[];
  gpa: number;
  totalScore: number;
  maxScore: number;
  issuedOn: string;
  /** R5-C6: null renders the fixed layout, exactly as before this round. */
  template?: DocTemplate | null;
  conduct?: { incidents: TranscriptConductRow[]; merits: TranscriptConductRow[]; totalMeritPoints: number };
  labels: {
    title: string; student: string; studentNo: string; grade: string; period: string;
    subject: string; instructor: string; ca: string; final: string; total: string;
    letter: string; status: string; pass: string; fail: string;
    semesterTotals: string; gpa: string; issued: string; notice: string; noticeBody: string;
    conductTitle: string; noIncidents: string; meritPointsTotal: string;
  };
}

// Anything above Latin-1 is unencodable by the standard PDF fonts. Tested
// positively rather than as a negated \u0000-\u00ff range, which would put a
// control character in the pattern (no-control-regex).
const NON_LATIN = /[\u0100-\uffff]/;
const hasNonLatin = (s: string) => NON_LATIN.test(s);

export async function buildTranscriptPdf(input: TranscriptInput): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import("pdf-lib");
  const tpl = templateRenderer({ rgb, degrees }, input.template ?? null);
  const doc = await PDFDocument.create();

  const NAVY = rgb(0.118, 0.165, 0.439);
  const INK = rgb(0.09, 0.10, 0.17);
  const FAINT = rgb(0.54, 0.56, 0.65);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Collect every string that will be drawn, so the Ethiopic fallback is
  // fetched once and only when it is genuinely needed.
  const conductRows = [...(input.conduct?.incidents ?? []), ...(input.conduct?.merits ?? [])];
  const allText = [
    input.schoolName, input.studentName, input.gradeLabel, input.academicPeriod,
    ...Object.values(input.labels), ...input.rows.flatMap((r) => [r.subject, r.code, r.instructor]),
    ...conductRows.flatMap((r) => [r.dateEc, r.label, r.detail]),
  ].join("");
  let ethiopic: Awaited<ReturnType<typeof doc.embedFont>> | null = null;
  if (hasNonLatin(allText)) {
    try {
      const fontkit = (await import("@pdf-lib/fontkit")).default;
      doc.registerFontkit(fontkit);
      const res = await fetch("/fonts/NotoSerifEthiopic-Regular.ttf");
      if (!res.ok) throw new Error(`font HTTP ${res.status}`);
      // The SPA rewrite answers 200 with index.html for any missing asset, so a
      // status check alone would hand embedFont a page of HTML. Require the sfnt
      // magic before trusting the bytes.
      const buf = await res.arrayBuffer();
      const magic = buf.byteLength >= 4 ? new DataView(buf).getUint32(0) : 0;
      if (magic !== 0x00010000 && magic !== 0x74727565 && magic !== 0x4f54544f) {
        throw new Error(`/fonts/NotoSerifEthiopic-Regular.ttf returned ${buf.byteLength}B of non-font data`);
      }
      ethiopic = await doc.embedFont(buf, { subset: true });
    } catch (err) {
      // Transcripts still render (Ethiopic is stripped below), but the reader
      // loses the Amharic name — worth a console trail rather than nothing.
      console.error("transcript-pdf: Ethiopic font unavailable, falling back to ASCII", err);
      ethiopic = null;
    }
  }

  // Helvetica cannot encode Ethiopic; without the fallback, strip rather than
  // throw so a font-fetch failure still yields a usable transcript.
  const pick = (s: string) => (hasNonLatin(s) && ethiopic ? ethiopic : null);
  const safe = (s: string, f: unknown) => (f ? s : s.replace(/[\u0100-\uffff]/g, "").trim() || "-");

  const page = doc.addPage([595, 842]); // A4 portrait
  const M = 44;
  let y = 842 - M;

  const draw = (text: string, x: number, size: number, opts: { bold?: boolean; color?: typeof INK } = {}) => {
    const custom = pick(text);
    const font = custom ?? (opts.bold ? bold : regular);
    page.drawText(safe(text, custom), { x, y, size, font, color: opts.color ?? INK });
  };

  // Header
  page.drawRectangle({ x: 0, y: 842 - 76, width: 595, height: 76, color: NAVY });
  y = 842 - 34;
  const nameFont = pick(input.schoolName);
  page.drawText(safe(input.schoolName, nameFont), {
    x: M, y, size: 16, font: nameFont ?? bold, color: rgb(1, 1, 1),
  });
  y -= 20;
  const titleFont = pick(input.labels.title);
  page.drawText(safe(input.labels.title, titleFont), {
    x: M, y, size: 10, font: titleFont ?? regular, color: rgb(0.85, 0.87, 0.96),
  });
  // Painted before the body: pdf-lib has no z-index, so paint order is the
  // only thing keeping the watermark underneath the content.
  tpl.watermark(page, regular, 595, 842);

  // Optional configured header line, drawn in the gap between the navy band
  // (which ends at 842-76) and the student block. Fixed position rather than
  // flowed: the block below keeps its exact 842-110 start whether or not a
  // header is configured, so an unconfigured transcript is byte-for-byte the
  // layout it was before R5-C6.
  tpl.header(page, regular, M, 842 - 92);

  // Student block
  y = 842 - 110;
  const info: [string, string][] = [
    [input.labels.student, input.studentName],
    [input.labels.studentNo, input.admissionNo],
    [input.labels.grade, input.gradeLabel],
    [input.labels.period, input.academicPeriod],
  ];
  for (const [label, value] of info) {
    draw(label, M, 8, { color: FAINT });
    const vf = pick(value);
    page.drawText(safe(value, vf), { x: M + 96, y, size: 10, font: vf ?? bold, color: INK });
    y -= 16;
  }

  // Table
  y -= 10;
  const COLS = [M, M + 190, M + 268, M + 330, M + 392, M + 452, M + 500];
  const head = [
    input.labels.subject, input.labels.instructor, input.labels.ca,
    input.labels.final, input.labels.total, input.labels.letter, input.labels.status,
  ];
  page.drawRectangle({ x: M - 6, y: y - 4, width: 595 - 2 * M + 12, height: 18, color: rgb(0.91, 0.92, 0.97) });
  head.forEach((h, i) => {
    const f = pick(h);
    page.drawText(safe(h, f), { x: COLS[i]!, y, size: 8, font: f ?? bold, color: INK });
  });
  y -= 20;

  for (const r of input.rows) {
    if (y < 120) break; // single page; a longer transcript is truncated rather than corrupt
    const cells = [
      r.subject, r.instructor, r.ca.toFixed(1), r.final.toFixed(1),
      r.total.toFixed(1), r.letter, r.total >= 50 ? input.labels.pass : input.labels.fail,
    ];
    cells.forEach((c, i) => {
      const f = pick(c);
      page.drawText(safe(c, f).slice(0, i === 0 ? 30 : 18), {
        x: COLS[i]!, y, size: 9, font: f ?? regular,
        color: i === 4 ? NAVY : INK,
      });
    });
    page.drawLine({ start: { x: M - 6, y: y - 5 }, end: { x: 595 - M + 6, y: y - 5 }, thickness: 0.4, color: rgb(0.9, 0.91, 0.95) });
    y -= 17;
  }

  // Totals
  y -= 8;
  draw(input.labels.semesterTotals, M, 9, { bold: true, color: FAINT });
  page.drawText(`${input.totalScore.toFixed(1)} / ${input.maxScore}`, { x: COLS[4]!, y, size: 11, font: bold, color: NAVY });
  y -= 18;
  draw(input.labels.gpa, M, 9, { bold: true, color: FAINT });
  page.drawText(input.gpa.toFixed(2), { x: COLS[4]!, y, size: 11, font: bold, color: NAVY });

  // Conduct / remarks — sourced from the same discipline_incidents/
  // student_merits data the Behavioral tab shows. The footer notice below is
  // anchored to a fixed y (not derived from where this section ends), so
  // every row here is bounded against that same y=96 rather than assuming
  // there's room.
  if (input.conduct) {
    y -= 26;
    if (y > 105) {
      draw(input.labels.conductTitle, M, 10, { bold: true, color: NAVY });
      y -= 15;
      const rows = [
        ...input.conduct.incidents.map((r) => ({ ...r, color: INK })),
        ...input.conduct.merits.map((r) => ({ ...r, color: NAVY })),
      ];
      if (rows.length === 0) {
        draw(input.labels.noIncidents, M, 8, { color: FAINT });
        y -= 13;
      } else {
        for (const r of rows) {
          if (y < 105) break;
          const line = `${r.dateEc} — ${r.label}${r.detail ? `: ${r.detail}` : ""}`;
          draw(line.slice(0, 100), M, 8, { color: r.color });
          y -= 12;
        }
      }
      if (y > 105) {
        draw(`${input.labels.meritPointsTotal}: ${input.conduct.totalMeritPoints}`, M, 8, { bold: true, color: NAVY });
        y -= 13;
      }
    }
  }

  // Footer notice
  y = 96;
  const nf = pick(input.labels.notice);
  page.drawText(safe(input.labels.notice, nf), { x: M, y, size: 9, font: nf ?? bold, color: INK });
  y -= 13;
  const bodyFont = pick(input.labels.noticeBody);
  const body = safe(input.labels.noticeBody, bodyFont);
  const per = 105;
  for (let i = 0; i < body.length && y > 34; i += per) {
    page.drawText(body.slice(i, i + per), { x: M, y, size: 7, font: bodyFont ?? regular, color: FAINT });
    y -= 9;
  }
  const issued = `${input.labels.issued}: ${input.issuedOn}`;
  const isf = pick(issued);
  page.drawText(safe(issued, isf), { x: M, y: 24, size: 7, font: isf ?? regular, color: FAINT });
  // Both no-op unless the school configured them.
  tpl.signature(page, regular, 595 - M, 78);
  tpl.footer(page, regular, 595);

  // Copy into a plain ArrayBuffer: pdf-lib types its output as
  // Uint8Array<ArrayBufferLike>, which BlobPart won't accept.
  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}
