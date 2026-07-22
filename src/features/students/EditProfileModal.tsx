import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDERS = ["male", "female", "other"];

interface StudentLike {
  id: string; first_name: string; middle_name: string | null; last_name: string;
  date_of_birth: string; gender: string; primary_language: string | null;
  blood_type: string | null; roll_number: string | null; admission_date: string | null;
}

// Edits ONLY the Personal Info tab's student-owned fields. Section / homeroom
// live on the class and are managed elsewhere, so they're not here.
export function EditProfileModal({ student, open, onClose }: { student: StudentLike; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    first_name: student.first_name, middle_name: student.middle_name ?? "", last_name: student.last_name,
    dob: student.date_of_birth ? new Date(student.date_of_birth + "T00:00:00Z") : null as Date | null,
    gender: student.gender, primary_language: student.primary_language ?? "",
    blood_type: student.blood_type ?? "", roll_number: student.roll_number ?? "",
    admission_date: student.admission_date ? new Date(student.admission_date + "T00:00:00Z") : null as Date | null,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("students").update({
        first_name: f.first_name, middle_name: f.middle_name || null, last_name: f.last_name,
        date_of_birth: f.dob ? toIsoDate(f.dob) : student.date_of_birth,
        gender: f.gender, primary_language: f.primary_language || null,
        blood_type: f.blood_type || null, roll_number: f.roll_number || null,
        admission_date: f.admission_date ? toIsoDate(f.admission_date) : null,
      }).eq("id", student.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["student-profile"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to save"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile — Personal Info" size="lg">
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="First name"><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
        <Field label="Middle name"><Input value={f.middle_name} onChange={(e) => setF({ ...f, middle_name: e.target.value })} /></Field>
        <Field label="Last name"><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
        <Field label="Gender">
          <select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink capitalize">
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Date of Birth"><EthDatePicker value={f.dob} onChange={(d) => setF({ ...f, dob: d })} /></Field>
        <Field label="Admission Date"><EthDatePicker value={f.admission_date} onChange={(d) => setF({ ...f, admission_date: d })} /></Field>
        <Field label="Primary Language"><Input value={f.primary_language} onChange={(e) => setF({ ...f, primary_language: e.target.value })} placeholder="Amharic" /></Field>
        <Field label="Blood Type">
          <select value={f.blood_type} onChange={(e) => setF({ ...f, blood_type: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            {BLOOD.map((b) => <option key={b} value={b}>{b || "—"}</option>)}
          </select>
        </Field>
        <Field label="Roll Number"><Input value={f.roll_number} onChange={(e) => setF({ ...f, roll_number: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!f.first_name || !f.last_name || save.isPending}>Save changes</Button>
      </div>
    </Modal>
  );
}
