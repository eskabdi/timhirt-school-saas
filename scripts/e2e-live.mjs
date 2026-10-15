#!/usr/bin/env node
// ============================================================================
// Live end-to-end harness — drives the DEPLOYED system (Vercel frontend +
// Supabase PostgREST / Auth / Storage / Edge Functions) the way a browser and
// an attacker holding the public anon key would. Driven by the
// `live-e2e-tester` subagent (.claude/agents/live-e2e-tester.md); usable on
// its own too.
//
// NON-MUTATING BY DESIGN. It never POSTs to submit-admission (5/h per IP and
// writes an applicant row), telebirr-notify (inbound signature is NOT
// verified — an unsigned "Completed" event settles a real invoice), or any
// JWT-gated function, and never inserts/updates/deletes through PostgREST.
// The only writes it causes are the ones logging in causes (GoTrue session
// rows, last_sign_in_at, one check-login-attempt token per account).
//
// Layers (--layers, default all):
//   frontend  bundle has env baked in, no service_role key, headers match
//             vercel.json, SPA rewrite, fonts are real TTFs, no source maps
//   functions every repo function is deployed; verify_jwt from config.toml
//             is what the gateway actually enforces, in both directions
//   rest      anon key reads zero rows from every table/view in migrations;
//             RPCs/tables the anon role can see in the OpenAPI root
//   storage   anon key lists nothing in any private bucket
//   public    anonymous endpoints answer sanely (no 5xx) at minimal cost
//   ui        headless Chromium on public pages: page errors, CSP
//             violations, failed requests, Ge'ez numerals, locale switching
//   auth      (needs --creds) per-role login through the real form, profile
//             role check, nav crawl of every page the role is shown,
//             forbidden-route bounce, privilege + cross-tenant RLS probes,
//             storage cross-tenant probe, logout revokes the refresh token
//
//   node scripts/e2e-live.mjs --self-test     # prove it catches planted bugs
//   node scripts/e2e-live.mjs                 # anonymous layers vs production
//   node scripts/e2e-live.mjs --creds ~/e2e-creds.json --out <dir>
//
// Credentials file (chmod 600, never committed) — every account optional:
//   { "tenant_slug": "tenant-a",
//     "accounts": { "school_admin":   {"email": "...", "password": "..."},
//                   "school_admin_b": {...}, "teacher": {...}, ... } }
// Keys: super_admin, school_admin, school_admin_b (second tenant, enables the
// cross-tenant probes), teacher, student, parent, hr_officer, accountant,
// registrar, librarian. Passwords, tokens and emails are never printed —
// accounts are reported by role key only.
//
// Exit code: 0 = no FAIL, 1 = at least one FAIL, 2 = harness error.
// ============================================================================
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE = "https://timhirt-school-saas.vercel.app";
const ALL_LAYERS = ["frontend", "functions", "rest", "storage", "public", "ui", "auth"];

// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1
// (Node >= 22.21). Re-exec once with it set; NO_PROXY keeps localhost direct
// for --self-test.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 2);
}

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { expect: [], layers: ALL_LAYERS, maxPages: 60 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v; };
    if (a === "--base") o.base = next();
    else if (a === "--creds") o.creds = next();
    else if (a === "--out") o.out = next();
    else if (a === "--expect") o.expect.push(next());
    else if (a === "--layers") o.layers = next().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--supabase-url") o.supabaseUrl = next();
    else if (a === "--anon-key") o.anonKey = next();
    else if (a === "--max-pages") o.maxPages = Number(next());
    else if (a === "--self-test") o.selfTest = true;
    else if (a === "--help" || a === "-h") o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  o.base = (o.base || process.env.E2E_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  o.creds = o.creds || process.env.E2E_CREDS_FILE;
  for (const l of o.layers) if (!ALL_LAYERS.includes(l)) throw new Error(`unknown layer ${l}`);
  return o;
}

// ------------------------------------------------------------------ results
function makeReporter() {
  const results = [];
  const add = (layer, id, status, detail = "") => results.push({ layer, id, status, detail });
  return {
    results,
    pass: (l, id, d) => add(l, id, "PASS", d),
    fail: (l, id, d) => add(l, id, "FAIL", d),
    warn: (l, id, d) => add(l, id, "WARN", d),
    skip: (l, id, d) => add(l, id, "SKIP", d),
  };
}

// ------------------------------------------------------------ repo parsing
// Everything the harness expects is derived from the repo at run time, so it
// cannot drift from the code it is testing.
function repoFunctions() {
  const dir = path.join(REPO, "supabase/functions");
  const slugs = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && fs.existsSync(path.join(dir, d.name, "index.ts")))
    .map((d) => d.name).sort();
  const toml = fs.readFileSync(path.join(REPO, "supabase/config.toml"), "utf8");
  const cfg = {};
  let cur = null;
  for (const line of toml.split("\n")) {
    const sec = line.match(/^\s*\[functions\.([a-z0-9-]+)\]/);
    if (sec) { cur = sec[1]; continue; }
    if (/^\s*\[/.test(line)) { cur = null; continue; }
    const vj = line.match(/^\s*verify_jwt\s*=\s*(true|false)/);
    if (cur && vj) cfg[cur] = vj[1] === "true";
  }
  return { slugs, cfg };
}

function migrationsText() {
  const dir = path.join(REPO, "supabase/migrations");
  return fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
}

function repoRelations(sql) {
  const tables = new Set(), views = new Set(), dropped = new Set();
  for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) tables.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/create (?:or replace )?view (?:public\.)?([a-z_][a-z0-9_]*)/gi)) views.add(m[1].toLowerCase());
  for (const m of sql.matchAll(/drop (?:table|view) (?:if exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) dropped.add(m[1].toLowerCase());
  return [...tables, ...views].filter((t) => !dropped.has(t)).sort();
}

function repoBuckets(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/\(\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9-]+)'\s*,\s*(true|false)\s*,/g)) {
    if (m[1] === m[2]) out.set(m[1], m[3] === "true");
  }
  return out;
}

function repoHeaders() {
  const v = JSON.parse(fs.readFileSync(path.join(REPO, "vercel.json"), "utf8"));
  const block = (v.headers || []).find((h) => h.source === "/(.*)");
  return block ? block.headers : [];
}

// ------------------------------------------------------------------- utils
const TIMEOUT_MS = 30_000;
async function req(url, init = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeout ?? TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "manual", ...init, signal: ctl.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, buf, text: buf.toString("utf8"), json };
  } catch (e) {
    return { status: 0, headers: new Headers(), buf: Buffer.alloc(0), text: "", json: null, error: e.name === "AbortError" ? "timeout" : e.message };
  } finally { clearTimeout(t); }
}

function jwtPayload(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return null; }
}

const anonHeaders = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
const userHeaders = (key, token) => ({ apikey: key, Authorization: `Bearer ${token}` });
const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url);
const brief = (r) => r.error ? `network error: ${r.error}` : `HTTP ${r.status}`;
// Ge'ez numerals ፩–፼ (U+1369–U+137C) are banned in rendered output — Arabic
// numerals only, Ethiopian calendar included.
const GEEZ_NUMERAL = /[\u1369-\u137C]/;
const ETHIOPIC = /[\u1200-\u137F]/g;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE, "playwright",
    "/opt/node22/lib/node_modules/playwright",
    process.env.NODE_PATH ? path.join(process.env.NODE_PATH, "playwright") : null,
  ].filter(Boolean);
  for (const c of candidates) { try { return require(c); } catch { /* try next */ } }
  return null;
}

function chromiumPath() {
  for (const p of [process.env.E2E_CHROMIUM, "/opt/pw-browsers/chromium"]) if (p && fs.existsSync(p)) return p;
  return undefined;
}

// ================================================================ frontend
async function layerFrontend(ctx) {
  const L = "frontend", r = ctx.r;
  const home = await req(`${ctx.base}/`);
  if (home.status !== 200) { r.fail(L, "index", `${ctx.base}/ -> ${brief(home)}`); return; }
  const bundlePath = home.text.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!bundlePath) { r.fail(L, "index", "index.html references no assets/index-*.js bundle"); return; }
  r.pass(L, "index", `200, bundle ${bundlePath}`);

  const bundle = await req(`${ctx.base}/${bundlePath}`);
  if (bundle.status !== 200) { r.fail(L, "bundle", `${bundlePath} -> ${brief(bundle)}`); return; }
  const js = bundle.text;

  const url = js.match(/https:\/\/[a-z0-9]{20}\.supabase\.co/)?.[0];
  const jwts = [...new Set(js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [])];
  const roles = jwts.map((t) => ({ t, role: jwtPayload(t)?.role }));
  const service = roles.filter((x) => x.role === "service_role");
  if (service.length) r.fail(L, "no-service-role-key", `CRITICAL: ${service.length} service_role JWT(s) shipped in the public bundle — rotate the key now`);
  else r.pass(L, "no-service-role-key", "no service_role JWT in bundle");
  const anon = roles.find((x) => x.role === "anon");
  if (!url || !anon) {
    r.fail(L, "env-baked-in", `VITE_SUPABASE_URL ${url ? "present" : "MISSING"}, anon key ${anon ? "present" : "MISSING"} — app is a blank page ("supabaseUrl is required"); was it built with --prebuilt?`);
  } else r.pass(L, "env-baked-in", `Supabase URL and anon key baked in (${url})`);
  ctx.supabaseUrl ||= url;
  ctx.anonKey ||= anon?.t;

  for (const s of ctx.expect) {
    if (js.includes(s)) r.pass(L, "expect", `bundle contains ${JSON.stringify(s)}`);
    else r.fail(L, "expect", `bundle does NOT contain ${JSON.stringify(s)} — the change is not live`);
  }

  for (const { key, value } of repoHeaders()) {
    const live = home.headers.get(key);
    if (live === null) r.fail(L, "header", `${key} missing (vercel.json sets it)`);
    else if (live.trim() !== value.trim()) r.fail(L, "header", `${key} differs from vercel.json — live: ${live.slice(0, 160)}`);
    else r.pass(L, "header", key);
  }

  const deep = await req(`${ctx.base}/students`);
  if (deep.status === 200 && deep.text.includes(bundlePath)) r.pass(L, "spa-rewrite", "/students serves index.html");
  else r.fail(L, "spa-rewrite", `/students -> ${brief(deep)}; deep links will 404 on reload`);

  for (const f of fs.readdirSync(path.join(REPO, "public/fonts"))) {
    const font = await req(`${ctx.base}/fonts/${f}`);
    const magic = font.buf.subarray(0, 4).toString("hex");
    if (font.status === 200 && ["00010000", "74727565", "4f54544f"].includes(magic)) r.pass(L, "font", `${f} (${font.buf.length} bytes)`);
    else r.fail(L, "font", `${f} -> ${brief(font)}, ${font.buf.length} bytes, magic ${magic || "none"} — SPA rewrite is answering with index.html; Ethiopic falls back to a font without glyphs`);
  }

  const map = await req(`${ctx.base}/${bundlePath}.map`);
  if (map.status === 200 && map.json?.mappings) r.warn(L, "source-map", "source map is publicly served (information disclosure)");
  else r.pass(L, "source-map", "no public source map");
}

// =============================================================== functions
async function layerFunctions(ctx) {
  const L = "functions", r = ctx.r;
  const { slugs, cfg } = repoFunctions();
  for (const s of slugs) if (!(s in cfg)) r.warn(L, "config-drift", `${s} has no [functions.${s}] block in config.toml (Supabase defaults verify_jwt=true)`);
  for (const s of Object.keys(cfg)) if (!slugs.includes(s)) r.warn(L, "config-drift", `config.toml configures ${s}, which has no function directory`);

  for (const slug of slugs) {
    const verifyJwt = cfg[slug] ?? true;
    const url = `${ctx.supabaseUrl}/functions/v1/${slug}`;
    // GET, no headers: every function rejects GET before rate-limiting or
    // touching data, so this costs nothing and changes nothing.
    const bare = await req(url);
    if (bare.status === 404) { r.fail(L, "deployed", `${slug} -> 404: in the repo but NOT deployed`); continue; }
    if (bare.status === 0 || bare.status >= 500) { r.fail(L, "deployed", `${slug} -> ${brief(bare)}`); continue; }
    if (verifyJwt) {
      if (bare.status === 401) r.pass(L, "jwt-gate", `${slug} (verify_jwt=true) rejects anonymous: 401`);
      else r.fail(L, "jwt-gate", `${slug} is verify_jwt=true in config.toml but answered ${bare.status} with no Authorization — deployed with --no-verify-jwt?`);
      // The anon key is itself a valid JWT, so it passes the gateway; the
      // function body must still refuse it.
      const anon = await req(url, { headers: anonHeaders(ctx.anonKey) });
      if (anon.status >= 200 && anon.status < 300) r.fail(L, "role-gate", `${slug} returned ${anon.status} to the PUBLIC anon key`);
      else r.pass(L, "role-gate", `${slug} refuses the anon key: ${anon.status}`);
    } else if (bare.status === 401) {
      r.fail(L, "public-reachable", `${slug} is verify_jwt=false (public) but the gateway demands a JWT — anonymous users cannot reach it`);
    } else r.pass(L, "public-reachable", `${slug} (public) reachable without JWT: ${bare.status}`);
  }
}

// ==================================================================== rest
async function layerRest(ctx) {
  const L = "rest", r = ctx.r;
  const rels = repoRelations(ctx.sql);
  const leaks = [], errorsSeen = [];
  let denied = 0, empty = 0, missing = 0;
  for (const t of rels) {
    const res = await req(`${ctx.supabaseUrl}/rest/v1/${t}?select=*&limit=1`, { headers: anonHeaders(ctx.anonKey) });
    if (res.status === 200 && Array.isArray(res.json) && res.json.length > 0) leaks.push(t);
    else if (res.status === 200) empty++;
    else if (res.status === 401 || res.status === 403) denied++;
    else if (res.status === 404) missing++;
    else errorsSeen.push(`${t}: ${brief(res)}`);
  }
  for (const t of leaks) r.fail(L, "anon-read", `anon key READ ROWS from ${t} — RLS/grant hole`);
  for (const e of errorsSeen) r.warn(L, "anon-read", e);
  if (!leaks.length) r.pass(L, "anon-read", `${rels.length} relations: ${denied} denied, ${empty} empty, ${missing} not exposed, 0 readable by anon`);
  if (missing > rels.length / 2) r.warn(L, "anon-read", `${missing}/${rels.length} relations 404 — migrations probably not applied to this project`);

  // Read-only inventory: PostgREST's OpenAPI root lists what the calling
  // role holds privileges on. Never executes anything.
  const oa = await req(`${ctx.supabaseUrl}/rest/v1/`, { headers: anonHeaders(ctx.anonKey) });
  if (oa.status === 200 && oa.json?.paths) {
    const rpcs = Object.keys(oa.json.paths).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5));
    const tabs = Object.keys(oa.json.paths).filter((p) => p !== "/" && !p.startsWith("/rpc/")).map((p) => p.slice(1));
    if (rpcs.length) r.warn(L, "anon-rpc-surface", `${rpcs.length} RPC(s) executable by anon (EXECUTE defaults to PUBLIC — each must re-check the caller): ${rpcs.join(", ")}`);
    else r.pass(L, "anon-rpc-surface", "no RPCs executable by anon");
    if (tabs.length) r.warn(L, "anon-grant-surface", `anon holds privileges on ${tabs.length} relation(s) (RLS still filters): ${tabs.slice(0, 40).join(", ")}${tabs.length > 40 ? ", …" : ""}`);
  } else r.pass(L, "anon-rpc-surface", `OpenAPI root not served to anon (${brief(oa)})`);
}

// ================================================================= storage
async function layerStorage(ctx) {
  const L = "storage", r = ctx.r;
  const buckets = repoBuckets(ctx.sql);
  const listed = await req(`${ctx.supabaseUrl}/storage/v1/bucket`, { headers: anonHeaders(ctx.anonKey) });
  if (listed.status === 200 && Array.isArray(listed.json)) {
    const visiblePrivate = listed.json.filter((b) => b && b.public === false).map((b) => b.name);
    if (visiblePrivate.length) r.warn(L, "bucket-list", `anon can enumerate private buckets: ${visiblePrivate.join(", ")}`);
    else r.pass(L, "bucket-list", `anon sees ${listed.json.length} bucket(s), none private`);
  } else r.pass(L, "bucket-list", `bucket listing refused to anon (${brief(listed)})`);

  for (const [name, isPublic] of buckets) {
    if (isPublic) { r.skip(L, "anon-list", `${name} is a public bucket by design`); continue; }
    const res = await req(`${ctx.supabaseUrl}/storage/v1/object/list/${name}`, {
      method: "POST", headers: { ...anonHeaders(ctx.anonKey), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 5 }),
    });
    if (res.status === 200 && Array.isArray(res.json) && res.json.length) r.fail(L, "anon-list", `anon listed ${res.json.length} object(s) in PRIVATE bucket ${name}`);
    else r.pass(L, "anon-list", `${name}: ${res.status === 200 ? "empty" : brief(res)}`);
  }
}

// ================================================================== public
async function layerPublic(ctx) {
  const L = "public", r = ctx.r;
  const fn = (slug) => `${ctx.supabaseUrl}/functions/v1/${slug}`;
  const post = (slug, body) => req(fn(slug), {
    method: "POST", headers: { ...anonHeaders(ctx.anonKey), "Content-Type": "application/json", Origin: ctx.base },
    body: JSON.stringify(body),
  });
  const sane = (id, res, ok) => {
    if (res.status === 429) r.warn(L, id, "429 rate-limited — rerun later; proxy egress IPs are shared");
    else if (res.status === 0 || res.status >= 500) r.fail(L, id, `${brief(res)} — anonymous endpoint is erroring`);
    else if (ok(res)) r.pass(L, id, brief(res));
    else r.fail(L, id, `unexpected ${brief(res)}: ${res.text.slice(0, 160)}`);
  };

  const pre = await req(fn("verify-id"), { method: "OPTIONS", headers: { Origin: ctx.base, "Access-Control-Request-Method": "POST" } });
  const acao = pre.headers.get("access-control-allow-origin");
  if (acao === "*" || acao === ctx.base) r.pass(L, "cors-preflight", `allow-origin ${acao}`);
  else r.fail(L, "cors-preflight", `preflight from ${ctx.base} -> ${brief(pre)}, allow-origin ${acao} — browser calls to public functions will fail`);

  sane("sso-domain-lookup", await post("sso-domain-lookup", { email: "e2e-probe@example.invalid" }), (x) => x.status === 200 && x.json !== null);
  sane("verify-id-unknown", await post("verify-id", { code: "E2E-PROBE-0000" }), (x) => x.status < 500 && x.json !== null);
  sane("admission-status-unknown",
    await post("check-admission-status", { tenant_slug: ctx.tenantSlug || "e2e-no-such-tenant", tracking_code: "E2EPROBE0" }),
    (x) => (x.status >= 400 && x.status < 500) || (x.status === 200 && x.json !== null));
  sane("admission-grades-unknown-tenant",
    await req(`${fn("submit-admission")}?tenant_slug=e2e-no-such-tenant`, { headers: anonHeaders(ctx.anonKey) }),
    (x) => x.status >= 400 && x.status < 500);
  if (ctx.tenantSlug) {
    sane("admission-grades",
      await req(`${fn("submit-admission")}?tenant_slug=${encodeURIComponent(ctx.tenantSlug)}`, { headers: anonHeaders(ctx.anonKey) }),
      (x) => x.status === 200 && x.json !== null && typeof x.json === "object");
  } else r.skip(L, "admission-grades", "no tenant_slug in creds file");
  r.skip(L, "never-called", "submit-admission POST, telebirr-notify POST, check-login-attempt (outside real logins): mutating or lockout-burning by design");
  r.skip(L, "realtime", "WebSocket upgrades are not supported through the agent proxy — Realtime is covered by pgTAP RLS only");
}

// ====================================================================== ui
function watchPage(page, supabaseHost) {
  const issues = [];
  page.on("pageerror", (e) => issues.push({ kind: "pageerror", msg: String(e.message || e).slice(0, 300) }));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    issues.push({ kind: /Content Security Policy|Refused to/.test(t) ? "csp" : "console", msg: t.slice(0, 300) });
  });
  page.on("requestfailed", (q) => {
    const err = q.failure()?.errorText || "";
    if (!/ERR_ABORTED/.test(err)) issues.push({ kind: "requestfailed", msg: `${q.url().slice(0, 160)} ${err}` });
  });
  page.on("response", (res) => {
    if (supabaseHost && res.url().includes(supabaseHost) && res.status() >= 400) {
      issues.push({ kind: `supabase-${res.status()}`, msg: `${res.request().method()} ${res.url().replace(/[?#].*/, "").slice(0, 160)}` });
    }
  });
  return issues;
}

async function newBrowser(ctx) {
  const pw = loadPlaywright();
  if (!pw) return null;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  return pw.chromium.launch({
    executablePath: chromiumPath(),
    proxy: proxyUrl && !isLocal(ctx.base) ? { server: proxyUrl, bypass: "localhost,127.0.0.1" } : undefined,
  });
}

// Page errors, CSP violations and Supabase 400-403/5xx are failures: a 400
// from PostgREST is usually a column the deployed schema does not have (the
// frontend shipped ahead of its migration), a 401/403 a missing column grant.
const HARD_KIND = /^(pageerror|csp|supabase-(40[0-3]|5\d\d))$/;
async function inspect(ctx, page, issues, L, id) {
  const r = ctx.r;
  const before = r.results.length;
  const text = await page.locator("body").innerText().catch(() => "");
  if (/Unexpected Application Error/.test(text)) r.fail(L, id, "React Router error screen rendered");
  if (!text.trim()) r.fail(L, id, "page rendered no text (blank page)");
  const geez = text.match(GEEZ_NUMERAL);
  if (geez) r.fail(L, `${id}:geez-numerals`, `Ge'ez numeral "${geez[0]}" rendered — Arabic numerals only`);
  const byKind = {};
  for (const i of issues) (byKind[i.kind] ||= []).push(i.msg);
  for (const [k, msgs] of Object.entries(byKind)) {
    (HARD_KIND.test(k) ? r.fail : r.warn)(L, `${id}:${k}`, `${msgs.length}x ${msgs[0]}`);
  }
  return { text, clean: r.results.length === before };
}

async function shot(ctx, page, name) {
  if (!ctx.out) return;
  await page.screenshot({ path: path.join(ctx.out, `${name.replace(/[^a-z0-9_-]+/gi, "_")}.png`), fullPage: true }).catch(() => {});
}

const goto = (page, url) => page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });

async function layerUi(ctx) {
  const L = "ui", r = ctx.r;
  const browser = await newBrowser(ctx);
  if (!browser) { r.skip(L, "chromium", "playwright not resolvable — set PLAYWRIGHT_MODULE"); return; }
  const host = ctx.supabaseUrl ? new URL(ctx.supabaseUrl).host : null;
  try {
    const pages = [["/login", "login"], ["/verify", "verify"]];
    if (ctx.tenantSlug) pages.push([`/apply/${ctx.tenantSlug}`, "apply"], [`/apply/${ctx.tenantSlug}/status`, "apply-status"]);
    for (const [route, id] of pages) {
      const page = await browser.newPage();
      const issues = watchPage(page, host);
      const err = await goto(page, ctx.base + route).then(() => null, (e) => e);
      if (err) { r.fail(L, id, `navigation failed: ${String(err.message).slice(0, 160)}`); await page.close(); continue; }
      const { clean } = await inspect(ctx, page, issues, L, id);
      if (clean) r.pass(L, id, `${route} rendered clean`);
      await shot(ctx, page, `public${route}`);
      await page.close();
    }

    // Unknown route -> "/" -> RequireAuth -> /login.
    const page = await browser.newPage();
    await goto(page, `${ctx.base}/e2e-no-such-route`).catch(() => {});
    const landed = new URL(page.url()).pathname;
    if (landed === "/login") r.pass(L, "unauth-redirect", "unknown route as anonymous lands on /login");
    else r.fail(L, "unauth-redirect", `anonymous user on an unknown route ended at ${landed}`);

    // Locale switching on /login. LanguageSwitcher is a <select> (a short-
    // label one for mobile and a full-label one for desktop — drive the
    // visible one). am must render Ethiopic with a self-hosted Ethiopic font
    // actually loaded; om must change the copy.
    await goto(page, `${ctx.base}/login`).catch(() => {});
    const bodyText = () => page.locator("body").innerText().catch(() => "");
    const enText = await bodyText();
    const switcher = page.locator("select:visible").filter({ has: page.locator('option[value="am"]') }).first();
    if (await switcher.count()) {
      await switcher.selectOption("am");
      await page.waitForTimeout(800);
      const amText = await bodyText();
      const fontsLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        // FontFaceSet.check() answers true for families with no @font-face at
        // all, so read the actual load status of the declared faces instead.
        return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, ""));
      });
      const ethiopicFonts = fontsLoaded.filter((f) => ["Tayitu", "Jiret", "NotoSerifEthiopic"].includes(f));
      const ethiopicChars = (amText.match(ETHIOPIC) || []).length;
      if (ethiopicChars > 20) r.pass(L, "locale-am", `${ethiopicChars} Ethiopic characters rendered`);
      else r.fail(L, "locale-am", `switching to am rendered ${ethiopicChars} Ethiopic characters — copy not translated`);
      if (ethiopicFonts.length) r.pass(L, "font-ethiopic", `loaded: ${ethiopicFonts.join(", ")}`);
      else r.warn(L, "font-ethiopic", "no self-hosted Ethiopic font (Tayitu/Jiret/NotoSerifEthiopic) loaded after switching to am");
      if (GEEZ_NUMERAL.test(amText)) r.fail(L, "locale-am:geez-numerals", "Ge'ez numerals in the Amharic UI");
      await shot(ctx, page, "public_login_am");
      await switcher.selectOption("om");
      await page.waitForTimeout(800);
      const omText = await bodyText();
      if (omText !== enText && omText !== amText) r.pass(L, "locale-om", "Afaan Oromoo copy differs from en and am");
      else r.fail(L, "locale-om", "switching to om did not change the copy");
      await switcher.selectOption("en");
    } else r.fail(L, "locale-switch", "no visible language <select> offering am on /login");
    await page.close();
  } finally { await browser.close(); }
}

// ==================================================================== auth
const ROLE_KEYS = ["super_admin", "school_admin", "school_admin_b", "teacher", "student", "parent",
  "hr_officer", "accountant", "registrar", "librarian"];
// Routes each role must be bounced away from (RequireRole -> "/"). Mirrors
// the role constants in src/app/router.tsx — keep in step with it.
const FORBIDDEN = {
  school_admin: ["/platform"],
  teacher: ["/hr/payroll", "/fees/invoices", "/settings/access", "/students", "/platform"],
  student: ["/students", "/hr/payroll", "/fees/invoices", "/settings/access", "/portal/pay", "/platform"],
  parent: ["/students", "/hr/payroll", "/fees/invoices", "/settings/access", "/portal/grades", "/platform"],
  hr_officer: ["/fees/invoices", "/students", "/settings/access", "/platform"],
  accountant: ["/hr/employees", "/students", "/settings/access", "/platform"],
  registrar: ["/hr/payroll", "/fees/invoices", "/settings/access", "/platform"],
  librarian: ["/hr/payroll", "/fees/invoices", "/students", "/settings/access", "/platform"],
};
// Relations a student or parent must never see a single row of.
const NEVER_FOR_FAMILY = ["employees", "employee_salary_components", "employment_contracts", "payroll_runs",
  "payslips", "payslip_lines", "audit_logs", "platform_integrations", "telebirr_token_cache", "rate_limits",
  "webhook_events", "impersonation_sessions", "hr_employee_sensitive", "backup_jobs", "restore_jobs",
  "user_permission_overrides", "tenant_sso_providers"];
// Platform-internal relations no tenant role may read.
const PLATFORM_ONLY = ["platform_integrations", "telebirr_token_cache", "rate_limits", "webhook_events"];

function loadCreds(file) {
  const st = fs.statSync(file);
  if (st.mode & 0o077) throw new Error(`${file} is readable by group/other — chmod 600 it first`);
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  const accounts = {};
  for (const [k, v] of Object.entries(c.accounts || {})) {
    if (!ROLE_KEYS.includes(k)) throw new Error(`unknown account key ${k} (expected one of ${ROLE_KEYS.join(", ")})`);
    if (v?.email && v?.password) accounts[k] = v;
  }
  return { tenantSlug: c.tenant_slug, accounts };
}

// One login per account, through the real two-step form (which consumes one
// check-login-attempt token: 5 per email per 15 min). The session it leaves
// in localStorage is reused for every API probe, so nothing logs in twice.
async function uiLogin(ctx, browser, roleKey, acct, L) {
  const r = ctx.r;
  const context = await browser.newContext();
  const page = await context.newPage();
  const fail = (d) => { r.fail(L, `${roleKey}:login`, d); return { context, page, ok: false }; };
  await goto(page, `${ctx.base}/login`);
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('button[type="submit"]').click();
  const pw = page.locator('input[type="password"]');
  await pw.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  if (!(await pw.count())) return fail(`password step never appeared (SSO-routed domain or sso-domain-lookup failing) — now at ${new URL(page.url()).pathname}`);
  await pw.fill(acct.password);
  await page.locator('button[type="submit"]').click();
  const left = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 }).then(() => true, () => false);
  if (!left) {
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    return fail(`still on /login after submit — ${/locked|try again|\d+:\d\d/i.test(text) ? "LOCKED OUT by check-login-attempt (wait out the window; do not retry)" : "credentials rejected or sign-in broken"}`);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  const ref = new URL(ctx.supabaseUrl).host.split(".")[0];
  const session = await page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }, `sb-${ref}-auth-token`);
  if (!session?.access_token) return fail("logged in but no Supabase session in localStorage");
  r.pass(L, `${roleKey}:login`, `through the real form -> ${new URL(page.url()).pathname}`);
  return { context, page, ok: true, session };
}

async function rowsVisible(ctx, token, rel, query = "") {
  const res = await req(`${ctx.supabaseUrl}/rest/v1/${rel}?select=*&limit=1${query}`, { headers: userHeaders(ctx.anonKey, token) });
  return { n: res.status === 200 && Array.isArray(res.json) ? res.json.length : 0, res };
}

async function crawl(ctx, roleKey, page, L) {
  const r = ctx.r;
  const host = new URL(ctx.supabaseUrl).host;
  const isPlatform = roleKey === "super_admin";
  if (isPlatform) await goto(page, `${ctx.base}/platform`).catch(() => {});
  const sel = isPlatform ? 'a[href^="/platform"]' : 'nav a[href^="/"], header a[href^="/"]';
  const hrefs = [...new Set(await page.locator(sel).evaluateAll((as) => as.map((a) => a.getAttribute("href"))))]
    .filter((h) => h && !h.startsWith("//")).slice(0, ctx.maxPages);
  if (!hrefs.length) { r.fail(L, `${roleKey}:nav`, "no navigation links rendered after login"); return; }
  r.pass(L, `${roleKey}:nav`, `${hrefs.length} nav link(s) to crawl`);
  let clean = 0;
  for (const href of hrefs) {
    const issues = watchPage(page, host);
    await goto(page, ctx.base + href).catch(() => {});
    await page.waitForTimeout(400);
    const landed = new URL(page.url()).pathname;
    const id = `${roleKey}:${href}`;
    if (landed.startsWith("/login")) { r.fail(L, id, "session lost — bounced to /login"); page.removeAllListeners(); return; }
    const bounced = landed === "/" && href.replace(/[?#].*/, "") !== "/";
    if (bounced) r.fail(L, id, "nav shows this link but the route guard bounces the role to /");
    const { clean: ok } = await inspect(ctx, page, issues, L, id);
    if (ok && !bounced) clean++;
    await shot(ctx, page, `${roleKey}${href}`);
    page.removeAllListeners();
  }
  (clean === hrefs.length ? r.pass : r.warn)(L, `${roleKey}:crawl`, `${clean}/${hrefs.length} page(s) with no errors, warnings or failed Supabase calls`);
}

async function layerAuth(ctx) {
  const L = "auth", r = ctx.r;
  if (!ctx.creds) { r.skip(L, "creds", "no --creds file: per-role login, nav crawl and RLS probes not run"); return; }
  const accounts = ctx.creds.accounts;
  if (!Object.keys(accounts).length) { r.skip(L, "creds", "creds file has no usable accounts"); return; }
  const browser = await newBrowser(ctx);
  if (!browser) { r.skip(L, "chromium", "playwright not resolvable — set PLAYWRIGHT_MODULE"); return; }
  const sessions = {};
  try {
    for (const roleKey of ROLE_KEYS) {
      const acct = accounts[roleKey];
      if (!acct) { r.skip(L, `${roleKey}:login`, "no account in creds file"); continue; }
      const expectedRole = roleKey.replace(/_b$/, "");
      const s = await uiLogin(ctx, browser, roleKey, acct, L)
        .catch((e) => { r.fail(L, `${roleKey}:login`, String(e.message).slice(0, 200)); return null; });
      if (!s?.ok) { await s?.context?.close(); continue; }
      const token = s.session.access_token;
      const uid = s.session.user?.id;

      const claims = jwtPayload(token) || {};
      const ttl = (claims.exp ?? 0) - (claims.iat ?? 0);
      if (ttl > 0 && ttl <= 3600) r.pass(L, `${roleKey}:jwt-ttl`, `access token lifetime ${ttl}s`);
      else r.warn(L, `${roleKey}:jwt-ttl`, `access token lifetime ${ttl}s (config.toml jwt_expiry = 3600)`);

      const prof = await req(`${ctx.supabaseUrl}/rest/v1/users?id=eq.${uid}&select=role,tenant_id`, { headers: userHeaders(ctx.anonKey, token) });
      const row = Array.isArray(prof.json) ? prof.json[0] : null;
      if (!row) r.fail(L, `${roleKey}:profile`, `no public.users row readable for this account (${brief(prof)}) — app renders blanks`);
      else if (row.role !== expectedRole) r.fail(L, `${roleKey}:profile`, `public.users.role is ${row.role}, expected ${expectedRole}`);
      else r.pass(L, `${roleKey}:profile`, `role ${row.role}${row.tenant_id ? "" : " (no tenant)"}`);
      sessions[roleKey] = { token, refresh: s.session.refresh_token, tenantId: row?.tenant_id };

      await crawl(ctx, roleKey, s.page, L);

      for (const route of FORBIDDEN[expectedRole] || []) {
        await goto(s.page, ctx.base + route).catch(() => {});
        await s.page.waitForTimeout(300);
        const landed = new URL(s.page.url()).pathname;
        if (landed.startsWith(route)) r.fail(L, `${roleKey}:forbidden`, `${route} rendered for ${expectedRole} — RequireRole not applied (RLS must still return nothing)`);
        else r.pass(L, `${roleKey}:forbidden`, `${route} -> ${landed}`);
      }

      const never = ["student", "parent"].includes(expectedRole) ? NEVER_FOR_FAMILY
        : expectedRole === "super_admin" ? [] : PLATFORM_ONLY;
      const seen = [];
      for (const rel of never) { const { n } = await rowsVisible(ctx, token, rel); if (n) seen.push(rel); }
      if (seen.length) r.fail(L, `${roleKey}:privilege`, `${expectedRole} can read rows from: ${seen.join(", ")} — confirm against the policy, then treat as a leak`);
      else if (never.length) r.pass(L, `${roleKey}:privilege`, `0 rows from ${never.length} relation(s) outside the role`);
      await s.context.close();
    }

    // Cross-tenant: each tenant admin filters every relation by the OTHER
    // tenant's id. Relations without tenant_id answer 400 and are skipped.
    const a = sessions.school_admin, b = sessions.school_admin_b;
    if (a?.tenantId && b?.tenantId && a.tenantId !== b.tenantId) {
      const rels = repoRelations(ctx.sql);
      for (const [who, me, other] of [["A->B", a, b], ["B->A", b, a]]) {
        const leaks = [];
        let probed = 0;
        for (const rel of rels) {
          const { n, res } = await rowsVisible(ctx, me.token, rel, `&tenant_id=eq.${other.tenantId}`);
          if (res.status === 200) probed++;
          if (n) leaks.push(rel);
        }
        if (leaks.length) r.fail(L, `cross-tenant:${who}`, `CROSS-TENANT ROWS visible in: ${leaks.join(", ")}`);
        else r.pass(L, `cross-tenant:${who}`, `${probed} tenant-scoped relation(s) probed, 0 foreign rows`);
        const sleaks = [];
        for (const [bucket, isPublic] of repoBuckets(ctx.sql)) {
          if (isPublic) continue;
          const res = await req(`${ctx.supabaseUrl}/storage/v1/object/list/${bucket}`, {
            method: "POST", headers: { ...userHeaders(ctx.anonKey, me.token), "Content-Type": "application/json" },
            body: JSON.stringify({ prefix: `${other.tenantId}/`, limit: 5 }),
          });
          if (res.status === 200 && Array.isArray(res.json) && res.json.length) sleaks.push(bucket);
        }
        if (sleaks.length) r.fail(L, `cross-tenant-storage:${who}`, `foreign tenant objects listed in: ${sleaks.join(", ")}`);
        else r.pass(L, `cross-tenant-storage:${who}`, "no foreign-tenant objects listable in private buckets");
      }
    } else r.skip(L, "cross-tenant", "needs school_admin and school_admin_b accounts in two different tenants");

    // Logout must revoke the refresh token (scope=local: this session only,
    // so a human signed in elsewhere on the same account is not kicked out).
    for (const [roleKey, s] of Object.entries(sessions)) {
      const out = await req(`${ctx.supabaseUrl}/auth/v1/logout?scope=local`, { method: "POST", headers: userHeaders(ctx.anonKey, s.token) });
      const again = await req(`${ctx.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: { apikey: ctx.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: s.refresh }),
      });
      if (out.status >= 300) r.warn(L, `${roleKey}:logout`, `logout -> ${brief(out)}`);
      else if (again.status >= 200 && again.status < 300) r.fail(L, `${roleKey}:logout`, "refresh token still valid after logout");
      else r.pass(L, `${roleKey}:logout`, `refresh token rejected after logout (${again.status})`);
    }
  } finally { await browser.close(); }
}

// ================================================================== runner
async function run(opts) {
  const r = makeReporter();
  const ctx = {
    r, base: opts.base, expect: opts.expect, out: opts.out, maxPages: opts.maxPages,
    supabaseUrl: opts.supabaseUrl, anonKey: opts.anonKey, sql: migrationsText(),
    creds: opts.creds ? loadCreds(opts.creds) : null,
  };
  ctx.tenantSlug = ctx.creds?.tenantSlug;
  if (ctx.out) fs.mkdirSync(ctx.out, { recursive: true });
  const layers = { frontend: layerFrontend, functions: layerFunctions, rest: layerRest, storage: layerStorage, public: layerPublic, ui: layerUi, auth: layerAuth };
  // The frontend layer discovers the Supabase URL and anon key from the
  // served bundle. When it was not requested, run it into a throwaway
  // reporter just for that discovery.
  if (!opts.layers.includes("frontend") && (!ctx.supabaseUrl || !ctx.anonKey)) {
    const probe = { ...ctx, r: makeReporter(), expect: [] };
    await layerFrontend(probe).catch(() => {});
    ctx.supabaseUrl ||= probe.supabaseUrl;
    ctx.anonKey ||= probe.anonKey;
  }
  for (const name of opts.layers) {
    if (name !== "frontend" && name !== "ui" && (!ctx.supabaseUrl || !ctx.anonKey)) {
      r.skip(name, "supabase", "no Supabase URL/anon key (not in bundle; pass --supabase-url/--anon-key)");
      continue;
    }
    try { await layers[name](ctx); }
    catch (e) { r.fail(name, "harness", `layer crashed: ${String(e.stack || e).split("\n").slice(0, 3).join(" | ")}`); }
  }
  return r.results;
}

function printReport(results, out) {
  const icon = { PASS: "ok  ", FAIL: "FAIL", WARN: "warn", SKIP: "skip" };
  let layer = null;
  for (const x of results) {
    if (x.layer !== layer) { layer = x.layer; console.log(`\n== ${layer}`); }
    console.log(`  ${icon[x.status]} ${x.id}${x.detail ? ` — ${x.detail}` : ""}`);
  }
  const count = (s) => results.filter((x) => x.status === s).length;
  console.log(`\n${count("FAIL")} FAIL · ${count("WARN")} WARN · ${count("PASS")} PASS · ${count("SKIP")} SKIP`);
  if (out) {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
    console.log(`report + screenshots: ${out}`);
  }
}

// =============================================================== self-test
// Stands up a deliberately broken stand-in for the whole stack on localhost
// and asserts the harness reports every planted defect. A gate that has
// never been seen to fail proves nothing (two runners in this repo reported
// green while measuring nothing).
async function selfTest() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const fakeJwt = (claims) => `eyJhbGciOiJIUzI1NiJ9.${b64(claims)}.c2lnbmF0dXJlc2lnbmF0dXJl`;
  const anonKey = fakeJwt({ role: "anon" });
  const subOf = (q) => jwtPayload(String(q.headers.authorization || "").replace(/^Bearer /, ""))?.sub;
  const { cfg } = repoFunctions();
  const aProtected = Object.keys(cfg).find((s) => cfg[s] && s !== "run-payroll");

  // Synthetic accounts only. The stand-in derives the role from the email's
  // local part; the creds file is written 0600 like a real one must be.
  const credsFile = path.join(os.tmpdir(), `timhirt-e2e-selftest-${process.pid}.json`);
  const acct = (k) => ({ email: `${k}@selftest.invalid`, password: "selftest-not-a-secret" });
  fs.writeFileSync(credsFile, JSON.stringify({ accounts: { school_admin: acct("school_admin"), school_admin_b: acct("school_admin_b"), student: acct("student") } }), { mode: 0o600 });

  const shell = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}<script src="/assets/index-SELFTEST.js"></script></body></html>`;
  // Two-step email-then-password form, like LoginPage; stores a session
  // under the same localStorage key supabase-js uses (ref "127").
  const LOGIN = shell(`<select aria-label="Language" style="display:none"><option value="en">EN</option><option value="am">አማ</option></select>
<select aria-label="Language" id="lang"><option value="en">English</option><option value="am">አማርኛ</option><option value="om">Afaan Oromoo</option></select>
<style>@font-face { font-family: "Tayitu"; src: url("/selftest/Tayitu.ttf"); } h1 { font-family: "Tayitu", sans-serif; }</style>
<h1 id="t">Sign in to your school account</h1>
<form id="f"><input type="email" id="e"><input type="password" id="p" style="display:none"><button type="submit">Continue</button></form>
<script>const copy = { en: "Sign in to your school account", am: "ወደ ትምህርት ቤትዎ መለያ ይግቡ እባክዎ ኢሜይልዎን ያስገቡ", om: "Gara herrega mana barumsaa keessanii seenaa" };
document.getElementById("lang").onchange = (ev) => { document.getElementById("t").textContent = copy[ev.target.value]; };
document.getElementById("f").onsubmit = async (ev) => {
  ev.preventDefault();
  const p = document.getElementById("p");
  if (p.style.display === "none") { p.style.display = ""; return; }
  const res = await fetch("/selftest/login", { method: "POST", body: document.getElementById("e").value });
  localStorage.setItem("sb-127-auth-token", JSON.stringify(await res.json()));
  location.href = "/";
};</script>`);
  // Authenticated shell with no route guards at all; /a calls a column the
  // "deployed schema" does not have.
  const APP = shell(`<nav><a href="/">Home</a><a href="/a">A</a><a href="/students">Students</a></nav><main>Timhirt dashboard</main>
<script>if (!localStorage.getItem("sb-127-auth-token")) location.replace("/login");
if (location.pathname === "/a") fetch("/rest/v1/broken_column");</script>`);

  const server = http.createServer(async (q, s) => {
    const u = new URL(q.url, "http://x");
    const sub = subOf(q);
    const send = (code, body, type = "application/json") => {
      // No security headers anywhere; CORS answers for the wrong origin.
      s.writeHead(code, { "Content-Type": type, "Access-Control-Allow-Origin": "https://not-this-origin.example" });
      s.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const html = (body) => send(200, body, "text/html; charset=utf-8");
    // Bundle: no Supabase URL baked in, a service_role key shipped, and it
    // throws on every page.
    if (u.pathname === "/assets/index-SELFTEST.js") return send(200, `window.k="${fakeJwt({ role: "service_role" })}";throw new Error("planted pageerror")`, "text/javascript");
    if (u.pathname.startsWith("/fonts/")) return send(200, "<!doctype html><html></html>", "text/html");
    if (u.pathname === "/selftest/Tayitu.ttf") { s.writeHead(200, { "Content-Type": "font/ttf" }); return s.end(fs.readFileSync(path.join(REPO, "public/fonts/Tayitu.ttf"))); }
    if (u.pathname === "/selftest/login") {
      let email = "";
      for await (const chunk of q) email += chunk;
      const who = email.split("@")[0];
      // Token lifetime 7200s — over config.toml's jwt_expiry.
      return send(200, { access_token: fakeJwt({ role: "authenticated", sub: who, iat: 1000, exp: 8200 }), refresh_token: `rt-${who}`, user: { id: who } });
    }
    if (u.pathname.startsWith("/functions/v1/")) {
      const slug = u.pathname.split("/")[3];
      if (slug === "run-payroll") return send(404, { code: "NOT_FOUND" });
      if (slug === "verify-id" && q.method !== "OPTIONS") return send(401, { msg: "Missing authorization header" });
      if (slug === "sso-domain-lookup") return send(500, { error: "boom" });
      return send(200, { ok: true });
    }
    if (u.pathname === "/rest/v1/") return send(200, { paths: { "/": {}, "/students": {}, "/rpc/planted_definer": {} } });
    if (u.pathname === "/rest/v1/users") {
      const id = (u.searchParams.get("id") || "").replace(/^eq\./, "");
      return send(200, id ? [{ role: id.replace(/_b$/, ""), tenant_id: id === "school_admin_b" ? "tB" : "tA" }] : []);
    }
    if (u.pathname === "/rest/v1/broken_column") return send(400, { code: "42703", message: "column does not exist" });
    // students: readable by anon, and tenant A's admin sees tenant B's rows.
    if (u.pathname === "/rest/v1/students") {
      const leak = !sub || (sub === "school_admin" && u.searchParams.get("tenant_id") === "eq.tB");
      return send(200, leak ? [{ id: "leak" }] : []);
    }
    if (u.pathname === "/rest/v1/payslips") return send(200, sub === "student" ? [{ id: "leak" }] : []);
    if (u.pathname.startsWith("/rest/v1/")) return send(200, []);
    if (u.pathname === "/storage/v1/bucket") return send(200, []);
    if (u.pathname === "/storage/v1/object/list/payslips") return send(200, sub ? [] : [{ name: "leak.pdf" }]);
    if (u.pathname.startsWith("/storage/v1/object/list/")) return send(200, []);
    if (u.pathname === "/auth/v1/logout") return send(204, "");
    // Refresh tokens are never revoked.
    if (u.pathname === "/auth/v1/token") return send(200, { access_token: "still-valid" });
    if (u.pathname === "/login") return html(LOGIN);
    if (u.pathname === "/verify") return html(shell(`<main>Timhirt verify ፩</main>`));
    return html(APP);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let results;
  try {
    results = await run({ base, expect: ["string-only-the-new-build-has"], layers: ALL_LAYERS, maxPages: 5, supabaseUrl: base, anonKey, creds: credsFile });
  } finally { server.close(); fs.rmSync(credsFile, { force: true }); }

  const has = (status, layer, id, re) => results.some((x) => x.status === status && x.layer === layer && x.id.startsWith(id) && (!re || re.test(x.detail)));
  const planted = [
    ["service_role key in bundle", has("FAIL", "frontend", "no-service-role-key")],
    ["env not baked in", has("FAIL", "frontend", "env-baked-in")],
    ["--expect string missing", has("FAIL", "frontend", "expect")],
    ["security headers missing", has("FAIL", "frontend", "header", /Content-Security-Policy/)],
    ["fonts served as HTML", has("FAIL", "frontend", "font")],
    ["function not deployed", has("FAIL", "functions", "deployed", /run-payroll/)],
    ["protected function open without JWT", has("FAIL", "functions", "jwt-gate", new RegExp(aProtected))],
    ["protected function answers anon key", has("FAIL", "functions", "role-gate")],
    ["public function gated by JWT", has("FAIL", "functions", "public-reachable", /verify-id/)],
    ["anon reads table rows", has("FAIL", "rest", "anon-read", /students/)],
    ["anon RPC surface", has("WARN", "rest", "anon-rpc-surface", /planted_definer/)],
    ["anon lists private bucket", has("FAIL", "storage", "anon-list", /payslips/)],
    ["public endpoint 5xx", has("FAIL", "public", "sso-domain-lookup")],
    ["CORS preflight wrong", has("FAIL", "public", "cors-preflight")],
  ];
  if (loadPlaywright()) {
    planted.push(
      ["page error captured", has("FAIL", "ui", "verify:pageerror")],
      ["(control) am switch via the visible <select> renders Ethiopic", has("PASS", "ui", "locale-am")],
      ["(control) om switch changes the copy", has("PASS", "ui", "locale-om")],
      ["(control) self-hosted Ethiopic font reported loaded", has("PASS", "ui", "font-ethiopic", /Tayitu/)],
      ["Ge'ez numeral rendered", has("FAIL", "ui", "verify:geez-numerals")],
      ["(control) login through the two-step form works", has("PASS", "auth", "student:login")],
      ["access token lifetime over 3600s", has("WARN", "auth", "student:jwt-ttl")],
      ["page queries a column the schema lacks (400)", has("FAIL", "auth", "student:/a:supabase-400")],
      ["forbidden route renders for the role", has("FAIL", "auth", "student:forbidden", /\/students/)],
      ["student reads payslips", has("FAIL", "auth", "student:privilege", /payslips/)],
      ["cross-tenant rows visible A->B", has("FAIL", "auth", "cross-tenant:A->B", /students/)],
      ["(control) clean direction B->A not flagged", has("PASS", "auth", "cross-tenant:B->A")],
      ["refresh token survives logout", has("FAIL", "auth", "student:logout")],
    );
  } else console.log("(playwright not resolvable — ui and auth defects not planted)");
  printReport(results);
  console.log("\n== self-test: planted defects");
  let missed = 0;
  for (const [name, caught] of planted) { console.log(`  ${caught ? "caught" : "MISSED"} ${name}`); if (!caught) missed++; }
  console.log(missed
    ? `\nSELF-TEST FAILED: ${missed}/${planted.length} planted defects not detected — do not trust a live run`
    : `\nself-test OK: ${planted.length}/${planted.length} planted defects detected`);
  return missed ? 1 : 0;
}

// ==================================================================== main
const USAGE = `usage: node scripts/e2e-live.mjs [--self-test] [--base URL] [--creds FILE] [--out DIR]
                [--layers ${ALL_LAYERS.join(",")}] [--expect STRING]... [--max-pages N]
                [--supabase-url URL --anon-key KEY]`;
try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(USAGE); process.exit(0); }
  if (opts.selfTest) process.exit(await selfTest());
  opts.out ||= path.join(os.tmpdir(), `timhirt-e2e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  console.log(`live e2e against ${opts.base} — layers: ${opts.layers.join(", ")}${opts.creds ? "" : " (no creds: auth layer skipped)"}`);
  const results = await run(opts);
  printReport(results, opts.out);
  process.exit(results.some((x) => x.status === "FAIL") ? 1 : 0);
} catch (e) {
  console.error(`e2e-live: ${e.message}\n${USAGE}`);
  process.exit(2);
}
