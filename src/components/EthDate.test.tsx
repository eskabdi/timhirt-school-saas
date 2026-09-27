// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeAll } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ profile: null }) }));

import i18n from "@/lib/i18n";
import { EthDate } from "./EthDate";
import type { CalendarPrefs } from "@/features/settings/useCalendarPrefs";

async function render(node: React.ReactNode): Promise<string> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);
  });
  const text = host.textContent ?? "";
  await act(async () => root.unmount());
  return text;
}

const prefs = (p: Partial<CalendarPrefs>): CalendarPrefs => ({ secondaryVisible: false, numerals: "latn", showHijri: false, ...p });

describe("<EthDate/> calendar display settings (R6 WP-01 round 2)", () => {
  beforeAll(async () => { await i18n.changeLanguage("en"); });

  it("renders the EC date with Western digits by default", async () => {
    expect(await render(<EthDate value="2026-09-25" prefs={prefs({})} />)).toBe("Meskerem 15, 2019 E.C.");
  });

  it("shows the Gregorian date as visible text when enabled (not a tooltip, review F-01)", async () => {
    expect(await render(<EthDate value="2026-09-25" prefs={prefs({ secondaryVisible: true })} />))
      .toBe("Meskerem 15, 2019 E.C. · 25/09/2026 G.C.");
  });

  it("shows the Hijri date when enabled", async () => {
    expect(await render(<EthDate value="2026-09-25" prefs={prefs({ showHijri: true })} />))
      .toBe("Meskerem 15, 2019 E.C. · Rabi al-Thani 14, 1448 AH");
  });

  it("uses Eastern Arabic digits everywhere when chosen, never Ge'ez", async () => {
    const out = await render(<EthDate value="2026-09-25" prefs={prefs({ numerals: "arab", secondaryVisible: true, showHijri: true })} />);
    expect(out).toBe("Meskerem ١٥, ٢٠١٩ E.C. · ٢٥/٠٩/٢٠٢٦ G.C. · Rabi al-Thani ١٤, ١٤٤٨ AH");
    expect(out).not.toMatch(/[0-9\u1369-\u137C]/);
  });

  it("accepts an ISO instant, a Date and nothing", async () => {
    expect(await render(<EthDate value="2026-09-25T10:30:00+00:00" prefs={prefs({})} />)).toBe("Meskerem 15, 2019 E.C.");
    expect(await render(<EthDate value={new Date(Date.UTC(2026, 8, 25))} prefs={prefs({})} />)).toBe("Meskerem 15, 2019 E.C.");
    expect(await render(<EthDate value={null} prefs={prefs({})} />)).toBe("—");
  });
});
