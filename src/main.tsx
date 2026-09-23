import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App';
import './styles/system.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      // Clerk's own dialogs (account settings) dressed as Win98: square corners, system font, navy highlights
      appearance={{
        variables: {
          borderRadius: '0px',
          fontFamily: '"MS Sans Serif", Arial, sans-serif',
          colorPrimary: '#000080',
          colorBackground: '#c0c0c0',
          colorForeground: '#000000',
          colorInput: '#ffffff',
        },
        elements: {
          card: { border: '2px outset #ffffff', boxShadow: '2px 2px 0 #000' },
          modalContent: { border: '2px outset #ffffff', boxShadow: '2px 2px 0 #000' },
          formButtonPrimary: { boxShadow: 'none', border: '2px outset #ffffff' },
        },
      }}
    >
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
