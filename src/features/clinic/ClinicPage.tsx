// M-1 fix: clinic notes (complaint/treatment/medication) were write-only —
// nothing in the app ever read them back, and a naive select("*") would now
// throw "permission denied" post-revoke anyway. Detail (with notes) reads
// from the `clinic_visit_detail` view (security_invoker; base-table RLS
// still governs which rows are visible — school_admin only, per §policy).
// LOW fix: replaced ad-hoc toLocaleDateString with the EC-aware <EthDate/>.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { EthDate } from "@/components/EthDate";

export function ClinicPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [complaint, setComplaint] = useState("");
  const [treatment, setTreatment] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: students } = useQuery({ queryKey: ["students-brief"], queryFn: async () => (await supabase.from("students").select("id,first_name,last_name")).data ?? [] });
  const { data: visits } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clinic_visits")
        .select("id, visit_date, guardian_notified, students(first_name,last_name)")
        .order("visit_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { data: detail } = useQuery({
    queryKey: ["clinic-detail", expanded],
    enabled: !!expanded,
    queryFn: async () => {
      const { data, error } = await supabase.from("clinic_visit_detail")
        .select("complaint, treatment, medication").eq("id", expanded).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("clinic_visits").insert({
        tenant_id: profile!.tenant_id, student_id: studentId, complaint, treatment, recorded_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["clinic"] }); setOpen(false); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Clinic</h1>
        <Button onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "Log visit"}</Button>
      </div>
      {open && (
        <Card className="max-w-xl space-y-3">
          <Field label="Student">
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-card border border-line px-3 py-2 text-sm">
              <option value="">—</option>
              {students?.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </Field>
          <Field label="Complaint">
            <textarea value={complaint} onChange={(e) => setComplaint(e.target.value)} maxLength={500} rows={2}
              className="w-full rounded-card border border-line px-3 py-2 text-sm" />
          </Field>
          <Field label="Treatment given">
            <textarea value={treatment} onChange={(e) => setTreatment(e.target.value)} maxLength={1000} rows={2}
              className="w-full rounded-card border border-line px-3 py-2 text-sm" />
          </Field>
          <Button onClick={() => create.mutate()} disabled={!studentId || !complaint}>Save</Button>
        </Card>
      )}
      <div className="space-y-2">
        {visits?.map((v) => (
          <Card key={v.id} className="text-sm">
            <button
              onClick={() => setExpanded((cur) => (cur === v.id ? null : v.id))}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="font-medium">{(v.students as any)?.first_name} {(v.students as any)?.last_name}</span>
              <span className="text-ink-faint"><EthDate value={v.visit_date.slice(0, 10)} /></span>
            </button>
            {expanded === v.id && detail && (
              <div className="mt-3 space-y-1 border-t border-line pt-3 text-ink-faint">
                <p><span className="font-medium text-ink">Complaint:</span> {detail.complaint || "—"}</p>
                <p><span className="font-medium text-ink">Treatment:</span> {detail.treatment || "—"}</p>
                <p><span className="font-medium text-ink">Medication:</span> {detail.medication || "—"}</p>
              </div>
            )}
          </Card>
        ))}
      </div>
      <p className="text-xs text-ink-faint">🔒 Medical details are restricted — visible to school administrators only.</p>
    </div>
  );
}
