// @vitest-environment happy-dom
// The academic calendar page renders the server's layers as the MoE sheet:
// the ድምር column for 2019 EC; "Choose Calendar" only for a user the server
// would let create one; its outcome (and the days it left out) survives the
// refetch that hides the chooser; the grid is one tab stop with arrow keys.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DAY_TYPES } from "./dayTypes";
import { MOE_2019_ENTRIES, MOE_2019_SESSION } from "./moe2019.fixture";

const state = vi.hoisted(() => ({ canCreate: false, created: false, previousPublished: false, closed: false, createFails: false }));
vi.mock("@/features/auth/useSession", () => ({
  useSession: () => ({ profile: { id: "u1", tenant_id: "t1", role: "school_admin", full_name: "A B C" } }),
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
  const settings = (y: number) => {
    const mine = y === 2019 && (state.created || state.closed);
    const prev = y === 2018 && state.previousPublished;
    return [{
      school_calendar_id: mine || prev ? `s${y}` : null, school_status: mine ? (state.closed ? "closed" : "draft") : prev ? "published" : null,
      school_origin: mine || prev ? "moe" : null, region_calendar_id: null, region_code: null,
      moe_calendar_id: y === 2019 ? "m" : null, weekend_days: [6, 7],
      session_starts_on: y === 2019 ? MOE_2019_SESSION.startsOn : null, session_ends_on: y === 2019 ? MOE_2019_SESSION.endsOn : null,
    }];
  };
  return {
    supabase: {
      from: query,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "calendar_year_settings") return { data: settings(args.p_ec_year as number), error: null };
        if (fn === "effective_calendar_entries") {
          return {
            error: null,
            data: args.p_ec_year === 2019
              ? MOE_2019_ENTRIES.map((e) => ({ entry_id: e.id, level: "moe", source_code: "MOE", day_type_code: e.dayTypeCode,
                                               starts_on: e.startsOn, ends_on: e.endsOn, name_i18n: { en: e.name }, locked: true }))
              : [],
          };
        }
        // Only academic_calendar:create opens the chooser (CAL-TV-14).
        if (fn === "has_resource_permission") {
          return { data: state.canCreate && args.p_resource === "academic_calendar" && args.p_action === "create", error: null };
        }
        if (fn === "create_school_calendar") {
          if (state.createFails) return { data: null, error: { message: "calendar_exists" } };
          state.created = true;
          return { error: null, data: { calendar_id: "s2019", status: "draft", origin: args.p_origin, copied: 2,
            dropped: [{ name: { en: "Founders Day" }, starts_on: "2026-09-11", ends_on: "2026-09-11", reason: "locked_date" }] } };
        }
        return { data: null, error: null };
      },
    },
  };
});

import { AcademicYearGridPage } from "./AcademicYearGridPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function render(client = new QueryClient()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={client}><AcademicYearGridPage /></QueryClientProvider></MemoryRouter>);
  });
  await flush(); await flush();
  return { host, client, done: () => { act(() => root.unmount()); host.remove(); } };
}
const reset = () => Object.assign(state, { canCreate: false, created: false, previousPublished: false, closed: false, createFails: false });
const cell = (host: HTMLElement, label: RegExp) => [...host.querySelectorAll<HTMLButtonElement>("tbody button")].find((b) => label.test(b.getAttribute("aria-label") ?? ""))!;

describe("AcademicYearGridPage", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T09:00:00Z")); // Meskerem 29, 2019 EC: the present academic year
  });
  afterAll(() => vi.useRealTimers());

  it("shows the MoE 2019 sheet's ድምር column and year total", async () => {
    state.canCreate = false;
    const { host, done } = await render();
    const totals = [...host.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild?.textContent);
    expect(totals.join(",")).toBe("9,20,21,22,21,14,20,22,19,21,21,–,–");
    expect(host.querySelector("tfoot td")?.textContent).toBe("210");
    expect(host.querySelector('input[name="calendar-origin"]')).toBeNull(); // no academic_calendar:create, no chooser
    done();
  });

  it("is one tab stop on today; arrow keys move; today and the full date are announced", async () => {
    state.canCreate = false;
    const { host, done } = await render();
    const cells = [...host.querySelectorAll<HTMLButtonElement>("tbody button")];
    const stops = cells.filter((b) => b.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.getAttribute("aria-current")).toBe("date");
    expect(stops[0]!.getAttribute("aria-label")).toBe("Friday — Meskerem 29, 2019 E.C. — instructional");
    expect(host.querySelector('tbody button[aria-label^="Friday — Meskerem 1, 2019 E.C. — national_holiday — Not a school day"]')).not.toBeNull();
    stops[0]!.focus();
    await act(async () => { stops[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Saturday — Meskerem 30, 2019 E\.C\./);
    expect(cells.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    // Up/down keep the column: from Meskerem 30 to the Tikimt day drawn below it.
    const col = (b: Element) => [...b.closest("tr")!.children].indexOf(b.closest("td")!);
    const from = document.activeElement!;
    await act(async () => { from.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/Tikimt \d+, 2019 E\.C\./);
    expect(col(document.activeElement!)).toBe(col(from));
    expect(host.querySelector("[role=region]")?.getAttribute("aria-describedby")).toBeTruthy(); // the keyboard hint
    expect(host.querySelector("tbody td[aria-hidden]")?.textContent).toBe(""); // empty cells are silent
    done();
  });

  it("offers Choose Calendar on the permission, and disables 'previous' with nothing to copy", async () => {
    state.canCreate = true; state.created = false; state.previousPublished = false;
    const { host, done } = await render();
    const radios = [...host.querySelectorAll<HTMLInputElement>('input[name="calendar-origin"]')];
    expect(radios.map((i) => i.value)).toEqual(["moe", "previous_year", "custom"]);
    expect(radios.map((i) => i.disabled)).toEqual([false, true, false]);
    expect(radios[1]!.getAttribute("aria-describedby")).toBeTruthy();
    done();
  });

  it("keeps the outcome and the left-out days after the chooser disappears", async () => {
    state.canCreate = true; state.created = false; state.previousPublished = true;
    const { host, done } = await render();
    const submit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Create draft")!;
    await act(async () => { submit.click(); });
    await flush(); await flush();
    expect(host.querySelector('input[name="calendar-origin"]')).toBeNull(); // the school has a calendar now
    const notice = host.querySelector('[role="status"]')!;
    expect(notice.textContent).toContain("Draft created; 2 school days copied.");
    expect(notice.textContent).toContain("1 copied day could not be kept and was left out.");
    expect(notice.textContent).toContain("Founders Day (falls on a locked date)");
    expect(notice.textContent).toContain("Founders Day");
    expect(document.activeElement).toBe(notice);
    done();
  });

  it("badge, legend and holiday list, marks, weekend header and today's bar", async () => {
    reset();
    const { host, done } = await render();
    expect(host.textContent).toContain("Present academic year");
    const legend = [...host.querySelectorAll("h2")].find((h) => h.textContent === "Legend")!.closest("div")!;
    expect(legend.textContent).toContain("national_holiday");
    expect(legend.textContent).toContain("Holidays");
    expect(legend.textContent).toContain("Enkutatash (New Year)");
    expect(legend.textContent).toContain("Today");
    expect(cell(host, /^Friday — Meskerem 1, 2019/).textContent).toContain("●"); // the national-holiday mark
    const weekendTh = [...host.querySelectorAll("thead th")].filter((th) => (th as HTMLElement).style.backgroundColor);
    expect(weekendTh.length).toBeGreaterThan(0);
    expect(cell(host, /^Friday — Meskerem 29, 2019/).querySelector("span.bottom-0\\.5")).not.toBeNull(); // today's bar
    expect(cell(host, /^Saturday — Meskerem 30, 2019/).querySelector("span.bottom-0\\.5")).toBeNull();
    done();
  });

  it("a closed year says so", async () => {
    reset(); state.closed = true;
    const { host, done } = await render();
    expect(host.textContent).toContain("Closed");
    done();
  });

  it("the inspector names the day's entries, their layer and the lock", async () => {
    reset();
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 1, 2019/).click(); });
    const inspector = host.querySelector("[aria-live=polite]")!;
    expect(inspector.textContent).toContain("Enkutatash (New Year)");
    expect(inspector.textContent).toContain("Ministry of Education");
    expect(inspector.textContent).toContain("Locked");
    done();
  });

  it("a refused Choose Calendar is announced as an alert in the user's language", async () => {
    reset(); state.canCreate = true; state.createFails = true;
    const { host, done } = await render();
    const submit = [...host.querySelectorAll("button")].find((b) => b.textContent === "Create draft")!;
    await act(async () => { submit.click(); });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("A calendar for this year already exists.");
    done();
  });

  it("caches the school's calendar under its school and user (§6.3)", async () => {
    reset();
    const { client, done } = await render();
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey as unknown[]).filter((k) => k[0] === "academic-calendar");
    for (const kind of ["settings", "entries", "can-create"]) {
      expect(keys.filter((k) => k.includes(kind)).every((k) => k[1] === "t1" && k[2] === "u1")).toBe(true);
      expect(keys.some((k) => k.includes(kind))).toBe(true);
    }
    done();
  });
});
