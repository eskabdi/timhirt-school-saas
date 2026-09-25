// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeRichTextNodes } from "./RichText";

function html(input: string): string {
  const host = document.createElement("div");
  host.replaceChildren(...sanitizeRichTextNodes(input));
  return host.innerHTML;
}

describe("sanitizeRichTextNodes (editor load path, R6 WP-01)", () => {
  it("keeps allow-listed formatting", () => {
    expect(html("<p><b>Bold</b> and <i>it</i></p><ul><li>one</li></ul>"))
      .toBe("<p><strong>Bold</strong> and <em>it</em></p><ul><li>one</li></ul>");
  });

  it("drops event handlers and script, keeping only text", () => {
    const out = html('<img src="x" onerror="alert(1)"><p onclick="alert(2)">hi</p><script>alert(3)</script>');
    expect(out).not.toMatch(/onerror|onclick|<script|alert\(1\)|alert\(2\)/i);
    expect(out).toContain("<p>hi</p>");
  });

  it("drops javascript: links but keeps safe ones detached", () => {
    expect(html('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(html('<a href="https://moe.gov.et">moe</a>'))
      .toBe('<a href="https://moe.gov.et" target="_blank" rel="noopener noreferrer">moe</a>');
  });

  it("keeps only https/data-image img sources", () => {
    expect(html('<img src="javascript:alert(1)">')).toBe("");
    expect(html('<img src="https://a.et/logo.png" alt="l">')).toBe('<img src="https://a.et/logo.png" alt="l">');
  });
});

describe("RichTextEditor load path (R6 WP-01, review FE-1/FE-2)", () => {
  it("renders stored HTML without handlers and hands the cleaned HTML back", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { RichTextEditor } = await import("./RichTextEditor");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const changes: string[] = [];
    const root = createRoot(host);
    await act(async () => {
      root.render(<RichTextEditor value={'<p>hi</p><img src="x" onerror="alert(1)"><svg onload="alert(2)"></svg>'} onChange={(h) => changes.push(h)} />);
    });
    const editor = host.querySelector("[contenteditable]");
    expect(editor).not.toBeNull();
    expect(editor!.innerHTML).toContain("<p>hi</p>");
    expect(host.innerHTML).not.toMatch(/onerror|onload|alert\(/i);
    expect(changes).toHaveLength(1);
    expect(changes[0]).not.toMatch(/onerror|onload/i);
    await act(async () => root.unmount());
  });
});

describe("RichTextEditor dirty-state (review m-6)", () => {
  it("does not hand back HTML that only needed harmless normalising", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { RichTextEditor } = await import("./RichTextEditor");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const changes: string[] = [];
    const root = createRoot(host);
    await act(async () => {
      root.render(<RichTextEditor value={"<p><b>Bold</b> text</p>"} onChange={(h) => changes.push(h)} />);
    });
    expect(changes).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
