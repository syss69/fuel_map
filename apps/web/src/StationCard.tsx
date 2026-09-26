import { useQuery } from '@tanstack/react-query';
import { fetchStation, Availability } from './api';
import { getReporterId } from './reporter';
import { QueuePanel } from './QueuePanel';

interface Props {
  stationId: string;
  onClose: () => void;
}

function displayPrice(availability: Availability, price: number | null): string {
  if (availability === 'PERMANENTLY_UNAVAILABLE') return 'Non distribué';
  if (availability === 'TEMPORARILY_UNAVAILABLE') return 'Temporairement indisponible';
  if (availability === 'UNAVAILABLE') return 'Indisponible';
  if (availability === 'UNKNOWN') return 'Disponibilité inconnue';
  if (price == null) return 'Prix non renseigné';
  return `${(price / 1_000).toFixed(3)} €/L`;
}

export function StationCard({ stationId, onClose }: Props) {
  const reporterId = getReporterId();
  const detail = useQuery({ queryKey: ['station', stationId, reporterId], queryFn: () => fetchStation(stationId, reporterId) });

  return (
    <aside className="station-card" aria-live="polite">
      <div className="station-card-toolbar">
      <button className="close-button" type="button" onClick={onClose} aria-label="Fermer">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
      </div>
      <div className="station-card-content">
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
                <strong className={
                  fuel.availability === 'TEMPORARILY_UNAVAILABLE' || fuel.availability === 'UNAVAILABLE'
                    ? 'fuel-status unavailable'
                    : fuel.availability !== 'AVAILABLE' || fuel.priceMilliEur == null ? 'fuel-status' : ''
                }>
                  {displayPrice(fuel.availability, fuel.priceMilliEur)}
                </strong>
              </div>
            ))}
          </div>
          <QueuePanel key={stationId} stationId={stationId} reporterId={reporterId} queue={detail.data.queue} />
        </>
      )}
      </div>
    </aside>
  );
}
