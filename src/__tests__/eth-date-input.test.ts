// Regression test for the input coercion behind <EthDate/>.
//
// The component took `new Date(value + "T00:00:00Z")` for every string, so any
// caller passing a timestamptz — which is what every `*_at` column returns —
// produced `2026-07-26T10:30:00+00:00T00:00:00Z`, an Invalid Date, and a
// RangeError from toISOString. React Router's error boundary turned that into a
// full-page "Unexpected Application Error"; the public admission-status page
// was unusable because it renders the application's created_at.
//
// The logic is duplicated here rather than imported because the component needs
// a React + i18next runtime to render, and the defect was never in the
// rendering — it was in this coercion. Keep the two in sync; the shapes below
// are the contract.
import { describe, it, expect } from "vitest";

/** Mirrors toDate() in src/components/EthDate.tsx. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));

describe("EthDate input coercion", () => {
  it("pins a bare calendar date to UTC midnight", () => {
    const d = toDate("2026-07-26");
    expect(d?.toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });

  it("accepts a Postgres timestamptz — the case that took the page down", () => {
    expect(iso(toDate("2026-07-26T10:30:00+00:00"))).toBe("2026-07-26");
    expect(iso(toDate("2026-07-26T10:30:00.123456+00:00"))).toBe("2026-07-26");
    expect(iso(toDate("2026-07-26T10:30:00Z"))).toBe("2026-07-26");
  });

  it("keeps the UTC calendar day for a non-UTC offset", () => {
    // 02:00 at +03:00 is still 2026-07-25 in UTC, and toEthiopian reads UTC
    // parts — so the EC date shown must follow UTC, not the offset.
    expect(iso(toDate("2026-07-26T02:00:00+03:00"))).toBe("2026-07-25");
  });

  it("returns null instead of throwing for missing values", () => {
    expect(toDate(undefined)).toBeNull();
    expect(toDate(null)).toBeNull();
  });

  it("returns null instead of throwing for unparseable values", () => {
    expect(toDate("")).toBeNull();
    expect(toDate("not a date")).toBeNull();
    // The exact string the old code built from a timestamptz.
    expect(toDate("2026-07-26T10:30:00+00:00T00:00:00Z")).toBeNull();
    expect(toDate(new Date("nope"))).toBeNull();
  });

  it("passes a valid Date through untouched", () => {
    const d = new Date("2026-07-26T00:00:00Z");
    expect(toDate(d)).toBe(d);
  });

  it("never throws for any of these inputs", () => {
    const inputs: (Date | string | null | undefined)[] = [
      undefined, null, "", "  ", "not a date", "2026-13-45",
      "2026-07-26", "2026-07-26T10:30:00+00:00", new Date("nope"), new Date(),
    ];
    for (const v of inputs) expect(() => toDate(v)).not.toThrow();
  });
});
