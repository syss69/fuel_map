import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { alertRequest } from './alerts-api';
import { digestDays } from './digest-management';
import type { ManagedDigest } from './digest-management';

export function DigestManagement({email}:{email:string}) {
  const client=useQueryClient();
  const [confirmOff,setConfirmOff]=useState(false);
  const [saved]=useState(()=>new URLSearchParams(location.search).get('digest')==='saved');
  const queryKey=['managed-digest',email];
  const digest=useQuery({queryKey,queryFn:()=>alertRequest<ManagedDigest|null>('/digest'),retry:false});
  const change=useMutation({mutationFn:(status:'ACTIVE'|'UNSUBSCRIBED')=>alertRequest<ManagedDigest>('/digest/status','PUT',{status}),
    onSuccess:data=>{client.setQueryData(queryKey,data);setConfirmOff(false);}});
  const data=digest.data;
  const expired=(digest.error as {status?:number}|null)?.status===401 || (change.error as {status?:number}|null)?.status===401;
  return <section aria-labelledby="my-digest-title"><h2 id="my-digest-title">Mon digest</h2>
    {saved&&<p role="status">Les modifications de votre digest ont été enregistrées.</p>}
    {digest.isPending?<p>Chargement du digest…</p>:digest.isError?<p role="alert">{digest.error.message}</p>:!data?<a href="/app?digest=open">Créer mon digest</a>:<>
      <p><strong>{data.status==='ACTIVE'?'Abonnement actif':data.status==='PENDING'?'En attente de confirmation':'Abonnement désactivé'}</strong></p>
      <dl className="digest-summary">
        <dt>Carburant</dt><dd>{data.fuelCode==='GAZOLE'?'Gazole (Diesel)':data.fuelCode==='GPLC'?'GPLc':data.fuelCode}</dd>
        <dt>Zone</dt><dd>{data.lat.toFixed(5)}, {data.lng.toFixed(5)} · rayon de {data.radiusMeters/1000} km</dd>
        <dt>Station favorite</dt><dd>{data.favoriteStation?[data.favoriteStation.displayName||'Station-service',data.favoriteStation.address,data.favoriteStation.city].filter(Boolean).join(' — '):'Aucune'}</dd>
        <dt>Réception</dt><dd>{data.weekdays.map(day=>digestDays[day-1]).join(', ')} · 08:00, heure de Paris</dd>
      </dl>
      <div className="digest-actions"><a href="/app?digest=edit">Modifier</a>
        {data.status!=='UNSUBSCRIBED'&&<button type="button" disabled={change.isPending} onClick={()=>setConfirmOff(true)}>Se désabonner</button>}
        {data.status!=='ACTIVE'&&<button type="button" disabled={change.isPending} onClick={()=>change.mutate('ACTIVE')}>{data.status==='PENDING'?'Activer mon digest':'Réactiver mon digest'}</button>}
      </div>
      {confirmOff&&<div role="group" aria-label="Confirmer le désabonnement"><p>Ne plus recevoir le digest ?</p><button disabled={change.isPending} onClick={()=>change.mutate('UNSUBSCRIBED')}>Confirmer le désabonnement</button><button disabled={change.isPending} onClick={()=>setConfirmOff(false)}>Annuler</button></div>}
      {change.isSuccess&&<p role="status">{data.status==='ACTIVE'?'Votre digest est actif.':'Votre abonnement a été désactivé.'}</p>}
    </>}
    {change.isError&&<p role="alert">{change.error.message}</p>}
    {expired&&<a href="/mes-alertes">Votre session a expiré. Reconnectez-vous.</a>}
  </section>;
}
