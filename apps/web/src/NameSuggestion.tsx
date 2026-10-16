import { useState } from 'react';
import { namesRequest } from './admin-api';

export function NameSuggestion({ stationId, name, address, reporterId }: { stationId: string; name: string; address: string; reporterId: string }) {
  const [open, setOpen] = useState(false);
  const [proposed, setProposed] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  return <section className="name-suggestion">
    {sent ? <p role="status">Merci, votre proposition sera examinée.</p> : <>
      <button type="button" className="name-correction-button" aria-expanded={open} onClick={() => setOpen(!open)}>Proposer une correction du nom</button>
      {open && <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError('');
        try { await namesRequest(`/stations/${stationId}/name-suggestions`, 'POST', { reporterId, name: proposed.trim(), comment: comment.trim() }); setSent(true); setOpen(false); }
        catch (error) { setError(error instanceof Error ? error.message : 'Envoi impossible.'); }
        finally { setBusy(false); }
      }}>
        <p><strong>{name}</strong><br />{address || 'Adresse non renseignée'}</p>
        <label>Nouveau nom<input required minLength={2} maxLength={120} value={proposed} onChange={e => setProposed(e.target.value)} /></label>
        <label>Précisions (facultatif)<textarea maxLength={1000} rows={3} value={comment} onChange={e => setComment(e.target.value)} /></label>
        <small>La correction sera examinée avant publication. Ne partagez pas de données personnelles.</small>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="admin-actions"><button disabled={busy || proposed.trim().length < 2 || proposed.trim() === name}>Envoyer</button><button type="button" disabled={busy} onClick={() => setOpen(false)}>Annuler</button></div>
      </form>}
    </>}
  </section>;
}
