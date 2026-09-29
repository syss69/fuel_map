import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitCommunity } from './api';
import type { CommunityAvailability, FuelProposal, StationDetail } from './api';
import { normalizeAvailability, parsePrice } from './community';

const officialLabels = {
  AVAILABLE: 'Disponible', UNAVAILABLE: 'Indisponible', TEMPORARILY_UNAVAILABLE: 'Temporairement indisponible',
  PERMANENTLY_UNAVAILABLE: 'Non distribué', UNKNOWN: 'Disponibilité inconnue',
};
export function CommunityPanel({ station, reporterId }: { station: StationDetail; reporterId: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { price: string; availability: CommunityAvailability | '' }>>({});
  const [message, setMessage] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (fuels: FuelProposal[] | undefined) => submitCommunity(station.id, reporterId, fuels),
    onSuccess: async (_, fuels) => {
      setEditing(false); setDraft({});
      setMessage(fuels ? 'Merci, vos propositions ont été enregistrées.' : 'Merci, votre confirmation a été enregistrée');
      await client.invalidateQueries({ queryKey: ['station', station.id, reporterId] });
    },
  });
  const changes: FuelProposal[] = [];
  let invalidPrice = false;
  for (const fuel of station.fuels) {
    const entry = draft[fuel.code];
    if (!entry) continue;
    const proposal: FuelProposal = { fuelCode: fuel.code };
    if (entry.availability && entry.availability !== normalizeAvailability(fuel.availability)) proposal.availability = entry.availability;
    if (entry.price.trim()) {
      const price = parsePrice(entry.price);
      if (price === null) invalidPrice = true;
      else if (price !== fuel.priceMilliEur) proposal.priceMilliEur = price;
    }
    if (proposal.availability !== undefined || proposal.priceMilliEur !== undefined) changes.push(proposal);
  }
  function update(code: string, patch: Partial<{ price: string; availability: CommunityAvailability | '' }>) {
    setDraft(current => ({ ...current, [code]: { ...(current[code] ?? { price: '', availability: '' }), ...patch } }));
    mutation.reset(); setMessage('');
  }
  return <section className="community-panel" aria-label="Informations des utilisateurs">
    <p>{station.community.confirmationsCount} confirmation{station.community.confirmationsCount !== 1 ? 's' : ''} récente{station.community.confirmationsCount !== 1 ? 's' : ''}</p>
    {station.community.myConfirmationActive && <small>Vous avez confirmé ces informations.</small>}
    {!editing ? <div className="community-actions">
      <button type="button" disabled={mutation.isPending} onClick={() => { setMessage(''); mutation.mutate(undefined); }}>Informations correctes</button>
      <button type="button" disabled={mutation.isPending} onClick={() => { mutation.reset(); setMessage(''); setEditing(true); }}>Proposer des modifications</button>
    </div> : <form onSubmit={event => { event.preventDefault(); if (!invalidPrice && changes.length) mutation.mutate(changes); }}>
      <h3>Proposer des modifications</h3>
      <p>Renseignez uniquement les changements constatés. Les données officielles ne seront pas remplacées.</p>
      {station.fuels.map(fuel => <fieldset key={fuel.code} disabled={mutation.isPending} className="community-fuel">
        <legend>{fuel.label}</legend>
        <p>Officiel : {officialLabels[fuel.availability]} · {fuel.priceMilliEur === null ? 'Prix non renseigné' : `${(fuel.priceMilliEur / 1000).toFixed(3).replace('.', ',')} €/L`}</p>
        <label>Disponibilité — {fuel.label}
          <select value={draft[fuel.code]?.availability ?? ''} onChange={e => update(fuel.code, { availability: e.target.value as CommunityAvailability | '' })}>
            <option value="">Sans modification</option><option value="AVAILABLE">Disponible</option><option value="UNAVAILABLE">Indisponible</option>
          </select>
        </label>
        <label>Prix proposé — {fuel.label} (€/L)
          <input inputMode="decimal" placeholder="Ex. 1,899" value={draft[fuel.code]?.price ?? ''}
            aria-invalid={Boolean(draft[fuel.code]?.price.trim() && parsePrice(draft[fuel.code].price) === null)}
            onChange={e => update(fuel.code, { price: e.target.value })} />
        </label>
      </fieldset>)}
      {invalidPrice && <p role="alert">Saisissez un prix positif valide, avec au maximum trois décimales.</p>}
      <div className="community-actions">
        <button type="submit" disabled={mutation.isPending || invalidPrice || !changes.length}>Envoyer</button>
        <button type="button" disabled={mutation.isPending} onClick={() => { setEditing(false); setDraft({}); mutation.reset(); }}>Annuler</button>
      </div>
    </form>}
    {mutation.isPending && <p role="status">Envoi en cours…</p>}
    {message && <p role="status">{message}</p>}
    {mutation.isError && <p role="alert" className="community-error">{mutation.error.message}</p>}
  </section>;
}
