// ============================================================================
// [INSA category: PRIVATE] generate-payslip-pdf
// AuthZ: hr_officer / accountant / school_admin — or the employee themself
// (RLS on the payslip lookup enforces this). Renders EC period labels and
// trilingual line labels; uploads to the private `payslips` bucket at
// {tenant_id}/{ec_year}/{ec_month}/{employee_id}/{uuid}.pdf; returns a 60s
// signed URL. Object names are randomized (INSA secure-upload).
//
// R5-B2: rendered via _shared/payslip-pdf.ts (pdf-lib) rather than the
// hand-rolled byte-string writer this used to carry -- that writer produced
// a bare text page with no letterhead at all, so there was nothing for
// extended branding to apply to.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { loadDocumentBranding } from "../_shared/branding.ts";
import { renderPayslipPdf } from "../_shared/payslip-pdf.ts";

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
    if (!(await rateLimit(`payslip:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

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

    // R5-B2: rendered by pdf-lib via the shared payslip renderer, with a
    // letterhead that carries extended branding when the tenant has the
    // module. Below Standard tier loadDocumentBranding returns UNBRANDED and
    // the letterhead falls back to the plain NAVY bar + raw tenant name.
    const branding = await loadDocumentBranding(ctx.adminClient, slip.tenant_id, { locale: parsed.data.locale });
    const { data: employee } = await ctx.adminClient.from("employees")
      .select("full_name").eq("id", slip.employee_id).maybeSingle();
    const { data: tenantRow } = await ctx.adminClient.from("tenants")
      .select("name").eq("id", slip.tenant_id).maybeSingle();

    const pdf = await renderPayslipPdf({
      tenantName: tenantRow?.name ?? "School",
      branding,
      period,
      employeeName: employee?.full_name ?? "-",
      lines: (slip.payslip_lines ?? []).map((l: { label_i18n: Record<string, string>; kind: string; amount: number }) => ({
        label: l.label_i18n?.[parsed.data.locale] ?? l.label_i18n?.en ?? "",
        kind: l.kind,
        amount: l.amount,
      })),
      netPay: slip.net_pay,
    });

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
