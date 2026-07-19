// ============================================================================
// Drag-and-drop CR-80 ID card template designer. Two independently editable
// sides (front/back), each an optional background image plus freely
// positioned fields. Saved as tenant_configs.settings.idCardTemplate --
// schema-free JSONB, same pattern BrandingPage.tsx already uses for
// settings.branding.primaryColor. issue-id-card reads this exact shape at
// render time; leaving both sides empty (the default, nothing saved yet)
// makes it fall back to its own built-in layout.
//
// Field types are a fixed vocabulary (not free-text bindings) because the
// renderer resolves each one against real student data server-side --
// "Full Name" always means the enrolled student's name, never an arbitrary
// merge field. "Custom Text" is the one type with tenant-authored content,
// for static labels/notices.
//
// This canvas is a plain-DOM approximation (CSS-positioned boxes over the
// background image), not a pdf-lib render -- close enough to place fields
// accurately, but the definitive preview is downloading an actual card.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { convertImageToPng } from "@/lib/image";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type FieldKey =
  | "photo" | "full_name" | "admission_no" | "class_label" | "dob"
  | "tenant_name" | "issued_date" | "guardian_contact" | "verify_code"
  | "qr_code" | "static_text";

interface FieldPlacement {
  id: string;
  field_key: FieldKey;
  x: number; y: number; w: number; h: number;
  fontSize?: number;
  color?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  text?: string;
}
interface CardSideTemplate { backgroundPath: string | null; fields: FieldPlacement[] }
interface TemplateConfig { front: CardSideTemplate; back: CardSideTemplate }

const CARD_W = 243, CARD_H = 153; // points, must match issue-id-card
const SCALE = 3; // on-screen px per point

const FIELD_TYPES: { key: FieldKey; label: string; w: number; h: number; fontSize: number; isImage?: boolean }[] = [
  { key: "photo", label: "Photo", w: 55, h: 65, fontSize: 0, isImage: true },
  { key: "full_name", label: "Full Name", w: 140, h: 14, fontSize: 11 },
  { key: "admission_no", label: "Student No.", w: 140, h: 10, fontSize: 7 },
  { key: "class_label", label: "Class", w: 140, h: 10, fontSize: 7 },
  { key: "dob", label: "Date of Birth", w: 140, h: 10, fontSize: 7 },
  { key: "tenant_name", label: "School Name", w: 140, h: 12, fontSize: 9 },
  { key: "issued_date", label: "Issued Date", w: 140, h: 10, fontSize: 6 },
  { key: "guardian_contact", label: "Guardian Contact", w: 180, h: 12, fontSize: 8 },
  { key: "verify_code", label: "Verification Code", w: 180, h: 10, fontSize: 7 },
  { key: "qr_code", label: "QR Code", w: 60, h: 60, fontSize: 0, isImage: true },
  { key: "static_text", label: "Custom Text", w: 140, h: 10, fontSize: 7 },
];
const FIELD_LABEL: Record<FieldKey, string> = Object.fromEntries(FIELD_TYPES.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

const EMPTY_SIDE: CardSideTemplate = { backgroundPath: null, fields: [] };
const EMPTY_TEMPLATE: TemplateConfig = { front: EMPTY_SIDE, back: EMPTY_SIDE };

function clamp(v: number, min: number, max: number) { return Math.min(Math.max(v, min), max); }

export function IdCardTemplateDesignerPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [side, setSide] = useState<"front" | "back">("front");
  const [template, setTemplate] = useState<TemplateConfig>(EMPTY_TEMPLATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const { data: config } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  useEffect(() => {
    if (config?.settings?.idCardTemplate) {
      setTemplate({
        front: config.settings.idCardTemplate.front ?? EMPTY_SIDE,
        back: config.settings.idCardTemplate.back ?? EMPTY_SIDE,
      });
    }
  }, [config]);

  const current = template[side];

  useEffect(() => {
    let cancelled = false;
    setBgUrl(null);
    if (!current.backgroundPath) return;
    supabase.storage.from("id-card-templates").createSignedUrl(current.backgroundPath, 300).then(({ data }) => {
      if (!cancelled && data?.signedUrl) setBgUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [current.backgroundPath]);

  const updateSide = (fn: (s: CardSideTemplate) => CardSideTemplate) => {
    setTemplate((t) => ({ ...t, [side]: fn(t[side]) }));
  };

  const addField = (type: (typeof FIELD_TYPES)[number]) => {
    const field: FieldPlacement = {
      id: crypto.randomUUID(), field_key: type.key,
      x: 10 + (current.fields.length % 5) * 6, y: 10 + (current.fields.length % 5) * 6,
      w: type.w, h: type.h, fontSize: type.fontSize || undefined,
      color: "#000000", align: "left",
      text: type.key === "static_text" ? "Label" : undefined,
    };
    updateSide((s) => ({ ...s, fields: [...s.fields, field] }));
    setSelectedId(field.id);
  };

  const patchField = (id: string, patch: Partial<FieldPlacement>) => {
    updateSide((s) => ({ ...s, fields: s.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  };
  const removeField = (id: string) => {
    updateSide((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const onFieldMouseDown = (e: React.MouseEvent, field: FieldPlacement) => {
    e.stopPropagation();
    setSelectedId(field.id);
    dragState.current = { id: field.id, startX: e.clientX, startY: e.clientY, origX: field.x, origY: field.y };
  };

  // Listeners attach once (mount) rather than re-attaching on every drag
  // frame. Both `side` and `current.fields` are mirrored into refs so onMove
  // always reads live state instead of closing over the values from mount --
  // otherwise switching Front/Back mid-drag would silently patch whichever
  // side was selected when the listener was first attached.
  const sideRef = useRef(side);
  useEffect(() => { sideRef.current = side; }, [side]);
  const fieldsRef = useRef(current.fields);
  useEffect(() => { fieldsRef.current = current.fields; }, [current.fields]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragState.current;
      if (!drag) return;
      const field = fieldsRef.current.find((f) => f.id === drag.id);
      if (!field) return;
      const dx = (e.clientX - drag.startX) / SCALE;
      const dy = (e.clientY - drag.startY) / SCALE;
      const nx = clamp(drag.origX + dx, 0, CARD_W - field.w);
      const ny = clamp(drag.origY + dy, 0, CARD_H - field.h);
      const s = sideRef.current;
      setTemplate((t) => ({
        ...t,
        [s]: { ...t[s], fields: t[s].fields.map((f) => (f.id === drag.id ? { ...f, x: nx, y: ny } : f)) },
      }));
    };
    const onUp = () => { dragState.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const uploadBackground = async (file: File) => {
    const png = await convertImageToPng(file);
    const path = `${profile!.tenant_id}/${side}/${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage.from("id-card-templates").upload(path, png, { contentType: "image/png" });
    if (error) return;
    updateSide((s) => ({ ...s, backgroundPath: path }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const settings = { ...(config?.settings ?? {}), idCardTemplate: template };
      const { error } = await supabase.from("tenant_configs").upsert({ tenant_id: profile!.tenant_id, settings });
      if (error) throw error;
    },
    onSuccess: () => {
      setSaveMessage("Saved.");
      qc.invalidateQueries({ queryKey: ["tenant-config"] });
      setTimeout(() => setSaveMessage(null), 2000);
    },
  });

  const selectedField = current.fields.find((f) => f.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">ID Card Template</h1>
      <p className="max-w-2xl text-sm text-ink-faint">
        Design the front and back of the printed student ID card. Add fields from the palette, drag them into
        place, and upload a background image for your school's own artwork. Leaving a side untouched keeps the
        built-in default layout.
      </p>

      <div className="flex items-center gap-2">
        <Button variant={side === "front" ? "primary" : "ghost"} onClick={() => { setSide("front"); setSelectedId(null); }}>Front</Button>
        <Button variant={side === "back" ? "primary" : "ghost"} onClick={() => { setSide("back"); setSelectedId(null); }}>Back</Button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-3">
          <div
            ref={canvasRef}
            onMouseDown={() => setSelectedId(null)}
            className="relative overflow-hidden rounded-control border border-line bg-card shadow-sm"
            style={{ width: CARD_W * SCALE, height: CARD_H * SCALE, backgroundImage: bgUrl ? `url(${bgUrl})` : undefined, backgroundSize: "cover" }}
          >
            {current.fields.map((f) => (
              <div
                key={f.id}
                onMouseDown={(e) => onFieldMouseDown(e, f)}
                className="absolute cursor-move select-none overflow-hidden border"
                style={{
                  left: f.x * SCALE, top: f.y * SCALE, width: f.w * SCALE, height: f.h * SCALE,
                  borderColor: f.id === selectedId ? "#1E2A70" : "rgba(0,0,0,0.2)",
                  borderWidth: f.id === selectedId ? 2 : 1,
                  backgroundColor: f.field_key === "photo" || f.field_key === "qr_code" ? "rgba(0,0,0,0.05)" : "transparent",
                  display: "flex", alignItems: "center",
                  justifyContent: f.align === "center" ? "center" : f.align === "right" ? "flex-end" : "flex-start",
                  fontSize: (f.fontSize ?? 7) * SCALE * 0.8,
                  fontWeight: f.bold ? 700 : 400,
                  color: f.color ?? "#000000",
                  padding: "0 2px",
                }}
              >
                {f.field_key === "static_text" ? (f.text || "Custom Text") : FIELD_LABEL[f.field_key]}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink hover:bg-sidebar">
              Upload background
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadBackground(e.target.files[0])} />
            </label>
            {current.backgroundPath && (
              <Button variant="ghost" onClick={() => updateSide((s) => ({ ...s, backgroundPath: null }))}>Remove background</Button>
            )}
          </div>
        </div>

        <Card className="w-64 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Add field</p>
          <div className="flex flex-wrap gap-1.5">
            {FIELD_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => addField(t)}
                className="rounded-control bg-sidebar px-2 py-1 text-xs text-ink-soft hover:bg-line"
              >
                + {t.label}
              </button>
            ))}
          </div>
        </Card>

        {selectedField && (
          <Card className="w-64 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{FIELD_LABEL[selectedField.field_key]}</p>
              <button type="button" onClick={() => removeField(selectedField.id)} className="text-xs text-danger hover:underline">Delete</button>
            </div>

            {selectedField.field_key === "static_text" && (
              <label className="block space-y-1 text-xs text-ink-faint">
                Text
                <input
                  value={selectedField.text ?? ""}
                  onChange={(e) => patchField(selectedField.id, { text: e.target.value })}
                  className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                  maxLength={60}
                />
              </label>
            )}

            {selectedField.field_key !== "photo" && selectedField.field_key !== "qr_code" && (
              <>
                <label className="block space-y-1 text-xs text-ink-faint">
                  Font size
                  <input
                    type="number" min={4} max={24}
                    value={selectedField.fontSize ?? 7}
                    onChange={(e) => patchField(selectedField.id, { fontSize: Number(e.target.value) })}
                    className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                  />
                </label>
                <label className="block space-y-1 text-xs text-ink-faint">
                  Color
                  <input
                    type="color"
                    value={selectedField.color ?? "#000000"}
                    onChange={(e) => patchField(selectedField.id, { color: e.target.value })}
                    className="h-8 w-full rounded-control border border-line"
                  />
                </label>
                <label className="block space-y-1 text-xs text-ink-faint">
                  Alignment
                  <select
                    value={selectedField.align ?? "left"}
                    onChange={(e) => patchField(selectedField.id, { align: e.target.value as FieldPlacement["align"] })}
                    className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-faint">
                  <input
                    type="checkbox"
                    checked={!!selectedField.bold}
                    onChange={(e) => patchField(selectedField.id, { bold: e.target.checked })}
                  />
                  Bold
                </label>
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1 text-xs text-ink-faint">
                Width
                <input
                  type="number" min={8} max={CARD_W}
                  value={Math.round(selectedField.w)}
                  onChange={(e) => patchField(selectedField.id, { w: Number(e.target.value) })}
                  className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                />
              </label>
              <label className="block space-y-1 text-xs text-ink-faint">
                Height
                <input
                  type="number" min={6} max={CARD_H}
                  value={Math.round(selectedField.h)}
                  onChange={(e) => patchField(selectedField.id, { h: Number(e.target.value) })}
                  className="w-full rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                />
              </label>
            </div>
          </Card>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save template"}</Button>
        {saveMessage && <span className="text-sm text-ok">{saveMessage}</span>}
      </div>
    </div>
  );
}
