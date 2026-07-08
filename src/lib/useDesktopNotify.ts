/**
 * useDesktopNotify — send a native OS notification when running in Electron,
 * fall back to the Web Notifications API in a browser tab.
 *
 * Usage:
 *   const notify = useDesktopNotify();
 *   notify('COI Expiring', 'Acme LLC insurance expires in 15 days.');
 */

import { useCallback } from 'react';

export function useDesktopNotify() {
  return useCallback(async (title: string, body: string) => {
    // Electron path
    if (window.divini?.notify) {
      await window.divini.notify(title, body);
      return;
    }

    // Web Notifications fallback
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    }
  }, []);
}

/**
 * True when the page is loaded inside the Electron shell.
 */
export const isDesktop = typeof window !== 'undefined' && !!window.divini?.isDesktop;
