// Toolbar + contentEditable body, matching the notice editor design.
//
// Formatting goes through document.execCommand. It is formally deprecated, but
// every current browser still implements it and the alternative — a selection/
// range engine of our own, or a multi-hundred-KB editor dependency — is a poor
// trade for a notice box. What the user produces is still never trusted:
// <RichText/> re-parses it through an allow-list at render time.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type Cmd = { key: string; label: string; cmd: string; arg?: string; className?: string };

const INLINE: Cmd[] = [
  { key: "bold", label: "B", cmd: "bold", className: "font-bold" },
  { key: "italic", label: "I", cmd: "italic", className: "italic" },
  { key: "underline", label: "U", cmd: "underline", className: "underline" },
  { key: "strike", label: "S", cmd: "strikeThrough", className: "line-through" },
];
const BLOCK: Cmd[] = [
  { key: "quote", label: "❞", cmd: "formatBlock", arg: "blockquote" },
  { key: "code", label: "</>", cmd: "formatBlock", arg: "pre" },
];
const LISTS: Cmd[] = [
  { key: "ordered", label: "1.", cmd: "insertOrderedList" },
  { key: "bullet", label: "•", cmd: "insertUnorderedList" },
];
const BLOCK_FORMATS = [
  { value: "p", labelKey: "richText.normal" },
  { value: "h1", labelKey: "richText.heading1" },
  { value: "h2", labelKey: "richText.heading2" },
  { value: "h3", labelKey: "richText.heading3" },
];

export function RichTextEditor({ value, onChange, placeholder, minHeight = 220 }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!value);

  // Only push `value` into the DOM when it diverges from what the user is
  // typing; writing on every keystroke would reset the caret to the start.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value ?? "";
    setEmpty(!(value ?? "").replace(/<[^>]*>/g, "").trim());
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? "";
    setEmpty(!html.replace(/<[^>]*>/g, "").trim());
    onChange(html);
  };

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const addLink = () => {
    const url = window.prompt(t("richText.linkPrompt"));
    if (!url) return;
    // Reject anything that is not a plain web/mail link before it reaches the
    // document; the renderer drops these too, but failing here tells the author.
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(url)) { window.alert(t("richText.linkInvalid")); return; }
    run("createLink", url);
  };
  const addImage = () => {
    const url = window.prompt(t("richText.imagePrompt"));
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { window.alert(t("richText.imageInvalid")); return; }
    run("insertImage", url);
  };

  const btn = "rounded px-2 py-1 text-sm text-ink-soft hover:bg-sidebar";

  const group = (cmds: Cmd[]) => cmds.map((c) => (
    <button key={c.key} type="button" title={t(`richText.${c.key}`)} aria-label={t(`richText.${c.key}`)}
      onMouseDown={(e) => e.preventDefault()} onClick={() => run(c.cmd, c.arg)}
      className={cn(btn, c.className)}>{c.label}</button>
  ));

  return (
    <div className="rounded-control border border-line bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {group(INLINE)}
        <span className="mx-1 h-4 w-px bg-line" />
        {group(BLOCK)}
        <span className="mx-1 h-4 w-px bg-line" />
        {group(LISTS)}
        <span className="mx-1 h-4 w-px bg-line" />
        <select
          aria-label={t("richText.blockFormat")}
          defaultValue="p"
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => run("formatBlock", e.target.value)}
          className="rounded border border-line bg-card px-1.5 py-1 text-xs text-ink"
        >
          {BLOCK_FORMATS.map((f) => <option key={f.value} value={f.value}>{t(f.labelKey)}</option>)}
        </select>
        <button type="button" title={t("richText.clear")} aria-label={t("richText.clear")}
          onMouseDown={(e) => e.preventDefault()} onClick={() => run("removeFormat")} className={btn}>Tx</button>
        <span className="mx-1 h-4 w-px bg-line" />
        <button type="button" title={t("richText.link")} aria-label={t("richText.link")}
          onMouseDown={(e) => e.preventDefault()} onClick={addLink} className={btn}>🔗</button>
        <button type="button" title={t("richText.image")} aria-label={t("richText.image")}
          onMouseDown={(e) => e.preventDefault()} onClick={addImage} className={btn}>🖼</button>
      </div>

      <div className="relative">
        {empty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-3 text-sm italic text-ink-faint">{placeholder}</p>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder ?? t("richText.body")}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onBlur={emit}
          style={{ minHeight }}
          className="w-full px-3 py-3 text-sm text-ink outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_h1]:font-display [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-display [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:rounded [&_pre]:bg-sidebar [&_pre]:p-2 [&_ul]:list-disc"
        />
      </div>
    </div>
  );
}
