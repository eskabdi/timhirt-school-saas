// WCAG 2.x contrast for the grid's day-type fills: each cell's text colour is
// whichever of the two text colours reads better on its fill (1.4.3).
export const DARK_TEXT = "#1f2937";
export const LIGHT_TEXT = "#ffffff";

/** Relative luminance of a #rrggbb colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** The text colour with the higher contrast on this fill. */
export function textOn(fill: string): string {
  return contrastRatio(fill, DARK_TEXT) >= contrastRatio(fill, LIGHT_TEXT) ? DARK_TEXT : LIGHT_TEXT;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** A day-type colour as stored (#rrggbb), or a neutral grey for anything else. */
export const safeColor = (c: unknown): string => (typeof c === "string" && HEX.test(c) ? c : "#e7e6e6");
