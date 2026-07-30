// @vitest-environment jsdom
//
// Tier-1 security test — RichText is the ONLY thing between stored HTML (notice
// and announcement bodies) and the DOM, since dangerouslySetInnerHTML is banned
// (react/no-danger is an eslint error, CLAUDE.md §10.4). It parses with
// DOMParser and rebuilds through a strict allow-list; anything off the list must
// contribute only its text. These cases are adversarial: a regression here is a
// live stored-XSS hole, not a cosmetic bug.
//
// The component runs its DOMParser walk at render time, so we render it to a
// static string (jsdom supplies DOMParser) and assert on the exact markup a
// user's browser would receive — the real output, not an intermediate shape.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText, richTextToPlain } from "@/components/ui/RichText";

const render = (html: string | null | undefined) =>
  renderToStaticMarkup(<RichText html={html} />);

describe("RichText sanitizer — script & event handlers", () => {
  it("drops <script> but keeps allowed siblings", () => {
    const out = render("<p>hello</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("hello");
  });

  it("drops an inline event-handler attribute on an allowed tag", () => {
    const out = render('<div onclick="steal()">click me</div>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("steal");
    expect(out).toContain("click me");
  });

  it("keeps the text of an unknown tag but not the tag itself", () => {
    const out = render("<marquee>scrolling</marquee>");
    expect(out).not.toContain("<marquee");
    expect(out).toContain("scrolling");
  });
});

describe("RichText sanitizer — link hrefs", () => {
  it("strips a javascript: href, keeping the anchor text", () => {
    const out = render('<a href="javascript:alert(1)">link</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("href");
    expect(out).toContain("link");
  });

  it("strips a data:text/html href", () => {
    const out = render('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(out).not.toContain("data:text/html");
    expect(out).not.toContain("href");
  });

  it("keeps an https href and forces it to open detached", () => {
    const out = render('<a href="https://example.com/notice">details</a>');
    expect(out).toContain('href="https://example.com/notice"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("keeps mailto: and tel: hrefs", () => {
    expect(render('<a href="mailto:a@b.et">mail</a>')).toContain('href="mailto:a@b.et"');
    expect(render('<a href="tel:+251911">call</a>')).toContain('href="tel:+251911"');
  });
});

describe("RichText sanitizer — image sources", () => {
  it("drops an <img> with an onerror handler and a non-http src", () => {
    const out = render('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
  });

  it("keeps the src but drops onerror on an https image", () => {
    const out = render('<img src="https://cdn.example.com/a.png" onerror="alert(1)">');
    expect(out).toContain('src="https://cdn.example.com/a.png"');
    expect(out).not.toContain("onerror");
  });

  it("allows a base64 png data URI", () => {
    const out = render('<img src="data:image/png;base64,iVBORw0KGgo=">');
    expect(out).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("rejects a data URI whose MIME type is not an allow-listed image", () => {
    const out = render('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("svg");
  });
});

describe("RichText sanitizer — tag normalisation & structure", () => {
  it("normalises b/i/strike/del to strong/em/s", () => {
    const out = render("<b>bold</b><i>ital</i><strike>gone</strike><del>old</del>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>ital</em>");
    expect(out).not.toContain("<strike");
    expect(out).not.toContain("<del");
    expect((out.match(/<s>/g) ?? []).length).toBe(2);
  });

  it("preserves allow-listed structural markup", () => {
    const out = render("<ul><li>one</li><li>two</li></ul>");
    expect(out).toContain("<ul");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<li>two</li>");
  });

  it("renders nothing for null / undefined / empty input", () => {
    expect(render(null)).toBe("");
    expect(render(undefined)).toBe("");
    expect(render("")).toBe("");
  });
});

describe("richTextToPlain", () => {
  it("returns only text content, dropping every tag", () => {
    expect(richTextToPlain("<p>Fee <strong>due</strong> Friday</p>")).toBe("Fee due Friday");
  });

  it("does not surface script text as markup", () => {
    const plain = richTextToPlain('<p>hi</p><a href="javascript:x">y</a>');
    expect(plain).not.toContain("<");
    expect(plain).toContain("hi");
  });

  it("returns an empty string for null / undefined / empty", () => {
    expect(richTextToPlain(null)).toBe("");
    expect(richTextToPlain(undefined)).toBe("");
    expect(richTextToPlain("")).toBe("");
  });
});
