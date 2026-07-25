// §16.2 header switcher; choice persists to users.locale + localStorage.
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/i18n";

const LABELS: Record<AppLocale, string> = { en: "English", am: "አማርኛ", om: "Afaan Oromoo" };

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const change = async (lng: AppLocale) => {
    await i18n.changeLanguage(lng);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("users").update({ locale: lng }).eq("id", user.id);
  };
  return (
    <select
      aria-label={t("common.language")}
      value={i18n.resolvedLanguage}
      onChange={(e) => change(e.target.value as AppLocale)}
      className="rounded-control border border-line bg-card px-2 py-1.5 text-sm"
    >
      {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{LABELS[l]}</option>)}
    </select>
  );
}
