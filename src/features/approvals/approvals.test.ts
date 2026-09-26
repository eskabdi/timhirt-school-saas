import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { approvalErrorKey, diffRows, isExpired } from "./approvals";

describe("diffRows", () => {
  it("lists every from/to field, with context fields first", () => {
    expect(diffRows({
      amount: 1200, provider: "cash", invoice_id: "00000000-0000-0000-0000-000000000001",
      from: { status: "pending" }, to: { status: "succeeded" },
    })).toEqual([
      { field: "amount", from: 1200, to: 1200 },
      { field: "provider", from: "cash", to: "cash" },
      { field: "status", from: "pending", to: "succeeded" },
    ]);
  });

  it("shows a field present on only one side as null on the other", () => {
    expect(diffRows({ from: { status: "active" }, to: { status: "transferred", transferred_to: "X" } })).toEqual([
      { field: "status", from: "active", to: "transferred" },
      { field: "transferred_to", from: null, to: "X" },
    ]);
  });

  it("tolerates a payload without from/to", () => {
    expect(diffRows({})).toEqual([]);
    expect(diffRows({ from: "junk", to: [1] })).toEqual([]);
  });
});

describe("approvalErrorKey", () => {
  it("maps the database's error messages", () => {
    expect(approvalErrorKey({ message: "approval_required" })).toBe("approval_required");
    expect(approvalErrorKey({ message: "maker_cannot_decide" })).toBe("maker_cannot_decide");
    expect(approvalErrorKey(new Error("invoice_void"))).toBe("invoice_void");
  });

  it("does not confuse a code that is a prefix of another", () => {
    expect(approvalErrorKey({ message: "invoice_void" })).toBe("invoice_void");
    expect(approvalErrorKey({ message: "invoice_already_void" })).toBe("invoice_already_void");
  });

  it("falls back to unknown", () => {
    expect(approvalErrorKey({ message: "duplicate key value" })).toBe("unknown");
    expect(approvalErrorKey(null)).toBe("unknown");
  });
});

describe("isExpired", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  it("is true for a pending request past its expiry", () => {
    expect(isExpired({ status: "pending", expires_at: "2026-09-26T11:59:59Z" }, now)).toBe(true);
  });
  it("is false for a pending request still in time, and for decided ones", () => {
    expect(isExpired({ status: "pending", expires_at: "2026-09-27T00:00:00Z" }, now)).toBe(false);
    expect(isExpired({ status: "executed", expires_at: "2026-09-01T00:00:00Z" }, now)).toBe(false);
  });
});
