import { clsx, type ClassValue } from "clsx";
import type { MouseEvent } from "react";
export const cn = (...inputs: ClassValue[]) => clsx(inputs);

/** Attach to a <tr>'s onDoubleClick to open that row's detail page. Ignores
 * double-clicks that land on a nested interactive element (a link, button,
 * input, select) inside the row -- those already have their own single-click
 * behavior (inline actions, inline edit fields) and shouldn't also trigger
 * row navigation. */
export function onRowDoubleClick(navigate: (path: string) => void, path: string) {
  return (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
    navigate(path);
  };
}
