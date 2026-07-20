import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

interface Route { id: string; name: string; vehicle_no: string | null; driver_name: string | null; }
type RouteForm = { name: string; vehicle: string; driver: string };
const emptyRoute: RouteForm = { name: "", vehicle: "", driver: "" };

export function TransportPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<RouteForm>(emptyRoute);
  const [editing, setEditing] = useState<Route | null>(null);
  const [editForm, setEditForm] = useState<RouteForm>(emptyRoute);
  const [deleting, setDeleting] = useState<Route | null>(null);
  const [assigning, setAssigning] = useState<Route | null>(null);
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: routes } = useQuery({
    queryKey: ["transport_routes"],
    queryFn: async () => ((await supabase.from("transport_routes").select("id,name,vehicle_no,driver_name").order("name")).data ?? []) as Route[],
  });
  const { data: students } = useQuery({
    queryKey: ["transport_students"],
    queryFn: async () => (await supabase.from("students").select("id,first_name,last_name").eq("status", "active").order("first_name")).data ?? [],
  });
  const { data: assignCounts } = useQuery({
    queryKey: ["transport_assign_counts"],
    queryFn: async () => {
      const { data } = await supabase.from("student_route_assignments").select("route_id");
      const m = new Map<string, number>();
      for (const a of data ?? []) m.set(a.route_id, (m.get(a.route_id) ?? 0) + 1);
      return m;
    },
  });

  const payload = (f: RouteForm) => ({ name: f.name, vehicle_no: f.vehicle || null, driver_name: f.driver || null });

  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("transport_routes").insert({ tenant_id: profile!.tenant_id, ...payload(form) }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_routes"] }); setShowCreate(false); setForm(emptyRoute); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("transport_routes").update(payload(editForm)).eq("id", editing!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_routes"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("transport_routes").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_routes"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const assign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("student_route_assignments")
        .upsert({ tenant_id: profile!.tenant_id, student_id: studentId, route_id: assigning!.id }, { onConflict: "tenant_id,student_id" });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["transport_assign_counts"] }); setAssigning(null); setStudentId(""); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const openEdit = (r: Route) => { setEditing(r); setEditForm({ name: r.name, vehicle: r.vehicle_no ?? "", driver: r.driver_name ?? "" }); };

  const fields = (f: RouteForm, set: (f: RouteForm) => void) => (
    <div className="space-y-3">
      <Field label="Route name"><Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder="Route A — Bole" /></Field>
      <Field label="Vehicle no."><Input value={f.vehicle} onChange={(e) => set({ ...f, vehicle: e.target.value })} placeholder="AA-12345" /></Field>
      <Field label="Driver name"><Input value={f.driver} onChange={(e) => set({ ...f, driver: e.target.value })} /></Field>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("nav.transport")}</h1>
        <Button onClick={() => { setForm(emptyRoute); setShowCreate(true); }}>+ Add route</Button>
      </div>

      {error && <Card className="border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <div className="grid gap-3 md:grid-cols-2">
        {routes?.map((r) => (
          <Card key={r.id} className="space-y-2">
            <div>
              <p className="font-medium text-ink">{r.name}</p>
              <p className="text-sm text-ink-faint">
                {r.vehicle_no ?? "—"}{r.driver_name ? ` · ${r.driver_name}` : ""} · {assignCounts?.get(r.id) ?? 0} students
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setStudentId(""); setAssigning(r); }}>Assign student</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(r)}>Edit</Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(r)}>Delete</Button>
            </div>
          </Card>
        ))}
        {!routes?.length && <Card className="py-12 text-center text-ink-faint md:col-span-2">{t("noRecordsYet")}</Card>}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add route">
        {fields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>Create</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit route">
        {fields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={() => update.mutate()} disabled={!editForm.name || update.isPending}>Save</Button>
        </div>
      </Modal>

      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={`Assign student — ${assigning?.name ?? ""}`}>
        <Field label="Student">
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="">Select student</option>
            {students?.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
          </select>
        </Field>
        <p className="mt-2 text-xs text-ink-faint">Re-assigning moves the student to this route.</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setAssigning(null)}>Cancel</Button>
          <Button onClick={() => assign.mutate()} disabled={!studentId || assign.isPending}>Assign</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete route">
        <p className="text-sm text-ink-soft">Delete <span className="font-medium text-ink">{deleting?.name}</span>?</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
