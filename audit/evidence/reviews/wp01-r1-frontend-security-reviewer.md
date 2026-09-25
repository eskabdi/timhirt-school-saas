REVIEWER: frontend-security-reviewer
WP: WP-01 (frontend slice: diff `bae3bfd..744f1d4 -- src vite.config.ts index.html`)
VERDICT: PASS

FINDINGS:
  - id: FE-1
    severity: minor
    location: src/components/ui/RichTextEditor.tsx:52
    evidence: `if (el && el.innerHTML !== value) el.replaceChildren(...sanitizeRichTextNodes(value));`. The editor's DOM is cleaned, but `onChange` is never called with the cleaned HTML. The unsafe original stays in form state and is saved again unchanged if the author clicks save without editing.
    reference: OWASP A03 (stored XSS, defence in depth) / blueprint §10.4
    fix: After the load-path `replaceChildren`, if `el.innerHTML !== value`, call `onChange(el.innerHTML)` once. Better still, also clean the HTML on write in the save mutation or in a DB trigger/Edge function. As it stands, only the render paths protect against stored payloads.
  - id: FE-2
    severity: minor
    location: src/components/ui/RichText.test.tsx:1-33
    evidence: The 4 tests cover handlers, `<script>`, `javascript:` hrefs and https images. They do not cover: SVG/MathML namespace confusion, `<noscript>`/`<template>`/`<iframe srcdoc>`, `style`/`url()`, mixed-case or whitespace-obfuscated `javascript:`, `data:image/svg+xml` and `data:text/html`, or attribute-quote breakout. No test mounts `RichTextEditor` itself, so a test would not catch a revert of line 52 to `innerHTML =`. The semgrep rule `.semgrep/timhirt-security.yml:23` (`$X.innerHTML = $V`) would catch it, which is why this is minor.
    reference: Plan §0 rule 4 (failing-then-passing test)
    fix: Add those payloads to RichText.test.tsx (I ran them all as a probe and they passed; see CHECKED). Add one RichTextEditor render test that loads `<img src=x onerror=...>` and asserts the editor DOM has no `on*` attribute.
  - id: FE-3
    severity: info
    location: src/components/ui/RichText.test.tsx (environment)
    evidence: All sanitizer checks, including mine, ran under happy-dom, not a real browser parser. Not verifiable here: how Chromium/Firefox handle these payloads in the DOMParser-then-rebuild path. The design makes this low-risk: every output node is built fresh with `createElement`/`createTextNode` and gets only allow-listed attributes, so a parser difference can change the text but cannot create an attribute.
    reference: CLAUDE.md "Verification means running the thing"
    fix: Add a Playwright check that opens a notice containing `<img src=x onerror>` for editing and asserts no dialog or console event fires.
  - id: FE-4
    severity: info
    location: src/components/ui/RichText.tsx:18, src/components/ui/RichTextEditor.tsx (addImage), vercel.json:9
    evidence: The sanitizer and the editor accept any `https:` image. The CSP only allows `img-src 'self' data: https://*.supabase.co`, so images from other hosts are blocked in production. This is a functional mismatch, not a security gap, and the CSP stops tracking pixels. Links to any https host are allowed and always get `target="_blank" rel="noopener noreferrer"`.
    reference: OWASP A05
    fix: Optionally restrict `SAFE_IMG_SRC` to Supabase storage signed URLs to match the CSP. Log it in the backlog.
  - id: FE-5
    severity: info
    location: vite.config.ts:11-18
    evidence: The build produces `<meta name="app-commit" content="b3aeaf39db783e7e2badb97b5c65af3f4f818c9d">`. The env value is checked against `/^[0-9a-f]{7,40}$/`. The `git rev-parse` fallback is not checked, but Vite escapes the attribute value. The tag only exposes a public commit SHA, which tells an attacker the exact version but nothing secret.
    reference: INSA Phase 3 information disclosure (low)
    fix: None required. Optionally apply the same hex check to the git fallback.

CHECKED:
  - Read the plan's §0, §0A.4 and WP-01, and the full diff. Only these 4 files changed. The working tree is at b3aeaf3, whose only change from 744f1d4 is outside src/, vite.config.ts and index.html.
  - `sanitizeRichTextNodes` uses the same allow-list as `RichText`. Tags not on the list keep only their text. The only attributes ever kept are href on `a`, which must match `^(https?:|mailto:|tel:)`, and src/alt on `img`, which must match https or base64 png/jpeg/gif/webp. `style`, `class`, `id` and all `on*` attributes are dropped. All nodes are created with `createElement`/`createTextNode` in the live document. Parsing happens in an inert DOMParser document, so scripts and image loads never run there.
  - Ran a probe under happy-dom with these payloads, all neutralised:
    - SVG `<a href=javascript:>` and `<animate onbegin>` became a plain `<a>` with no href.
    - The MathML/`mglyph`/`style` mXSS chain and the `<noscript>` title breakout produced nothing executable.
    - `" javascript:"`, `JaVaScRiPt:` and `java&#x09;script:` were all dropped.
    - `data:image/svg+xml` and `data:text/html` were dropped.
    - `style=url(javascript:)` was dropped.
    - A quote-breakout href stayed inside the escaped attribute.
    - `template`/`iframe srcdoc`/`form formaction`/`base` were dropped.
    - Entity-encoded text stayed as text.
  - No `innerHTML =`, `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `outerHTML` or `eval` appears in src/ outside comments. `emit()` only reads innerHTML. No inline script is added, and the meta tag is CSP-safe.
  - Rendered links keep `rel="noopener noreferrer"` and `target="_blank"`. No redirect or token-handling code is in this diff.
  - `npx vitest run src/components/ui`: 4/4 pass. `npm run build`: exit 0.
  - Grepped dist for secrets: no JWT-shaped strings. The only `sb_secret_`/`service_role`-like matches are supabase-js key-format validation strings, not keys.
  - The semgrep rule `.semgrep/timhirt-security.yml:23` flags `$X.innerHTML = $V`, which guards against the editor fix being reverted.
  - Not in scope and not checked: signed-URL file previews, the WP-20 host/tenant check, and route guards (this diff does not touch them).

I did not write `/tmp/review-*.md`. The probe test is at `/tmp/claude-0/-home-user-timhirt-school-saas/1305e095-5767-5b84-af04-2715e7c2b0fb/scratchpad/probe.test.tsx`.
