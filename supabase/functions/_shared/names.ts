// Ethiopian personal names: First + Middle (father's name) + Last. Mirrors
// src/lib/names.ts for Edge Functions (fix plan §0 Rule 8, M-12); documents
// and receipts must never drop the middle name.
export type PersonName = {
  first_name?: string | null;
  middle_name?: string | null;
  father_name?: string | null;
  last_name?: string | null;
};

export function fullName(p: PersonName | null | undefined): string {
  if (!p) return "";
  return [p.first_name, p.middle_name ?? p.father_name, p.last_name]
    .map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}
