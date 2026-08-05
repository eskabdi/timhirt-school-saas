// §16.2 header switcher; choice persists to users.locale + localStorage.
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LABELS: Record<AppLocale, string> = { en: "English", am: "አማርኛ", om: "Afaan Oromoo" };

// `dark` renders as a pill legible on the navy top bar (DashboardShell);
// every other call site (login, public forms) keeps the light default.
export function LanguageSwitcher({ variant = "light" }: { variant?: "light" | "dark" }) {
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
      className={cn(
        "w-20 truncate rounded-pill px-2 py-1 text-xs sm:w-auto sm:px-3 sm:py-1.5 sm:text-sm",
        variant === "dark"
          ? "border border-white/20 bg-white/10 text-white [color-scheme:dark] hover:bg-white/15"
          : "border border-line bg-card text-ink",
      )}
    >
      {SUPPORTED_LOCALES.map((l) => <option key={l} value={l} className="text-ink">{LABELS[l]}</option>)}
    </select>
  );
}
