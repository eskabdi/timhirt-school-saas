// @vitest-environment happy-dom
// A checker deciding an academic calendar change (20261022000001) sees what
// would change by its labels (the op, the type, the name, the dates in the
// Ethiopian calendar, the MoE/regional date it removes), never the ids the
// approval re-checks; the record link opens the request's year; approving
// refreshes the calendar page's cache.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const request = {
  id: "r1", action: "academic_calendar_change", entity_table: "school_calendar_entries", entity_id: "e1",
  payload: {
    ec_year: 2019, op: "add", calendar_id: "cal-uuid-hidden",
    from: {},
    to: { type: { en: "Parent Meeting" }, day_type_code: "parent_meeting", name_i18n: { en: "PTA" },
          starts_on: "2026-10-09", ends_on: "2026-10-09", overrides_entry_id: "moe-uuid-hidden",
          overrides: { en: "Regional PTA day" }, suppressed: true },
  },
  payload_hash: "h", status: "pending", maker_id: "someone-else", checker_id: null, decided_at: null,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(), reason: null, decision_reason: null,
  created_at: new Date().toISOString(), maker: { full_name: "Abebe Kebede Tadesse" }, checker: null,
};
vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "eq", "neq", "in"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [request], error: null });
  return { supabase: { from: () => chain, rpc: async () => ({ data: "executed", error: null }) } };
});
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ profile: { id: "me" } }) }));
vi.mock("@/features/fees/api", () => ({ issueFeeDocumentUrl: async () => null }));

import { ApprovalsPage } from "./ApprovalsPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe("ApprovalsPage: academic calendar requests", () => {
  it("shows the change by its labels, links to its year, and refreshes the calendar once approved", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated: unknown[][] = [];
    const orig = qc.invalidateQueries.bind(qc);
    qc.invalidateQueries = ((f?: { queryKey?: unknown[] }) => { invalidated.push(f?.queryKey ?? []); return orig(f); }) as typeof qc.invalidateQueries;
    await act(async () => {
      root.render(<MemoryRouter><QueryClientProvider client={qc}><ApprovalsPage /></QueryClientProvider></MemoryRouter>);
    });
    await flush();
    const text = host.textContent ?? "";
    expect(text).toContain("Change the published academic calendar");
    expect(text).toContain("Add a day");
    expect(text).toContain("Parent Meeting");
    expect(text).toContain("PTA");
    expect(text).toContain("Regional PTA day");
    expect(text).toContain("Meskerem 29, 2019");     // dates through EthDate
    expect(text).toContain("Yes");                   // suppressed: true
    expect(text).not.toContain("hidden");            // calendar and override ids
    expect(text).not.toContain("parent_meeting");
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "Open the record")!;
    expect(link.getAttribute("href")).toBe("/academic-calendar?year=2019");
    const approve = [...host.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    await act(async () => { approve.click(); });
    await flush();
    expect(invalidated).toContainEqual(["academic-calendar"]);
    act(() => root.unmount());
    host.remove();
  });
});
