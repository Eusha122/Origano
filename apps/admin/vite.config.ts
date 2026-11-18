import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * The page may load only its own files, the fonts, and talk to the API. Identity documents are shown from
 * `blob:` URLs, so `img-src` allows them. Built into index.html for production only: the dev server injects
 * inline scripts for hot reload, which this policy would block.
 * (`frame-ancestors` cannot be set from a meta tag; the host sends it as a header, Plan 11.)
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const api = new URL(apiUrl);
  const ws = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`;
  const policy = [
    "default-src 'self'",
    `img-src 'self' blob: data: ${api.origin}`,
    `connect-src 'self' ${api.origin} ${ws}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "base-uri 'none'",
  ].join('; ');
  return {
    name: 'oregano-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return { plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:4000')] };
});
