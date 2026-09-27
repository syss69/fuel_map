import { useId } from 'react';
import type { FuelDiscrepancy } from './api';
import { reportedAgo } from './community';

export function FuelWarning({ discrepancy, label }: { discrepancy: FuelDiscrepancy; label: string }) {
  const id = useId();
  const { availability, price } = discrepancy;
  return <details className="fuel-warning">
    <summary aria-label={`Signalements des utilisateurs pour ${label}`} aria-controls={id}>!</summary>
    <div id={id} className="fuel-warning-content">
      <strong>Signalements des utilisateurs</strong>
      {availability && <p>{label} : signalé {availability.value === 'AVAILABLE' ? 'disponible' : 'indisponible'} par {availability.reportsCount} utilisateur{availability.reportsCount > 1 ? 's' : ''}<br />
        <small>Dernier signalement {reportedAgo(availability.lastReportedAt)}</small></p>}
      {price && <p>{label} : prix signalé {(price.valueMilliEur / 1000).toFixed(3).replace('.', ',')} €/L par {price.reportsCount} utilisateur{price.reportsCount > 1 ? 's' : ''}<br />
        <small>Dernier signalement {reportedAgo(price.lastReportedAt)}</small></p>}
      <small>Les informations officielles restent affichées ci-dessus.</small>
    </div>
  </details>;
}
