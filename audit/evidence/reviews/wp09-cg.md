REVIEWER: cg
WP: R6 WP-09 (maker-checker / dual control), `7c81fd7..7cb1fc4` in /home/user/rv-wp09
VERDICT: PASS

I found no Ethiopian-context or convention problem in this change that is Critical, High or Medium. There are five Low findings and one Info item.

**FINDINGS**

**CG-1 (minor): the approvals inbox shows the payment method as a raw code.**
- **Where:** /home/user/rv-wp09/src/features/approvals/ApprovalsPage.tsx:220, with the payload built at supabase/migrations/20260927000002_r6_maker_checker.sql:523.
- **What happens:** a checker looking at a `manual_payment_accept` request in the am or om UI sees the literal `cash` or `bank` in the "ዘዴ" (method) row. The `provider` value falls through `DiffValue` to `String(v)`.
- **Evidence:** `fees.paymentProvider.*` translations already exist and InvoiceDetailPage.tsx:311 uses them. `check:i18n` does not catch this because the text is data, not a hard-coded string.
- **Fix:** add a branch in `DiffValue`: when `row.field === "provider"`, render `t(\`fees.paymentProvider.${v}\`)`.

**CG-2 (minor): money in the approval diff is not formatted as ETB.**
- **Where:** ApprovalsPage.tsx:220.
- **What happens:** `amount`, `amount_due` and `amount_paid` (manual payment and invoice void) render as `String(v)`, e.g. `12500.5`. `formatETB` would give `ETB 12,500.50` (en), `ብር 12,500.50` (am) or `Br 12,500.50` (om); I confirmed those outputs with Node's Intl. The "(ETB)" in the label keeps the currency right, but the number has no grouping and no fixed 2 decimals, on a screen where a second person approves money.
- **Fix:** for those three fields, use `formatETB(Number(v), i18n.resolvedLanguage)`.

**CG-3 (minor): request timestamps can show the wrong Ethiopian-calendar day.**
- **Where:** ApprovalsPage.tsx:127, :162 and :167 (`created_at`, `decided_at`, `expires_at` go to `<EthDate>`).
- **What happens:** `EthDate` reads the UTC fields of an instant. A request made at 01:30 Addis time shows the previous day.
- **Evidence:** I ran `toEthiopian(new Date("2026-09-28T22:30:00Z"))` with vite-node. It returns 2019-01-18, while the Addis date is 2019-01-19. Expiry is shifted the same way, so it shows a day early; that errs on the safe side. The same pattern exists elsewhere in the app, so this is not new to WP-09.
- **Fix:** shift instants by +3h before converting (a shared helper), or track it app-wide in audit/backlog.md.

**CG-4 (minor): in am and om, "withdrawn" and "void" are the same word.**
- **Where:** /home/user/rv-wp09/src/locales/am/common.json:85 and /home/user/rv-wp09/src/locales/om/common.json:85.
- **What happens:** `approvals.status.cancelled` and `approvals.value.void` / `fees.invoiceStatus.void` are both "ተሰርዟል" (am) and both "Haqameera" (om). In History, a withdrawn `invoice_void` request shows a "ተሰርዟል" badge next to a "to: ተሰርዟል" row. An Amharic or Oromo reader can take that to mean the invoice was voided. English keeps the two apart ("Withdrawn" vs "Void").
- **Fix:** use a distinct withdrawn term for `status.cancelled` and `withdraw`, e.g. am "ተመልሷል"/"ጥያቄውን መልስ" and om "Deebi'eera"/"Gaaffii deebisi".
- **Also:** `approvals.withdraw` uses the infinitive ("ጥያቄውን መሰረዝ", "Gaaffii haquu") where the other buttons use the imperative.

**CG-5 (minor): the settings page leaves one always-on action out of its list.**
- **Where:** /home/user/rv-wp09/src/features/approvals/ApprovalSettingsPage.tsx:77-81.
- **What happens:** the "Always need a second person" list omits `grade_entry_after_publish` (adding a missing published grade). That action is also always gated and already has an `approvals.action` label.
- **Fix:** add the `<li>`.

**CG-6 (info): `current_date` is copied into the redefined dashboard finance function.**
- **Where:** supabase/migrations/20260927000002_r6_maker_checker.sql:618 and :622.
- **What happens:** `current_date` is today in UTC, not Addis, so the overdue vs to-be-collected split can be off by a day between 21:00 and 24:00 UTC.
- **Context:** this was already in 20260729000002_dashboard.sql. The new threshold logic in 000003:295 does use Africa/Addis_Ababa correctly.
- **Fix:** backlog item to use `(now() at time zone 'Africa/Addis_Ababa')::date`.

**CHECKED**
- **Convention checks:** `python3 scripts/ci/conventions.py` gave 0 findings (geez-digit, currency, name-concat, name-render). scripts/ci/conventions.sh, which the standing instructions name, does not exist; `.py` is the script in the repo.
- **i18n:** `npm run check:i18n` found 0 hard-coded strings. `npm run check:locales` shows parity for common (2313 keys), apply and calendar.
- **Translations:** I listed every added or changed key in en/am/om with a script and read all of them. The Amharic and Oromo are idiomatic apart from CG-4. Plural ICU is correct. The one removed key, `settingsPages.unpublishResults`, is no longer referenced anywhere in src.
- **Ge'ez numerals and currency:** no U+1369–U+137C in any changed file, and `NumeralSystem` is only `latn`/`arab`. No `$`/USD in the changed src or function code; amounts are ETB/ብር.
- **Dates:** every new date goes through `<EthDate>`, including the transfer date via `EthDatePicker` and `toIsoDate`. The only new `new Date()` calls are instant comparisons or stamps (DashboardShell expiry filter, AcademicYearsPage publish time), not "today". No times are displayed, so the Ethiopian clock does not come into play.
- **Names:** student names in grade payloads are built First, Middle, Last with `concat_ws` (000003:632/685). The gradebook uses `fullName()`. Maker and checker use `users.full_name`, the existing account pattern.
- **Banned patterns:** no new `.eq('tenant_id')`, `dangerouslySetInnerHTML` or `toLocaleDateString`. Every new `<label>` wraps a single control, so `Field` is used correctly and `FieldGroup` is not needed.
- **PDFs:** the issue-fee-document diff only filters void lines and requires a succeeded payment. No font or typography change, so Tayitu/Jiret are not involved.
- **Edge Functions:** the diffs for record-fee-payment, generate-fee-invoices and enroll-finalize-billing have no locale, date or currency problem.
- **Tests:** `npx vitest run src/features/approvals src/lib/useSecuritySettings.test.tsx` passed 12/12.
- **Earlier reviews:** read `audit/evidence/reviews/wp09-*.md`; none of the findings above are already reported there.
- **Not verified:** I did not render the pages in a browser. CG-1 and CG-2 come from following the exact `DiffValue` code path, not from a screenshot; a vite-node attempt to run `diffRows` failed on the Supabase client import.