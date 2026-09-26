// Renders stored rich text without dangerouslySetInnerHTML, which this repo
// bans (react/no-danger is an eslint error). The markup is parsed with
// DOMParser and rebuilt as React elements through a strict allow-list, so an
// unexpected tag, attribute, or javascript: URL is dropped rather than
// escaped-and-hoped-for. Anything not on the list contributes only its text.
import { createElement, type ReactNode } from "react";

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del",
  "blockquote", "code", "pre", "ol", "ul", "li",
  "h1", "h2", "h3", "h4", "span", "div", "a", "img",
]);

// Tags React spells differently, or that we normalise to a canonical element.
const TAG_MAP: Record<string, string> = { b: "strong", i: "em", strike: "s", del: "s" };

const SAFE_URL = /^(https?:|mailto:|tel:)/i;
const SAFE_IMG_SRC = /^(https?:|data:image\/(png|jpeg|gif|webp);base64,)/i;

function safeAttrs(el: Element, tag: string): Record<string, string> {
  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    if (!SAFE_URL.test(href)) return {};
    // Author-supplied links always open detached from the app session.
    return { href, target: "_blank", rel: "noopener noreferrer" };
  }
  if (tag === "img") {
    const src = el.getAttribute("src") ?? "";
    if (!SAFE_IMG_SRC.test(src)) return {};
    return { src, alt: el.getAttribute("alt") ?? "" };
  }
  return {};
}

function toReact(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const raw = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).map((c, i) => toReact(c, i));

  // Not on the list: keep the words, drop the element.
  if (!ALLOWED_TAGS.has(raw)) return children.length ? children : null;

  const tag = TAG_MAP[raw] ?? raw;
  if (tag === "br") return createElement("br", { key });
  if (tag === "img") {
    const attrs = safeAttrs(el, tag);
    return attrs.src ? createElement("img", { key, ...attrs, className: "max-w-full rounded" }) : null;
  }
  return createElement(tag, { key, ...safeAttrs(el, tag) }, children.length ? children : undefined);
}

/** Prose styling lives here so every notice/announcement body reads the same. */
export function RichText({ html, className }: { html: string | null | undefined; className?: string }) {
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = Array.from(doc.body.childNodes).map((n, i) => toReact(n, i));
  return (
    <div className={className ?? "space-y-2 text-sm text-ink [&_a]:text-navy [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-soft [&_code]:rounded [&_code]:bg-sidebar [&_code]:px-1 [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-display [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"}>
      {body}
    </div>
  );
}

// Same allow-list, but producing real DOM nodes for the contentEditable editor
// (RichTextEditor). Loading stored HTML with `el.innerHTML = value` ran any
// `<img onerror>` or inline handler the moment a staff member opened another
// author's notice for editing (R6 WP-01, found by the new semgrep rule). Nodes
// are created with createElement/createTextNode and only allow-listed
// attributes are set, so nothing executable can reach the live document.
/** Set when sanitising dropped something (a tag, an attribute, a node). */
export interface SanitizeReport { removed: boolean }

function toDom(node: Node, doc: Document, report?: SanitizeReport): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? "")];
  if (node.nodeType !== Node.ELEMENT_NODE) {
    if (report) report.removed = true;
    return [];
  }

  const el = node as Element;
  const raw = el.tagName.toLowerCase();
  const children = Array.from(el.childNodes).flatMap((c) => toDom(c, doc, report));
  if (!ALLOWED_TAGS.has(raw)) {
    if (report) report.removed = true;
    return children;
  }

  const tag = TAG_MAP[raw] ?? raw;
  const attrs = safeAttrs(el, tag);
  if (report && Array.from(el.attributes).some((a) => !Object.hasOwn(attrs, a.name))) report.removed = true;
  if (tag === "img" && !attrs.src) {
    if (report) report.removed = true;
    return [];
  }
  const out = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) out.setAttribute(name, value);
  if (tag !== "br" && tag !== "img") out.append(...children);
  return [out];
}

export function sanitizeRichTextNodes(html: string | null | undefined, doc: Document = document, report?: SanitizeReport): Node[] {
  if (!html) return [];
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return Array.from(parsed.body.childNodes).flatMap((n) => toDom(n, doc, report));
}

/** Plain-text preview for list rows, where the full markup would be noise. */
export function richTextToPlain(html: string | null | undefined): string {
  if (!html) return "";
  return new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";
}
