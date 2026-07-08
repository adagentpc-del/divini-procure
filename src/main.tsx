import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './theme.css';
// Initialize i18n (language detection + translations) before the app renders.
import './i18n';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
