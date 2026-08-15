// ============================================================================
// Swappable SMS provider interface. Nothing in this codebase calls .send()
// anywhere yet — there is currently zero SMS consumer (confirmed by grep:
// credential storage only, no fetch() to any SMS gateway anywhere in
// supabase/functions or src). This module exists so the interface and
// adapters are code-reviewable and swap-ready, not so they run. Wiring an
// actual send trigger (e.g. into _shared/fee-pdf.ts's notifyBilling) is
// deliberately out of scope for this build.
//
// Provider chosen at runtime via system_config's platform-wide
// 'active_sms_provider' row (tenant_id is null), set by super_admin from
// /platform/integrations — see getActiveSmsProvider() below.
// ============================================================================
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getCredential } from "./security.ts";

export type SmsSendResult =
  | { ok: true; messageId?: string }
  | { ok: false; error: string };

export interface SmsProvider {
  send(admin: SupabaseClient, to: string, body: string): Promise<SmsSendResult>;
}

/**
 * SMSala (api2.smsala.com) — the reference adapter. Built against a
 * complete, unambiguous static-PDF spec (not a JS-rendered site), confirmed
 * twice: once from the vendor's own API documentation PDF, once from a
 * matching Node.js code sample. `messageType: "2"` = Transactional (vs "1"
 * Promotional, "3" OTP); `messageEncoding: "1"` = Default.
 *
 * UNVERIFIED, FLAGGED NOT ASSUMED: every worked example in the vendor's docs
 * uses Indian/Zambian numbers — Ethiopian carrier routing and Amharic/
 * Unicode segment handling are not confirmed. Verify against a live trial
 * account before any production traffic.
 */
export const smsalaAdapter: SmsProvider = {
  async send(admin, to, body) {
    const apiToken = await getCredential(admin, "sms_smsala_api_key");
    if (!apiToken) return { ok: false, error: "not_configured" };

    const res = await fetch("https://api2.smsala.com/SendSmsV2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{
        apiToken,
        messageType: "2", // Transactional
        messageEncoding: "1", // Default
        destinationAddress: to,
        sourceAddress: "Timhirt",
        messageText: body,
      }]),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const arr = await res.json();
    const first = Array.isArray(arr) ? arr[0] : null;
    if (!first || first.Status !== "Success") {
      return { ok: false, error: first?.Remarks ?? "unknown" };
    }
    return { ok: true, messageId: String(first.MessageId) };
  },
};

/**
 * AfroMessage — best-effort, from third-party SDK evidence (Go/PHP/Node
 * packages referencing the real API), NOT the vendor's own docs, which are
 * a JS-rendered site this environment could not fetch or render.
 * STRUCTURAL PLACEHOLDER, NOT A TRUSTED INTEGRATION — endpoint/payload
 * shape unverified against a live account. Confirm before production use.
 */
export const afroMessageAdapter: SmsProvider = {
  async send(admin, to, body) {
    const apiKey = await getCredential(admin, "sms_afromessage_api_key");
    if (!apiKey) return { ok: false, error: "not_configured" };
    const { data: row } = await admin.from("platform_integrations")
      .select("config").eq("provider", "sms_afromessage").maybeSingle();
    const senderId = (row?.config as Record<string, string> | undefined)?.sender_id;

    const res = await fetch("https://api.afromessage.com/api/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, message: body, sender: senderId }),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    return { ok: true, messageId: data?.message_id ? String(data.message_id) : undefined };
  },
};

/**
 * GeezSMS — best-effort, weakest public evidence of the candidates: the
 * vendor's real technical docs live in a Postman collection this
 * environment could not fetch or render. STRUCTURAL PLACEHOLDER, NOT A
 * TRUSTED INTEGRATION — confirm endpoint/payload shape against a live
 * account before production use.
 */
export const geezSmsAdapter: SmsProvider = {
  async send(admin, to, body) {
    const apiKey = await getCredential(admin, "sms_geezsms_api_key");
    if (!apiKey) return { ok: false, error: "not_configured" };

    const res = await fetch("https://api.geezsms.com/sendSms", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ phone: to, msg: body }),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const data = await res.json();
    return { ok: true, messageId: data?.id ? String(data.id) : undefined };
  },
};

const ADAPTERS: Record<string, SmsProvider> = {
  sms_smsala: smsalaAdapter,
  sms_afromessage: afroMessageAdapter,
  sms_geezsms: geezSmsAdapter,
};

/** Reads system_config.active_sms_provider (platform-wide) and returns the matching adapter, or null. */
export async function getActiveSmsProvider(admin: SupabaseClient): Promise<SmsProvider | null> {
  const { data } = await admin.from("system_config")
    .select("value").is("tenant_id", null).eq("key", "active_sms_provider").maybeSingle();
  const providerKey = data?.value as string | null;
  if (!providerKey) return null;
  return ADAPTERS[providerKey] ?? null;
}
