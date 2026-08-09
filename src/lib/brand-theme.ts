// ============================================================================
// Applies a tenant's branding palette to the live UI.
//
// tailwind.config.ts declares the navy/ok/late token families as
// `rgb(var(--brand-…) / <alpha-value>)`, so every existing `bg-navy`,
// `text-ok`, `border-navy/40`, … utility resolves through these variables at
// paint time. Swapping the variables here re-themes the whole app without
// rebuilding CSS, and opacity modifiers keep working because the variables
// hold space-separated RGB channels ("30 42 112"), not hex.
//
// Only three colours are author-controlled (Branding page: primary /
// secondary / accent). The deep + wash/tint shades each family needs are
// derived from them, so a tenant never has to pick six colours to get a
// coherent theme.
// ============================================================================

export interface BrandPalette {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
}

interface Rgb { r: number; g: number; b: number }

/** #rgb / #rrggbb -> channels. Returns null for anything unparseable, so a
 *  half-typed hex in the Branding page's text input can't blank the theme. */
export function parseHex(hex: string | undefined | null): Rgb | null {
  if (!hex) return null;
  const s = hex.trim().replace(/^#/, "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const channels = (c: Rgb) => `${Math.round(c.r)} ${Math.round(c.g)} ${Math.round(c.b)}`;

function mix(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  const w = Math.min(Math.max(weightOfA, 0), 1);
  return { r: a.r * w + b.r * (1 - w), g: a.g * w + b.g * (1 - w), b: a.b * w + b.b * (1 - w) };
}
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastWithWhite(c: Rgb): number {
  return 1.05 / (luminance(c) + 0.05);
}

/** Darken toward black until white text on this colour is legible.
 *  bg-navy/bg-ok/text-late all pair with white or sit on white, so a tenant
 *  picking a pale primary would otherwise produce invisible text. */
function ensureReadableOnWhite(c: Rgb, minContrast = 4.5): Rgb {
  let out = c;
  for (let i = 0; i < 20 && contrastWithWhite(out) < minContrast; i++) {
    out = mix(out, BLACK, 0.9);
  }
  return out;
}

/** Every CSS variable the Tailwind config reads, as "r g b" strings. */
export function paletteToVars(palette: BrandPalette): Record<string, string> {
  const vars: Record<string, string> = {};

  const primary = parseHex(palette.primaryColor);
  if (primary) {
    const base = ensureReadableOnWhite(primary);
    vars["--brand-primary"] = channels(base);
    vars["--brand-primary-deep"] = channels(mix(base, BLACK, 0.85));
    vars["--brand-primary-wash"] = channels(mix(base, WHITE, 0.12));
  }

  const secondary = parseHex(palette.secondaryColor);
  if (secondary) {
    const base = ensureReadableOnWhite(secondary);
    vars["--brand-secondary"] = channels(base);
    vars["--brand-secondary-tint"] = channels(mix(base, WHITE, 0.14));
  }

  const accent = parseHex(palette.accentColor);
  if (accent) {
    // Accent is commonly a pale highlight (the default is #ffd6a8), so the
    // raw value drives the tint while a darkened form carries text/borders.
    const base = ensureReadableOnWhite(accent);
    vars["--brand-accent"] = channels(base);
    vars["--brand-accent-tint"] = channels(mix(accent, WHITE, 0.35));
  }

  return vars;
}

const MANAGED_VARS = [
  "--brand-primary", "--brand-primary-deep", "--brand-primary-wash",
  "--brand-secondary", "--brand-secondary-tint",
  "--brand-accent", "--brand-accent-tint",
];

/** Push a palette onto :root. Unset colours fall back to the design-system
 *  defaults declared in index.css. */
export function applyBrandPalette(palette: BrandPalette | null | undefined): void {
  const root = document.documentElement;
  const vars = palette ? paletteToVars(palette) : {};
  for (const name of MANAGED_VARS) {
    const value = vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
}
