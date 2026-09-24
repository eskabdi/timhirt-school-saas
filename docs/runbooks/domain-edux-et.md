# Runbook: `edux.et` DNS and mail (fix plan WP-20.6)

DNS for `edux.et` is served by Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`, delegated 2026-09-24).
Mail is hosted separately (hostns.io, host `91.204.209.21`, PTR `gin.hostns.io`). The owner created
the mailboxes `superadmin@edux.et`, `noreply@edux.et` and `info@edux.et`.

## Current state (re-verified 2026-09-24, Google and Cloudflare DoH)

| Record | Live |
|---|---|
| `NS edux.et` | ✅ only `ns1.vercel-dns.com`, `ns2.vercel-dns.com`, so the split-brain below is resolved |
| `A edux.et`, `A admin.edux.et` (wildcard) | ✅ Vercel `216.198.79.1`, `64.29.17.65`; `edux.et` 308 → `www.edux.et`, served by Vercel |
| Supabase Auth email | ✅ custom SMTP through **Resend**: `MX send.edux.et 10 feedback-smtp.eu-west-1.amazonses.com`, `TXT send.edux.et "v=spf1 include:amazonses.com ~all"`, DKIM `resend._domainkey.edux.et`. The owner confirmed an invite email was sent and received. |
| `TXT _dmarc.edux.et` | ✅ `v=DMARC1; p=none;` |
| `MX edux.et`, SPF `TXT edux.et` | ❌ none. **Mail to `info@`, `superadmin@` and `noreply@edux.et` is not delivered.** If those hostns.io mailboxes should receive mail, add the MX and SPF records from step 1 below (the SPF must also `include:amazonses.com` if Resend ever sends from the apex). |

Cloudflare's resolver briefly returned the old hostns.io `A` record after the change (cache); Google already
had the Vercel answer. Re-run the verify commands below once the TTL expires.

## ⚠️ Split-brain delegation (found 2026-09-24, since resolved)

The registrar lists **four** nameservers, from two providers: `ns1.hostns.io`, `ns2.hostns.io`, `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.
The two zones hold different data, so answers depend on which server a resolver asks:

| Query | Cloudflare resolver (got the Vercel zone) | Google resolver (got the hostns.io zone) |
|---|---|---|
| `NS edux.et` | vercel-dns | hostns.io |
| `MX edux.et` | **none** | `10 entrap-01/02/03.hostns.io` |
| SPF `TXT edux.et` | none | none |
| DKIM `default._domainkey` | present | **none** |

**Fix (in this order, or mail breaks):**
1. Vercel → Domains → edux.et → DNS Records: add `MX @ 10 entrap-01.hostns.io`, `MX @ 10 entrap-02.hostns.io`,
   `MX @ 10 entrap-03.hostns.io`, and `TXT @ "v=spf1 ip4:91.204.209.21 include:spf.hostns.io +a +mx -all"`.
   Keep the DKIM and DMARC records already there.
2. Verify that Cloudflare and Google DoH return identical MX/TXT/DKIM/DMARC answers (commands below).
3. At the registrar, remove `ns1.hostns.io` / `ns2.hostns.io`, leaving only the Vercel nameservers (WP-20 needs Vercel
   DNS for the `*.edux.et` wildcard certificate). Wait for the parent TTL, then re-verify.

## Mail records: state on 2026-09-24 (DNS-over-HTTPS, Cloudflare)

| Record | Required value (from the owner / mail host) | Live |
|---|---|---|
| `MX edux.et` | `10 entrap-01.hostns.io`, `10 entrap-02.hostns.io`, `10 entrap-03.hostns.io` (as served by the hostns.io zone) | ⚠️ only in the hostns.io zone; missing in Vercel |
| `TXT edux.et` (SPF) | `v=spf1 ip4:91.204.209.21 include:spf.hostns.io +a +mx -all` | ❌ missing |
| `TXT default._domainkey.edux.et` (DKIM) — ⚠️ now present in Vercel, missing in hostns.io | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuZTsaAGQ9MrZW/n3WsSJeCyYYxcWdV/dL851bZF5it8r7DTlJi7YQZ9tOOQesB6/XySUfMrKKD3sZaFKOVOg3U3HLRBuCUW1XFtlxFFGkC/oMaWs5Oa4KU6KtuQME9eeX7l7tvJsQxixe6leyDHf+dUDVcSQes1zIlF5RAEk7jnKpTB9DLtaGfSRSNVYdY8vBm69lECJiz941kjwGurqS1llAYZ09rTAWaL4Gke3ajDNYAD3w+sutI8VREpZGD7XkgM9iueeKbRgUN59LuTTxG5GCb7K1gKIYgBEvzo3LrazBsXel01umDGVizATTLt1vfT0uLTU7hAIno7eHHsXtwIDAQAB;` | ❌ missing |
| `TXT _dmarc.edux.et` | `v=DMARC1; p=none;` (tighten to `p=quarantine` once SPF/DKIM pass for a few weeks) | ✅ present |
| `PTR 21.209.204.91.in-addr.arpa` | `gin.hostns.io` | set by the mail host (not in this zone) |

⚠️ `mail.edux.et` currently resolves to Vercel (`216.198.79.x`). The `*.edux.et` wildcard catches it. If the mail
host expects `mail.edux.et`, add an explicit `A mail → 91.204.209.21`. It takes precedence over the wildcard.
Do the same for `webmail`, `smtp`, `imap` and `pop` if you use them. These names are already on the WP-20 reserved-slug list.

**Why this isn't automated:** the session's Vercel token is not allowed to list or create DNS
records (`forbidden: domainRecord create`). Add them in **Vercel → Domains → edux.et → DNS Records**.

## Verify after adding

```bash
for r in https://cloudflare-dns.com/dns-query https://dns.google/resolve; do
  for q in "edux.et NS" "edux.et MX" "edux.et TXT" "default._domainkey.edux.et TXT" "_dmarc.edux.et TXT"; do
    set -- $q; echo "$r $1 $2: $(curl -s -H 'accept: application/dns-json' "$r?name=$1&type=$2")"; done; done
# Both resolvers must return identical answers before you remove the hostns.io nameservers.
```
Then send a test message to and from `info@edux.et` and check the headers show `spf=pass` and `dkim=pass`.
Supabase Auth emails (invites, password reset) go through custom SMTP via Resend (configured by the owner on
2026-09-24). Keep the `send.edux.et` SPF and `resend._domainkey` DKIM records in place, and tighten DMARC once
aggregate reports show alignment (WP-07/WP-19).
