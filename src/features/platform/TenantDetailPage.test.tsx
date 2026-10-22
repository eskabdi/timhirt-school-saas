// @vitest-environment happy-dom
// The school admin roster shows each admin's invite status and offers
// "Resend invite" only to those who have not accepted; the outcome (sent, or
// already accepted) is announced in a status region.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@/features/auth/useSession", () => ({
  useSession: () => ({ profile: { id: "sa", tenant_id: null, role: "super_admin", full_name: "Platform Admin Person" } }),
}));
vi.mock("@/lib/supabase", () => {
  const tables: Record<string, unknown[]> = {
    tenants: [{ id: "t1", name: "Future Generation School", slug: "fgs", status: "trial", created_at: "2026-10-17T15:05:00Z", tier_key: "basic" }],
    users: [
      { id: "u-pending", full_name: "Pending Admin Person", email: "pending@example.test", locale: "am" },
      { id: "u-active", full_name: "Active Admin Person", email: "active@example.test", locale: "en" },
    ],
  };
  const query = (table: string) => {
    let single = false;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) q[m] = () => q;
    q.single = () => { single = true; return q; };
    q.maybeSingle = () => { single = true; return q; };
    q.then = (resolve: (v: unknown) => void) => {
      const rows = tables[table] ?? [];
      resolve({ data: single ? rows[0] ?? null : rows, error: null });
    };
    return q;
  };
  return { supabase: { from: query, auth: {
    getSession: async () => ({ data: { session: { access_token: "jwt" } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  } } };
});

import "@/lib/i18n";
import { TenantDetailPage } from "./TenantDetailPage";

const calls: Record<string, unknown>[] = [];
let resendStatus = 200;
let resendNetworkError = false;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/platform/tenants/t1"]}>
        <QueryClientProvider client={new QueryClient()}>
          <Routes><Route path="/platform/tenants/:id" element={<TenantDetailPage />} /></Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush(); await flush();
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

const row = (host: HTMLElement, name: string) => [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!;

describe("TenantDetailPage invite status and resend", () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      if (body.action === "status") {
        return new Response(JSON.stringify({ admins: [
          { user_id: "u-pending", pending: true, invited_at: "2026-10-17T15:05:12Z" },
          { user_id: "u-active", pending: false, invited_at: "2026-09-01T08:00:00Z" },
        ] }), { status: 200 });
      }
      if (body.action === "resend" && resendNetworkError) throw new TypeError("Failed to fetch");
      if (body.action === "resend") {
        return new Response(JSON.stringify(resendStatus === 200 ? { resent: true } : { code: "already_accepted" }), { status: resendStatus });
      }
      return new Response("{}", { status: 400 });
    });
  });
  afterEach(() => { calls.length = 0; resendStatus = 200; resendNetworkError = false; });

  it("marks who is pending and offers Resend only to them", async () => {
    const { host, done } = await render();
    expect(row(host, "Pending Admin Person").textContent).toContain("Invite pending");
    expect(row(host, "Active Admin Person").textContent).toContain("Active");
    const buttons = (name: string) => [...row(host, name).querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons("Pending Admin Person")).toContain("Resend invite");
    expect(buttons("Active Admin Person")).not.toContain("Resend invite");
    done();
  });

  it("resends for the pending admin and says so", async () => {
    resendStatus = 200;
    const { host, done } = await render();
    const btn = [...row(host, "Pending Admin Person").querySelectorAll("button")].find((b) => b.textContent === "Resend invite")!;
    await act(async () => { btn.click(); });
    await flush();
    expect(calls).toContainEqual({ action: "resend", tenant_id: "t1", user_id: "u-pending" });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("A new link to set a password was sent to pending@example.test.");
    done();
  });

  it("explains when the server says the invite was already accepted", async () => {
    resendStatus = 409;
    const { host, done } = await render();
    const btn = [...row(host, "Pending Admin Person").querySelectorAll("button")].find((b) => b.textContent === "Resend invite")!;
    await act(async () => { btn.click(); });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This admin has already accepted the invite.");
    done();
  });

  it("shows the generic message, never raw error text, when the request itself fails", async () => {
    resendNetworkError = true;
    const { host, done } = await render();
    const btn = [...row(host, "Pending Admin Person").querySelectorAll("button")].find((b) => b.textContent === "Resend invite")!;
    await act(async () => { btn.click(); });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not resend the invite. Try again later.");
    resendNetworkError = false;
    done();
  });

  it("says to wait when the server rate-limits the resend", async () => {
    resendStatus = 429;
    const { host, done } = await render();
    const btn = [...row(host, "Pending Admin Person").querySelectorAll("button")].find((b) => b.textContent === "Resend invite")!;
    await act(async () => { btn.click(); });
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Too many invite emails were sent recently. Wait a while (up to an hour) and try again.");
    done();
  });
});
