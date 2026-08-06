// Shared "assign a section + optionally pick a fee structure" data for
// enrollment. Was duplicated (sections query) between EnrollStudentModal and
// AdmissionReviewModal, and the fee-structure picker existed only in
// EnrollStudentModal -- AdmissionReviewModal's status-dropdown enrollment
// path never created an invoice at all. One hook now backs both.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useEnrollTargets(tenantId: string | undefined, desiredGrade: string | null | undefined, classId: string) {
  const { data: sections } = useQuery({
    queryKey: ["admission-enroll-sections", tenantId, desiredGrade],
    enabled: !!tenantId && !!desiredGrade,
    queryFn: async () => {
      const { data: classes, error: classesErr } = await supabase.from("classes")
        .select("id, name, section, capacity")
        .eq("tenant_id", tenantId!)
        .eq("name", desiredGrade!);
      if (classesErr) throw classesErr;
      const ids = (classes ?? []).map((c) => c.id);
      const { data: active, error: studentsErr } = ids.length
        ? await supabase.from("students").select("class_id").eq("status", "active").in("class_id", ids)
        : { data: [], error: null };
      if (studentsErr) throw studentsErr;
      const counts = new Map<string, number>();
      for (const s of active ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
      return (classes ?? []).map((c) => ({ ...c, enrolled: counts.get(c.id) ?? 0 }));
    },
  });

  const { data: feeStructures } = useQuery({
    queryKey: ["admission-enroll-fee-structures", tenantId, classId],
    enabled: !!tenantId && !!classId,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("fee_structures")
        .select("id, name_i18n, amount, billing_cycle")
        .eq("tenant_id", tenantId!)
        .or(`class_id.eq.${classId},class_id.is.null`);
      if (err) throw err;
      return data ?? [];
    },
  });

  return { sections, feeStructures };
}
