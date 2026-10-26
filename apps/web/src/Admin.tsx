import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminApiError, namesRequest } from './admin-api';
import type { AdminStation, NameHistory, NameSuggestion, Page } from './admin-api';

const date = (value: string) => new Date(value).toLocaleString('fr-FR');
const stationAddress = (item: { address: string | null; city: string | null; official_id: string }) =>
  `${[item.address, item.city].filter(Boolean).join(', ') || 'Adresse non renseignée'} · ${item.official_id}`;
type Run = (action: () => Promise<unknown>) => Promise<boolean>;

export default function Admin() {
  const client = useQueryClient();
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'suggestions' | 'stations'>('suggestions');
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const session = useQuery({ queryKey: ['admin', 'session'], queryFn: () => namesRequest<{ username: string }>('/admin/session'), retry: false });
  const loggedIn = !!session.data && !expired && !session.isError;
  const suggestions = useQuery({ queryKey: ['admin', 'suggestions', status, page], queryFn: () => namesRequest<Page<NameSuggestion>>(`/admin/name-suggestions?status=${status}&page=${page}`), enabled: loggedIn && tab === 'suggestions', retry: false });
  const stations = useQuery({ queryKey: ['admin', 'stations', search, page], queryFn: () => namesRequest<Page<AdminStation>>(`/admin/stations?${new URLSearchParams({ q: search, page: String(page) })}`), enabled: loggedIn && tab === 'stations', retry: false });
  const run: Run = async action => {
    setBusy(true); setError(''); setMessage('');
    try {
      await action();
      await Promise.all([client.invalidateQueries({ queryKey: ['admin'] }), client.invalidateQueries({ queryKey: ['stations'] }), client.invalidateQueries({ queryKey: ['station'] })]);
      setMessage('Modification enregistrée.'); return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Demande impossible.');
      if (error instanceof AdminApiError && error.status === 401) setExpired(true);
      return false;
    } finally { setBusy(false); }
  };
  const active = tab === 'suggestions' ? suggestions : stations;
  const needsLogin = !loggedIn || (active.error instanceof AdminApiError && active.error.status === 401);
  return <main className="alerts-page admin-page">
    <nav aria-label="Navigation"><a href="/">← Accueil</a><a href="/app">Carte</a></nav>
    <h1>Administration </h1>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {session.isPending ? <p role="status">Chargement…</p> : needsLogin ? <AdminLogin busy={busy} login={async (username, password) => {
      const ok = await run(() => namesRequest('/admin/login', 'POST', { username, password }));
      if (ok) { setExpired(false); setMessage('Connexion réussie.'); }
      return ok;
    }} /> : <>
      <div className="admin-actions"><span>Connecté : {session.data?.username}</span><button disabled={busy} onClick={async () => {
        if (await run(() => namesRequest('/admin/logout', 'POST'))) { client.removeQueries({ queryKey: ['admin'] }); setExpired(true); setMessage('Déconnexion réussie.'); }
      }}>Se déconnecter</button></div>
      <nav className="admin-actions" aria-label="Administration">
        <button aria-pressed={tab === 'suggestions'} onClick={() => { setTab('suggestions'); setPage(1); }}>Propositions</button>
        <button aria-pressed={tab === 'stations'} onClick={() => { setTab('stations'); setPage(1); }}>Stations</button>
      </nav>
      {tab === 'suggestions' ? <label>État<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
        <option value="PENDING">En attente</option><option value="APPROVED">Acceptées</option><option value="REJECTED">Refusées</option>
      </select></label> : <form className="admin-search" onSubmit={e => { e.preventDefault(); setSearch(q); setPage(1); }}>
        <label>Nom, adresse, ville ou identifiant officiel<input maxLength={120} value={q} onChange={e => setQ(e.target.value)} /></label><button>Rechercher</button>
      </form>}
      {active.isPending && <p role="status">Chargement…</p>}
      {active.isError && <p role="alert" className="error">{active.error.message}</p>}
      <button type="button" disabled={active.isFetching || busy} onClick={() => void active.refetch()}>Actualiser</button>
      {active.data?.items.length === 0 && <p>Aucun résultat.</p>}
      {tab === 'suggestions' ? suggestions.data?.items.map(item => <Suggestion key={`${item.id}-${item.display_name}`} item={item} run={run} busy={busy} />)
        : stations.data?.items.map(item => <StationEditor key={`${item.id}-${item.display_name}`} item={item} run={run} busy={busy} />)}
      <div className="admin-actions"><button disabled={page === 1 || active.isFetching} onClick={() => setPage(page - 1)}>Précédent</button><span>Page {page}</span><button disabled={!active.data?.hasMore || active.isFetching} onClick={() => setPage(page + 1)}>Suivant</button></div>
    </>}
  </main>;
}

function AdminLogin({ login, busy }: { login: (username: string, password: string) => Promise<boolean>; busy: boolean }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  return <form className="admin-login" onSubmit={async e => { e.preventDefault(); if (await login(username, password)) setPassword(''); }}>
    <h2>Connexion administrateur</h2><label>Identifiant<input autoComplete="username" required maxLength={120} value={username} onChange={e => setUsername(e.target.value)} /></label>
    <label>Mot de passe<input type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button disabled={busy}>Se connecter</button>
  </form>;
}

function Suggestion({ item, run, busy }: { item: NameSuggestion; run: Run; busy: boolean }) {
  const [name, setName] = useState(item.proposed_name); const [reason, setReason] = useState('');
  return <article className="admin-card"><h2>{item.display_name ?? 'Station-service'}</h2><p>{stationAddress(item)}</p>
    <p>Proposé le {date(item.created_at)} : <strong>{item.proposed_name}</strong></p>
    <p>Nom lors de l’envoi : {item.original_name ?? 'Station-service'}</p>
    {item.original_name !== item.display_name && <p className="admin-notice">Le nom de la station a changé depuis cette proposition.</p>}
    {item.comment && <p className="admin-comment">{item.comment}</p>}
    {item.status === 'PENDING' ? <form onSubmit={e => { e.preventDefault(); void run(() => namesRequest(`/admin/name-suggestions/${item.id}`, 'PUT', { decision: 'APPROVED', name: name.trim(), expectedName: item.display_name, reason })); }}>
      <label>Nom à publier<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Motif (facultatif)<textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="admin-actions"><button disabled={busy || name.trim().length < 2}>Accepter et publier</button><button type="button" disabled={busy} onClick={() => void run(() => namesRequest(`/admin/name-suggestions/${item.id}`, 'PUT', { decision: 'REJECTED', expectedName: item.display_name, reason }))}>Refuser</button></div>
    </form> : <p>{item.status === 'APPROVED' ? `Nom publié : ${item.approved_name}` : 'Proposition refusée'} · {item.reviewed_by} · {item.reviewed_at && date(item.reviewed_at)}{item.decision_reason && <><br />{item.decision_reason}</>}</p>}
    <a href={`/app?station=${item.station_id}`}>Voir sur la carte</a>
  </article>;
}

function StationEditor({ item, run, busy }: { item: AdminStation; run: Run; busy: boolean }) {
  const [editing, setEditing] = useState(false); const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(item.display_name ?? ''); const [historyOpen, setHistoryOpen] = useState(false); const [page, setPage] = useState(1);
  const history = useQuery({ queryKey: ['admin', 'history', item.id, page], queryFn: () => namesRequest<Page<NameHistory>>(`/admin/stations/${item.id}/history?page=${page}`), enabled: historyOpen, retry: false });
  return <article className="admin-card"><h2>{item.display_name ?? 'Station-service'}</h2><p>{stationAddress(item)}</p>
    <p>Dernières données : {date(item.last_seen_at)}{Date.now() - new Date(item.last_seen_at).getTime() > 86400000 && ' — station absente des données récentes'}</p>
    <div className="admin-actions"><button aria-expanded={editing} onClick={() => { setEditing(!editing); setConfirm(false); }}>Modifier le nom</button><button aria-expanded={historyOpen} onClick={() => setHistoryOpen(!historyOpen)}>Historique</button></div>
    {editing && <form onSubmit={async e => {
      e.preventDefault(); if (!confirm) { setConfirm(true); return; }
      if (await run(() => namesRequest(`/admin/stations/${item.id}/name`, 'PUT', { name: name.trim(), expectedName: item.display_name }))) { setEditing(false); setConfirm(false); }
    }}><label>Nouveau nom<input required minLength={2} maxLength={120} value={name} onChange={e => { setName(e.target.value); setConfirm(false); }} /></label>
      {confirm && <p role="status">Publier « {name.trim()} » à la place de « {item.display_name ?? 'Station-service'} » ?</p>}
      <div className="admin-actions"><button disabled={busy || name.trim().length < 2 || name.trim() === (item.display_name ?? 'Station-service')}>{confirm ? 'Confirmer la modification' : 'Enregistrer'}</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setConfirm(false); setName(item.display_name ?? ''); }}>Annuler</button></div>
    </form>}
    {historyOpen && <section aria-label="Historique des noms">
      {history.isPending && <p>Chargement…</p>}{history.isError && <p role="alert">{history.error.message}</p>}
      {history.data?.items.length === 0 && <p>Aucune modification administrative.</p>}
      {history.data?.items.map(entry => <p key={entry.id}>{entry.old_name ?? 'Station-service'} → <strong>{entry.new_name}</strong><br /><small>{date(entry.created_at)} · {entry.admin_username} · {entry.suggestion_id ? 'Proposition acceptée' : 'Modification directe'}</small></p>)}
      <div className="admin-actions"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Précédent</button><span>Page {page}</span><button disabled={!history.data?.hasMore} onClick={() => setPage(page + 1)}>Suivant</button></div>
    </section>}
  </article>;
}
