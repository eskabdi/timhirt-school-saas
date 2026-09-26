// @vitest-environment happy-dom
// R6 WP-02 (reviews AC-13/SEC-9): get_security_settings is for signed-in users
// only, so the hook must not call it without a session, and must key its cache
// by the signed-in user so one session's answer is never served to another.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  rpc: vi.fn(async () => ({ data: { session_timeout_minutes: 15, password_min_length: 12 }, error: null })),
}));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => h.rpc(...(a as [])) } }));
vi.mock("@/features/auth/useSession", () => ({ useSession: () => ({ userId: h.userId }) }));

import { DEFAULT_SECURITY_SETTINGS, useSecuritySettings, type SecuritySettings } from "./useSecuritySettings";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let seen: SecuritySettings | null = null;
let client: QueryClient;

function Probe() { seen = useSecuritySettings(); return null; }

async function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  const r = createRoot(host);
  root = r;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { r.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
}

afterEach(async () => {
  const r = root;
  if (r) await act(async () => r.unmount());
  host?.remove();
  root = null; host = null; seen = null;
  h.rpc.mockClear();
});

describe("useSecuritySettings", () => {
  it("does not call the RPC without a session and returns the defaults", async () => {
    h.userId = null;
    await mount();
    expect(h.rpc).not.toHaveBeenCalled();
    expect(seen).toEqual(DEFAULT_SECURITY_SETTINGS);
  });

  it("reads the policy for a signed-in user, cached under that user", async () => {
    h.userId = "u-1";
    await mount();
    expect(h.rpc).toHaveBeenCalledWith("get_security_settings");
    expect(seen?.sessionTimeoutMinutes).toBe(15);
    expect(seen?.passwordPolicy.minLength).toBe(12);
    expect(client.getQueryData(["security-settings", "u-1"])).toBeTruthy();
  });
});
