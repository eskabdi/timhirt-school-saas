// ============================================================================
// [INSA category: PRIVATE] generate-payslip-pdf
// AuthZ: hr_officer / accountant / school_admin — or the employee themself
// (RLS on the payslip lookup enforces this). Renders EC period labels and
// trilingual line labels; uploads to the private `payslips` bucket at
// {tenant_id}/{ec_year}/{ec_month}/{employee_id}/{uuid}.pdf; returns a 60s
// signed URL. Object names are randomized (INSA secure-upload).
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ payslip_id: z.string().uuid(), locale: z.enum(["en", "am", "om"]).default("en") });

const ETH_MONTHS_AM = ["መስከረም","ጥቅምት","ኅዳር","ታኅሣሥ","ጥር","የካቲት","መጋቢት","ሚያዝያ","ግንቦት","ሰኔ","ሐምሌ","ነሐሴ","ጳጉሜን"];
const ETH_MONTHS_EN = ["Meskerem","Tikimt","Hidar","Tahsas","Tir","Yekatit","Megabit","Miyazya","Ginbot","Sene","Hamle","Nehase","Pagume"];
const ETH_MONTHS_OM = ["Fulbaana","Onkololeessa","Sadaasa","Muddee","Amajjii","Guraandhala","Bitootessa","Ebla","Caamsaa","Waxabajjii","Adoolessa","Hagayya","Qaammee"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req,
      ["hr_officer", "accountant", "school_admin", "teacher", "registrar"]);
    if (ctx instanceof Response) return ctx;
    if (!rateLimit(`payslip:${ctx.userId}`, 20, 60_000)) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    // RLS-scoped lookup: employees see only their own payslips
    const { data: slip } = await ctx.userClient.from("payslips")
      .select(`id, tenant_id, employee_id, gross, income_tax, pension_employee,
               other_deductions, net_pay,
               payroll_runs!inner(ec_year, ec_month),
               payslip_lines(label_i18n, kind, amount)`)
      .eq("id", parsed.data.payslip_id).maybeSingle();
    if (!slip) return errors.badRequest();

    const run = slip.payroll_runs;
    const months = parsed.data.locale === "am" ? ETH_MONTHS_AM
      : parsed.data.locale === "om" ? ETH_MONTHS_OM : ETH_MONTHS_EN;
    const period = `${months[run.ec_month - 1]} ${run.ec_year}`;

    // Minimal deterministic PDF (production: swap for pdf-lib + Ethiopic font embed)
    const linesText = (slip.payslip_lines ?? []).map((l: { label_i18n: Record<string, string>; kind: string; amount: number }) =>
      `${(l.label_i18n?.[parsed.data.locale] ?? l.label_i18n?.en ?? "").slice(0, 40)}  ${l.kind === "deduction" ? "-" : ""}${l.amount} ETB`);
    const content = [`PAYSLIP — ${period}`, "", ...linesText, "", `NET PAY: ${slip.net_pay} ETB`].join("\n");
    const pdf = buildSimplePdf(content);

    const path = `${slip.tenant_id}/${run.ec_year}/${run.ec_month}/${slip.employee_id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await ctx.adminClient.storage.from("payslips")
      .upload(path, pdf, { contentType: "application/pdf" });
    if (upErr) throw upErr;

    await ctx.adminClient.from("payslips").update({ pdf_path: path }).eq("id", slip.id);
    const { data: signed } = await ctx.adminClient.storage.from("payslips")
      .createSignedUrl(path, 60);   // 60s signed URL (INSA)

    return json({ url: signed?.signedUrl, expires_in: 60 }, 200);
  } catch (err) {
    console.error("generate-payslip-pdf failed", { message: (err as Error).message });
    return errors.internal();
  }
});

/** Tiny single-page PDF writer (ASCII-safe body; Ethiopic via font embed in prod). */
function buildSimplePdf(text: string): Uint8Array {
  const safe = text.replace(/[()\\]/g, " ").split("\n")
    .map((l, i) => `BT /F1 11 Tf 40 ${780 - i * 16} Td (${l}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${safe.length} >>\nstream\n${safe}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
