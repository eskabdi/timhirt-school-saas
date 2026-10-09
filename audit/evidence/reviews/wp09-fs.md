REVIEWER: fs
WP: R6 WP-09 (maker-checker), browser-side UI, commit 7cb1fc4 against base 7c81fd7
VERDICT: PASS

I found no blocker or major issue. There is one minor robustness finding and three info notes. I did not use Playwright: there is no Supabase backend to drive the pages against. Instead I rendered the real `ApprovalsPage` in happy-dom with a mocked `supabase.from`, feeding it hostile server rows. That test lived in a scratch directory and has been deleted. Nothing in the worktree was changed.

FINDINGS

- **FS-1** (minor)
  - **Location:** `/home/user/rv-wp09/src/features/approvals/ApprovalsPage.tsx:216-217` (`DiffValue`)
  - **Evidence:** A `{en,am,om}` value is passed to `tField(v)` and rendered without checking it is a string. `exams.name_i18n` is `jsonb not null` with no shape CHECK (`20260713000003_attendance_grades_fees.sql:43`). `submit_approval` copies `e.name_i18n` / `sj.name_i18n` into the payload as they are (`20260927000003_r6_maker_checker_hardening.sql:631-633, 686-688`). I rendered a request with `payload.exam = {"en": {"nested": 1}}` and got `Error: Objects are not valid as a React child (found: object with keys {nested})`. The whole inbox falls to the route error screen, so the checker cannot decide any request until that one expires.
  - **Scope:** It needs a same-tenant user with exam write access. The same unguarded `tField` pattern already exists elsewhere, for example the Gradebook exam `<option>`. The damage is denial of service on one tenant's inbox, not data exposure.
  - **Reference:** §10.4, robustness of rendering server payloads.
  - **Fix:** In `DiffValue`, render the `tField` result only when `typeof === "string"` and show "—" otherwise, or harden `tField` itself. Better still, add a CHECK that the values in `name_i18n` are strings.

- **FS-2** (info)
  - **Location:** `/home/user/rv-wp09/src/features/fees/InvoiceDetailPage.tsx:287`
  - **Evidence:** `href={lastReceiptUrl}` is used without the `httpsHref()` helper, which the same file imports, and with `rel="noreferrer"` only. This line predates WP-09. `noreferrer` implies `noopener` in current browsers. The URL comes from the `record-fee-payment` response, which WP-09 sets to `null` for payments waiting on approval. The approval-time receipt call (`ApprovalsPage.tsx`, `issueFeeDocumentUrl(...).catch`) throws away the URL it gets back, so no new URL reaches the DOM.
  - **Fix (optional):** Wrap it in `httpsHref()` and use `rel="noopener noreferrer"`, to match the checklist.

- **FS-3** (info)
  - **Location:** `InvoiceDetailPage.tsx:197`, `FeeStructuresPage.tsx:185`, `InvoicesPage.tsx:125`
  - **Evidence:** When an error isn't mapped, these pages still show the raw `Error.message`. That message comes from `callFunction` (`src/lib/functions.ts`), which only surfaces the response's `error` field. The functions changed in WP-09 return fixed codes only (`invoice_void`, `amount_exceeds_balance`, `duplicate_reference`, `invoice_changed_retry`) or `errors.internal()`. `payErr.message` is only regex-matched, never echoed. So no database or constraint detail reaches the user. The pages that call RPCs (Approvals, ApprovalSettings, Gradebook, the Transfer modal, the void modal) map every error through `approvalErrorKey` to translated `approvals.error.*` keys. Removing the raw fallback would be tidier but is not required.

- **FS-4** (info, what I could not verify)
  - I did not drive the app end to end in Chromium, so real CSP and Trusted Types enforcement at runtime is not verified by me. Statically the build is clean: `index.html` has only an external module script, and the new source has no `eval`, `new Function`, `innerHTML` or `dangerouslySetInnerHTML`.

CHECKED

- **Rendering of server payloads.** Hostile strings (an `<img onerror>` tag and a `<script>` tag) went into `reason`, `decision_reason`, `maker.full_name`, `checker.full_name`, `payload.student`, `payload.exam.en` and `from/to.remark`, plus a `javascript:` string. In the render test no `img` or `script` element appeared, the text showed up escaped, and `window.__pwned` stayed undefined.
- **Entity links.** With `payload.invoice_id = "//evil.example/x"` the link rendered as `/fees/invoices/evil.example/x`, which stays in the app. Link targets are built only from server-set ids and fixed `/fees/invoices/` or `/students/` prefixes. The payload keys are whitelisted server-side (`invalid_changes`).
- **Route guards.**
  - `/approvals` sits behind `RequireRole STAFF`. `/settings/approvals` sits under the `school_admin` guard, and `set_approval_settings` re-checks `school_admin` on the server (migration 000002:457).
  - The pending-count badge only runs for staff, and its query is limited by RLS.
  - Void and transfer requests go through `submit_approval`, which re-checks permissions. The UI only files requests.
- **React Query cache.**
  - The approvals queries are keyed by `profile.id`, the security settings by `userId`, and the tenant settings by `tenant_id`.
  - `queryClient.clear()` runs on explicit sign-out (`DashboardShell`, `PlatformNav`) and on any `onAuthStateChange` with no session (`useSession`), which covers idle logout. So unkeyed keys such as `["exams"]`, `["grades", …]` and `["invoice-void-request", id]` do not survive a user switch.
- **Error display.** Every WP-09 error path maps to translated keys. The edge function error bodies are fixed codes, and `issue-fee-document` refuses receipts for payments that have not succeeded.
- **Build and bundle.** `vite build` into a scratch directory; grep of the bundle for `service_role`, `SUPABASE_SERVICE`, `sb_secret_`, `innerHTML` and `eval`. The only hits are react-dom and supabase-js library internals. The build had no env injected, so env-baked secrets could not be tested this way.
- **Lint.** `eslint` over the changed UI files: 0 errors, 0 warnings.
- **Links and tokens.** No new external links and no `target=_blank` apart from the unchanged receipt anchor. Tokens are only read via `supabase.auth.getSession()` in `callFunction`, which is unchanged.