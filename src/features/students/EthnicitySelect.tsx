// One control for choosing a student's ethnic group.
//
// Three forms need it — the public application, the staff "add student" form
// and the profile editor — and a 39-option list pasted into three files is how
// three files stop agreeing with each other. The options come from
// ETHNIC_GROUPS; only the label lookup lives here.
//
// Always optional. A family that would rather not answer has to be able to
// finish an application, so the empty option is real and every caller maps it
// to NULL before writing (the column's CHECK rejects the empty string).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/ui/Field";
import { ETHNIC_GROUPS } from "@/lib/ethnic-groups";

/**
 * The option list, shared by this control and the public application form.
 *
 * The public form wraps its fields differently and translates from the `apply`
 * namespace, so it cannot reuse the component below — but it must not reimplement
 * the ordering, or the same list would appear in two different orders in the
 * same product.
 *
 * Sorted by the label the reader actually sees: ETHNIC_GROUPS is in English
 * census order, which is meaningless once the labels are Amharic or Afaan
 * Oromoo. 'other' and 'undisclosed' are pinned last — they are escape hatches,
 * not entries in an alphabetical list.
 */
export function useEthnicityOptions(): { key: string; label: string }[] {
  const { t } = useTranslation();
  return useMemo(() => {
    const tail = ["other", "undisclosed"];
    const label = (k: string) => t(`ethnicity.${k}`, { defaultValue: k });
    const body = ETHNIC_GROUPS.filter((k) => !tail.includes(k))
      .map((k) => ({ key: k as string, label: label(k) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [...body, ...tail.map((k) => ({ key: k, label: label(k) }))];
  }, [t]);
}

export function EthnicitySelect({ value, onChange, label, hint, error }: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string;
  error?: string;
}) {
  const { t } = useTranslation();
  const options = useEthnicityOptions();

  return (
    <Field label={label ?? t("students.ethnicity")} hint={hint ?? t("students.ethnicityHint")} error={error}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
      >
        <option value="">{t("ethnicity.unrecorded")}</option>
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}
