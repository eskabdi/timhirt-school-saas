// Fixture for scripts/ci/semgrep-rule-test.py. Not compiled or bundled (outside src/).
declare const el: HTMLElement;
declare const html: string;
declare const nodes: Node[];

export function A() {
  // ruleid: timhirt-no-dangerously-set-inner-html
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function F() {
  // ruleid: timhirt-no-html-string-sink
  return <iframe srcDoc={html} />;
}

export function sinks() {
  // ruleid: timhirt-no-html-string-sink
  el.innerHTML = html;
  // ruleid: timhirt-no-html-string-sink
  el.outerHTML = html;
  // ruleid: timhirt-no-html-string-sink
  el.insertAdjacentHTML("beforeend", html);
  // ruleid: timhirt-no-html-string-sink
  document.write(html);
  // ruleid: timhirt-no-html-string-sink
  document.execCommand("insertHTML", false, html);
  // ok: timhirt-no-html-string-sink
  document.execCommand("bold");
  // ruleid: timhirt-no-html-string-sink
  document.createRange().createContextualFragment(html);
  // ruleid: timhirt-no-html-string-sink
  el.setHTMLUnsafe(html);
  // ruleid: timhirt-no-html-string-sink
  Document.parseHTMLUnsafe(html);
  const frame = document.createElement("iframe");
  // ruleid: timhirt-no-html-string-sink
  frame.srcdoc = html;
  // ok: timhirt-no-html-string-sink
  el.replaceChildren(...nodes);
  // ok: timhirt-no-html-string-sink
  const current = el.innerHTML;
  return current;
}

export function code(s: string) {
  // ruleid: timhirt-no-dynamic-code
  eval(s);
  // ruleid: timhirt-no-dynamic-code
  new Function(s);
  // ruleid: timhirt-no-dynamic-code
  setTimeout("run()", 10);
  // ok: timhirt-no-dynamic-code
  setTimeout(() => s, 10);
}

export async function net() {
  // ruleid: timhirt-no-plain-http-fetch
  await fetch("http://apps.cbe.com.et/receipt");
  // ok: timhirt-no-plain-http-fetch
  await fetch("https://apps.cbe.com.et/receipt");
}
