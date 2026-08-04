import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { toIsoDate } from "@/lib/ethiopian-date";

interface Item {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  reorder_level: number;
}
type ItemForm = { name: string; sku: string; unit: string; reorder: string };
const emptyItem: ItemForm = { name: "", sku: "", unit: "unit", reorder: "0" };

export function InventoryPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ItemForm>(emptyItem);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState<ItemForm>(emptyItem);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [moveForm, setMoveForm] = useState({ type: "in", qty: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: itemsData } = useQuery({
    queryKey: ["inventory_items", page],
    queryFn: async () => {
      const [from, to] = pageRange(page);
      const { data, error, count } = await supabase.from("inventory_items")
        .select("id,name,sku,unit,reorder_level", { count: "exact" }).order("name").range(from, to);
      if (error) throw error;
      return { rows: (data ?? []) as Item[], count: count ?? 0 };
    },
  });
  const data = itemsData?.rows;

  const itemPayload = (f: ItemForm) => ({ name: f.name, sku: f.sku || null, unit: f.unit || "unit", reorder_level: Number(f.reorder || 0) });

  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("inventory_items").insert({ tenant_id: profile!.tenant_id, ...itemPayload(form) }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory_items"] }); setShowCreate(false); setForm(emptyItem); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("inventory_items").update(itemPayload(editForm)).eq("id", editing!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory_items"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("inventory_items").delete().eq("id", deleting!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory_items"] }); setDeleting(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const move = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("inventory_movements").insert({
        tenant_id: profile!.tenant_id, item_id: moving!.id, movement_type: moveForm.type,
        quantity: Number(moveForm.qty), movement_date: toIsoDate(new Date()), recorded_by: profile!.id, notes: moveForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { setMoving(null); setMoveForm({ type: "in", qty: "", notes: "" }); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const openEdit = (it: Item) => { setEditing(it); setEditForm({ name: it.name, sku: it.sku ?? "", unit: it.unit, reorder: String(it.reorder_level) }); };

  const itemFields = (f: ItemForm, set: (f: ItemForm) => void) => (
    <div className="space-y-3">
      <Field label={t("common.name")}><Input value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder={t("modules.markerExample")} /></Field>
      <Field label={t("modules.sku")}><Input value={f.sku} onChange={(e) => set({ ...f, sku: e.target.value.toUpperCase() })} placeholder="MKR-01" /></Field>
      <Field label={t("modules.unit")}><Input value={f.unit} onChange={(e) => set({ ...f, unit: e.target.value })} placeholder="unit" /></Field>
      <Field label={t("modules.reorderLevel")}><Input type="number" min={0} value={f.reorder} onChange={(e) => set({ ...f, reorder: e.target.value })} /></Field>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("nav.inventory")}</h1>
        <Button onClick={() => { setForm(emptyItem); setShowCreate(true); }}>+ {t("modules.addItem")}</Button>
      </div>

      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      {!data?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("noRecordsYet")}</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("common.name")}</th><th className="px-4 py-2">{t("modules.skuShort")}</th><th className="px-4 py-2">{t("modules.unit")}</th><th className="px-4 py-2">{t("modules.reorder")}</th><th className="px-4 py-2"></th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((it) => (
                <tr key={it.id} className="hover:bg-sidebar">
                  <td className="px-4 py-2 font-medium text-ink">{it.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-soft">{it.sku ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-soft">{it.unit}</td>
                  <td className="px-4 py-2 text-ink-soft">{it.reorder_level}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setMoving(it)}>{t("modules.stock")}</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openEdit(it)}>{t("crud.edit")}</Button>
                      <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setDeleting(it)}>{t("crud.delete")}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} totalCount={itemsData?.count ?? 0} onPageChange={setPage} className="px-4" />
        </Panel>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("modules.addInventoryItem")}>
        {itemFields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name || create.isPending}>{t("crud.create")}</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={t("modules.editItem")}>
        {itemFields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => update.mutate()} disabled={!editForm.name || update.isPending}>{t("common.save")}</Button>
        </div>
      </Modal>

      <Modal open={!!moving} onClose={() => setMoving(null)} title={`Stock movement — ${moving?.name ?? ""}`}>
        <div className="space-y-3">
          <Field label={t("crud.type")}>
            <select value={moveForm.type} onChange={(e) => setMoveForm({ ...moveForm, type: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              <option value="in">{t("modules.stockIn")}</option>
              <option value="out">{t("modules.stockOut")}</option>
            </select>
          </Field>
          <Field label={t("modules.quantity")}><Input type="number" min={0} step="0.01" value={moveForm.qty} onChange={(e) => setMoveForm({ ...moveForm, qty: e.target.value })} /></Field>
          <Field label={t("modules.notesOptional")}><Input value={moveForm.notes} onChange={(e) => setMoveForm({ ...moveForm, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setMoving(null)}>{t("common.cancel")}</Button>
          <Button onClick={() => move.mutate()} disabled={!moveForm.qty || Number(moveForm.qty) <= 0 || move.isPending}>{t("common.record")}</Button>
        </div>
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t("modules.deleteItem")}>
        <p className="text-sm text-ink-soft">{t("crud.delete")} <span className="font-medium text-ink">{deleting?.name}</span>?</p>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setDeleting(null)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("crud.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
