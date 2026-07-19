// ============================================================================
// [INSA category: PRIVATE] issue-id-card
// AuthZ: school_admin / registrar. Generates a CR-80-sized (3.375in x
// 2.125in / 243pt x 153pt at 72dpi) two-page PDF -- page 1 the front, page 2
// the back -- for a student, uploads it to the private `id-cards` bucket,
// and records it in id_cards/id_card_batches (see 20260713000007_extended_modules.sql).
//
// Text-and-vector-graphics only, same reasoning as generate-payslip-pdf's
// hand-rolled writer: embedding a real photo means parsing/re-encoding an
// arbitrary upload (JPEG/PNG/WebP) into a PDF image XObject, and embedding
// Ethiopic text means a CID-keyed Type0 font with a subsetted glyph table --
// both real scope, not "a few more lines," so this prints an initials
// placeholder instead of a photo and English-only text, flagged here the
// same way the payslip generator flags its own font-embedding gap, rather
// than silently shipping something that looks photo-backed but isn't.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ student_id: z.string().uuid() });

const NAVY: [number, number, number] = [0.118, 0.165, 0.439]; // #1E2A70 -- design system default

function hexToRgb01(hex: string | null | undefined): [number, number, number] {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return NAVY;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Printable ASCII only: content-stream /Length below is the JS string's
// .length (UTF-16 code units), which only equals the actual UTF-8 byte
// count once encoded if every character is ASCII — a non-Latin tenant or
// student name (very plausible; unlike a payslip line label, a school's own
// legal name) would silently corrupt that length. Base14 Helvetica can't
// render Ethiopic glyphs anyway (see file header), so stripping here is
// consistent with "English-only text" rather than emitting mojibake.
function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}
function esc(s: string): string {
  return s.replace(/[()\\]/g, (c) => "\\" + c);
}
function txt(x: number, y: number, size: number, s: string): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;
}
function fillRect(x: number, y: number, w: number, h: number, rgb: [number, number, number]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]} rg ${x} ${y} ${w} ${h} re f`;
}
function strokeRect(x: number, y: number, w: number, h: number): string {
  return `0.6 0.6 0.6 RG 1 w ${x} ${y} ${w} ${h} re S`;
}
function setColor(rgb: [number, number, number]): string {
  return `${rgb[0]} ${rgb[1]} ${rgb[2]} rg`;
}
const BLACK: [number, number, number] = [0, 0, 0];
const WHITE: [number, number, number] = [1, 1, 1];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];

/** Minimal multi-page PDF writer (ASCII-safe body — see file header). */
function buildCardPdf(frontLines: string[], backLines: string[]): Uint8Array {
  const W = 243, H = 153; // CR-80 landscape, points
  const pages = [frontLines, backLines];
  const n = pages.length;
  const fontObjNum = 3 + 2 * n;

  const objs: string[] = [];
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const contentNum = 4 + i * 2;
    const content = pages[i].join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function generateVerifyCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); // 48 hex chars
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "registrar"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!rateLimit(`issue-id-card:${ctx.userId}`, 20, 60_000)) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    const { data: student } = await ctx.userClient.from("students")
      .select("id, tenant_id, first_name, middle_name, last_name, admission_no, date_of_birth, class:classes(name, section)")
      .eq("id", parsed.data.student_id).maybeSingle();
    if (!student) return errors.badRequest();

    const { data: tenant } = await ctx.userClient.from("tenants").select("name").eq("id", student.tenant_id).maybeSingle();
    const { data: tenantConfig } = await ctx.userClient.from("tenant_configs")
      .select("settings").eq("tenant_id", student.tenant_id).maybeSingle();
    const { data: guardian } = await ctx.userClient.from("guardians")
      .select("relationship, phone").eq("student_id", student.id).limit(1).maybeSingle();

    const tenantName = asciiOnly(tenant?.name ?? "School") || "School";
    const brandColor = hexToRgb01(tenantConfig?.settings?.branding?.primaryColor);
    const fullName = asciiOnly([student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ")) || "Student";
    const classLabel = student.class ? asciiOnly(`${student.class.name} ${student.class.section ?? ""}`.trim()) : "-";
    const verifyCode = generateVerifyCode();

    const front = [
      fillRect(0, 133, 243, 20, brandColor),
      setColor(WHITE), txt(10, 140, 9, tenantName.slice(0, 34)),
      setColor(WHITE), txt(180, 140, 7, "STUDENT ID"),
      strokeRect(10, 60, 55, 65),
      setColor(GREY), txt(28, 90, 16, initialsFor(fullName)),
      setColor(BLACK), txt(75, 110, 11, fullName.slice(0, 26)),
      setColor(GREY), txt(75, 96, 7, `Admission No: ${student.admission_no}`),
      setColor(GREY), txt(75, 86, 7, `Class: ${classLabel}`),
      setColor(GREY), txt(75, 76, 7, `DOB (GC): ${student.date_of_birth}`),
      fillRect(0, 0, 243, 6, brandColor),
      setColor(GREY), txt(10, 45, 6, "Valid for the current academic year"),
    ];

    const back = [
      fillRect(0, 133, 243, 20, brandColor),
      setColor(WHITE), txt(10, 140, 8, "Emergency / Guardian Contact"),
      setColor(BLACK), txt(10, 115, 8, guardian ? `${guardian.relationship ?? "Guardian"}: ${guardian.phone ?? "-"}` : "On file at school office"),
      setColor(GREY), txt(10, 95, 6, "Verification code"),
      setColor(BLACK), txt(10, 86, 7, verifyCode.slice(0, 24)),
      setColor(BLACK), txt(10, 76, 7, verifyCode.slice(24)),
      setColor(GREY), txt(10, 60, 6, `Issued: ${new Date().toISOString().slice(0, 10)} (GC)`),
      fillRect(0, 0, 243, 6, brandColor),
      setColor(GREY), txt(10, 45, 6, `Property of ${tenantName.slice(0, 30)} - if found, return to the school office.`),
    ];

    const pdf = buildCardPdf(front, back);
    const path = `${student.tenant_id}/${student.id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await ctx.adminClient.storage.from("id-cards").upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;

    const { data: batch, error: batchErr } = await ctx.adminClient.from("id_card_batches")
      .insert({ tenant_id: student.tenant_id, batch_type: "student_id", status: "done", created_by: ctx.userId })
      .select("id").single();
    if (batchErr) throw batchErr;

    const { error: cardErr } = await ctx.adminClient.from("id_cards").insert({
      tenant_id: student.tenant_id, batch_id: batch.id,
      subject_type: "student", subject_id: student.id,
      verify_code: verifyCode, pdf_path: path,
    });
    if (cardErr) throw cardErr;

    const { data: signed } = await ctx.adminClient.storage.from("id-cards").createSignedUrl(path, 300);
    return json({ url: signed?.signedUrl, expires_in: 300 }, 201);
  } catch (err) {
    console.error("issue-id-card failed", { message: (err as Error).message });
    return errors.internal();
  }
});
