// @vitest-environment happy-dom
// The calendar editor on the academic calendar page (20261022000001): shown
// only to academic_calendar:update; a draft is saved directly, a published
// calendar's change and the publish itself are maker-checker requests; an
// unlocked MoE/regional day can be removed for the school, a locked one
// cannot; a draft waiting for its publish approval is frozen; the server's
// refusals are explained in the user's language.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DAY_TYPES } from "./dayTypes";
import { MOE_2019_ENTRIES, MOE_2019_SESSION } from "./moe2019.fixture";

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  status: "draft" as "draft" | "published",
  schoolEntries: [] as unknown[],
  requests: [] as unknown[],
  failWith: null as string | null,
  rpc: [] as [string, Record<string, unknown>][],
}));
vi.mock("@/features/auth/useSession", () => ({
  useSession: () => ({ profile: { id: "u1", tenant_id: "t1", role: "school_admin", full_name: "A B C" } }),
}));
vi.mock("@/lib/supabase", () => {
  const tables = (): Record<string, unknown[]> => ({
    calendar_day_types: DAY_TYPES.map((d, i) => ({
      code: d.code, label_i18n: { en: d.code }, color: d.color, category: d.category,
      counts_as_instructional: d.countsAsInstructional, legend_order: i + 1, authority_only: d.authorityOnly, derived: d.derived,
    })),
    edu_authorities: [{ code: "MOE", name_i18n: { en: "Ministry of Education" } }],
    tenant_configs: [{ settings: {} }],
    school_calendar_entries: state.schoolEntries,
    approval_requests: state.requests,
  });
  const query = (table: string) => {
    let single = false;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "or", "order"]) q[m] = () => q;
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (v: unknown) => void) => {
      const rows = tables()[table] ?? [];
      resolve({ data: single ? rows[0] ?? null : rows, error: null });
    };
    return q;
  };
  return {
    supabase: {
      from: query,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn === "calendar_year_settings") {
          const y = args.p_ec_year as number;
          // 2020 has a draft too (no session yet), to switch years with a form open.
          return { error: null, data: [{
            school_calendar_id: y === 2019 ? "s2019" : y === 2020 ? "s2020" : null,
            school_status: y === 2019 ? state.status : y === 2020 ? "draft" : null,
            school_origin: y === 2019 ? "moe" : null, region_calendar_id: null, region_code: null,
            moe_calendar_id: y === 2019 ? "m" : null, weekend_days: [6, 7],
            session_starts_on: y === 2019 ? MOE_2019_SESSION.startsOn : null, session_ends_on: y === 2019 ? MOE_2019_SESSION.endsOn : null,
          }] };
        }
        if (fn === "effective_calendar_entries") {
          if (args.p_ec_year !== 2019) return { data: [], error: null };
          return { error: null, data: [
            ...MOE_2019_ENTRIES.map((e) => ({ entry_id: e.id, level: "moe", source_code: "MOE", day_type_code: e.dayTypeCode,
              starts_on: e.startsOn, ends_on: e.endsOn, name_i18n: { en: e.name }, locked: true })),
            // An unlocked regional parents' meeting today (Meskerem 29, 2019).
            { entry_id: "r-pta", level: "region", source_code: "OR", day_type_code: "parent_meeting",
              starts_on: "2026-10-09", ends_on: "2026-10-09", name_i18n: { en: "PTA" }, locked: false },
          ] };
        }
        if (fn === "school_calendar_pending") return { data: state.requests, error: null };
        if (fn === "has_resource_permission") {
          return { data: args.p_resource === "academic_calendar" && state.perms.has(args.p_action as string), error: null };
        }
        state.rpc.push([fn, args]);
        return state.failWith ? { data: null, error: { message: state.failWith } } : { data: "new-id", error: null };
      },
    },
  };
});

import { AcademicYearGridPage } from "./AcademicYearGridPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function render() { return renderAt("/"); }
async function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={client}><AcademicYearGridPage /></QueryClientProvider></MemoryRouter>);
  });
  await flush(); await flush();
  return { host, client, done: () => { act(() => root.unmount()); host.remove(); } };
}
const cell = (host: HTMLElement, label: RegExp) => [...host.querySelectorAll<HTMLButtonElement>("tbody button")].find((b) => label.test(b.getAttribute("aria-label") ?? ""))!;
const button = (host: HTMLElement, text: string | RegExp) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")));
const editor = (host: HTMLElement) => [...host.querySelectorAll("h2")].find((h) => h.textContent === "Edit the school's calendar")?.closest("div.rounded-panel, div") ?? null;
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const named = (root: ParentNode, name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === name)!;
const nameInput = (host: HTMLElement, lang: string) =>
  [...host.querySelectorAll<HTMLLabelElement>("form label")].find((l) => l.textContent?.startsWith(`Name (${lang}`))!.querySelector("input")!;
const submitForm = async (host: HTMLElement) => {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
};

describe("CalendarEditor", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T09:00:00Z")); // Meskerem 29, 2019 EC
  });
  afterAll(() => vi.useRealTimers());
  beforeEach(() => Object.assign(state, {
    perms: new Set(["update"]), status: "draft", schoolEntries: [], requests: [], failWith: null, rpc: [],
  }));

  it("is not offered without academic_calendar:update", async () => {
    state.perms = new Set();
    const { host, done } = await render();
    expect(host.querySelector("tbody")).not.toBeNull();
    expect(editor(host)).toBeNull();
    done();
  });

  it("adds a day to the draft directly, on the selected date, with the first type a school may enter", async () => {
    const { host, done } = await render();
    expect(host.textContent).toContain("This is a draft: changes are saved straight away");
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Add a day here")!.click(); });
    const select = host.querySelector<HTMLSelectElement>("form select")!;
    expect(document.activeElement).toBe(select); // focus moves into the form
    expect([...select.options].map((o) => o.value)).not.toContain("national_holiday"); // authority-only
    expect([...select.options].map((o) => o.value)).not.toContain("weekend"); // derived
    await typeInto(nameInput(host, "English"), "  Founders  ");
    await submitForm(host);
    expect(state.rpc).toEqual([["save_school_calendar_entry", {
      p_calendar_id: "s2019", p_entry_id: null, p_day_type_code: "school_holiday", p_starts_on: "2026-10-09",
      p_ends_on: "2026-10-09", p_name_i18n: { en: "Founders" }, p_overrides_entry_id: null, p_suppressed: false,
    }]]);
    const status = host.querySelector('[role="status"]:not([aria-live])');
    expect([...host.querySelectorAll('[role="status"]')].some((n) => n.textContent === "Saved.")).toBe(true);
    expect(status).not.toBeNull();
    expect(host.querySelector("form")).toBeNull(); // the form closes
    done();
  });

  it("needs a name before it calls the server", async () => {
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Add a day here")!.click(); });
    await submitForm(host);
    expect(host.querySelector("form [role=alert]")?.textContent).toBe("Enter a name in at least one language.");
    expect(state.rpc).toEqual([]);
    done();
  });

  it("removes an unlocked regional day for the school; a locked national holiday offers no removal", async () => {
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Remove “PTA” for our school")!.click(); });
    await flush();
    expect(state.rpc).toEqual([["save_school_calendar_entry", {
      p_calendar_id: "s2019", p_entry_id: null, p_day_type_code: "parent_meeting", p_starts_on: "2026-10-09",
      p_ends_on: "2026-10-09", p_name_i18n: { en: "PTA" }, p_overrides_entry_id: "r-pta", p_suppressed: true,
    }]]);
    await act(async () => { cell(host, /^Friday — Meskerem 1, 2019/).click(); });
    expect(button(host, /for our school$/)).toBeUndefined();
    done();
  });

  it("a published calendar's change is a request, not a direct write", async () => {
    state.status = "published";
    const { host, done } = await render();
    expect(host.textContent).toContain("Each change goes to a second person for approval");
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Add a day here")!.click(); });
    await typeInto(nameInput(host, "Amharic"), "የመሥራቾች ቀን");
    expect(button(host, "Send for approval")).toBeDefined();
    await submitForm(host);
    expect(state.rpc).toEqual([["submit_approval", {
      p_action: "academic_calendar_change", p_entity_id: "s2019", p_reason: null,
      p_changes: { op: "add", day_type_code: "school_holiday", starts_on: "2026-10-09", ends_on: "2026-10-09",
                   name_i18n: { am: "የመሥራቾች ቀን" }, overrides_entry_id: null, suppressed: false },
    }]]);
    expect(host.textContent).toContain("Sent for approval. The change takes effect when a second person approves it.");
    done();
  });

  it("asks to publish the draft (with the reason) only with academic_calendar:publish", async () => {
    const { host: h1, done: d1 } = await render();
    expect(button(h1, "Send for publishing")).toBeUndefined();
    d1();
    state.perms = new Set(["update", "publish"]);
    const { host, done } = await render();
    const reason = [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Reason"))!.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Ready for the year");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { button(host, "Send for publishing")!.click(); });
    await flush();
    expect(state.rpc).toEqual([["submit_approval", {
      p_action: "academic_calendar_publish", p_entity_id: "s2019", p_changes: {}, p_reason: "Ready for the year",
    }]]);
    expect(host.textContent).toContain("Sent for publishing.");
    done();
  });

  it("a draft waiting for its publish approval is frozen", async () => {
    state.perms = new Set(["update", "publish"]);
    state.schoolEntries = [{ id: "e1", day_type_code: "school_holiday", starts_on: "2026-10-20", ends_on: "2026-10-20",
      name_i18n: { en: "Founders" }, overrides_entry_id: null, suppressed: false }];
    state.requests = [{ action: "academic_calendar_publish", entity_id: "s2019", op: null, overrides_entry_id: null }];
    const { host, done } = await render();
    expect(host.textContent).toContain("Waiting for approval to publish");
    expect(host.textContent).toContain("This draft is waiting for approval to be published, so it cannot be changed.");
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    expect(button(host, "Add a day here")).toBeUndefined();
    expect(named(host, "Edit Founders").disabled).toBe(true);
    expect(named(host, "Delete Founders").disabled).toBe(true);
    expect(button(host, "Send for publishing")!.disabled).toBe(true);
    done();
  });

  it("lists the school's own days: a removal reads as one and is restored; a day with a pending change is held", async () => {
    state.status = "published";
    state.schoolEntries = [
      { id: "e1", day_type_code: "school_holiday", starts_on: "2026-10-20", ends_on: "2026-10-21", name_i18n: { en: "Founders" }, overrides_entry_id: null, suppressed: false },
      { id: "e2", day_type_code: "parent_meeting", starts_on: "2026-10-09", ends_on: "2026-10-09", name_i18n: { en: "PTA" }, overrides_entry_id: "r-pta", suppressed: true },
    ];
    // Made by someone else: the editor still learns it waits (school_calendar_pending).
    state.requests = [{ action: "academic_calendar_change", entity_id: "e1", op: "update", overrides_entry_id: null }];
    const { host, done } = await render();
    const heading = [...host.querySelectorAll("h3")].find((c) => c.textContent === "The school's own days")!;
    const rows = host.querySelector(`ul[aria-labelledby="${heading.id}"]`)!.querySelectorAll("li");
    expect(rows[0]!.textContent).toContain("Founders");
    expect(rows[0]!.textContent).toContain("Waiting for approval");
    expect(named(rows[0]!, "Edit Founders").disabled).toBe(true);
    expect(rows[0]!.textContent).toContain("Request a change");
    expect(rows[1]!.textContent).toContain("Removed for our school: PTA");
    const restore = named(rows[1]!, "Restore PTA");
    expect(restore.disabled).toBe(false);
    await act(async () => { restore.click(); });
    await flush();
    expect(state.rpc).toEqual([["submit_approval", {
      p_action: "academic_calendar_change", p_entity_id: "e2", p_changes: { op: "delete" }, p_reason: null,
    }]]);
    // Already removed for the school: no second "Remove" offer on that day.
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    expect(button(host, "Remove “PTA” for our school")).toBeUndefined();
    done();
  });

  it("editing a day that replaces a MoE/regional date keeps the replacement", async () => {
    state.schoolEntries = [{ id: "e3", day_type_code: "parent_meeting", starts_on: "2026-10-09", ends_on: "2026-10-09",
      name_i18n: { en: "PTA (moved)" }, overrides_entry_id: "r-pta", suppressed: false }];
    const { host, done } = await render();
    await act(async () => { named(host, "Edit PTA (moved)").click(); });
    await submitForm(host);
    expect(state.rpc[0]![1]).toMatchObject({ p_entry_id: "e3", p_overrides_entry_id: "r-pta" });
    done();
  });

  it("does not offer to remove a date a waiting request already removes", async () => {
    state.requests = [{ action: "academic_calendar_change", entity_id: "new1", op: "add", overrides_entry_id: "r-pta" }];
    state.status = "published";
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    expect(button(host, "Add a day here")).toBeDefined();
    expect(button(host, "Remove “PTA” for our school")).toBeUndefined();
    done();
  });

  it("an open form does not follow the user to another year's calendar", async () => {
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Add a day here")!.click(); });
    expect(host.querySelector("form")).not.toBeNull();
    const select = host.querySelector<HTMLSelectElement>("#ac-year")!;
    await act(async () => { select.value = "2020"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush(); await flush();
    expect(editor(host)).not.toBeNull(); // 2020's draft editor
    expect(host.querySelector("form")).toBeNull();
    done();
  });

  it("opens on the year a link names (?year=), within the current year ± 1", async () => {
    const { host, done } = await renderAt("/academic-calendar?year=2020");
    expect((host.querySelector<HTMLSelectElement>("#ac-year"))!.value).toBe("2020");
    done();
    const far = await renderAt("/academic-calendar?year=2031");
    expect((far.host.querySelector<HTMLSelectElement>("#ac-year"))!.value).toBe("2019");
    far.done();
  });

  it("explains a refusal in the user's language, never the server's text", async () => {
    state.failWith = "calendar_entry_locked";
    const { host, done } = await render();
    await act(async () => { cell(host, /^Friday — Meskerem 29, 2019/).click(); });
    await act(async () => { button(host, "Remove “PTA” for our school")!.click(); });
    await flush();
    expect([...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent))
      .toContain("This date is locked by the Ministry or the regional bureau and cannot be changed.");
    state.failWith = "permission denied for function save_school_calendar_entry";
    await act(async () => { button(host, "Remove “PTA” for our school")!.click(); });
    await flush();
    expect([...host.querySelectorAll('[role="alert"]')].map((n) => n.textContent)).toContain("Something went wrong. Try again.");
    done();
  });

  it("caches the school's own days and requests under its school and user (§6.3)", async () => {
    const { client, done } = await render();
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey as unknown[]).filter((k) => k[0] === "academic-calendar");
    for (const kind of ["school-entries", "requests", "can-update"]) {
      expect(keys.some((k) => k.includes(kind))).toBe(true);
      expect(keys.filter((k) => k.includes(kind)).every((k) => k[1] === "t1" && k[2] === "u1")).toBe(true);
    }
    done();
  });
});
