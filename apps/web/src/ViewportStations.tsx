import { useEffect, useMemo, useState } from 'react';
import type { Map } from 'maplibre-gl';
import type { StationMarker } from './api';

export function ViewportStations({ map, stations, choose, disabled, pickingFavorite, onOpen }: {
  map: Map; stations: StationMarker[]; choose: (id: string) => void; disabled: boolean; pickingFavorite: boolean; onOpen: () => void;
}) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [view, setView] = useState(0);
  useEffect(() => {
    const moved = () => { setView(value => value + 1); setPage(1); };
    map.on('moveend', moved); return () => { map.off('moveend', moved); };
  }, [map]);
  useEffect(() => { setPage(1); }, [stations]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const inView = useMemo(() => {
    if (!open) return [];
    const bounds = map.getBounds();
    return stations.filter(station => bounds.contains([station.lng, station.lat]))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'fr') || (a.address ?? '').localeCompare(b.address ?? '', 'fr') || a.id.localeCompare(b.id));
  }, [stations, map, view, open]);
  const pageCount = Math.max(1, Math.ceil(inView.length / 20));
  const current = Math.min(page, pageCount);
  if (disabled) return null;
  return <div className={`viewport-stations${open ? ' viewport-stations-open' : ''}${pickingFavorite ? ' viewport-stations-favorite' : ''}`}>
    <button type="button" className="viewport-toggle" aria-expanded={open} aria-controls="viewport-station-list" disabled={disabled}
      onClick={() => { if (!open) onOpen(); setOpen(!open); }}>Stations dans cette zone</button>
    {open && <section id="viewport-station-list" aria-label="Stations dans cette zone">
      <p role="status">{inView.length} station{inView.length === 1 ? '' : 's'} dans la vue · 40 · 64 · 65</p>
      {inView.length === 0 && <p>Aucune station correspondant aux filtres dans cette vue.</p>}
      <ul>{inView.slice((current - 1) * 20, current * 20).map(station => <li key={station.id}>
        <button onClick={() => { choose(station.id); setOpen(false); }}>
          <strong>{pickingFavorite ? 'Choisir ' : ''}{station.displayName}</strong>
          <span>{[station.address, station.city].filter(Boolean).join(', ') || 'Adresse non renseignée'}</span>
          <small>{station.availableFuels.length ? 'Carburant disponible' : 'Aucun carburant déclaré disponible'}</small>
        </button>
      </li>)}</ul>
      <div className="viewport-pages"><button disabled={current === 1} onClick={() => setPage(current - 1)}>Précédent</button><span>{current} / {pageCount}</span><button disabled={current === pageCount} onClick={() => setPage(current + 1)}>Suivant</button></div>
    </section>}
  </div>;
}
