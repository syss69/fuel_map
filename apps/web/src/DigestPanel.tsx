import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { digestRequest } from './api';
import type { FuelCode, StationMarker } from './api';

export function DigestPanel({favorite,initialFuel,point,radius,onRadiusChange,picking,pickingFavorite,onPickFavorite,onClearFavorite,onCancelFavorite,onPick,onCancelPick,onClose}: {
  radius:number;onRadiusChange:(radius:number)=>void;
  favorite:StationMarker|null;initialFuel:FuelCode|'';point:{lat:number;lng:number}|null;picking:boolean;
  pickingFavorite:boolean;onPickFavorite:()=>void;onClearFavorite:()=>void;onCancelFavorite:()=>void;
  onPick:()=>void;onCancelPick:()=>void;onClose:()=>void;
}) {
  const [email,setEmail]=useState('');
  const [weekdays,setWeekdays]=useState<number[]>([]);
  const [fuel,setFuel]=useState<FuelCode>(initialFuel || 'GAZOLE');
  const mutation=useMutation({mutationFn:()=>digestRequest('',{
    email,fuelCode:fuel,lat:point!.lat,lng:point!.lng,radiusMeters:radius,favoriteStationId:favorite?.id ?? null,weekdays,
  })});
  if(picking)return <div className="digest-pick-hint" role="status">Touchez la carte pour choisir votre zone.<button type="button" onClick={onCancelPick}>Annuler</button></div>;
  if(pickingFavorite)return <div className="digest-pick-hint" role="status">Touchez une station sur la carte pour la choisir comme favorite. Toutes les stations sont affichées.<button type="button" onClick={onCancelFavorite}>Annuler</button></div>;
  return <section className="digest-panel" aria-label="Digest du matin">
    <div className="digest-header"><h2>Votre point carburant du matin</h2><button type="button" onClick={onClose} aria-label="Fermer le formulaire">×</button></div>
    <div className="digest-body">
      <p>Les 3 stations les moins chères autour de votre zone, les jours choisis à <strong>08:00, heure de Paris</strong>.</p>
      {mutation.isSuccess ? <p role="status">{mutation.data.message} Pensez à vérifier votre dossier « Spam » ou « Courriers indésirables ».</p> :
      <form onSubmit={e=>{e.preventDefault();if(point && weekdays.length>0)mutation.mutate();}}>
        <fieldset disabled={mutation.isPending}>
          <label>Carburant<select value={fuel} onChange={e=>setFuel(e.target.value as FuelCode)}>
            {(['GAZOLE','SP95','SP98','E10','E85','GPLC'] as FuelCode[]).map(code=><option key={code} value={code}>{code==='GAZOLE'?'Gazole (Diesel)':code==='GPLC'?'GPLc':code}</option>)}
          </select></label>
          <label>Zone de recherche</label>
          <button type="button" onClick={onPick}>{point?'Modifier le point sur la carte':'Choisir un point sur la carte'}</button>
          {point && <small>Point choisi : {point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small>}
          <label>Rayon<select value={radius} onChange={e=>onRadiusChange(Number(e.target.value))}>{[5000,10000,15000].map(value=><option key={value} value={value}>{value/1000} km</option>)}</select></label>
          <div role="group" aria-label="Station favorite (facultatif)">
            <p>Station favorite (facultatif)</p>
            {favorite && <p role="status">{[favorite.displayName,favorite.city,favorite.address].filter(Boolean).join(' — ')}</p>}
            <button type="button" onClick={onPickFavorite}>{favorite?'Changer de station sur la carte':'Choisir une station sur la carte'}</button>
            {favorite && <button type="button" onClick={onClearFavorite}>Retirer la station favorite</button>}
          </div>
          <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} /></label>
          <div role="group" aria-label="Jours de réception">
            <p>Jours de réception — choisissez 1 à 3 jours</p>
            <div className="fuel-filter-options">
              {['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map((label,index)=>{
                const day=index+1,selected=weekdays.includes(day);
                return <button className="fuel-filter-option" type="button" key={day}
                  aria-label={['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][index]}
                  aria-pressed={selected} disabled={!selected && weekdays.length>=3}
                  onClick={()=>setWeekdays(current=>selected?current.filter(value=>value!==day):[...current,day].sort((a,b)=>a-b))}>{label}</button>;
              })}
            </div>
            <small role="status">{weekdays.length}/3 jours sélectionnés · 08:00, heure de Paris</small>
          </div>
          <p className="digest-note">Confirmez votre email pour activer l’abonnement. Si vous ne trouvez pas le message, vérifiez votre dossier « Spam » ou « Courriers indésirables ». Un seul abonnement par adresse. Désabonnement possible dans chaque email.</p>
          <button type="submit" disabled={!point || weekdays.length===0 || mutation.isPending}>{mutation.isPending?'Envoi…':'Recevoir le digest'}</button>
        </fieldset>
      </form>}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
    </div>
  </section>;
}

export function DigestLink({action}:{action:'verify'|'unsubscribe'}) {
  const [token]=useState(()=>window.location.hash.slice(1));
  const mutation=useMutation({mutationFn:()=>digestRequest(`/${action}`,{token}),onSuccess:()=>{
    window.history.replaceState(null,'',`?digest=${action}`);
  }});
  return <main className="digest-link-page"><section>
    <img src="/brand/trajetico-logo-full.png" alt="Trajetico" width="225" height="75" />
    <h1>{action==='verify'?'Confirmer mon abonnement':'Se désabonner'}</h1>
    {mutation.isSuccess?<p role="status">{mutation.data.message}</p>:<>
      <p>{action==='verify'?'Recevez votre digest les jours choisis à 08:00, heure de Paris (3 jours par semaine maximum).':'Vous ne recevrez plus le digest.'}</p>
      <button type="button" disabled={!token || mutation.isPending} onClick={()=>mutation.mutate()}>{mutation.isPending?'Traitement…':action==='verify'?'Confirmer mon abonnement':'Se désabonner'}</button>
      {!token && <p>Ouvrez le lien reçu par email.</p>}
      {mutation.isError && <p role="alert">{mutation.error.message}</p>}
    </>}
    <p><a href="/app">Ouvrir Trajetico</a></p>
  </section></main>;
}
