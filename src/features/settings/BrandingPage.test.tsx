// @vitest-environment happy-dom
// R6 WP-01 release gate GK-1: a failed settings load must not let Save write
// default branding over the school's real branding.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({ configResult: { data: null as unknown, error: null as unknown }, rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => {
  // A chainable PostgREST-style builder: every method returns the builder,
  // and awaiting it resolves to the table's configured result.
  const builder = (table: string) => {
    const result = () => (table === "tenant_configs" ? db.configResult : { data: [], error: null });
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve(result());
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      rpc: (...a: unknown[]) => db.rpc(...a),
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }), upload: vi.fn() }) },
    },
  };
});
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ profile: { id: "u1", tenant_id: "t1", role: "school_admin" } }) }));

import i18n from "@/lib/i18n";
import { BrandingPage } from "./BrandingPage";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  host = el; root = r;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { r.render(<QueryClientProvider client={client}><BrandingPage /></QueryClientProvider>); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
}

afterEach(async () => {
  const r = root;
  if (r) await act(async () => r.unmount());
  host?.remove();
  host = null; root = null;
  db.rpc.mockReset();
});

const saveButton = () => [...(host as HTMLDivElement).querySelectorAll("button")]
  .find((b) => b.textContent?.includes(i18n.t("branding.saveChanges"))) as HTMLButtonElement;

describe("<BrandingPage/> after a settings load", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });

  it("keeps Save disabled and shows an alert when the load fails", async () => {
    db.configResult = { data: null, error: { message: "network" } };
    await mount();
    expect(saveButton().disabled).toBe(true);
    expect(host?.querySelector('[role="alert"]')?.textContent).toBe(i18n.t("calendarPrefs.loadFailed"));
    await act(async () => { saveButton().click(); });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("enables Save once the stored settings have loaded", async () => {
    db.configResult = { data: { settings: { branding: { nameEn: "Real School" } }, school_type_key: "k12", operational_mode_key: null }, error: null };
    await mount();
    expect(saveButton().disabled).toBe(false);
    expect(host?.querySelector('[role="alert"]')).toBeNull();
  });
});
