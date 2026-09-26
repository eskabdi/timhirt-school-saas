// @vitest-environment happy-dom
// R6 WP-01 round 3 (test-verifier finding 2, reviews CQ M-1 / i18n N-01): the
// stored tenant setting → parse → render path, and the settings page itself.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  settings: Promise.resolve({ data: { settings: {} }, error: null }) as Promise<{ data: unknown; error: unknown }>,
  rpc: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("@/lib/supabase", () => {
  db.rpc = vi.fn(async () => ({ data: {}, error: null }));
  return {
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => db.settings }) }) }),
      rpc: (...args: unknown[]) => db.rpc(...args),
    },
  };
});
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ profile: { id: "u1", tenant_id: "t1" } }) }));

import i18n from "@/lib/i18n";
import { EthDate } from "@/components/EthDate";
import { CalendarPreferencesPage } from "./CalendarPreferencesPage";
import { parseCalendarPrefs, serializeCalendarPrefs } from "./useCalendarPrefs";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(node: React.ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const r = createRoot(el);
  host = el; root = r;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { r.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

afterEach(async () => {
  const r = root;
  if (r) await act(async () => r.unmount());
  host?.remove();
  host = null; root = null;
  db.rpc.mockClear();
});

const $ = () => host as HTMLDivElement;

const saveButton = () => [...$().querySelectorAll("button")].find((b) => b.textContent === i18n.t("common.save")) as HTMLButtonElement;

describe("parseCalendarPrefs / serializeCalendarPrefs", () => {
  it("reads the stored snake_case keys", () => {
    expect(parseCalendarPrefs({ secondary_visible: false, numerals: "arab", show_hijri: true }))
      .toEqual({ secondaryVisible: false, numerals: "arab", showHijri: true });
  });
  it("still reads the legacy camelCase keys", () => {
    expect(parseCalendarPrefs({ secondaryVisible: false, showHijri: true }))
      .toEqual({ secondaryVisible: false, numerals: "latn", showHijri: true });
  });
  it("never yields Ge'ez numerals, whatever is stored", () => {
    expect(parseCalendarPrefs({ numerals: "geez", geezNumerals: true }).numerals).toBe("latn");
  });
  it("defaults junk", () => {
    expect(parseCalendarPrefs("junk")).toEqual({ secondaryVisible: true, numerals: "latn", showHijri: false });
    expect(parseCalendarPrefs([1])).toEqual({ secondaryVisible: true, numerals: "latn", showHijri: false });
  });
  it("writes snake_case only", () => {
    expect(serializeCalendarPrefs({ secondaryVisible: false, numerals: "arab", showHijri: true }))
      .toEqual({ secondary_visible: false, numerals: "arab", show_hijri: true });
  });
});

describe("tenant calendar settings reach <EthDate/>", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });

  it("renders Eastern Arabic digits when the tenant stored numerals: arab (no prefs prop)", async () => {
    db.settings = Promise.resolve({ data: { settings: { calendar: { secondary_visible: false, numerals: "arab", show_hijri: false } } }, error: null });
    await mount(<EthDate value="2026-09-25" />);
    expect($().textContent).toBe("Meskerem ١٥, ٢٠١٩ E.C.");
  });

  it("shows the Gregorian date when the tenant stored secondary_visible: true", async () => {
    db.settings = Promise.resolve({ data: { settings: { calendar: { secondary_visible: true, numerals: "latn" } } }, error: null });
    await mount(<EthDate value="2026-09-25" />);
    expect($().textContent).toBe("Meskerem 15, 2019 E.C. · 25/09/2026 G.C.");
  });
});

describe("<CalendarPreferencesPage/>", () => {
  it("offers Western and Eastern Arabic digits and Hijri, and no Ge'ez option", async () => {
    db.settings = Promise.resolve({ data: { settings: {} }, error: null });
    await mount(<CalendarPreferencesPage />);
    const radios = [...$().querySelectorAll<HTMLInputElement>('input[type="radio"][name="numerals"]')].map((r) => r.value);
    expect(radios).toEqual(["latn", "arab"]);
    expect($().textContent).toContain(i18n.t("calendarPrefs.showHijri"));
    expect($().textContent?.toLowerCase()).not.toMatch(/ge.?ez/);
  });

  it("keeps Save disabled while the stored settings are loading", async () => {
    db.settings = new Promise(() => {});
    await mount(<CalendarPreferencesPage />);
    expect(saveButton().disabled).toBe(true);
  });

  it("keeps Save disabled and says so when the settings fail to load", async () => {
    db.settings = Promise.resolve({ data: null, error: { message: "network" } });
    await mount(<CalendarPreferencesPage />);
    expect(saveButton().disabled).toBe(true);
    expect($().querySelector('[role="alert"]')?.textContent).toBe(i18n.t("calendarPrefs.loadFailed"));
  });

  it("saves only the calendar section, in snake_case, through merge_tenant_settings", async () => {
    db.settings = Promise.resolve({ data: { settings: { branding: { schoolName: "X" }, calendar: { secondary_visible: true } } }, error: null });
    await mount(<CalendarPreferencesPage />);
    const arab = $().querySelector<HTMLInputElement>('input[type="radio"][value="arab"]')!;
    await act(async () => { arab.click(); });
    expect(saveButton().disabled).toBe(false);
    await act(async () => { saveButton().click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(db.rpc).toHaveBeenCalledWith("merge_tenant_settings", {
      p_section: "calendar", p_value: { secondary_visible: true, numerals: "arab", show_hijri: false },
    });
    expect($().querySelector('[role="status"]')?.textContent).toBe(i18n.t("calendarPrefs.saved"));
  });
});
