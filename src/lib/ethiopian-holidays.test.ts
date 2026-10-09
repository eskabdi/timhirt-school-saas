import { describe, expect, it } from "vitest";
import { toEthiopian } from "@/lib/ethiopian-date";
import { ecYearSpan, generateHolidays } from "@/lib/ethiopian-holidays";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("generateHolidays (fixed-date national holidays)", () => {
  const h2019 = generateHolidays(2019);
  const ec = (code: string) => h2019.filter((h) => h.code === code).map((h) => `${h.ec.month}/${h.ec.day}`);

  it("places the 2019 EC holidays where the MoE sheet does", () => {
    expect(ec("enkutatash")).toEqual(["1/1"]);
    expect(ec("genna")).toEqual(["4/29"]);
    expect(ec("timket")).toEqual(["5/11"]);
    expect(ec("adwa")).toEqual(["6/23"]);
    expect(ec("labour_day")).toEqual(["8/23"]);
    expect(ec("patriots_day")).toEqual(["8/27"]);
  });

  it("computes no movable feasts (no Bahire Hasab, no Hijri)", () => {
    const codes = new Set(h2019.map((h) => h.code));
    for (const c of ["siklet", "fasika", "eid_al_fitr", "eid_al_adha", "mawlid"]) expect(codes.has(c)).toBe(false);
  });

  it("puts Genna on Tahsas 28 after a six-day Pagume (Jan 7 either way)", () => {
    const genna2016 = generateHolidays(2016).find((h) => h.code === "genna")!;
    expect(genna2016.date).toBe("2024-01-07");
    expect(`${genna2016.ec.month}/${genna2016.ec.day}`).toBe("4/28");
  });

  it("keeps every date inside the EC year, once per rule, in order", () => {
    for (const y of [2016, 2017, 2018, 2019, 2020]) {
      const { first, last } = ecYearSpan(y);
      const list = generateHolidays(y);
      expect(list).toHaveLength(8);
      for (const h of list) {
        expect(h.date >= iso(first) && h.date <= iso(last), `${h.code} ${y}`).toBe(true);
        expect(toEthiopian(new Date(`${h.date}T00:00:00Z`)).year).toBe(y);
      }
      expect(list.map((h) => h.date)).toEqual([...list.map((h) => h.date)].sort());
    }
  });
});
