import type { Config } from "tailwindcss";

/**
 * Design tokens — "Chalk & Meskel" theme.
 * Deep slate ink on chalk-white surfaces; Meskel-daisy gold as the single accent
 * (the flower of Ethiopian new year — the moment the academic year begins).
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#1E2430", soft: "#3A4356", faint: "#6B7386" },
        chalk: { DEFAULT: "#FAFAF7", raised: "#FFFFFF", sunken: "#F0EFEA" },
        meskel: { DEFAULT: "#E8A317", deep: "#B87E0A", wash: "#FBF3DF" },
        line: "#E3E1D9",
        ok: "#2F7D4F",
        warn: "#B4540A",
        danger: "#B3261E"
      },
      fontFamily: {
        display: ["'Zilla Slab'", "'Noto Serif Ethiopic'", "serif"],
        sans: ["'Inter'", "'Noto Sans Ethiopic'", "system-ui", "sans-serif"]
      },
      borderRadius: { card: "10px" }
    }
  },
  plugins: []
} satisfies Config;
