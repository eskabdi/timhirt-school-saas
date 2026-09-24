// Request schema for manage-integration-credentials, kept in its own module so
// it can be unit-tested without starting the Deno.serve handler (index.ts).
// Only SMS providers exist. Chapa, Stripe and the Telebirr online gateway
// (decommissioned in R6 WP-00, C-01) are rejected by the enum, which is the only
// thing standing between a caller and a Vault write for an unknown provider.
import { z } from "npm:zod@3";
import { PROVIDERS } from "./keys.ts";

export { PROVIDERS };

export const Payload = z.object({
  provider: z.enum(PROVIDERS),
  credentials: z.record(z.string().min(1).max(500)).optional(),
  config: z.record(z.string().max(2000)).optional(),
}).strict();
