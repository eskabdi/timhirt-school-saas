// Ethiopian personal names are First + Middle (father's name) + Last
// (grandfather's name); the short form is First + Middle. Every rendered
// person name goes through these helpers so the middle name is never dropped
// (fix plan §0 Rule 8, M-12). Staff rows call the middle name `father_name`.
export type PersonName = {
  first_name?: string | null;
  middle_name?: string | null;
  father_name?: string | null;
  last_name?: string | null;
};

const join = (parts: (string | null | undefined)[]) =>
  parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" ");

/** First + Middle + Last. */
export function fullName(p: PersonName | null | undefined): string {
  if (!p) return "";
  return join([p.first_name, p.middle_name ?? p.father_name, p.last_name]);
}

/** First + Middle: the Ethiopian short form. */
export function shortName(p: PersonName | null | undefined): string {
  if (!p) return "";
  return join([p.first_name, p.middle_name ?? p.father_name]);
}
