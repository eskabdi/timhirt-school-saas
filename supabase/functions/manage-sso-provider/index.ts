// ============================================================================
// [INSA category: INTERNAL] manage-sso-provider
//
// school_admin-only. Registers/updates/removes the tenant's single SAML IdP
// with GoTrue and keeps tenant_sso_providers (20260817000009) in sync.
//
// GoTrue's own admin SSO REST endpoints
// (${SUPABASE_URL}/auth/v1/admin/sso/providers) are called directly via
// fetch() with the service_role key, NOT through the supabase-js admin
// client -- the auth-js version vendored in this repo's node_modules
// (checked: @supabase/auth-js's GoTrueAdminApi.d.ts) has no
// create/update/deleteSSOProvider methods, and confirming that ahead of
// time beat finding out at deploy time. A live spike against this project
// (create -> get -> update -> delete a disposable test provider) confirmed
// the service_role key alone is sufficient here -- no Management API PAT
// needed, which is a meaningfully smaller credential blast radius than a
// project/org-control-plane-scoped token would have been.
//
// One provider per tenant (tenant_sso_providers has `unique (tenant_id)`).
// `domain` cannot be changed via "update" -- changing the routing domain is
// a new registration (delete + create), not an edit, so a mismatched domain
// in an update request is rejected rather than silently repointing GoTrue's
// domain list.
//
// The IdP's metadata_url is fetched server-side (school_admin-supplied,
// same trust tier as verify-admission-bank-url's bank-URL fetch) so GoTrue
// always receives real, freshly-fetched metadata_xml rather than depending
// on undocumented behavior of GoTrue fetching the URL itself. SSRF defenses
// mirror _shared/bank-verify.ts: HTTPS only (also DB-constrained),
// redirect:"manual" (any 3xx is a hard reject), a timeout, and a size cap
// while streaming -- there is no per-tenant hostname allow-list here (unlike
// bank verification) because arbitrary IdP domains are the whole point, so
// those defenses carry the full weight.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { readBodyWithCap } from "../_shared/stream-read.ts";

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const MAX_METADATA_BYTES = 1024 * 1024; // 1MB -- real IdP metadata is a few KB
const FETCH_TIMEOUT_MS = 10_000;

const Payload = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    domain: z.string().regex(DOMAIN_RE),
    metadata_url: z.string().url().refine((u) => u.startsWith("https://"), "https required"),
  }),
  z.object({
    action: z.literal("update"),
    domain: z.string().regex(DOMAIN_RE),
    metadata_url: z.string().url().refine((u) => u.startsWith("https://"), "https required"),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal("delete") }),
]);

interface FetchMetadataResult {
  ok: true;
  xml: string;
}
interface FetchMetadataError {
  ok: false;
  reason: string;
}

// Reject anything resolving to a private/loopback/link-local/reserved
// address before ever fetching it -- there is no hostname allow-list here
// (unlike bank-verify.ts) since arbitrary public IdP domains are the whole
// point, so this is the only thing standing between a malicious/compromised
// school_admin (tenant-level, not platform-level) and using this function
// as an SSRF probe against internal infrastructure. Same residual
// DNS-rebinding risk bank-verify.ts already accepts (no DNS pinning between
// this check and the fetch) -- acceptable for the same reason: closing that
// fully needs custom connection-level DNS control this codebase doesn't
// have anywhere yet, and the up-front resolve+range-check closes the gap
// the review actually found (no check at all).
function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254)
      || (a === 100 && b >= 64 && b <= 127) // CGNAT
      || (a === 192 && b === 0);
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")
    || lower.startsWith("::ffff:127.") || lower.startsWith("::ffff:10.") || lower.startsWith("::ffff:192.168.");
}

async function isPrivateOrReservedHost(hostname: string): Promise<boolean> {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  if (isPrivateOrReservedIp(hostname)) return true;
  try {
    const [v4, v6] = await Promise.all([
      Deno.resolveDns(hostname, "A").catch(() => []),
      Deno.resolveDns(hostname, "AAAA").catch(() => []),
    ]);
    return [...v4, ...v6].some(isPrivateOrReservedIp);
  } catch {
    return true; // DNS resolution failure -- fail closed, not open
  }
}

async function fetchMetadataXml(url: string): Promise<FetchMetadataResult | FetchMetadataError> {
  const target = new URL(url);
  if (await isPrivateOrReservedHost(target.hostname)) {
    return { ok: false, reason: "host_not_allowed" };
  }
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/samlmetadata+xml, application/xml, text/xml" },
    });
  } catch (err) {
    console.error("manage-sso-provider: metadata fetch failed", { message: (err as Error).message });
    return { ok: false, reason: "fetch_failed" };
  }
  if (res.status >= 300 && res.status < 400) return { ok: false, reason: "redirect_blocked" };
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const read = await readBodyWithCap(res, MAX_METADATA_BYTES);
  if (!read.ok) {
    if (read.reason === "read_failed") {
      console.error("manage-sso-provider: metadata stream read failed");
    }
    return { ok: false, reason: read.reason === "read_failed" ? "fetch_failed" : read.reason };
  }
  const xml = new TextDecoder().decode(read.bytes);
  if (!xml.includes("EntityDescriptor")) return { ok: false, reason: "not_saml_metadata" };
  return { ok: true, xml };
}

const GOTRUE_BASE = `${Deno.env.get("SUPABASE_URL")!}/auth/v1/admin/sso/providers`;

function gotrueHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["school_admin"]);
    if (ctx instanceof Response) return ctx;
    if (!ctx.tenantId) return errors.forbidden();
    if (!(await rateLimit(`sso-provider:${ctx.userId}`, 10, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const db = ctx.adminClient;

    const { data: existing } = await db.from("tenant_sso_providers")
      .select("id, domain, gotrue_provider_id").eq("tenant_id", ctx.tenantId).maybeSingle();

    if (p.action === "delete") {
      if (!existing) return json({ configured: false, enabled: false }, 200);
      if (existing.gotrue_provider_id) {
        const res = await fetch(`${GOTRUE_BASE}/${existing.gotrue_provider_id}`, {
          method: "DELETE", headers: gotrueHeaders(),
        });
        if (!res.ok && res.status !== 404) {
          console.error("manage-sso-provider: GoTrue delete failed", { status: res.status });
          return errors.internal();
        }
      }
      const { error: delErr } = await db.from("tenant_sso_providers").delete().eq("id", existing.id);
      if (delErr) {
        // GoTrue-side is already gone at this point -- surfacing this as a
        // failure (rather than silently reporting success) matters because
        // a stale row here permanently blocks a future "create" (the
        // existing-row check above) even though GoTrue has nothing
        // registered, and there'd be no visible error pointing at why.
        console.error("manage-sso-provider: local delete failed after GoTrue delete succeeded", { message: delErr.message });
        return errors.internal();
      }
      return json({ configured: false, enabled: false }, 200);
    }

    if (p.action === "create" && existing) {
      return json({ error: "This tenant already has an SSO provider configured. Delete it first to register a different one." }, 400);
    }
    if (p.action === "update" && !existing) {
      return json({ error: "No SSO provider is configured yet for this tenant." }, 400);
    }
    if (p.action === "update" && existing!.domain !== p.domain) {
      return json({ error: "The routing domain cannot be changed on an existing provider. Delete it and create a new one." }, 400);
    }

    // A different tenant may already own this domain -- the DB's unique
    // constraint is the real backstop, but check first for a clean 400
    // instead of a raw constraint-violation 500.
    if (p.action === "create") {
      const { data: domainTaken } = await db.from("tenant_sso_providers")
        .select("id").eq("domain", p.domain).maybeSingle();
      if (domainTaken) {
        return json({ error: "This domain is already registered to another tenant." }, 400);
      }
    }

    const fetched = await fetchMetadataXml(p.metadata_url);
    if (!fetched.ok) {
      return json({ error: `Could not fetch valid SAML metadata from that URL (${fetched.reason}).` }, 400);
    }

    if (p.action === "create") {
      const res = await fetch(GOTRUE_BASE, {
        method: "POST", headers: gotrueHeaders(),
        body: JSON.stringify({ type: "saml", metadata_xml: fetched.xml, domains: [p.domain] }),
      });
      if (!res.ok) {
        console.error("manage-sso-provider: GoTrue create failed", { status: res.status });
        return json({ error: "The identity provider rejected this configuration." }, 400);
      }
      const created = await res.json();
      const { error: insErr } = await db.from("tenant_sso_providers").insert({
        tenant_id: ctx.tenantId, domain: p.domain, metadata_url: p.metadata_url,
        gotrue_provider_id: created.id, enabled: false, created_by: ctx.userId,
      });
      if (insErr) {
        // GoTrue-side create succeeded but our own bookkeeping row failed --
        // roll back the GoTrue side so a retry doesn't collide with an
        // orphaned provider it can no longer see.
        await fetch(`${GOTRUE_BASE}/${created.id}`, { method: "DELETE", headers: gotrueHeaders() }).catch(() => {});
        throw insErr;
      }
      return json({ configured: true, enabled: false }, 201);
    }

    // update
    const res = await fetch(`${GOTRUE_BASE}/${existing!.gotrue_provider_id}`, {
      method: "PUT", headers: gotrueHeaders(),
      body: JSON.stringify({ metadata_xml: fetched.xml, domains: [p.domain] }),
    });
    if (!res.ok) {
      console.error("manage-sso-provider: GoTrue update failed", { status: res.status });
      return json({ error: "The identity provider rejected this configuration." }, 400);
    }
    const { error: updErr } = await db.from("tenant_sso_providers")
      .update({ metadata_url: p.metadata_url, enabled: p.enabled }).eq("id", existing!.id);
    if (updErr) {
      // GoTrue already has the new metadata at this point and our local row
      // doesn't -- no compensating rollback (there's no old metadata_xml
      // retained to restore GoTrue to). A generic 500 here would tell the
      // admin nothing about whether it's safe to just try again, so this
      // returns a distinct, retry-safe response instead of throwing into
      // the catch-all errors.internal() -- the caller can show something
      // more useful than "an unexpected error occurred" for a state that
      // self-heals on the next identical request (both the GoTrue PUT and
      // this update are idempotent and converge to the same target state).
      console.error("manage-sso-provider: local update failed after GoTrue update succeeded -- retry is safe", { message: updErr.message });
      return json({
        error: "Settings partially updated -- please try again.",
        code: "update_partial_retry_safe",
      }, 409);
    }
    return json({ configured: true, enabled: p.enabled }, 200);
  } catch (err) {
    console.error("manage-sso-provider failed", { message: (err as Error).message });
    return errors.internal();
  }
});
