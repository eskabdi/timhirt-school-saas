// ============================================================================
// i18n bootstrap (§16.2) — react-i18next + ICU; am/om/en; en fallback.
// escapeValue=false is safe: React auto-escapes (XSS discipline §6.5);
// dangerouslySetInnerHTML is banned by lint.
// ============================================================================
import i18n from "i18next";
import ICU from "i18next-icu";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "@/locales/en/common.json";
import enCalendar from "@/locales/en/calendar.json";
import amCommon from "@/locales/am/common.json";
import amCalendar from "@/locales/am/calendar.json";
import omCommon from "@/locales/om/common.json";
import omCalendar from "@/locales/om/calendar.json";

export const SUPPORTED_LOCALES = ["en", "am", "om"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

i18n
  .use(ICU)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon, calendar: enCalendar },
      am: { common: amCommon, calendar: amCalendar },
      om: { common: omCommon, calendar: omCalendar },
    },
    supportedLngs: [...SUPPORTED_LOCALES],
    fallbackLng: "en",
    defaultNS: "common",
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
  });

export default i18n;

/** Resolve a jsonb i18n field ({en, am, om}) client-side — mirrors SQL t_field(). */
export function tField(field: Record<string, string> | null | undefined, locale: string): string {
  if (!field) return "";
  return field[locale] ?? field.en ?? field.am ?? field.om ?? "";
}

/** ETB currency in the active locale (§16.5). */
export function formatETB(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-ET" : locale, {
    style: "currency", currency: "ETB", currencyDisplay: "narrowSymbol",
  }).format(amount);
}
