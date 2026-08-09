import { useTranslation } from "react-i18next";
import type { PasswordPolicy } from "@/lib/passwordPolicy";

/** Renders the currently-configured password policy as a single line, so the
 *  requirement is visible before the user gets an error for missing it. */
export function PasswordPolicyHint({ policy }: { policy: PasswordPolicy }) {
  const { t } = useTranslation();
  const parts = [t("auth.policy.minLength", { count: policy.minLength })];
  if (policy.requireUppercase) parts.push(t("auth.policy.uppercase"));
  if (policy.requireNumbers) parts.push(t("auth.policy.numbers"));
  if (policy.requireSpecial) parts.push(t("auth.policy.special"));
  return <p className="text-xs text-ink-faint">{parts.join(" · ")}</p>;
}
