# Runbook: `edux.et` DNS and mail (fix plan WP-20.6)

DNS for `edux.et` is served by Vercel (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`, delegated 2026-09-24).
Mail is hosted separately (hostns.io, host `91.204.209.21`, PTR `gin.hostns.io`). The owner created
the mailboxes `superadmin@edux.et`, `noreply@edux.et` and `info@edux.et`.

## Mail records: state on 2026-09-24 (DNS-over-HTTPS, Cloudflare)

| Record | Required value (from the owner / mail host) | Live |
|---|---|---|
| `MX edux.et` | **Value still needed from hostns.io.** Usually `10 <mail host name>` — e.g. `gin.hostns.io`, or `mail.edux.et` with an `A` record → `91.204.209.21`. | ❌ missing: **no inbound mail is delivered** |
| `TXT edux.et` (SPF) | `v=spf1 ip4:91.204.209.21 include:spf.hostns.io +a +mx -all` | ❌ missing |
| `TXT default._domainkey.edux.et` (DKIM) | `v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuZTsaAGQ9MrZW/n3WsSJeCyYYxcWdV/dL851bZF5it8r7DTlJi7YQZ9tOOQesB6/XySUfMrKKD3sZaFKOVOg3U3HLRBuCUW1XFtlxFFGkC/oMaWs5Oa4KU6KtuQME9eeX7l7tvJsQxixe6leyDHf+dUDVcSQes1zIlF5RAEk7jnKpTB9DLtaGfSRSNVYdY8vBm69lECJiz941kjwGurqS1llAYZ09rTAWaL4Gke3ajDNYAD3w+sutI8VREpZGD7XkgM9iueeKbRgUN59LuTTxG5GCb7K1gKIYgBEvzo3LrazBsXel01umDGVizATTLt1vfT0uLTU7hAIno7eHHsXtwIDAQAB;` | ❌ missing |
| `TXT _dmarc.edux.et` | `v=DMARC1; p=none;` (tighten to `p=quarantine` once SPF/DKIM pass for a few weeks) | ✅ present |
| `PTR 21.209.204.91.in-addr.arpa` | `gin.hostns.io` | set by the mail host (not in this zone) |

⚠️ `mail.edux.et` currently resolves to Vercel (`216.198.79.x`). The `*.edux.et` wildcard catches it. If the mail
host expects `mail.edux.et`, add an explicit `A mail → 91.204.209.21`. It takes precedence over the wildcard.
Do the same for `webmail`, `smtp`, `imap` and `pop` if you use them. These names are already on the WP-20 reserved-slug list.

**Why this isn't automated:** the session's Vercel token is not allowed to list or create DNS
records (`forbidden: domainRecord create`). Add them in **Vercel → Domains → edux.et → DNS Records**.

## Verify after adding

```bash
for q in "edux.et MX" "edux.et TXT" "default._domainkey.edux.et TXT" "_dmarc.edux.et TXT" "mail.edux.et A"; do
  set -- $q; curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$1&type=$2"; echo; done
```
Then send a test message to and from `info@edux.et` and check the headers show `spf=pass` and `dkim=pass`.
Supabase Auth emails (invites, password reset) use Supabase's SMTP unless custom SMTP is configured. If
`noreply@edux.et` is to be the sender, configure custom SMTP in Supabase and keep SPF/DKIM aligned (WP-07/WP-19).
