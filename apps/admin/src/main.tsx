import { ApiProvider, webTokenStorage } from '@oregano/app-core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { apiUrl, realtimeUrl } from './config';
import './styles.css';
import { applyTheme } from './theme';

applyTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <StrictMode>
    <ApiProvider baseUrl={apiUrl} realtimeUrl={realtimeUrl} storage={webTokenStorage}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
