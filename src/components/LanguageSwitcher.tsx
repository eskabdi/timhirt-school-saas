// §16.2 header switcher; choice persists to users.locale + localStorage.
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/i18n";

const LABELS: Record<AppLocale, string> = { en: "English", am: "አማርኛ", om: "Afaan Oromoo" };

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const change = async (lng: AppLocale) => {
    await i18n.changeLanguage(lng);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from("users").update({ locale: lng }).eq("id", user.id);
  };
  return (
    <select
      aria-label="Language"
      value={i18n.resolvedLanguage}
      onChange={(e) => change(e.target.value as AppLocale)}
      className="rounded-card border border-line bg-chalk-raised px-2 py-1.5 text-sm"
    >
      {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{LABELS[l]}</option>)}
    </select>
  );
}
