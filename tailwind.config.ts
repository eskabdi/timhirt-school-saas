import type { Config } from "tailwindcss";

/**
 * Design tokens — "Academic Atelier" theme (v4.0): Deep Navy + Burnished
 * Gold, per the uploaded DESIGN.md. Legacy names (chalk/meskel/warn/
 * rounded-card) are kept as aliases remapped onto the new values so screens
 * not yet individually migrated to the new component patterns still render
 * coherently — same colors, same radius family. Don't add new usages of the
 * legacy names; they exist only so old class lists keep working.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // navy / ok / late resolve through CSS variables so a tenant's
        // Branding palette re-themes the running app (src/lib/brand-theme.ts).
        // The variables hold space-separated RGB channels rather than hex,
        // which is what keeps opacity modifiers (`border-navy/40`) working.
        // Defaults live in index.css :root — this file no longer owns them.
        navy: {
          DEFAULT: "rgb(var(--brand-primary) / <alpha-value>)",
          deep: "rgb(var(--brand-primary-deep) / <alpha-value>)",
          wash: "rgb(var(--brand-primary-wash) / <alpha-value>)",
          container: "rgb(var(--brand-primary-container) / <alpha-value>)",
        },
        page: "#F8F9FA",
        card: "#FFFFFF",
        sidebar: "#F3F4F5",
        line: "#E5E7EB",
        ink: { DEFAULT: "#171A2B", soft: "#44474E", faint: "#8A8FA6" },
        danger: { DEFAULT: "#CC3333", tint: "#FDE7E7" },
        late: {
          DEFAULT: "rgb(var(--brand-accent) / <alpha-value>)",
          tint: "rgb(var(--brand-accent-tint) / <alpha-value>)",
        },
        ok: {
          DEFAULT: "rgb(var(--brand-secondary) / <alpha-value>)",
          tint: "rgb(var(--brand-secondary-tint) / <alpha-value>)",
        },
        // The platform's own signature accent (top bar, active-nav indicator,
        // "jewelry" highlights) — deliberately static, not tenant-overridable.
        // See index.css :root for the rationale.
        gold: {
          DEFAULT: "rgb(var(--gold) / <alpha-value>)",
          bright: "rgb(var(--gold-bright) / <alpha-value>)",
        },

        // Legacy aliases — kept coherent with the new palette, not the old one.
        chalk: { DEFAULT: "#F8F9FA", raised: "#FFFFFF", sunken: "#F3F4F5" },
        meskel: {
          DEFAULT: "rgb(var(--brand-primary) / <alpha-value>)",
          deep: "rgb(var(--brand-primary-deep) / <alpha-value>)",
          wash: "rgb(var(--brand-primary-wash) / <alpha-value>)",
        },
        warn: "rgb(var(--brand-accent) / <alpha-value>)",
      },
      fontFamily: {
        display: ["'Public Sans'", "'Noto Sans Ethiopic'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "'Noto Sans Ethiopic'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        panel: "16px",
        control: "12px",
        pill: "9999px",
        card: "16px", // legacy alias -> rounded-panel's value
      },
      boxShadow: {
        // "Tonal Layering" ambient shadow — DESIGN.md §4: an ultra-diffused
        // occlusion, not a mimicked light source. Tint derived from primary.
        ambient: "0px 12px 32px rgba(9, 27, 58, 0.06)",
        "ambient-lg": "0px 20px 48px rgba(9, 27, 58, 0.10)",
      },
    },
  },
  plugins: [],
} satisfies Config;
