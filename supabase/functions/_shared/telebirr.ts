// ============================================================================
// Telebirr H5 C2B Web Payment Integration — shared plumbing (signing, fabric
// token cache, preOrder/checkout-url/queryOrder/refundOrder). Transcribed
// from Ethio Telecom's official developer docs (screenshots the operator
// captured — the docs site itself is a client-only SPA this environment
// cannot fetch or render).
//
// TESTBED ONLY. Production credentials require contacting an ET
// administrator — out of scope until that happens; `environment` in
// platform_integrations.config stays 'testbed'.
//
// Inbound signature verification (of Telebirr's own notify/queryOrder
// responses) is NOT implemented anywhere that calls into this module —
// Telebirr's public key isn't available in the source docs. Every caller
// that receives a Telebirr response logs this loudly. See telebirr-notify's
// header comment for the production-blocker framing.
// ============================================================================
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCredential } from "./security.ts";

export interface TelebirrConfig {
  environment: "testbed" | "production";
  fabricAppKey: string;   // X-APP-Key header value (identifier, not secret)
  appSecret: string;      // Vault-backed secret
  appid: string;           // Mobile Payment application id
  merchCode: string;       // merchant short code
  privateKeyPem: string;  // Vault-backed, ours — signs every outgoing request
}

interface BaseUrls {
  apiBase: string;
  webBase: string;
}

/**
 * The two documented URL pairs. NOTE: the docs' production `webBaseUrl`
 * (https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway)
 * looks identical in shape to the API gateway URL rather than a
 * `/payment/web/paygate?` checkout page like testbed's — very likely a
 * transcription artifact in the source docs, not confirmed either way, and
 * irrelevant since this build targets testbed only. Do not trust it without
 * confirming against Ethio Telecom directly before ever using production.
 */
export function getBaseUrls(environment: "testbed" | "production"): BaseUrls {
  if (environment === "production") {
    return {
      apiBase: "https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway",
      webBase: "https://superapp.ethiomobilemoney.et:38443/apiaccess/payment/gateway",
    };
  }
  return {
    apiBase: "https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway",
    webBase: "https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?",
  };
}

/** Loads Telebirr credentials/config from Vault + platform_integrations.config. */
export async function loadTelebirrConfig(admin: SupabaseClient): Promise<TelebirrConfig | null> {
  const { data: row } = await admin.from("platform_integrations")
    .select("config").eq("provider", "telebirr").maybeSingle();
  const config = (row?.config ?? {}) as Record<string, string>;
  const appSecret = await getCredential(admin, "telebirr_fabric_app_secret");
  const privateKeyPem = await getCredential(admin, "telebirr_private_key_pem");
  if (!appSecret || !privateKeyPem || !config.fabric_app_key || !config.appid || !config.merch_code) {
    return null;
  }
  return {
    environment: (config.environment === "production" ? "production" : "testbed"),
    fabricAppKey: config.fabric_app_key,
    appSecret,
    appid: config.appid,
    merchCode: config.merch_code,
    privateKeyPem,
  };
}

// Fields the official sample code excludes from the signature — replicated
// verbatim, not guessed. `refund_status`/`openType`/`wallet_reference_data`
// only ever appear in responses we'd be re-signing by mistake if this list
// were incomplete, so keeping the full set (even ones this module never
// sends) costs nothing and matches the docs exactly.
const SIGN_EXCLUDE_FIELDS = new Set([
  "sign", "sign_type", "refund_status", "openType", "wallet_reference_data",
]);

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The core `signRequestObject` reimplementation (Additionally:
 * RequestSignatureProcess in the docs): drop the excluded fields, sort the
 * remaining keys alphabetically, join as key=value&key=value..., sign with
 * SHA256withRSA using our private key, base64-encode.
 *
 * SPIKE, NOT AN ASSUMPTION: this needs a real deployed-function invocation
 * to confirm crypto.subtle's PKCS8 import + PKCS1v1.5 signing actually work
 * in the Supabase Edge Runtime's Deno subset, not just locally. Independent
 * of any network call — verifiable standalone by signing a known payload and
 * checking it with crypto.subtle.verify against the matching public key.
 */
export async function signFlatFields(
  fields: Record<string, string | number>,
  privateKeyPem: string,
): Promise<string> {
  const entries = Object.entries(fields)
    .filter(([k]) => !SIGN_EXCLUDE_FIELDS.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const signOriginStr = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signOriginStr),
  );
  return bufferToBase64(sig);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function unixSeconds(): string {
  return Math.floor(Date.now() / 1000).toString();
}

/** Parses Telebirr's yyyyMMddHHmmss format (not ISO) into a Date. */
function parseTelebirrTimestamp(s: string): Date {
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(4, 6)) - 1;
  const d = Number(s.slice(6, 8));
  const h = Number(s.slice(8, 10));
  const mi = Number(s.slice(10, 12));
  const se = Number(s.slice(12, 14));
  return new Date(Date.UTC(y, mo, d, h, mi, se));
}

/**
 * Step 1 — Apply Fabric Token. Checks telebirr_token_cache first (refreshes
 * if expires_at is within ~60s), else POSTs /payment/v1/token.
 */
export async function getFabricToken(admin: SupabaseClient, cfg: TelebirrConfig): Promise<string> {
  const { data: cached } = await admin.from("telebirr_token_cache")
    .select("token, expires_at").eq("id", true).maybeSingle();
  if (cached && new Date(cached.expires_at).getTime() - Date.now() > 60_000) {
    return cached.token;
  }

  const { apiBase } = getBaseUrls(cfg.environment);
  const res = await fetch(`${apiBase}/payment/v1/token`, {
    method: "POST",
    headers: { "X-APP-Key": cfg.fabricAppKey, "Content-Type": "application/json" },
    body: JSON.stringify({ appSecret: cfg.appSecret }),
  });
  if (!res.ok) throw new Error(`telebirr_token_${res.status}`);
  const body = await res.json();
  const token: string = body.token;
  const effectiveAt = parseTelebirrTimestamp(body.effectiveDate);
  const expiresAt = parseTelebirrTimestamp(body.expirationDate);

  await admin.from("telebirr_token_cache").upsert({
    id: true, token, effective_at: effectiveAt.toISOString(), expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });

  return token;
}

export interface PreOrderResult {
  merchOrderId: string;
  prepayId: string;
}

/**
 * Step 2 — Request Create Order (preOrder). Deliberately OMITS
 * business_type/payee_type/payee_identifier/payee_identifier_type — their
 * exact required values were illegible in the source screenshots. Omitting
 * is safer than guessing values that could misroute funds; confirm against
 * the live testbed before adding them.
 */
export async function preOrder(
  admin: SupabaseClient, cfg: TelebirrConfig,
  opts: { merchOrderId: string; amountEtb: string; title: string; notifyUrl: string; redirectUrl?: string },
): Promise<PreOrderResult> {
  const token = await getFabricToken(admin, cfg);
  const { apiBase } = getBaseUrls(cfg.environment);

  const biz: Record<string, string | number> = {
    timestamp: unixSeconds(),
    method: "payment.preorder",
    nonce_str: randomNonce(),
    appid: cfg.appid,
    merch_code: cfg.merchCode,
    merch_order_id: opts.merchOrderId,
    trade_type: "Checkout",
    title: opts.title,
    total_amount: opts.amountEtb,
    trans_currency: "ETB",
    timeout_express: "30m",
    notify_url: opts.notifyUrl,
  };
  if (opts.redirectUrl) biz.redirect_url = opts.redirectUrl;

  const flat: Record<string, string | number> = { ...biz, version: "1.0" };
  const sign = await signFlatFields(flat, cfg.privateKeyPem);

  const res = await fetch(`${apiBase}/payment/v1/merchant/preOrder`, {
    method: "POST",
    headers: {
      "X-APP-Key": cfg.fabricAppKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timestamp: biz.timestamp, method: biz.method, nonce_str: biz.nonce_str,
      version: "1.0", sign_type: "SHA256WithRSA", sign, biz_content: biz,
    }),
  });
  if (!res.ok) throw new Error(`telebirr_preorder_${res.status}`);
  const body = await res.json();
  if (body.result !== "SUCCESS") throw new Error(`telebirr_preorder_failed_${body.code}`);

  return { merchOrderId: body.biz_content.merch_order_id, prepayId: body.biz_content.prepay_id };
}

/** Step 3 — Generate Checkout Url: a second, smaller signed param set. */
export async function buildCheckoutUrl(
  cfg: TelebirrConfig, opts: { prepayId: string },
): Promise<string> {
  const { webBase } = getBaseUrls(cfg.environment);
  const fields: Record<string, string | number> = {
    appid: cfg.appid, merch_code: cfg.merchCode, nonce_str: randomNonce(),
    prepay_id: opts.prepayId, timestamp: unixSeconds(),
  };
  const sign = await signFlatFields(fields, cfg.privateKeyPem);
  const rawRequest = [
    `appid=${fields.appid}`, `merch_code=${fields.merch_code}`,
    `nonce_str=${fields.nonce_str}`, `prepay_id=${fields.prepay_id}`,
    `timestamp=${fields.timestamp}`, `sign=${sign}`, `sign_type=SHA256WithRSA`,
  ].join("&");
  return `${webBase}${rawRequest}&version=1.0&trade_type=Checkout`;
}

// Step 5 (queryOrder) has its OWN trade_status vocabulary, deliberately kept
// separate from Step 7 (notify)'s vocabulary in telebirr-notify's own file —
// collapsing the two into one mapping table was explicitly ruled out.
export type QueryOrderStatus =
  | "PAY_SUCCESS" | "PAY_FAILED" | "WAIT_PAY" | "ORDER_CLOSED" | "PAYING"
  | "ACCEPTED" | "REFUNDING" | "REFUND_SUCCESS" | "REFUND_FAILED";

export interface QueryOrderResult {
  merchOrderId: string;
  tradeStatus: QueryOrderStatus;
  paymentOrderId?: string;
  transId?: string;
  totalAmount?: string;
}

/** Step 5 — queryOrder: on-demand reconciliation when notify never arrives. */
export async function queryOrder(
  admin: SupabaseClient, cfg: TelebirrConfig, merchOrderId: string,
): Promise<QueryOrderResult> {
  const token = await getFabricToken(admin, cfg);
  const { apiBase } = getBaseUrls(cfg.environment);

  const biz = { appid: cfg.appid, merch_code: cfg.merchCode, merch_order_id: merchOrderId };
  const flat: Record<string, string | number> = {
    timestamp: unixSeconds(), method: "payment.queryorder", nonce_str: randomNonce(),
    version: "1.0", ...biz,
  };
  const sign = await signFlatFields(flat, cfg.privateKeyPem);

  const res = await fetch(`${apiBase}/payment/v1/merchant/queryOrder`, {
    method: "POST",
    headers: {
      "X-APP-Key": cfg.fabricAppKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timestamp: flat.timestamp, method: flat.method, nonce_str: flat.nonce_str,
      version: "1.0", sign_type: "SHA256WithRSA", sign, biz_content: biz,
    }),
  });
  if (!res.ok) throw new Error(`telebirr_queryorder_${res.status}`);
  // NOTE: response.sign is signed by Telebirr's private key. Verifying it
  // requires Telebirr's public key, which is not in the source docs and is
  // not yet stored anywhere in this codebase — inbound signature
  // verification is NOT performed here. This is a pre-production blocker,
  // same severity class chapa-webhook's own HMAC check carries; logged
  // loudly by every caller of this function, not silently skipped.
  console.error("telebirr queryOrder: response signature NOT verified — testbed only, pre-production blocker (Telebirr public key unavailable)");
  const body = await res.json();
  if (body.result !== "SUCCESS") throw new Error(`telebirr_queryorder_failed_${body.code}`);

  return {
    merchOrderId: body.biz_content.merch_order_id,
    tradeStatus: body.biz_content.trade_status,
    paymentOrderId: body.biz_content.payment_order_id,
    transId: body.biz_content.trans_id,
    totalAmount: body.biz_content.total_amount,
  };
}

export type RefundStatus = "REFUND_SUCCESS" | "REFUNDING" | "REFUND_FAILED" | "REFUND_DUPLICATED";

export interface RefundResult {
  refundOrderId: string;
  refundStatus: RefundStatus;
  refundAmount?: string;
}

/**
 * Step 8 — refundOrder. Complete and independently testable, but NOT wired
 * into any UI or Edge Function caller in this build — refunds are
 * deliberately out of scope until the primary preOrder/notify/queryOrder
 * path has been verified against a live testbed. Response sign_type here
 * supports both HmacSHA256 and SHA256WithRSA per the docs (unlike every
 * other endpoint) — not handled, since nothing calls this yet.
 */
export async function refundOrder(
  admin: SupabaseClient, cfg: TelebirrConfig,
  opts: { merchOrderId: string; refundRequestNo: string; actualAmount: string; reason?: string },
): Promise<RefundResult> {
  const token = await getFabricToken(admin, cfg);
  const { apiBase } = getBaseUrls(cfg.environment);

  const biz: Record<string, string> = {
    appid: cfg.appid, merch_code: cfg.merchCode, merch_order_id: opts.merchOrderId,
    refund_request_no: opts.refundRequestNo, actual_amount: opts.actualAmount, trans_currency: "ETB",
  };
  if (opts.reason) biz.refund_reason = opts.reason;

  const flat: Record<string, string | number> = {
    timestamp: unixSeconds(), method: "payment.refund", nonce_str: randomNonce(),
    version: "1.0", ...biz,
  };
  const sign = await signFlatFields(flat, cfg.privateKeyPem);

  const res = await fetch(`${apiBase}/payment/v1/merchant/refund`, {
    method: "POST",
    headers: {
      "X-APP-Key": cfg.fabricAppKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timestamp: flat.timestamp, method: flat.method, nonce_str: flat.nonce_str,
      version: "1.0", sign_type: "SHA256WithRSA", sign, biz_content: biz,
    }),
  });
  if (!res.ok) throw new Error(`telebirr_refund_${res.status}`);
  const body = await res.json();
  if (body.result !== "SUCCESS") throw new Error(`telebirr_refund_failed_${body.code}`);

  return {
    refundOrderId: body.biz_content.refund_order_id,
    refundStatus: body.biz_content.refund_status,
    refundAmount: body.biz_content.refund_amount,
  };
}
