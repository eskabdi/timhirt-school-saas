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
