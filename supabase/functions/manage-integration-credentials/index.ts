// ============================================================================
// [INSA-style category: INTERNAL — see §21.9 on what "INSA category" labels
// mean for this codebase] manage-integration-credentials
// AuthZ: super_admin only. The ONLY write path into Supabase Vault for
// SMS-provider SECRETS (migration 011), and into platform_integrations.config
// for their non-secret identifiers. Secret values are never echoed back in the response
// — only a "configured" boolean and timestamp. Each provider has a fixed
// allow-list of expected secret AND config keys; anything outside that list,
// or a partial secret set, is rejected rather than silently stored (a
// half-configured provider fails silently later, which is worse than
// refusing it up front).
//
// Chapa, Stripe and the Telebirr online gateway (decommissioned in R6 WP-00,
// C-01) are not providers -- posting any of them gets a clean 400 from the
// enum, not silent acceptance.
// ============================================================================
import { requireRole, rateLimit } from "../_shared/security.ts";
import { makeHandler } from "./handler.ts";

Deno.serve(makeHandler({ requireRole, rateLimit }));
