// ============================================================================
// [INSA category: PRIVATE] issue-staff-id
// AuthZ: school_admin / hr_officer. Renders a print-ready CR-80 (85.6 x
// 54 mm / 243pt x 153pt) two-page PDF — front, then back — for an employee,
// uploads it to the existing private `id-cards` bucket, and records it in
// id_card_batches/id_cards (both tables already had 'staff_id'/'staff' as
// valid values — 20260713000007 anticipated this pipeline before it existed).
//
// Deliberately its own file rather than a shared renderer with
// issue-id-card: the two cards draw from different tables (employees vs.
// students), carry a different field set (job title/department instead of
// class/guardian), and issue-id-card's per-tenant template designer has no
// staff equivalent to plug into — forcing this through that machinery would
// mean threading student-shaped concepts through a staff-shaped card. The
// CR-80 geometry, QR-verification approach, and photo/placeholder drawing
// are copied in spirit, not by import, and kept simple: one fixed layout,
// no template designer, no barcode (the QR carries the same verification
// role and one 2D code per side is enough).
// ============================================================================
import { z } from "npm:zod@3";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "npm:pdf-lib@1";
import { toDataURL as qrToDataURL } from "npm:qrcode@1";
import { requireRole, errors, json, rateLimit, corsHeaders, type AuthContext } from "../_shared/security.ts";

const Payload = z.object({ employee_id: z.string().uuid() });

const W = 243, H = 153; // CR-80 landscape, points (85.6 x 54 mm)
const NAVY: [number, number, number] = [0.118, 0.165, 0.439];
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];

function asciiOnly(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "");
}
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function generateVerifyCode(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function drawTextInBox(page: PDFPage, font: PDFFont, raw: string, box: { x: number; y: number; w: number; h: number }, opts: { size: number; color: [number, number, number]; align?: "left" | "center" | "right" }) {
  const size = opts.size;
  let text = asciiOnly(raw); // Helvetica has no Ethiopic glyphs; every field here is ASCII by construction
  const maxChars = Math.max(1, Math.floor(box.w / (size * 0.55)));
  if (text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - 1)) + ".";
  const width = font.widthOfTextAtSize(text, size);
  let x = box.x;
  if (opts.align === "center") x = box.x + (box.w - width) / 2;
  else if (opts.align === "right") x = box.x + box.w - width;
  const y = box.y + Math.max(0, (box.h - size) / 2);
  page.drawText(text, { x, y, size, font, color: rgb(...opts.color) });
}
function drawImageBox(page: PDFPage, img: PDFImage, box: { x: number; y: number; w: number; h: number }) {
  page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
}
function drawPhotoPlaceholder(page: PDFPage, font: PDFFont, initials: string, box: { x: number; y: number; w: number; h: number }) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  drawTextInBox(page, font, initials, box, { size: 16, color: GREY, align: "center" });
}

async function embedPngFromStorage(pdfDoc: PDFDocument, adminClient: AuthContext["adminClient"], bucket: string, path: string): Promise<PDFImage | null> {
  try {
    const { data: blob, error } = await adminClient.storage.from(bucket).download(path);
    if (error || !blob) return null;
    return await pdfDoc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "hr_officer"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`issue-staff-id:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    const { data: employee } = await ctx.userClient.from("employees")
      .select("id, tenant_id, full_name, employee_no, job_title, department, campus, photo_path, hire_date, employee_type")
      .eq("id", parsed.data.employee_id).maybeSingle();
    if (!employee) return errors.badRequest();

    const { data: tenant } = await ctx.userClient.from("tenants").select("name").eq("id", employee.tenant_id).maybeSingle();
    const { data: emergency } = await ctx.userClient.from("employee_emergency_contacts")
      .select("full_name, relationship, phone").eq("employee_id", employee.id).maybeSingle();

    const verifyCode = generateVerifyCode();
    const issuedDate = new Date().toISOString().slice(0, 10);
    const roleLabel = employee.job_title || employee.department || employee.employee_type;
    const emergencyLine = emergency
      ? `${emergency.relationship ?? "Contact"}: ${emergency.phone ?? "-"}`
      : "On file at school office";

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const photoImg = employee.photo_path ? await embedPngFromStorage(pdfDoc, ctx.adminClient, "avatars", employee.photo_path) : null;

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    let qrImg: PDFImage | null = null;
    try {
      const qrDataUrl = await qrToDataURL(`${appUrl}/verify/${verifyCode}`, { margin: 1, width: 240 });
      qrImg = await pdfDoc.embedPng(Uint8Array.from(atob(qrDataUrl.split(",")[1]), (c) => c.charCodeAt(0)));
    } catch {
      qrImg = null;
    }

    // ---------- front ----------------------------------------------------------
    const front = pdfDoc.addPage([W, H]);
    front.drawRectangle({ x: 0, y: H - 20, width: W, height: 20, color: rgb(...NAVY) });
    front.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: rgb(...NAVY) });
    drawTextInBox(front, boldFont, tenant?.name ?? "School", { x: 8, y: H - 18, w: 160, h: 12 }, { size: 8, color: [1, 1, 1] });
    drawTextInBox(front, boldFont, "STAFF ID", { x: W - 68, y: H - 18, w: 60, h: 10 }, { size: 6, color: [1, 1, 1], align: "right" });

    const photoBox = { x: 10, y: H - 91, w: 55, h: 65 };
    if (photoImg) drawImageBox(front, photoImg, photoBox);
    else drawPhotoPlaceholder(front, boldFont, initialsFor(employee.full_name), photoBox);

    drawTextInBox(front, boldFont, employee.full_name, { x: 72, y: H - 44, w: 165, h: 14 }, { size: 11, color: BLACK });
    drawTextInBox(front, font, roleLabel ?? "-", { x: 72, y: H - 57, w: 165, h: 10 }, { size: 7, color: GREY });
    drawTextInBox(front, font, `Staff No: ${employee.employee_no}`, { x: 72, y: H - 68, w: 165, h: 10 }, { size: 7, color: GREY });
    if (employee.campus) drawTextInBox(front, font, employee.campus, { x: 72, y: H - 79, w: 165, h: 10 }, { size: 7, color: GREY });
    drawTextInBox(front, font, "Valid for the current academic year", { x: 8, y: 10, w: 220, h: 10 }, { size: 6, color: GREY });

    // ---------- back -------------------------------------------------------------
    const back = pdfDoc.addPage([W, H]);
    back.drawRectangle({ x: 0, y: H - 20, width: W, height: 20, color: rgb(...NAVY) });
    drawTextInBox(back, boldFont, "Emergency Contact", { x: 8, y: H - 18, w: 220, h: 12 }, { size: 8, color: [1, 1, 1] });
    drawTextInBox(back, font, emergencyLine, { x: 8, y: H - 40, w: 220, h: 12 }, { size: 8, color: BLACK });
    drawTextInBox(back, font, "Verification code", { x: 8, y: H - 58, w: 150, h: 8 }, { size: 6, color: GREY });
    drawTextInBox(back, font, verifyCode, { x: 8, y: H - 68, w: 150, h: 10 }, { size: 6, color: BLACK });
    if (qrImg) drawImageBox(back, qrImg, { x: 173, y: 20, w: 60, h: 60 });
    drawTextInBox(back, font, `Issued: ${issuedDate} (GC)`, { x: 8, y: 22, w: 150, h: 10 }, { size: 6, color: GREY });
    drawTextInBox(back, font, "Property of the school - if found, return to the office.", { x: 8, y: 8, w: 220, h: 10 }, { size: 6, color: GREY });

    const pdfBytes = await pdfDoc.save();
    const path = `${employee.tenant_id}/${employee.id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await ctx.adminClient.storage.from("id-cards").upload(path, pdfBytes, { contentType: "application/pdf" });
    if (upErr) throw upErr;

    const { data: batch, error: batchErr } = await ctx.adminClient.from("id_card_batches")
      .insert({ tenant_id: employee.tenant_id, batch_type: "staff_id", status: "done", created_by: ctx.userId })
      .select("id").single();
    if (batchErr) throw batchErr;

    const { error: cardErr } = await ctx.adminClient.from("id_cards").insert({
      tenant_id: employee.tenant_id, batch_id: batch.id,
      subject_type: "staff", subject_id: employee.id,
      verify_code: verifyCode, pdf_path: path,
    });
    if (cardErr) throw cardErr;

    const { data: signed } = await ctx.adminClient.storage.from("id-cards").createSignedUrl(path, 300);
    return json({ url: signed?.signedUrl, expires_in: 300 }, 201);
  } catch (err) {
    console.error("issue-staff-id failed", { message: (err as Error).message });
    return errors.internal();
  }
});
