/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Vitest covers the frontend only. Edge Function tests under
  // supabase/functions are Deno tests (jsr:/npm: imports) and run via
  // `deno test` in CI, not here.
  test: { include: ["src/**/*.{test,spec}.{ts,tsx}"] },
});
