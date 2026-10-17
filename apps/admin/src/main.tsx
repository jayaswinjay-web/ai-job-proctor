import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

/**
 * Entry point.
 *
 * A 401 on any request triggers one silent refresh, and if that fails the app returns to
 * the login screen. This module installs that handler once, before any request is made.
 */

const container = document.getElementById('root');
if (!container) throw new Error('The #root element is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
