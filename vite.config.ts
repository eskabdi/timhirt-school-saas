/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "child_process";

// The commit a bundle was built from, stamped into index.html as
// <meta name="app-commit"> so a deploy can be verified against an exact SHA
// rather than inferred from code markers (R6 WP-00 gatekeeper GK-F4).
// `npm run deploy` passes VITE_COMMIT_SHA because a Vercel CLI upload has no .git.
function commitSha(): string {
  const fromEnv = process.env.VITE_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv && /^[0-9a-f]{7,40}$/.test(fromEnv)) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "app-commit-meta",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "app-commit", content: commitSha() }, injectTo: "head" },
      ],
    },
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Vitest covers the frontend only. Edge Function tests under
  // supabase/functions are Deno tests (jsr:/npm: imports) and run via
  // `deno test` in CI, not here.
  test: {
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Run i18next-icu and intl-messageformat through Vite, as the browser build
    // does. Externalised, Node loads intl-messageformat's CommonJS entry, the
    // default import is not a constructor, and every ICU message silently
    // falls back to its raw text ("{date} G.C."), so i18n in tests proved nothing.
    server: { deps: { inline: ["i18next-icu", "intl-messageformat"] } },
  },
});
