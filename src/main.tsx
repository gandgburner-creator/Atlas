import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';
import { applyTheme } from './theme';

// Offline-first: take the new service worker as soon as it's ready. There's
// no server state to coordinate with, so there's nothing to lose by updating.
registerSW({ immediate: true });

// Before the first paint, so a chosen theme never flashes the other one.
applyTheme();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
