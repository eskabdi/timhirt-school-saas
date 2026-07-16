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
        navy: { DEFAULT: "#1E2A70", deep: "#16205A", wash: "#E9EAF7" },
        page: "#F5F6FB",
        card: "#FFFFFF",
        sidebar: "#F8F9FD",
        line: "#E7E9F2",
        ink: { DEFAULT: "#171A2B", soft: "#565B76", faint: "#8A8FA6" },
        danger: { DEFAULT: "#CC3333", tint: "#FDE7E7" },
        late: { DEFAULT: "#A85C24", tint: "#FBEADD" },
        ok: { DEFAULT: "#1E8A5F", tint: "#E4F5EC" },

        // Legacy aliases — kept coherent with the new palette, not the old one.
        chalk: { DEFAULT: "#F5F6FB", raised: "#FFFFFF", sunken: "#F8F9FD" },
        meskel: { DEFAULT: "#1E2A70", deep: "#16205A", wash: "#E9EAF7" },
        warn: "#A85C24",
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
