import { useQuery } from '@tanstack/react-query';
import { fetchStation, Availability } from './api';

interface Props {
  stationId: string;
  onClose: () => void;
}

function displayPrice(availability: Availability, price: number | null): string {
  if (availability === 'TEMPORARILY_UNAVAILABLE' || availability === 'UNAVAILABLE') {
    return 'Indisponible';
  }
  if (availability !== 'AVAILABLE' || price == null) return '—';
  return `${(price / 1_000).toFixed(3)} €/L`;
}

export function StationCard({ stationId, onClose }: Props) {
  const detail = useQuery({ queryKey: ['station', stationId], queryFn: () => fetchStation(stationId) });

  return (
    <aside className="station-card" aria-live="polite">
      <button className="close-button" type="button" onClick={onClose} aria-label="Fermer">
        ×
      </button>
      {detail.isPending && <p className="card-status">Chargement de la station…</p>}
      {detail.isError && <p className="card-status error">Impossible de charger cette station.</p>}
      {detail.data && (
        <>
          <header>
            <p className="eyebrow">Station-service</p>
            <h2>{detail.data.displayName}</h2>
            {detail.data.brand && <p className="brand">{detail.data.brand}</p>}
            <p className="address">
              {[detail.data.address, detail.data.city].filter(Boolean).join(', ') || 'Adresse non renseignée'}
            </p>
          </header>
          <div className="fuel-list">
            {detail.data.fuels.map((fuel) => (
              <div className="fuel-row" key={fuel.code}>
                <span>{fuel.label}</span>
                <strong className={fuel.availability.includes('UNAVAILABLE') ? 'unavailable' : ''}>
                  {displayPrice(fuel.availability, fuel.priceMilliEur)}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
