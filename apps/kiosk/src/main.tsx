import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

/**
 * Kiosk entry point.
 *
 * Deliberately minimal. Everything interesting lives in `App` and
 * `useKioskController`; this file only mounts it and fails loudly to the operator if
 * mounting itself fails, because a blank screen at a kiosk is worse than a message.
 */
const container = document.getElementById('root');

if (!container) {
  document.body.textContent = 'This kiosk could not start. Please call the person at the desk.';
} else {
  try {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    // Nothing below this point can render, so write plain text.
    const message = 'This kiosk could not start. Please call the person at the desk.';
    container.textContent = message;
    // Surfaced to the API so support can correlate it with the server log.
    void fetch('/api/v1/kiosk/report-error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'REACT_MOUNT_FAILED', context: { message: (err as Error)?.message ?? 'unknown' } }),
    }).catch(() => undefined);
  }
}

// The kiosk must never be restored from the browser's back/forward cache.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});
