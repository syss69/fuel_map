import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reportQueue } from './api';
import type { QueueAggregate, QueueStatus } from './api';

const labels: Record<QueueStatus, string> = {
  NONE: 'Pas de file', LT_5: 'Moins de 5 voitures', FROM_5_TO_10: '5–10 voitures',
  FROM_11_TO_15: '11–15 voitures', GT_15: 'Plus de 15 voitures',
};
function ago(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  return minutes === 0 ? 'à l’instant' : `il y a ${minutes} min`;
}

export function QueuePanel({ stationId, reporterId, queue }: {
  stationId: string; reporterId: string; queue: QueueAggregate;
}) {
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: QueueStatus) => reportQueue(stationId, reporterId, status),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['station', stationId, reporterId] });
    },
  });
  return <section className="queue-panel" aria-label="File d’attente">
    <h3>File d'attente</h3>
    {queue.status === null ? <p>Aucune donnée récente</p> : <>
      <strong>{labels[queue.status]}</strong>
      <p>{queue.confirmationsCount} signalement{queue.confirmationsCount > 1 ? 's' : ''} sur {queue.reportsCount}</p>
      {queue.statusLastReportedAt && <p>Dernier signalement pour ce résultat {ago(queue.statusLastReportedAt)}</p>}
      {queue.latestReport && queue.latestReport.status !== queue.status &&
        <p className="queue-latest">Dernier signalement reçu : <strong>{labels[queue.latestReport.status]}</strong>, {ago(queue.latestReport.updatedAt)}</p>}
    </>}
    {queue.myReport && <p className="queue-own">Votre signalement : {labels[queue.myReport.status]}</p>}
    {editing ? <div className="queue-actions">
      {(Object.keys(labels) as QueueStatus[]).map(status =>
        <button key={status} type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(status)}>{labels[status]}</button>)}
      <button type="button" disabled={mutation.isPending} onClick={() => setEditing(false)}>Annuler</button>
    </div> : <div className="queue-actions">
      {queue.status !== null && <button type="button" disabled={mutation.isPending}
        onClick={() => mutation.mutate(queue.status!)}>Confirmer</button>}
      <button type="button" disabled={mutation.isPending} onClick={() => { mutation.reset(); setEditing(true); }}>
        {queue.status === null ? 'Signaler la file' : 'Modifier'}
      </button>
    </div>}
    {mutation.isPending && <p role="status">Envoi en cours…</p>}
    {mutation.isError && <p role="alert" className="error">{mutation.error.message}</p>}
  </section>;
}
