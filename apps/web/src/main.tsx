import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { landingTitle, landingDescription, siteOrigin, websiteSchema } from './seo';
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
const isLanding=path==='/'&&!digestAction;
const meta=(key:string,content:string,property=false)=>{
  const attr=property?'property':'name';
  let element=document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if(!element){element=document.createElement('meta');element.setAttribute(attr,key);document.head.append(element);}
  element.content=content;
};
if(isLanding)document.title=landingTitle;
const description=isLanding?landingDescription:path==='/app'?'Explorez la carte des stations-service et comparez les prix et la disponibilité des carburants dans les Pyrénées-Atlantiques avec Trajetico.':path==='/notifications'?'Découvrez comment recevoir les alertes carburant et le digest email Trajetico.':'Informations et services Trajetico.';
meta('description',description);meta('og:title',document.title,true);meta('og:description',description,true);
meta('og:site_name','Trajetico',true);meta('og:url',`${siteOrigin}${path==='/'?'/':path}`,true);
const indexable=['/','/app','/notifications','/privacy','/mentions-legales'].includes(path)&&!digestAction;
meta('robots',indexable?'index, follow':'noindex, follow');
let canonical=document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.append(canonical);}
canonical.href=`${siteOrigin}${path==='/'?'/':path}`;
document.getElementById('website-schema')?.remove();
if(isLanding){const schema=document.createElement('script');schema.id='website-schema';schema.type='application/ld+json';schema.textContent=JSON.stringify(websiteSchema);document.head.append(schema);}
const app=(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isLanding?page:<Suspense fallback={<p role="status">Chargement de la carte…</p>}>{page}</Suspense>}
    </QueryClientProvider>
  </StrictMode>
);
const root=document.getElementById('root')!;
if(isLanding&&root.hasChildNodes())hydrateRoot(root,app);
else createRoot(root).render(app);
