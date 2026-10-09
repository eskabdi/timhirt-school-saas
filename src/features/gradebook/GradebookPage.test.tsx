// @vitest-environment happy-dom
// Corrections to a published exam (R6 WP-09): each failed row is marked, and
// editing a failed row never turns the save's outcome into "sent" (review
// I18N9R3-1: it announced "Corrections sent for approval." when none were).
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const data: Record<string, unknown[]> = {
  exams: [{ id: "x1", name_i18n: { en: "Mid" }, max_score: 100, class_id: "c1", term: { results_published: true } }],
  subjects: [{ id: "s1", name_i18n: { en: "Math" } }],
  students: [
    { id: "a", first_name: "Abebe", middle_name: "Kebede", last_name: "Tadesse" },
    { id: "b", first_name: "Sara", middle_name: "Mulugeta", last_name: "Lemma" },
  ],
  grades: [{ id: "g1", student_id: "a", score: 50 }, { id: "g2", student_id: "b", score: 60 }],
};
const failing = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "in"]) c[m] = () => c;
      c.then = (resolve: (v: unknown) => void) => resolve({ data: data[table], error: null });
      return c;
    },
  },
}));
vi.mock("@/features/approvals/approvals", async (orig) => {
  const m = await orig<Record<string, unknown>>();
  return {
    ...m,
    submitApproval: async (_action: string, id: string) => {
      if (failing.ids.has(id)) throw new Error("approval_already_pending");
      return "r";
    },
  };
});

import { GradebookPage } from "./GradebookPage";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const setValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
};

async function renderAndCorrect(host: HTMLElement) {
  const root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><GradebookPage /></QueryClientProvider></MemoryRouter>);
  });
  await flush();
  const [exam, subject] = [...host.querySelectorAll("select")];
  await act(async () => setValue(exam!, "x1")); await flush();
  await act(async () => setValue(subject!, "s1")); await flush();
  const inputs = () => [...host.querySelectorAll("input")] as HTMLInputElement[];
  await act(async () => setValue(inputs()[0]!, "55"));
  await act(async () => setValue(inputs()[1]!, "65"));
  await flush();
  await act(async () => setValue(host.querySelector("textarea")!, "marking error"));
  await flush();
  await act(async () => [...host.querySelectorAll("button")].at(-1)!.click());
  await flush(); await flush();
  return { root, inputs };
}
const texts = (host: HTMLElement, sel: string) => [...host.querySelectorAll(sel)].map((e) => e.textContent ?? "");

describe("GradebookPage corrections after publication", () => {
  it("keeps a failed save failed when the failed rows are edited", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    failing.ids = new Set(["g1", "g2"]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { root, inputs } = await renderAndCorrect(host);

    expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual(["true", "true"]);
    expect(texts(host, "[role=status]").join("")).toBe("");
    expect(texts(host, "[role=alert]").join("")).toMatch(/2 scores were not sent/);

    await act(async () => setValue(inputs()[1]!, "66"));
    await act(async () => setValue(inputs()[0]!, "56"));
    await flush();
    expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual([null, null]); // the edited rows are unmarked
    expect(texts(host, "[role=status]").join("")).not.toMatch(/sent for approval/);    // ... but nothing was sent

    act(() => root.unmount());
    host.remove();
  });

  it("marks the row that failed and the row that went for approval", async () => {
    failing.ids = new Set(["g2"]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const { root, inputs } = await renderAndCorrect(host);

    expect(inputs().map((i) => i.getAttribute("aria-invalid"))).toEqual([null, "true"]);
    const describedBy = inputs()[1]!.getAttribute("aria-describedby");
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBeTruthy();
    expect(texts(host, "td").join(" ")).toMatch(/Correction waiting for approval/);
    expect(texts(host, "[role=status]").join("")).not.toMatch(/sent for approval/); // one row failed

    act(() => root.unmount());
    host.remove();
  });
});
