import type { Config } from "tailwindcss";

/**
 * Design tokens — "Navy/Rounded" theme (v3.0). See DESIGN_SYSTEM.md for the
 * full rationale. Legacy names (chalk/meskel/warn/rounded-card) are kept as
 * aliases remapped onto the new values so screens not yet individually
 * migrated to the new component patterns still render coherently — same
 * colors, same radius family. Don't add new usages of the legacy names;
 * they exist only so old class lists keep working.
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
        },
        page: "#F5F6FB",
        card: "#FFFFFF",
        sidebar: "#F8F9FD",
        line: "#E7E9F2",
        ink: { DEFAULT: "#171A2B", soft: "#565B76", faint: "#8A8FA6" },
        danger: { DEFAULT: "#CC3333", tint: "#FDE7E7" },
        late: {
          DEFAULT: "rgb(var(--brand-accent) / <alpha-value>)",
          tint: "rgb(var(--brand-accent-tint) / <alpha-value>)",
        },
        ok: {
          DEFAULT: "rgb(var(--brand-secondary) / <alpha-value>)",
          tint: "rgb(var(--brand-secondary-tint) / <alpha-value>)",
        },

        // Legacy aliases — kept coherent with the new palette, not the old one.
        chalk: { DEFAULT: "#F5F6FB", raised: "#FFFFFF", sunken: "#F8F9FD" },
        meskel: {
          DEFAULT: "rgb(var(--brand-primary) / <alpha-value>)",
          deep: "rgb(var(--brand-primary-deep) / <alpha-value>)",
          wash: "rgb(var(--brand-primary-wash) / <alpha-value>)",
        },
        warn: "rgb(var(--brand-accent) / <alpha-value>)",
      },
      fontFamily: {
        display: ["'Plus Jakarta Sans'", "'Noto Sans Ethiopic'", "system-ui", "sans-serif"],
        sans: ["'Inter'", "'Noto Sans Ethiopic'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        panel: "16px",
        control: "12px",
        pill: "9999px",
        card: "16px", // legacy alias -> rounded-panel's value
      },
    },
  },
  plugins: [],
} satisfies Config;
