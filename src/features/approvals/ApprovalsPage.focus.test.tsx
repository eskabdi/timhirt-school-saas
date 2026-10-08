// @vitest-environment happy-dom
// I18N9-1 (WCAG 2.4.3): each step of a decision swaps out the button the
// checker pressed; focus must land on what replaces it, never on <body>.
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const request = {
  id: "r1", action: "invoice_void", entity_table: "invoice_headers", entity_id: "e1",
  payload: { from: { amount_due: 100, amount_paid: 0, open_lines: 1 }, to: { status: "void" } },
  payload_hash: "h", status: "pending", maker_id: "someone-else", checker_id: null, decided_at: null,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(), reason: "duplicate", decision_reason: null,
  created_at: new Date().toISOString(), maker: { full_name: "Abebe Kebede Tadesse" }, checker: null,
};

vi.mock("@/lib/supabase", () => {
  type Chain = Record<string, unknown>;
  const chain: Chain = {};
  for (const m of ["select", "order", "limit", "eq", "neq", "in", "gt", "lt"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: [request], error: null });
  return { supabase: { from: () => chain, rpc: async () => ({ data: "executed", error: null }) } };
});
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ profile: { id: "me" } }) }));
vi.mock("@/features/fees/api", () => ({ issueFeeDocumentUrl: async () => null }));

import { ApprovalsPage } from "./ApprovalsPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });

describe("ApprovalsPage keyboard focus", () => {
  it("keeps focus on the decision controls through reject, cancel and approve", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(<MemoryRouter><QueryClientProvider client={qc}><ApprovalsPage /></QueryClientProvider></MemoryRouter>);
    });
    await flush();
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement | undefined;

    const reject = button("Reject");
    expect(reject).toBeDefined();
    reject!.focus();
    await act(async () => { reject!.click(); });
    expect(document.activeElement?.tagName).toBe("TEXTAREA");

    const cancel = button("Cancel");
    cancel!.focus();
    await act(async () => { cancel!.click(); });
    expect(document.activeElement?.textContent).toBe("Reject");

    const approve = button("Approve");
    approve!.focus();
    await act(async () => { approve!.click(); });
    await flush();
    expect(document.activeElement?.getAttribute("role")).toBe("status");

    act(() => root.unmount());
    host.remove();
  });
});
