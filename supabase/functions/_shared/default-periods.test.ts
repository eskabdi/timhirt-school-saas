import { assert, assertEquals } from "jsr:@std/assert@1";
import { defaultPeriods } from "./default-periods.ts";

Deno.test("every seeded period carries every column (a bulk insert sends NULL for a missing key)", () => {
  const rows = defaultPeriods("t1");
  const keys = Object.keys(rows[0]!).sort().join(",");
  for (const r of rows) {
    assertEquals(Object.keys(r).sort().join(","), keys);
    assert(typeof r.is_break === "boolean", `period ${r.period_no} is_break`);
  }
});

Deno.test("the default day: 9 rows, one break, consecutive periods", () => {
  const rows = defaultPeriods("t1");
  assertEquals(rows.length, 9);
  assertEquals(rows.filter((r) => r.is_break).map((r) => r.label), ["Break"]);
  assertEquals(rows.map((r) => r.period_no), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let i = 1; i < rows.length; i++) assertEquals(rows[i]!.starts_at, rows[i - 1]!.ends_at);
  assert(rows.every((r) => r.tenant_id === "t1"));
});
