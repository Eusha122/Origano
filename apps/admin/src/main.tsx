import { ApiProvider, createWebSessionStore } from '@oregano/app-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { apiUrl, realtimeUrl } from './config';
import './styles.css';
import { applyTheme } from './theme';

applyTheme();

// The access token lives in memory; the refresh token is an httpOnly cookie the page cannot read.
const session = createWebSessionStore();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <ApiProvider baseUrl={apiUrl} realtimeUrl={realtimeUrl} session={session}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
