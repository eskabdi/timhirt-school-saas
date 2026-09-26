# Owner action list (R6 fix plan)

Things only you, the owner, can do: they need your accounts, money, legal
authority, or a decision that is yours to make. Claude keeps this file current
as the fix plan runs. Each item says what to do, why, and how to tell Claude
it is done. Tick the box when finished.

Last updated: 2026-09-26 (WP-01 round 3; WP-02 and WP-09 in progress).

---

## A. Do now (security hygiene)

- [ ] **A1. Rotate the two deploy tokens this session has used.**
  `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access Tokens) and
  `VERCEL_TOKEN` (Vercel → Account Settings → Tokens). Create new ones, revoke
  the old ones, and give the new ones to the session environment's secrets.
  *Why:* tokens that sat in a shared session environment should be treated as
  exposed.
- [ ] **A2. Delete the unknown self-signed-up auth account.** Supabase →
  Authentication → Users: the account created **2026-08-06** that has no
  profile (it signed up while public sign-up was still open). If you recognise
  it, tell Claude instead. The other profile-less account is your own pending
  invite test; keep or delete it as you like.
- [ ] **A3. Revoke any Telebirr testbed credentials or keypair** ever issued to
  Timhirt, with Ethio Telecom. The code and endpoints were removed in WP-00;
  the credentials exist on Ethio Telecom's side.
- [ ] **A4. Add apex MX/SPF records for inbound mail on `edux.et`** if you
  want mail *to* `@edux.et` addresses (outbound through Resend already works).

## B. Decisions and approvals Claude needs from you

- [ ] **B1. Approve production deploys.** Claude prepares each release and
  verifies it, but a production deploy (migrations, Edge Functions, frontend)
  waits for your explicit "deploy". Pending right now: WP-01, which includes
  migrations `20260925000002` (calendar settings) and `20260925000003` (safe
  settings saves), the frontend right after them, and 9 Edge Functions.
  **Heads-up for this deploy:** all 3 schools have "Show Gregorian
  date alongside Ethiopian dates" switched on (it was the onboarding default
  and did nothing before). It now works, so every date will also show its
  Gregorian equivalent. A school admin can switch it off in Settings →
  Calendar Preferences, or tell Claude to switch it off for all schools.
- [ ] **B2. API-origin WAF (plan WP-16, item 2).** Choose:
  **A)** a Cloudflare Worker reverse proxy for the Supabase API
  (`api.edux.et`, costs a Cloudflare plan, needs Supabase support's
  confirmation), or **B)** no WAF on the API origin, accepted as a recorded
  residual risk that relies on in-app controls. Tell Claude "WAF A" or
  "WAF B".
- [ ] **B3. Native-speaker check** of the new Amharic and Afaan Oromoo text:
  Hijri month names, the Hijri era suffix (am `ዓ.ሂ`, om `A.H.`), the calendar
  settings labels and messages, the date-picker navigation labels, and the
  Oromo `help.integrationsNote` wording, and the date picker's weekday
  initials, now per language (Sunday first): am `እ ሰ ማ ረ ሐ ዓ ቅ`,
  om `D W K R K J S`. Reply with corrections or "OK".

## C. Accounts, services and money (Claude cannot create these)

- [ ] **C1. Staging environment (plan WP-17 / WP-19).** Create a second
  Supabase project (for example `timhirt-staging`) and a Vercel preview or
  staging environment on `staging.edux.et`, then put the staging project ref
  and keys in the session environment. Staging never gets a copy of
  production data.
- [ ] **C2. Backups (plan WP-19, item 3). This is the most urgent in this
  section.** Production runs with **PITR off and no backups**. Enable
  Point-in-Time Recovery (a paid Supabase add-on, on the Pro plan or above)
  and confirm here. Claude then adds the daily logical backup job and runs the
  first restore drill.
- [ ] **C3. Monitoring destination (plan WP-16, item 3).** Pick where logs and
  alerts go (Datadog, Grafana Cloud, a self-hosted ELK/OpenSearch in Ethiopia,
  or e-mail/Telegram alerts only), create the account, and provide the
  API key or webhook through the environment secrets.
- [ ] **C4. Operator MFA.** Turn on MFA for every person with access to the
  production Supabase dashboard, the Vercel team and GitHub.

## D. Legal, people and external parties

- [ ] **D1. Privacy and legal review (plan WP-19, item 8).** Have counsel
  confirm your obligations under Ethiopia's Personal Data Protection
  Proclamation No. 1321/2024. Topics: guardian consent for minors, the privacy
  notice, the retention schedule, cross-border hosting, breach notification,
  and data-processing agreements with Supabase, Vercel and the SMS provider.
  Claude builds the privacy pages, consent capture and data-subject-request
  workflow. The legal text and the DPAs have to come from you.
- [ ] **D2. INSA assessment / external penetration test (plan WP-19, item 7).**
  Book the assessment with INSA, and with a pentest firm if you want one. Claude
  prepares the documentation package (WP-18) and the testing scope (WP-17).
- [ ] **D3. Named owners (plan WP-19, item 9).** Provide: the security contact
  e-mail for `/.well-known/security.txt`, the on-call people and rota, and who
  approves maker-checker steps (for example the second approver for school
  bank-account changes).
