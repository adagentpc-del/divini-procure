/**
 * Divini Procure — i18n configuration
 *
 * Supported languages (16 total, international coverage):
 *   en  — English (default)
 *   es  — Spanish
 *   ht  — Haitian Creole
 *   pt  — Portuguese / Brazilian
 *   fr  — French
 *   de  — German
 *   it  — Italian
 *   zh  — Simplified Chinese (Mandarin)
 *   ar  — Arabic (RTL — set dir="rtl" on <html> when this language is active)
 *   ja  — Japanese
 *   ko  — Korean
 *   ru  — Russian
 *   hi  — Hindi
 *   vi  — Vietnamese
 *   tr  — Turkish
 *   pl  — Polish
 *
 * Detection order: localStorage key "divini_lang" → browser navigator.language →
 * fallback "en". The user's explicit choice is persisted to localStorage so it
 * survives refreshes and new sessions.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en';
import es from './locales/es';
import ht from './locales/ht';
import pt from './locales/pt';
import fr from './locales/fr';
import de from './locales/de';
import it from './locales/it';
import zh from './locales/zh';
import ar from './locales/ar';
import ja from './locales/ja';
import ko from './locales/ko';
import ru from './locales/ru';
import hi from './locales/hi';
import vi from './locales/vi';
import tr from './locales/tr';
import pl from './locales/pl';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English',         nativeLabel: 'English' },
  { code: 'es', label: 'Spanish',         nativeLabel: 'Español' },
  { code: 'ht', label: 'Haitian Creole',  nativeLabel: 'Kreyòl ayisyen' },
  { code: 'pt', label: 'Portuguese',      nativeLabel: 'Português' },
  { code: 'fr', label: 'French',          nativeLabel: 'Français' },
  { code: 'de', label: 'German',          nativeLabel: 'Deutsch' },
  { code: 'it', label: 'Italian',         nativeLabel: 'Italiano' },
  { code: 'zh', label: 'Chinese',         nativeLabel: '中文' },
  { code: 'ar', label: 'Arabic',          nativeLabel: 'العربية' },
  { code: 'ja', label: 'Japanese',        nativeLabel: '日本語' },
  { code: 'ko', label: 'Korean',          nativeLabel: '한국어' },
  { code: 'ru', label: 'Russian',         nativeLabel: 'Русский' },
  { code: 'hi', label: 'Hindi',           nativeLabel: 'हिन्दी' },
  { code: 'vi', label: 'Vietnamese',      nativeLabel: 'Tiếng Việt' },
  { code: 'tr', label: 'Turkish',         nativeLabel: 'Türkçe' },
  { code: 'pl', label: 'Polish',          nativeLabel: 'Polski' },
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGUAGES)[number]['code'];

/** RTL languages — document.dir should be set to 'rtl' for these. */
export const RTL_LANGS: ReadonlySet<SupportedLang> = new Set(['ar']);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      ht: { translation: ht },
      pt: { translation: pt },
      fr: { translation: fr },
      de: { translation: de },
      it: { translation: it },
      zh: { translation: zh },
      ar: { translation: ar },
      ja: { translation: ja },
      ko: { translation: ko },
      ru: { translation: ru },
      hi: { translation: hi },
      vi: { translation: vi },
      tr: { translation: tr },
      pl: { translation: pl },
    },
    // Fall back to English for any key or language not found.
    fallbackLng: 'en',
    // Supported languages — LanguageDetector will not resolve to others.
    supportedLngs: ['en', 'es', 'ht', 'pt', 'fr', 'de', 'it', 'zh', 'ar', 'ja', 'ko', 'ru', 'hi', 'vi', 'tr', 'pl'],
    // Match 'es-MX', 'pt-BR', 'zh-CN', 'ar-SA' etc. to their base codes.
    nonExplicitSupportedLngs: true,
    detection: {
      // Check localStorage first (explicit user choice), then browser language.
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'divini_lang',
      caches: ['localStorage'],
    },
    interpolation: {
      // React already handles XSS escaping.
      escapeValue: false,
    },
    // Disable key-not-found console warnings in production.
    saveMissing: false,
  });

// Wire up RTL support: set document.dir whenever the language changes.
i18n.on('languageChanged', (lng: string) => {
  const base = lng.slice(0, 2) as SupportedLang;
  document.documentElement.dir = RTL_LANGS.has(base) ? 'rtl' : 'ltr';
});

export default i18n;
