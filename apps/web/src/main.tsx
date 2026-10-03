import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import Landing from './Landing';
import { LegalPage } from './LegalPages';
const App = lazy(() => import('./App'));
import { DigestLink } from './DigestPanel';
import { AlertsPage, NotificationsPage } from './Alerts';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const params = new URLSearchParams(window.location.search);
const digestAction = params.get('digest');
// Preserve previously shared map URLs without changing verification links or tokens.
if (location.pathname === '/' && digestAction !== 'verify' && digestAction !== 'unsubscribe'
    && (params.has('station') || params.has('fuel') || digestAction === 'open')) {
  history.replaceState(null, '', '/app' + location.search + location.hash);
}
const path = location.pathname.replace(/\/$/, '') || '/';
const page = path === '/mes-alertes' ? <AlertsPage />
  : path === '/notifications' ? <NotificationsPage />
  : digestAction === 'verify' || digestAction === 'unsubscribe' ? <DigestLink action={digestAction} />
  : path === '/privacy' ? <LegalPage privacy />
  : path === '/mentions-legales' ? <LegalPage />
  : path === '/app' ? <App />
  : path === '/' ? <Landing />
  : <main className="alerts-page"><h1>Page introuvable</h1><a href="/">Accueil</a> · <a href="/app">Ouvrir la carte</a></main>;
if (path !== '/' || digestAction) document.title = path === '/privacy' ? 'Confidentialité — Trajetico' : path === '/mentions-legales' ? 'Mentions légales — Trajetico' : path === '/mes-alertes' ? 'Mes alertes — Trajetico' : path === '/notifications' ? 'Les alertes — Trajetico' : 'Carte et carburants — Trajetico';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p role="status">Chargement de la carte…</p>}>{page}</Suspense>
    </QueryClientProvider>
  </StrictMode>,
);
