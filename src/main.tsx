import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {createSessionManager, validateSite} from './session.ts';
import type {Site, SessionManager} from './session.ts';
import './styles.css';
let site: Site | null = null, manager: SessionManager | null = null;
try {
  const response = await fetch('/site.json', {credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('site_unavailable');
  const text = await response.text(); if (text.length > 4096) throw new Error('site_configuration');
  site = validateSite(JSON.parse(text));
  if (site.service_id && location.protocol === 'https:') manager = createSessionManager(site);
} catch { /* 不从URL参数或用户输入替换站点与秘密接收方。 */ }
window.addEventListener('pagehide', () => manager?.leavePage());
createRoot(document.getElementById('root')!).render(<StrictMode><App site={site} manager={manager}/></StrictMode>);
