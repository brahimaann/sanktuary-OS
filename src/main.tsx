import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import './styles/system.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <App />
    </ClerkProvider>
  </React.StrictMode>,
);

// ──────────────────────────────────────────────
// Browser Zoom Prevention (Desktop & Mobile)
// ──────────────────────────────────────────────

// Disable browser keyboard zoom hotkeys (Ctrl + '=', Ctrl + '-', Ctrl + '0')
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '-' || e.key === '+' || e.key === '0' || e.key === '_')) {
    e.preventDefault();
  }
});

// Disable browser wheel zoom (Ctrl + mouse wheel scroll and touchpad pinch-zoom),
// except when targeting the Ppls Story world map container
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      const isInsideMap = e.target instanceof Element && e.target.closest('.ppls-map-container, .sk-canvas');
      if (!isInsideMap) {
        e.preventDefault();
      }
    }
  },
  { passive: false },
);

// Disable mobile touch-pinch gesture zoom, except over the world map
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) {
      const isInsideMap = e.target instanceof Element && e.target.closest('.ppls-map-container, .sk-canvas');
      if (!isInsideMap) {
        e.preventDefault();
      }
    }
  },
  { passive: false },
);
