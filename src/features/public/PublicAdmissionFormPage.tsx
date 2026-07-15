// [INSA §5 PUBLIC] Anonymous submissions never write to admission_applications
// directly — RLS has no anon policy on that table. Real deployments POST this
// to a dedicated `submit-admission` Edge Function (Zod + rate-limit + CAPTCHA);
// this page is wired for that contract.
import { useState } from "react";
import { useParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";

const schema = z.object({
  applicant_name: z.string().trim().min(1).max(120),
  guardian_name: z.string().trim().min(1).max(120),
  guardian_phone: z.string().regex(/^\+?[0-9]{7,15}$/),
  guardian_email: z.string().email().optional().or(z.literal("")),
});

export function PublicAdmissionFormPage() {
  const { tenantSlug } = useParams();
  const [dob, setDob] = useState<Date | null>(null);
  const [form, setForm] = useState({ applicant_name: "", guardian_name: "", guardian_phone: "", guardian_email: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success || !dob) { setStatus("error"); return; }
    setStatus("sending");
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-admission`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_slug: tenantSlug, ...parsed.data, date_of_birth: toIsoDate(dob) }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch { setStatus("error"); }
  };

  if (status === "sent") return <div className="flex min-h-screen items-center justify-center"><Card className="max-w-md text-center">Application received. We'll be in touch.</Card></div>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-chalk px-4">
      <Card className="w-full max-w-md">
        <h1 className="mb-4 font-display text-xl font-bold">Admission application</h1>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Applicant name">
            <Input required maxLength={120} value={form.applicant_name}
              onChange={(e) => setForm({ ...form, applicant_name: e.target.value })} />
          </Field>
          <Field label="Date of birth"><EthDatePicker value={dob} onChange={setDob} /></Field>
          <Field label="Guardian name">
            <Input required maxLength={120} value={form.guardian_name}
              onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} />
          </Field>
          <Field label="Guardian phone">
            <Input required maxLength={15} value={form.guardian_phone}
              onChange={(e) => setForm({ ...form, guardian_phone: e.target.value })} />
          </Field>
          {status === "error" && <p className="text-sm text-danger">Please check the form and try again.</p>}
          <Button type="submit" disabled={status === "sending"} className="w-full justify-center">
            {status === "sending" ? "Sending…" : "Submit application"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
