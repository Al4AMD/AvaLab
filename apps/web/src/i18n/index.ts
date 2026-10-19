/**
 * i18next bootstrap.
 *
 * Resources are bundled (no backend loader) so the app works offline.
 * The persisted language lives in `localStorage["avalab.language"]`;
 * Persian is the default and English the fallback. `lang` and `dir`
 * on `<html>` are set here at boot and re-applied by the language
 * toggle on every change.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import fa from "./fa.json";

export const LANGUAGE_STORAGE_KEY = "avalab.language";

export type Language = "fa" | "en";

/**
 * Language autonyms: each language's own name, shown in its own script.
 * These are data for the language switcher, not translatable copy.
 */
export const LANGUAGE_AUTONYMS: Record<Language, string> = {
  fa: "فارسی",
  en: "English",
};

function readPersistedLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "fa";
  } catch {
    // Storage unavailable (e.g. blocked by browser settings) — default.
    return "fa";
  }
}

export function persistLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Persistence is best-effort; the session still switches language.
  }
}

/** Sync `<html lang>` / `<html dir>` with the active language. */
export function applyDocumentLanguage(language: Language): void {
  document.documentElement.lang = language;
  document.documentElement.dir = language === "fa" ? "rtl" : "ltr";
}

const initialLanguage = readPersistedLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["fa", "en"],
  interpolation: { escapeValue: false },
});

applyDocumentLanguage(initialLanguage);

export default i18n;
