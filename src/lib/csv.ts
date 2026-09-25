// One CSV cell for spreadsheet exports (invoices, payroll). Quotes separators
// and quotes (RFC 4180) and neutralises formula injection: a cell that starts
// with = + - @ tab or CR is prefixed with ' so Excel/LibreOffice treat it as
// text, not a formula (OWASP CSV Injection, CWE-1236; R6 review SEC-WP01-3).
// A plain number (including a negative amount formatted with toFixed) is
// data, not a formula, and is left alone.
export function csvCell(value: string | number): string {
  let s = String(value);
  if (!/^[+-]?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
