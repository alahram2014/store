import { bootstrapApp } from './src/runtime/bootstrap.js';

bootstrapApp();

const pwaState = window.__ALAHRAM_PWA__ || (window.__ALAHRAM_PWA__ = {
  deferredPrompt: null,
  installAvailable: false,
  installed: Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator?.standalone === true
  ),
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  pwaState.deferredPrompt = event;
  pwaState.installAvailable = true;
});

window.addEventListener('appinstalled', () => {
  pwaState.deferredPrompt = null;
  pwaState.installAvailable = false;
  pwaState.installed = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
