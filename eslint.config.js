// Minimal flat ESLint config. The no-restricted-syntax rule below is the
// enforcement that EthDate.tsx's comment refers to ("banned by lint") —
// previously that comment overstated reality; this makes it true. Any direct
// call to Date.prototype.toLocaleDateString/toLocaleString bypasses the
// Ethiopian-calendar facade (§17.2's canonical-storage/presentation split)
// and must go through <EthDate/> or lib/ethiopian-date.ts instead.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { react },
    rules: {
      "react/no-danger": "error",
      // Downgraded to warn: pre-existing `(x as any)` casts throughout
      // features/** work around Supabase's untyped embedded-relation query
      // results (no `supabase gen types typescript` output committed yet —
      // see README's `npm run gen:types`). Real, but out of scope for this
      // security-hardening pass; tracked separately, not silenced.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message: "Use <EthDate value={…}/> or lib/ethiopian-date.ts — raw toLocaleDateString bypasses the Ethiopian calendar facade.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message: "Use <EthDate value={…}/> or lib/ethiopian-date.ts — raw toLocaleString bypasses the Ethiopian calendar facade.",
        },
      ],
    },
  },
  {
    // EthDatePicker's own Gregorian-equivalent footer is a deliberate,
    // labeled exception (it explicitly renders "= 21 Sep 2026" as a GC
    // cross-check next to the EC value, not a silent bypass).
    files: ["src/components/EthDatePicker.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
];
