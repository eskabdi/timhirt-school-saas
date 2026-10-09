// @vitest-environment happy-dom
// The academic calendar page renders the server's layers as the MoE sheet:
// the ድምር column for 2019 EC, and "Choose Calendar" only for an admin whose
// school has no calendar for the year.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DAY_TYPES } from "./dayTypes";
import { MOE_2019_ENTRIES, MOE_2019_SESSION } from "./moe2019.fixture";

const session = vi.hoisted(() => ({ role: "teacher" }));
vi.mock("@/features/auth/useSession", () => ({
  useSession: () => ({ profile: { id: "u1", tenant_id: "t1", role: session.role, full_name: "A B C" } }),
}));
vi.mock("@/lib/supabase", () => {
  const tables: Record<string, unknown[]> = {
    calendar_day_types: DAY_TYPES.map((d, i) => ({
      code: d.code, label_i18n: { en: d.code }, color: d.color, category: d.category,
      counts_as_instructional: d.countsAsInstructional, legend_order: i + 1,
    })),
    edu_authorities: [{ code: "MOE", name_i18n: { en: "Ministry of Education" } }],
    tenant_configs: [{ settings: {} }],
  };
  const query = (table: string) => {
    let single = false;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (v: unknown) => void) => {
      const rows = tables[table] ?? [];
      resolve({ data: single ? rows[0] ?? null : rows, error: null });
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      rpc: async (fn: string) => ({
        error: null,
        data: fn === "calendar_year_settings"
          ? [{ school_calendar_id: null, school_status: null, school_origin: null, region_calendar_id: null, region_code: null,
               moe_calendar_id: "m", weekend_days: [6, 7], session_starts_on: MOE_2019_SESSION.startsOn, session_ends_on: MOE_2019_SESSION.endsOn }]
          : fn === "effective_calendar_entries"
            ? MOE_2019_ENTRIES.map((e) => ({ entry_id: e.id, level: "moe", source_code: "MOE", day_type_code: e.dayTypeCode,
                                             starts_on: e.startsOn, ends_on: e.endsOn, name_i18n: { en: e.name }, locked: true }))
            : null,
      }),
    },
  };
});

import { AcademicYearGridPage } from "./AcademicYearGridPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><AcademicYearGridPage /></QueryClientProvider></MemoryRouter>);
  });
  await flush(); await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe("AcademicYearGridPage", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T09:00:00Z")); // Tikimt 2019 EC: the present academic year
  });
  afterAll(() => vi.useRealTimers());

  it("shows the MoE 2019 sheet's ድምር column and year total", async () => {
    session.role = "teacher";
    const { host, done } = await render();
    const totals = [...host.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild?.textContent);
    expect(totals.join(",")).toBe("9,20,21,22,21,14,20,22,19,21,21,–,–");
    expect(host.querySelector("tfoot td")?.textContent).toBe("210");
    expect(host.querySelector('input[name="calendar-origin"]')).toBeNull(); // a teacher is not offered Choose Calendar
    done();
  });

  it("offers Choose Calendar to an admin whose school has none for the year", async () => {
    session.role = "school_admin";
    const { host, done } = await render();
    expect([...host.querySelectorAll<HTMLInputElement>('input[name="calendar-origin"]')].map((i) => i.value))
      .toEqual(["moe", "previous_year", "custom"]);
    done();
  });
});
