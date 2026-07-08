/**
 * Divini Procure — i18n configuration
 *
 * Languages supported at Miami launch:
 *   en  — English (default)
 *   es  — Spanish (largest non-English community in Miami-Dade)
 *   ht  — Haitian Creole (second largest non-English community)
 *   pt  — Portuguese/Brazilian (significant South Florida community)
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

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { code: 'ht', label: 'Haitian Creole', nativeLabel: 'Kreyòl ayisyen' },
  { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGUAGES)[number]['code'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
      ht: { translation: ht },
      pt: { translation: pt },
    },
    // Fall back to English for any key or language not found.
    fallbackLng: 'en',
    // Supported languages — LanguageDetector will not resolve to others.
    supportedLngs: ['en', 'es', 'ht', 'pt'],
    // Match 'es-MX', 'es-419' etc. to 'es'; 'pt-BR' to 'pt'.
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

export default i18n;
