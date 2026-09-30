import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { DigestLink } from './DigestPanel';
import { AlertsPage, NotificationsPage } from './Alerts';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
});

const digestAction = new URLSearchParams(window.location.search).get('digest');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {location.pathname==='/mes-alertes'?<AlertsPage/>:location.pathname==='/notifications'?<NotificationsPage/>:digestAction === 'verify' || digestAction === 'unsubscribe' ? <DigestLink action={digestAction} /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
);
