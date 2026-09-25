// R6 WP-00 review R2-TV-2: the handler writes nothing to Vault unless the whole
// request is valid and the provider row exists (AC-3, R2-1), and a valid
// AfroMessage request stores api_key in Vault and sender_id as config (AC-1).
import { assertEquals } from "jsr:@std/assert@1";
import type { AuthContext } from "../_shared/security.ts";
import { makeHandler } from "./handler.ts";

type Call = { op: string; args: unknown[] };

// A stand-in for the supabase-js client. Each top-level call (`from`,
// `schema`, `rpc`) starts a new recorded chain; awaiting a chain resolves
// like PostgREST would for the one table and the one RPC this handler uses.
function fakeDb(rowExists: boolean) {
  const log: Call[][] = [];
  const resolveChain = (calls: Call[]) => {
    const table = calls.find((c) => c.op === "from")?.args[0];
    const rpc = calls.find((c) => c.op === "rpc");
    if (rpc) return { data: "secret-id", error: null };
    if (table === "platform_integrations") {
      return { data: rowExists ? { config: {}, provider: "sms_afromessage" } : null, error: null };
    }
    return { data: null, error: null }; // vault.secrets lookup: no existing secret
  };
  const chain = (calls: Call[]): unknown =>
    new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(resolveChain(calls));
        return (...args: unknown[]) => {
          calls.push({ op: String(prop), args });
          return chain(calls);
        };
      },
    });
  const db = new Proxy({}, {
    get(_t, prop) {
      return (...args: unknown[]) => {
        const calls: Call[] = [{ op: String(prop), args }];
        log.push(calls);
        return chain(calls);
      };
    },
  });
  return { db, log };
}

function run(body: unknown, rowExists = true) {
  const { db, log } = fakeDb(rowExists);
  const ctx = { userId: "u1", role: "super_admin", tenantId: null, userClient: db, adminClient: db } as unknown as AuthContext;
  const handler = makeHandler({ requireRole: () => Promise.resolve(ctx), rateLimit: () => Promise.resolve(true) });
  const req = new Request("http://x/", { method: "POST", body: JSON.stringify(body) });
  return handler(req).then((res) => ({ res, log }));
}

const vaultWrites = (log: Call[][]) =>
  log.flat().filter((c) => c.op === "rpc" && (c.args[0] === "create_secret" || c.args[0] === "update_secret"));

Deno.test("AfroMessage with sender_id posted as a secret: 400 and no Vault write", async () => {
  const { res, log } = await run({ provider: "sms_afromessage", credentials: { api_key: "k", sender_id: "S" } });
  assertEquals(res.status, 400);
  assertEquals(vaultWrites(log).length, 0);
});

Deno.test("missing config for AfroMessage: 400 and no Vault write", async () => {
  const { res, log } = await run({ provider: "sms_afromessage", credentials: { api_key: "k" } });
  assertEquals(res.status, 400);
  assertEquals(vaultWrites(log).length, 0);
});

Deno.test("missing platform_integrations row: 500 and no Vault write (R2-1)", async () => {
  const { res, log } = await run(
    { provider: "sms_afromessage", credentials: { api_key: "k" }, config: { sender_id: "S" } }, false);
  assertEquals(res.status, 500);
  assertEquals(vaultWrites(log).length, 0);
});

Deno.test("valid AfroMessage request: api_key to Vault, sender_id to config, 200", async () => {
  const { res, log } = await run({ provider: "sms_afromessage", credentials: { api_key: "k" }, config: { sender_id: "S" } });
  assertEquals(res.status, 200);
  const writes = vaultWrites(log);
  assertEquals(writes.length, 1);
  assertEquals(writes[0].args[0], "create_secret");
  assertEquals((writes[0].args[1] as Record<string, unknown>).new_name, "sms_afromessage_api_key");
  const update = log.flat().find((c) => c.op === "update");
  assertEquals((update?.args[0] as { config: unknown }).config, { sender_id: "S" });
});
