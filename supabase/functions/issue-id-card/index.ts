// ============================================================================
// [INSA category: PRIVATE] issue-id-card
// AuthZ: school_admin / registrar. Renders a print-ready CR-80 (3.375in x
// 2.125in / 243pt x 153pt) two-page PDF -- front, then back -- for a
// student, uploads it to the private `id-cards` bucket, and records it in
// id_cards/id_card_batches (20260713000007_extended_modules.sql).
//
// Uses pdf-lib instead of a hand-rolled writer (both prior PDF generators in
// this codebase flagged that swap as the intended next step) specifically
// because this needs real binary image embedding: the student's actual
// photo (copied from their admission application into student-photos --
// see EnrollStudentModal) and a real scannable QR code for the
// verification link, not the text-only placeholders the previous version
// shipped with. Falls back cleanly (initials box) when no photo exists.
//
// A tenant can replace the whole look via tenant_configs.settings.
// idCardTemplate -- a background image plus freely positioned fields per
// side, built with the Template Designer (Settings). No template configured
// for a side just means DEFAULT_FRONT/DEFAULT_BACK render instead: same
// renderer, same field vocabulary, different starting data. Ethiopic text
// still isn't supported (Helvetica has no such glyphs, and pdf-lib throws
// rather than silently dropping unencodable characters) -- every string
// drawn on the card is stripped to printable ASCII first.
// ============================================================================
import { z } from "npm:zod@3";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type PDFImage } from "npm:pdf-lib@1";
import fontkit from "npm:@pdf-lib/fontkit@1";
import { toDataURL as qrToDataURL } from "npm:qrcode@1";
import bwipjs from "npm:bwip-js@4";
import { requireRole, errors, json, rateLimit, corsHeaders, type AuthContext } from "../_shared/security.ts";

const Payload = z.object({ student_id: z.string().uuid() });

const W = 243, H = 153; // CR-80 landscape, points
const NAVY: [number, number, number] = [0.118, 0.165, 0.439]; // #1E2A70 -- design system default
const BLACK: [number, number, number] = [0, 0, 0];
const GREY: [number, number, number] = [0.45, 0.45, 0.45];

type FieldKey =
  | "photo" | "full_name" | "full_name_am" | "admission_no" | "class_label" | "dob"
  | "tenant_name" | "issued_date" | "guardian_contact" | "verify_code"
  | "qr_code" | "barcode" | "static_text";

interface FieldPlacement {
  id: string;
  field_key: FieldKey;
  x: number; y: number; w: number; h: number; // top-left origin, points, 243x153 card space
  fontSize?: number;
  color?: string;   // hex, text fields only
  align?: "left" | "center" | "right";
  bold?: boolean;
  text?: string;    // static_text only
  fontFamily?: string; // "default" (Helvetica) | "NotoSerifEthiopic" | "Tayitu" | "Jiret"
  rotation?: 0 | 90 | 180 | 270; // barcode only, degrees counter-clockwise
}

// Uploaded Ethiopic/Latin fonts, served from the deployed frontend's /public.
// Fetched + subset-embedded per document only when a field actually uses them.
const FONT_URLS: Record<string, string> = {
  NotoSerifEthiopic: "/fonts/NotoSerifEthiopic-Regular.ttf",
  Tayitu: "/fonts/Tayitu.ttf",
  Jiret: "/fonts/Jiret.ttf",
};
const fontByteCache: Record<string, Uint8Array | null> = {};
async function loadFontBytes(appUrl: string, key: string): Promise<Uint8Array | null> {
  if (key in fontByteCache) return fontByteCache[key];
  try {
    const res = await fetch(`${appUrl}${FONT_URLS[key]}`);
    if (!res.ok) throw new Error(`font ${key} ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    fontByteCache[key] = bytes;
    return bytes;
  } catch {
    fontByteCache[key] = null;
    return null;
  }
}
interface CardSideTemplate { backgroundPath: string | null; fields: FieldPlacement[] }
interface IdCardTemplate { front?: CardSideTemplate; back?: CardSideTemplate }

interface CardData {
  tenantName: string; fullName: string; fullNameAm: string; admissionNo: string; classLabel: string;
  dob: string; issuedDate: string; guardianContact: string; verifyCode: string;
}

const DEFAULT_FRONT: CardSideTemplate = {
  backgroundPath: null,
  fields: [
    { id: "d1", field_key: "tenant_name", x: 8, y: 4, w: 160, h: 12, fontSize: 8, bold: true, color: "#FFFFFF" },
    { id: "d2", field_key: "static_text", text: "STUDENT ID", x: 175, y: 4, w: 60, h: 10, fontSize: 6, bold: true, color: "#FFFFFF", align: "right" },
    { id: "d3", field_key: "photo", x: 10, y: 26, w: 55, h: 65 },
    { id: "d4", field_key: "full_name", x: 72, y: 30, w: 165, h: 14, fontSize: 11, bold: true, color: "#000000" },
    { id: "d5", field_key: "admission_no", x: 72, y: 46, w: 165, h: 10, fontSize: 7, color: "#737373" },
    { id: "d6", field_key: "class_label", x: 72, y: 57, w: 165, h: 10, fontSize: 7, color: "#737373" },
    { id: "d7", field_key: "dob", x: 72, y: 68, w: 165, h: 10, fontSize: 7, color: "#737373" },
    { id: "d8", field_key: "static_text", text: "Valid for the current academic year", x: 8, y: 133, w: 220, h: 10, fontSize: 6, color: "#737373" },
  ],
};
const DEFAULT_BACK: CardSideTemplate = {
  backgroundPath: null,
  fields: [
    { id: "d1", field_key: "static_text", text: "Emergency / Guardian Contact", x: 8, y: 4, w: 220, h: 12, fontSize: 8, bold: true, color: "#FFFFFF" },
    { id: "d2", field_key: "guardian_contact", x: 8, y: 26, w: 220, h: 12, fontSize: 8, color: "#000000" },
    { id: "d3", field_key: "static_text", text: "Verification code", x: 8, y: 44, w: 220, h: 8, fontSize: 6, color: "#737373" },
    { id: "d4", field_key: "verify_code", x: 8, y: 54, w: 220, h: 10, fontSize: 7, color: "#000000" },
    { id: "d5", field_key: "qr_code", x: 173, y: 68, w: 60, h: 60 },
    { id: "d6", field_key: "issued_date", x: 8, y: 118, w: 150, h: 10, fontSize: 6, color: "#737373" },
    { id: "d7", field_key: "static_text", text: "Property of the school - if found, return to the office.", x: 8, y: 133, w: 220, h: 10, fontSize: 6, color: "#737373" },
  ],
};

function hexToRgb01(hex: string | null | undefined, fallback: [number, number, number] = BLACK): [number, number, number] {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
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
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); // 48 hex chars
}

function resolveFieldValue(key: FieldKey, data: CardData, customText?: string): string {
  switch (key) {
    case "full_name": return data.fullName;
    case "full_name_am": return data.fullNameAm;
    case "admission_no": return `Student No: ${data.admissionNo}`;
    case "class_label": return `Class: ${data.classLabel}`;
    case "dob": return `DOB (GC): ${data.dob}`;
    case "tenant_name": return data.tenantName;
    case "issued_date": return `Issued: ${data.issuedDate} (GC)`;
    case "guardian_contact": return data.guardianContact;
    case "verify_code": return data.verifyCode;
    case "static_text": return customText ?? "";
    default: return "";
  }
}

/** Draws left/center/right-aligned, vertically-centered single-line text
 *  clipped (by truncation, not real clipping) to stay inside its box. */
function drawTextInBox(page: PDFPage, font: PDFFont, raw: string, box: { x: number; y: number; w: number; h: number }, opts: { size: number; color: [number, number, number]; align?: "left" | "center" | "right"; allowUnicode?: boolean }) {
  const size = opts.size;
  // Helvetica has no Ethiopic glyphs and pdf-lib throws on them, so the default
  // path strips to ASCII. A custom embedded font (Noto/Tayitu/Jiret) does have
  // them — keep the raw text (incl. Amharic) in that case.
  let text = opts.allowUnicode ? raw : asciiOnly(raw);
  const maxChars = Math.max(1, Math.floor(box.w / (size * 0.55)));
  if (text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - 1)) + ".";
  const width = font.widthOfTextAtSize(text, size);
  let x = box.x;
  if (opts.align === "center") x = box.x + (box.w - width) / 2;
  else if (opts.align === "right") x = box.x + box.w - width;
  const y = box.y + Math.max(0, (box.h - size) / 2);
  page.drawText(text, { x, y, size, font, color: rgb(...opts.color) });
}

/** Photo/QR boxes are stretched to fit their box rather than cropped to the
 *  source aspect ratio -- pdf-lib clipping paths are real API surface this
 *  function doesn't need to risk getting wrong for a placeholder-vs-photo
 *  cosmetic difference; a slightly stretched photo beats a broken card. */
function drawImageBox(page: PDFPage, img: PDFImage, box: { x: number; y: number; w: number; h: number }) {
  page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
}

/** Same fill-the-box contract as drawImageBox, but for artwork the template
 *  rotates (barcodes, so a card can carry a vertical spine code).
 *
 *  pdf-lib rotates counter-clockwise about the draw origin (x, y) rather than
 *  about the image's centre, so the origin and the draw width/height have to
 *  be restated per quarter-turn for the result to still land inside `box`.
 *  At 90/270 the drawn width runs along the box's height, hence the swap. */
function drawImageBoxRotated(
  page: PDFPage, img: PDFImage,
  box: { x: number; y: number; w: number; h: number },
  rotation: 0 | 90 | 180 | 270,
) {
  const { x, y, w, h } = box;
  switch (rotation) {
    case 90:
      page.drawImage(img, { x: x + w, y, width: h, height: w, rotate: degrees(90) });
      return;
    case 180:
      page.drawImage(img, { x: x + w, y: y + h, width: w, height: h, rotate: degrees(180) });
      return;
    case 270:
      page.drawImage(img, { x, y: y + h, width: h, height: w, rotate: degrees(270) });
      return;
    default:
      page.drawImage(img, { x, y, width: w, height: h });
  }
}
function drawPhotoPlaceholder(page: PDFPage, font: PDFFont, initials: string, box: { x: number; y: number; w: number; h: number }) {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 });
  drawTextInBox(page, font, initials, box, { size: 16, color: GREY, align: "center" });
}

function renderSide(
  page: PDFPage, font: PDFFont, boldFont: PDFFont,
  template: CardSideTemplate, data: CardData, brandColor: [number, number, number],
  avatarImg: PDFImage | null, qrImg: PDFImage | null, backgroundImg: PDFImage | null,
  barcodeImg: PDFImage | null, customFonts: Record<string, PDFFont>,
) {
  if (backgroundImg) {
    page.drawImage(backgroundImg, { x: 0, y: 0, width: W, height: H });
  } else {
    page.drawRectangle({ x: 0, y: H - 20, width: W, height: 20, color: rgb(...brandColor) });
    page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: rgb(...brandColor) });
  }

  for (const f of template.fields) {
    const box = { x: f.x, y: H - f.y - f.h, w: f.w, h: f.h }; // top-left stored coords -> PDF bottom-left

    if (f.field_key === "photo") {
      if (avatarImg) drawImageBox(page, avatarImg, box);
      else drawPhotoPlaceholder(page, boldFont, initialsFor(data.fullName), box);
      continue;
    }
    if (f.field_key === "qr_code") {
      if (qrImg) drawImageBox(page, qrImg, box);
      continue;
    }
    if (f.field_key === "barcode") {
      if (barcodeImg) drawImageBoxRotated(page, barcodeImg, box, f.rotation ?? 0);
      continue;
    }

    const value = resolveFieldValue(f.field_key, data, f.text);
    if (!value) continue;
    const custom = f.fontFamily && f.fontFamily !== "default" ? customFonts[f.fontFamily] : undefined;
    drawTextInBox(page, custom ?? (f.bold ? boldFont : font), value, box, {
      size: f.fontSize ?? 7,
      color: hexToRgb01(f.color, BLACK),
      align: f.align ?? "left",
      allowUnicode: !!custom,
    });
  }
}

async function embedPngFromStorage(pdfDoc: PDFDocument, adminClient: AuthContext["adminClient"], bucket: string, path: string): Promise<PDFImage | null> {
  try {
    const { data: blob, error } = await adminClient.storage.from(bucket).download(path);
    if (error || !blob) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return await pdfDoc.embedPng(bytes);
  } catch {
    return null;
  }
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
      .select("id, tenant_id, first_name, middle_name, last_name, first_name_am, middle_name_am, last_name_am, admission_no, date_of_birth, avatar_path, class:classes(name, section)")
      .eq("id", parsed.data.student_id).maybeSingle();
    if (!student) return errors.badRequest();

    const { data: tenant } = await ctx.userClient.from("tenants").select("name").eq("id", student.tenant_id).maybeSingle();
    const { data: tenantConfig } = await ctx.userClient.from("tenant_configs")
      .select("settings").eq("tenant_id", student.tenant_id).maybeSingle();
    const { data: guardian } = await ctx.userClient.from("guardians")
      .select("relationship, phone").eq("student_id", student.id).limit(1).maybeSingle();

    const template = (tenantConfig?.settings?.idCardTemplate ?? {}) as IdCardTemplate;
    const frontTemplate = template.front && (template.front.backgroundPath || template.front.fields.length) ? template.front : DEFAULT_FRONT;
    const backTemplate = template.back && (template.back.backgroundPath || template.back.fields.length) ? template.back : DEFAULT_BACK;
    const brandColor = hexToRgb01(tenantConfig?.settings?.branding?.primaryColor, NAVY);

    const data: CardData = {
      tenantName: tenant?.name ?? "School",
      fullName: [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ") || "Student",
      fullNameAm: [student.first_name_am, student.middle_name_am, student.last_name_am].filter(Boolean).join(" "),
      admissionNo: student.admission_no,
      classLabel: student.class ? `${student.class.name} ${student.class.section ?? ""}`.trim() : "-",
      dob: student.date_of_birth,
      issuedDate: new Date().toISOString().slice(0, 10),
      guardianContact: guardian ? `${guardian.relationship ?? "Guardian"}: ${guardian.phone ?? "-"}` : "On file at school office",
      verifyCode: generateVerifyCode(),
    };

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const avatarImg = student.avatar_path ? await embedPngFromStorage(pdfDoc, ctx.adminClient, "student-photos", student.avatar_path) : null;

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    let qrImg: PDFImage | null = null;
    try {
      const qrDataUrl = await qrToDataURL(`${appUrl}/verify/${data.verifyCode}`, { margin: 1, width: 240 });
      const qrBytes = Uint8Array.from(atob(qrDataUrl.split(",")[1]), (c) => c.charCodeAt(0));
      qrImg = await pdfDoc.embedPng(qrBytes);
    } catch {
      qrImg = null;
    }

    // Code128 barcode of the student number (admission no). Independent of the
    // QR block above — nothing there changes. Rendered only where a school has
    // placed a "barcode" field via the template designer.
    let barcodeImg: PDFImage | null = null;
    try {
      const png = await bwipjs.toBuffer({ bcid: "code128", text: data.admissionNo, scale: 3, height: 8, includetext: false, paddingwidth: 2, paddingheight: 2, backgroundcolor: "FFFFFF" });
      barcodeImg = await pdfDoc.embedPng(new Uint8Array(png));
    } catch {
      barcodeImg = null;
    }

    const frontBg = frontTemplate.backgroundPath ? await embedPngFromStorage(pdfDoc, ctx.adminClient, "id-card-templates", frontTemplate.backgroundPath) : null;
    const backBg = backTemplate.backgroundPath ? await embedPngFromStorage(pdfDoc, ctx.adminClient, "id-card-templates", backTemplate.backgroundPath) : null;

    // Embed only the custom fonts a field actually uses (Noto/Tayitu/Jiret),
    // so text placed with an Amharic/English font renders in that face. Failures
    // (font unreachable, subset error) fall back to Helvetica per field.
    const customFonts: Record<string, PDFFont> = {};
    const usedFonts = new Set<string>();
    for (const s of [frontTemplate, backTemplate]) {
      for (const f of s.fields) {
        if (f.fontFamily && f.fontFamily !== "default" && FONT_URLS[f.fontFamily]) usedFonts.add(f.fontFamily);
      }
    }
    if (usedFonts.size) {
      pdfDoc.registerFontkit(fontkit);
      for (const key of usedFonts) {
        const bytes = await loadFontBytes(appUrl, key);
        if (!bytes) continue;
        try { customFonts[key] = await pdfDoc.embedFont(bytes, { subset: true }); } catch { /* keep Helvetica fallback */ }
      }
    }

    const frontPage = pdfDoc.addPage([W, H]);
    renderSide(frontPage, font, boldFont, frontTemplate, data, brandColor, avatarImg, null, frontBg, barcodeImg, customFonts);
    const backPage = pdfDoc.addPage([W, H]);
    renderSide(backPage, font, boldFont, backTemplate, data, brandColor, null, qrImg, backBg, barcodeImg, customFonts);

    const pdfBytes = await pdfDoc.save();
    const path = `${student.tenant_id}/${student.id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await ctx.adminClient.storage.from("id-cards").upload(path, pdfBytes, { contentType: "application/pdf" });
    if (upErr) throw upErr;

    const { data: batch, error: batchErr } = await ctx.adminClient.from("id_card_batches")
      .insert({ tenant_id: student.tenant_id, batch_type: "student_id", status: "done", created_by: ctx.userId })
      .select("id").single();
    if (batchErr) throw batchErr;

    const { error: cardErr } = await ctx.adminClient.from("id_cards").insert({
      tenant_id: student.tenant_id, batch_id: batch.id,
      subject_type: "student", subject_id: student.id,
      verify_code: data.verifyCode, pdf_path: path,
    });
    if (cardErr) throw cardErr;

    const { data: signed } = await ctx.adminClient.storage.from("id-cards").createSignedUrl(path, 300);
    return json({ url: signed?.signedUrl, expires_in: 300 }, 201);
  } catch (err) {
    console.error("issue-id-card failed", { message: (err as Error).message });
    return errors.internal();
  }
});
