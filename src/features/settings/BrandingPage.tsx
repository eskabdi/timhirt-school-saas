import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { applyBrandPalette } from "@/lib/brand-theme";

interface Branding {
  nameEn: string; nameAm: string; nameOm: string; motto: string;
  logoPath: string | null; sealPath: string | null;
  primaryColor: string; secondaryColor: string; accentColor: string;
  langEn: boolean; langAm: boolean; langOm: boolean;
  calendar: "EC" | "GC";
}
const DEFAULTS: Branding = {
  nameEn: "", nameAm: "", nameOm: "", motto: "",
  logoPath: null, sealPath: null,
  primaryColor: "#1a56db", secondaryColor: "#006c4a", accentColor: "#ffd6a8",
  langEn: true, langAm: false, langOm: false, calendar: "EC",
};

function publicUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
}

export function BrandingPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [b, setB] = useState<Branding>(DEFAULTS);
  const [toast, setToast] = useState<string | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const sealInput = useRef<HTMLInputElement>(null);

  const { data: config } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  useEffect(() => {
    if (config?.settings?.branding) setB({ ...DEFAULTS, ...config.settings.branding });
  }, [config]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(h);
  }, [toast]);

  // Live preview: re-theme the app as the palette is edited, so the effect is
  // visible on the surrounding chrome before committing. Leaving the page
  // without saving restores whatever is actually persisted.
  useEffect(() => {
    applyBrandPalette({ primaryColor: b.primaryColor, secondaryColor: b.secondaryColor, accentColor: b.accentColor });
  }, [b.primaryColor, b.secondaryColor, b.accentColor]);
  useEffect(() => () => {
    const saved = config?.settings?.branding;
    applyBrandPalette(saved ? { primaryColor: saved.primaryColor, secondaryColor: saved.secondaryColor, accentColor: saved.accentColor } : null);
  }, [config]);

  const upload = async (file: File, kind: "logo" | "seal") => {
    const path = `${profile!.tenant_id}/${kind}-${Date.now()}.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("branding").upload(path, file, { upsert: true });
    if (error) { alert(error.message); return; }
    setB((prev) => ({ ...prev, [kind === "logo" ? "logoPath" : "sealPath"]: path }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const settings = { ...(config?.settings ?? {}), branding: b };
      const { error } = await supabase.from("tenant_configs").upsert({ tenant_id: profile!.tenant_id, settings });
      if (error) throw error;
    },
    // Shares the ["tenant-config", …] key with the sidebar, so the nav name +
    // logo refresh the moment the save lands.
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tenant-config"] }); setToast(t("branding.savedToast")); },
    onError: (e: unknown) => setToast(e instanceof Error ? e.message : t("branding.saveFailed")),
  });

  // "Reset All Branding Data" restores ONLY the colour palette to defaults.
  const resetPalette = () => setB((prev) => ({ ...prev, primaryColor: DEFAULTS.primaryColor, secondaryColor: DEFAULTS.secondaryColor, accentColor: DEFAULTS.accentColor }));

  const sectionHead = (icon: string, label: string) => (
    <div className="flex items-center gap-2 text-ink"><span className="text-navy">{icon}</span><h2 className="text-sm font-bold uppercase tracking-wide">{label}</h2></div>
  );
  const hexInput = (val: string, set: (v: string) => void, bar: string, label: string) => (
    <div className="flex-1">
      <label className="mb-1 block text-xs text-ink-faint">{label}</label>
      <div className="flex items-center rounded-control border border-line bg-card" style={{ borderLeft: `4px solid ${bar}` }}>
        <input value={val} onChange={(e) => set(e.target.value)} className="w-full bg-transparent px-3 py-2 font-mono text-sm text-ink focus:outline-none" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-ok px-4 py-3 text-sm font-medium text-white shadow-lg">
          <span>✓</span>{toast}
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">{t("branding.title")}</h1>
          <p className="text-ink-faint">{t("branding.subtitle")}</p>
          <p className="mt-1 text-xs text-ink-faint">{t("branding.breadcrumb")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" className="border border-line" onClick={() => setB(DEFAULTS)}>{t("branding.resetDefault")}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>▣ {t("branding.saveChanges")}</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-4">
          <Card className="space-y-4">
            {sectionHead("🪪", t("branding.visualIdentity"))}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-2 text-sm font-semibold text-ink">{t("branding.primaryLogo")}</p>
                <button onClick={() => logoInput.current?.click()} className="flex h-36 w-full items-center justify-center rounded-lg border-2 border-dashed border-line bg-navy-wash text-sm text-ink-faint">
                  {b.logoPath ? <img src={publicUrl(b.logoPath)!} alt={t("branding.logoAlt")} className="max-h-32 max-w-full object-contain" /> : `🖼 ${t("branding.logoPlaceholder")}`}
                </button>
                <input ref={logoInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "logo")} />
                <p className="mt-2 text-xs text-ink-faint">{t("branding.logoHint")}</p>
              </div>
              <div>
                <p className="mb-2 text-center text-sm font-semibold text-ink">{t("branding.seal")}</p>
                <button onClick={() => sealInput.current?.click()} className="mx-auto flex h-36 w-36 items-center justify-center rounded-full border-2 border-dashed border-line bg-navy-wash text-xs text-ink-faint">
                  {b.sealPath ? <img src={publicUrl(b.sealPath)!} alt={t("branding.sealAlt")} className="h-32 w-32 rounded-full object-cover" /> : t("branding.sealShort")}
                </button>
                <input ref={sealInput} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], "seal")} />
                <p className="mt-2 text-center text-xs text-ink-faint">{t("branding.sealHint")}</p>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            {sectionHead("🎨", t("branding.colorPalette"))}
            <div className="flex gap-3">
              {hexInput(b.primaryColor, (v) => setB({ ...b, primaryColor: v }), b.primaryColor, t("branding.primaryColor"))}
              {hexInput(b.secondaryColor, (v) => setB({ ...b, secondaryColor: v }), b.secondaryColor, t("branding.secondaryColor"))}
              {hexInput(b.accentColor, (v) => setB({ ...b, accentColor: v }), b.accentColor, t("branding.accentColor"))}
            </div>
            <div className="rounded-lg bg-navy-wash p-4">
              <p className="mb-3 text-xs font-semibold uppercase text-ink-faint">{t("branding.componentPreview")}</p>
              <div className="grid grid-cols-2 gap-3">
                <button className="rounded-control px-4 py-2 text-sm font-medium text-white" style={{ background: b.primaryColor }}>{t("branding.primaryAction")}</button>
                <button className="rounded-control border px-4 py-2 text-sm font-medium" style={{ borderColor: b.primaryColor, color: b.primaryColor }}>{t("branding.secondaryGhost")}</button>
                <button className="rounded-control px-4 py-2 text-sm font-medium text-ok" style={{ background: "var(--ok-tint, #d1fadf)" }}>{t("branding.successState")}</button>
                <button className="rounded-control bg-danger-tint px-4 py-2 text-sm font-medium text-danger">⚠ {t("branding.alertMessage")}</button>
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold text-ink-faint">{t("branding.officialName")}</h2>
            <div>
              <label className="text-xs font-semibold text-ink">{t("branding.english")}</label>
              <input value={b.nameEn} onChange={(e) => setB({ ...b, nameEn: e.target.value })} className="mt-1 w-full rounded-control border border-line bg-navy-wash px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink">አማርኛ</label>
              <input value={b.nameAm} onChange={(e) => setB({ ...b, nameAm: e.target.value })} className="mt-1 w-full rounded-control border border-line bg-navy-wash px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink">{t("branding.oromo")}</label>
              <input value={b.nameOm} onChange={(e) => setB({ ...b, nameOm: e.target.value })} className="mt-1 w-full rounded-control border border-line bg-navy-wash px-3 py-2 text-sm text-ink" />
            </div>
            <div>
              <label className="text-sm font-semibold text-ink">{t("branding.motto")}</label>
              <textarea value={b.motto} onChange={(e) => setB({ ...b, motto: e.target.value })} rows={3} placeholder={t("branding.mottoPlaceholder")} className="mt-1 w-full rounded-control border border-line bg-navy-wash px-3 py-2 text-sm text-ink" />
            </div>
            <p className="text-xs text-ink-faint">{t("branding.nameHint")}</p>
          </Card>

          <Card className="space-y-4">
            {sectionHead("🌐", t("branding.localization"))}
            <div className="rounded-lg bg-navy-wash p-3">
              <p className="mb-2 text-center text-sm font-bold text-ink">🌐 {t("branding.defaultLanguage")}</p>
              <div className="flex justify-around text-sm text-ink">
                <label className="flex items-center gap-2"><input type="checkbox" checked={b.langEn} onChange={(e) => setB({ ...b, langEn: e.target.checked })} />{t("branding.englishCaps")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={b.langAm} onChange={(e) => setB({ ...b, langAm: e.target.checked })} />አማርኛ</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={b.langOm} onChange={(e) => setB({ ...b, langOm: e.target.checked })} />{t("branding.oromo")}</label>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-navy-wash p-3">
              <div><p className="text-sm font-bold text-ink">📅 {t("branding.calendarSystem")}</p><p className="text-xs text-ink-faint">{b.calendar === "EC" ? "Ethiopian Calendar (EC)" : "Gregorian Calendar (GC)"}</p></div>
              <div className="flex overflow-hidden rounded-control border border-line">
                {(["EC", "GC"] as const).map((c) => (
                  <button key={c} onClick={() => setB({ ...b, calendar: c })} className={`px-3 py-1 text-sm font-medium ${b.calendar === c ? "bg-navy text-white" : "bg-card text-ink-soft"}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold text-ink">{t("branding.yearStart")}</p>
              <div className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">📅 {t("branding.yearStartValue")}</div>
            </div>
          </Card>

          <Card className="space-y-3 border border-danger bg-danger-tint">
            <h2 className="text-sm font-bold uppercase text-danger">{t("branding.advancedActions")}</h2>
            <button onClick={() => { if (confirm(t("branding.resetConfirm"))) resetPalette(); }} className="w-full rounded-control border border-danger bg-card py-3 text-sm font-medium text-danger">{t("branding.resetAll")}</button>
            <p className="text-xs text-ink-faint">{t("branding.resetHint")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
