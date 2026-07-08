/**
 * LanguageSwitcher — compact dropdown to switch the UI language.
 *
 * Can be rendered in two modes:
 *   compact (default) — icon + current language code, dropdown on click
 *   full              — "Language" label + full native name
 *
 * The selected language is persisted to localStorage ("divini_lang") via
 * i18next-browser-languagedetector so it survives page reloads.
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLang } from '../i18n';

interface Props {
  /** Show full label + native language name. Default: compact icon+code mode. */
  full?: boolean;
  /** Additional CSS class on the root element. */
  className?: string;
}

export default function LanguageSwitcher({ full = false, className = '' }: Props) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentCode = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2) as SupportedLang;
  const current = SUPPORTED_LANGUAGES.find(l => l.code === currentCode) ?? SUPPORTED_LANGUAGES[0];

  function select(code: SupportedLang) {
    i18n.changeLanguage(code);
    setOpen(false);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      ref={ref}
      className={`lang-switcher ${className}`}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.label')}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: '1px solid var(--line, #e0dbd0)',
          borderRadius: 8,
          padding: full ? '6px 10px' : '5px 9px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink, #1a1a1a)',
          whiteSpace: 'nowrap',
        }}
      >
        {/* Globe icon */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <path d="M2 12h20" />
        </svg>
        {full ? current.nativeLabel : current.code.toUpperCase()}
        {/* Chevron */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 2, transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('language.label')}
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            background: '#fff',
            border: '1px solid var(--line, #e0dbd0)',
            borderRadius: 10,
            boxShadow: '0 8px 24px -8px rgba(0,0,0,.18)',
            padding: '4px 0',
            minWidth: 170,
            zIndex: 200,
            listStyle: 'none',
            margin: 0,
          }}
        >
          {SUPPORTED_LANGUAGES.map(lang => (
            <li key={lang.code} role="option" aria-selected={lang.code === currentCode}>
              <button
                type="button"
                onClick={() => select(lang.code)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: lang.code === currentCode ? 'var(--emerald-pale, #eef7f2)' : 'none',
                  border: 'none',
                  padding: '9px 14px',
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: 'var(--ink, #1a1a1a)',
                  fontWeight: lang.code === currentCode ? 600 : 400,
                }}
              >
                <span>{lang.nativeLabel}</span>
                {lang.code === currentCode && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--emerald, #1e5d4a)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
