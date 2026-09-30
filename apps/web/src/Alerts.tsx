import { parsePrice } from './community';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FuelCode } from './api';
const base=import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export interface Rule {priceThresholdMilliEur:number|null;id:string;stationId:string;stationName:string;fuelCode:FuelCode;fuelLabel:string;eventType:'FUEL_AVAILABLE'|'PRICE_DROP';frequency:'ONCE'|'RECURRING';status:'ACTIVE'|'DISABLED'|'COMPLETED'}
interface Device {id:string;deviceLabel:string;lastSeenAt:string;revokedAt:string|null}
interface Me {email:string;rules:Rule[];devices:Device[]}
export async function alertRequest<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(`${base}/alerts${path}`,{method,credentials:'include',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 if(!r.ok){const data=await r.json().catch(()=>({}));throw Object.assign(new Error(data.message||'Impossible de charger les alertes.'),{status:r.status});}return r.json();
}
function useMe(){return useQuery({queryKey:['alerts-me'],queryFn:()=>alertRequest<Me>('/me'),retry:false,staleTime:0});}
export function LoginForm(){
 const [email,setEmail]=useState('');const mutation=useMutation({mutationFn:()=>alertRequest<{message:string}>('/login','POST',{email})});
 return <><form onSubmit={e=>{e.preventDefault();mutation.mutate();}}><p>Connectez-vous par email pour gérer vos alertes, sans mot de passe.</p><label>Email<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} /></label><button disabled={mutation.isPending}>Recevoir un lien</button>{mutation.isSuccess&&<p role="status">{mutation.data.message}</p>}{mutation.isError&&<p role="alert">{mutation.error.message}</p>}</form><PasteLoginLink/></>;
}
function PasteLoginLink(){
 const [link,setLink]=useState('');const [error,setError]=useState('');
 return <details><summary>Ouvrir un lien de connexion dans cette app</summary><form onSubmit={e=>{e.preventDefault();try{const url=new URL(link);if(url.origin!==location.origin||url.pathname!=='/mes-alertes'||!/^#[A-Za-z0-9_-]{43}$/.test(url.hash))throw new Error();location.assign(`/mes-alertes${url.hash}`);location.reload();}catch{setError('Collez le lien Trajetico reçu par email.');}}}><label>Lien reçu par email<input type="url" required value={link} onChange={e=>setLink(e.target.value)}/></label><button>Ouvrir le lien</button>{error&&<p role="alert">{error}</p>}</form></details>;
}
const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function deviceLabel(){const ua=navigator.userAgent;return `${/Edg\//.test(ua)?'Edge':/Firefox/.test(ua)?'Firefox':/Chrome/.test(ua)?'Chrome':'Safari / navigateur'} · ${/iPhone|iPad/.test(ua)?'iOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':'Appareil'}`;}
// Called directly by a user gesture, before any network await.
async function enableDevice(email:string){
 if(!supported())throw new Error('Les notifications push ne sont pas disponibles sur ce navigateur. Sur iPhone/iPad, ajoutez Trajetico à l’écran d’accueil et ouvrez cette app.');
 if(Notification.permission==='denied')throw new Error('Les notifications sont bloquées dans les réglages de votre navigateur. Autorisez-les pour recevoir vos alertes sur cet appareil.');
 const permission=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
 if(permission!=='granted')throw new Error('Notifications non autorisées : vos alertes seront enregistrées, mais cet appareil ne recevra pas de notification.');
 const {publicKey}=await alertRequest<{publicKey:string|null}>('/config');if(!publicKey)throw new Error('Les notifications sont temporairement indisponibles.');
 await navigator.serviceWorker.register('/sw.js');const registration=await navigator.serviceWorker.ready;
 const key=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
 const result=await alertRequest<{id:string}>('/devices','POST',{endpoint:sub.endpoint,keys:sub.toJSON().keys,deviceLabel:deviceLabel()});
 localStorage.setItem(`trajetico_device:${email}`,result.id);return result.id;
}
export function DevicePanel({me}:{me:Me}){
 const client=useQueryClient();const [current,setCurrent]=useState<string|null>(()=>localStorage.getItem(`trajetico_device:${me.email}`));
 const [permission,setPermission]=useState(()=>supported()?Notification.permission:'default');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [testMessage,setTestMessage]=useState('');
 async function register(sub:PushSubscription){const json=sub.toJSON();const result=await alertRequest<{id:string}>('/devices','POST',{endpoint:sub.endpoint,keys:json.keys,deviceLabel:deviceLabel()});localStorage.setItem(`trajetico_device:${me.email}`,result.id);setCurrent(result.id);await client.invalidateQueries({queryKey:['alerts-me']});}
 useEffect(()=>{
  if(!supported()||Notification.permission!=='granted')return;
  const id=localStorage.getItem(`trajetico_device:${me.email}`);
  if(id&&me.devices.some(d=>d.id===id&&d.revokedAt))return;
  let live=true;
  void navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready).then(r=>r.pushManager.getSubscription()).then(sub=>{if(sub&&live)return register(sub);}).catch(()=>{if(live)setError('Impossible de synchroniser cet appareil. Réessayez avec le bouton d’activation.');});
  return()=>{live=false;};
  // Refresh last_seen once per authenticated page mount, never request permission here.
 },[me.email]);
 async function activate(){
  if(!supported()||Notification.permission==='denied')return;
  setBusy(true);setError('');
  try{
   setCurrent(await enableDevice(me.email));setPermission(Notification.permission);await client.invalidateQueries({queryKey:['alerts-me']});
  }catch(e){setError(e instanceof Error?e.message:'Activation impossible.');}finally{setBusy(false);}
 }
 async function testNotification(){
  if(busy)return;setBusy(true);setError('');setTestMessage('');
  try{
   if(!supported()||Notification.permission!=='granted')throw new Error('Autorisez les notifications sur cet appareil avant de lancer le test.');
   // Resolve the actual browser subscription, not a possibly stale local device id.
   const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();
   if(!sub)throw new Error('Réactivez les notifications sur cet appareil avant de lancer le test.');
   const device=await alertRequest<{id:string}>('/devices','POST',{endpoint:sub.endpoint,keys:sub.toJSON().keys,deviceLabel:deviceLabel()});
   localStorage.setItem(`trajetico_device:${me.email}`,device.id);setCurrent(device.id);
   const result=await alertRequest<{message:string}>(`/devices/${device.id}/test`,'POST');setTestMessage(result.message);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);await client.invalidateQueries({queryKey:['alerts-me']});}
 }
 async function revoke(id:string){setBusy(true);setError('');try{await alertRequest(`/devices/${id}/revoke`,'POST');if(id===current&&supported()){const r=await navigator.serviceWorker.getRegistration();const sub=await r?.pushManager.getSubscription();await sub?.unsubscribe();}await client.invalidateQueries({queryKey:['alerts-me']});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 useEffect(()=>{setCurrent(localStorage.getItem(`trajetico_device:${me.email}`));if(supported())setPermission(Notification.permission);},[me.devices,me.email]);
 const active=current&&me.devices.some(d=>d.id===current&&!d.revokedAt);
 return <section><h2>Mes appareils</h2>{!supported()?<p>Les notifications push ne sont pas disponibles sur ce navigateur. <a href="/notifications">Voir les instructions iPhone / iPad et autres appareils</a>, ou <a href="/app?digest=open">utiliser le digest email</a>.</p>:permission==='denied'?<p>Les notifications sont bloquées dans les réglages de votre navigateur. <a href="/notifications">Comment les autoriser</a></p>:active&&permission==='granted'?<p role="status">Notifications activées sur cet appareil</p>:<button type="button" disabled={busy} onClick={activate}>Activer les notifications</button>}
 {supported()&&permission==='granted'&&active&&<button type="button" disabled={busy} onClick={testNotification}>{busy?'Envoi…':'Tester les notifications'}</button>}{testMessage&&<p role="status">{testMessage}</p>}
 {me.devices.map(d=><div className="alert-device" key={d.id}><strong>{d.deviceLabel}{d.id===current?' (cet appareil)':''}</strong><p>{d.revokedAt?'Notifications désactivées':'Notifications actives'}</p>{!d.revokedAt&&<button type="button" disabled={busy} onClick={()=>revoke(d.id)}>Désactiver cet appareil</button>}</div>)}{error&&<p role="alert">{error}</p>}<p><a href="/notifications">Comment fonctionnent les notifications ?</a></p></section>;
}
const fuels:FuelCode[]=['GAZOLE','SP95','SP98','E10','E85','GPLC'];
export function StationAlerts({stationId}:{stationId:string}){
 const [open,setOpen]=useState(false);
 return <section className="station-alerts"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'Fermer les alertes':'Créer une alerte'}</button>{open&&<AlertEditor stationId={stationId}/>}</section>;
}
function AlertEditor({stationId}:{stationId:string}){
 const me=useMe();const client=useQueryClient();const [draft,setDraft]=useState<Record<string,string>>({});const [thresholds,setThresholds]=useState<Record<string,string>>({});
 const [preparing,setPreparing]=useState(false);const [pushNotice,setPushNotice]=useState('');
 const save=useMutation({mutationFn:async()=>{for(const [key,value] of Object.entries(draft)){const [fuelCode,eventType]=key.split(':');const old=me.data?.rules.find(r=>r.stationId===stationId&&r.fuelCode===fuelCode&&r.eventType===eventType);const threshold=thresholds[fuelCode]!==undefined?parsePrice(thresholds[fuelCode]):old?.priceThresholdMilliEur;if(eventType==='PRICE_DROP'&&value!=='DISABLED'&&!threshold)throw new Error('Indiquez un seuil positif en €/L (3 décimales maximum).');await alertRequest('/rules','PUT',{stationId,fuelCode,eventType,frequency:value==='DISABLED'?'ONCE':value,status:value==='DISABLED'?'DISABLED':'ACTIVE',priceThresholdMilliEur:eventType==='PRICE_DROP'?(threshold??null):null});}},onSuccess:async()=>{setDraft({});await client.invalidateQueries({queryKey:['alerts-me']});}});
 async function submit(){
  if(preparing||save.isPending||!me.data)return;
  setPreparing(true);setPushNotice('');
  try{
   // Validate locally before displaying the browser permission prompt.
   for(const [key,value] of Object.entries(draft)){
    const [fuel,type]=key.split(':');const existing=me.data.rules.find(r=>r.stationId===stationId&&r.fuelCode===fuel&&r.eventType===type);
    if(type==='PRICE_DROP'&&value!=='DISABLED'&&!(thresholds[fuel]!==undefined?parsePrice(thresholds[fuel]):existing?.priceThresholdMilliEur))throw new Error('Indiquez un seuil positif en €/L (3 décimales maximum).');
   }
   if(Object.values(draft).some(value=>value!=='DISABLED')){try{await enableDevice(me.data.email);}catch(e){setPushNotice((e as Error).message);}}
   save.mutate();
  }catch(e){setPushNotice((e as Error).message);}finally{setPreparing(false);}
 }
 if(me.isPending)return <p>Chargement…</p>;
 if(me.isError)return (me.error as {status?:number}).status===401?<><LoginForm/><a href="/mes-alertes">Mes alertes</a></>:<p role="alert">{me.error.message}</p>;
 return <><p>En enregistrant vos alertes, vous serez invité à autoriser les notifications sur cet appareil.</p><form onSubmit={e=>{e.preventDefault();void submit();}}>
 {fuels.map(fuel=><fieldset disabled={save.isPending||preparing} key={fuel}><legend>{fuel==='GAZOLE'?'Gazole':fuel}</legend>{(['FUEL_AVAILABLE','PRICE_DROP'] as const).map(type=>{const rule=me.data.rules.find(r=>r.stationId===stationId&&r.fuelCode===fuel&&r.eventType===type);const key=`${fuel}:${type}`;return <div key={type}><label>{type==='FUEL_AVAILABLE'?'Disponibilité':'Prix'}<select value={draft[key]??(rule?.status==='ACTIVE'?rule.frequency:'DISABLED')} onChange={e=>{setDraft(d=>({...d,[key]:e.target.value}));save.reset();}}><option value="DISABLED">Désactivé</option><option value="ONCE">Une seule fois</option><option value="RECURRING">{type==='FUEL_AVAILABLE'?'À chaque retour en stock':'À chaque passage sous le seuil'}</option></select></label>{type==='PRICE_DROP'&&<label>Me prévenir en dessous de (€/L)<input inputMode="decimal" placeholder="Ex. 1,850" value={thresholds[fuel]??(rule?.priceThresholdMilliEur!=null?(rule.priceThresholdMilliEur/1000).toFixed(3).replace('.',','):'')} onChange={e=>{setThresholds(t=>({...t,[fuel]:e.target.value}));setDraft(d=>({...d,[key]:d[key]??(rule?.status==='ACTIVE'?rule.frequency:'DISABLED')}));save.reset();}}/></label>}</div>;})}</fieldset>)}
 <button disabled={preparing||save.isPending||!Object.keys(draft).length}>{preparing?'Activation des notifications…':'Enregistrer et activer les notifications'}</button>{pushNotice&&<p role="alert">{pushNotice} <a href="/notifications">Voir les instructions</a></p>}{save.isSuccess&&<p role="status">Alertes enregistrées.</p>}{save.isError&&<p role="alert">{save.error.message} Vos choix sont conservés ; réessayez pour terminer l’enregistrement.</p>}</form><DevicePanel me={me.data}/><a href="/mes-alertes">Gérer toutes mes alertes</a></>;
}
export function AlertsPage(){
 const [token]=useState(()=>location.hash.slice(1));const [verified,setVerified]=useState(false);const me=useMe();const client=useQueryClient();
 const login=useMutation({mutationFn:()=>alertRequest('/verify','POST',{token}),onSuccess:async()=>{history.replaceState(null,'','/mes-alertes');setVerified(true);await client.invalidateQueries({queryKey:['alerts-me']});}});
 const action=useMutation({mutationFn:async(input:{path:string;body?:unknown;method?:string})=>alertRequest(input.path,input.method||'POST',input.body),onSuccess:()=>client.invalidateQueries({queryKey:['alerts-me']})});
 const [preparing,setPreparing]=useState(false);const [pushNotice,setPushNotice]=useState('');
 const save=async(r:Rule,frequency:Rule['frequency'],status:'ACTIVE'|'DISABLED',priceThresholdMilliEur=r.priceThresholdMilliEur)=>{
  if(preparing||action.isPending||!me.data)return;
  setPreparing(true);setPushNotice('');
  try{if(status==='ACTIVE'){try{await enableDevice(me.data.email);}catch(e){setPushNotice((e as Error).message);}}
   action.mutate({path:'/rules',method:'PUT',body:{stationId:r.stationId,fuelCode:r.fuelCode,eventType:r.eventType,frequency,status,priceThresholdMilliEur}});
  }finally{setPreparing(false);}
 };
 const groups=(me.data?.rules??[]).reduce<Record<string,Rule[]>>((all,r)=>{(all[r.stationId]??=[]).push(r);return all;},{});
 return <main className="alerts-page"><a href="/app">← Carte Trajetico</a><h1>Mes alertes</h1>{token&&!verified?<><p>Confirmez la connexion à votre espace d’alertes.</p><button disabled={login.isPending} onClick={()=>login.mutate()}>Accéder à mes alertes</button>{login.isError&&<><p role="alert">{login.error.message}</p><LoginForm/></>}</>:me.isPending?<p>Chargement…</p>:me.isError?(me.error as {status?:number}).status===401?<LoginForm/>:<p role="alert">{me.error.message}</p>:<>
 <p>{me.data.email}</p><button disabled={action.isPending} onClick={()=>action.mutate({path:'/logout'})}>Se déconnecter</button>
 <p><a href="/app">Choisir une station pour créer une alerte</a></p>{!me.data.rules.length&&<p>Aucune alerte. Ouvrez une station sur la carte pour commencer.</p>}
 {Object.entries(groups).map(([stationId,rules])=><section key={stationId}><h2><a href={`/app?station=${stationId}`}>{rules![0].stationName}</a></h2>{fuels.map(fuel=>{const rows=rules!.filter(r=>r.fuelCode===fuel);return rows.length?<section key={fuel}><h3>{rows[0].fuelLabel}</h3>{rows.map(r=><RuleControl key={`${r.id}-${r.priceThresholdMilliEur}-${r.status}-${r.frequency}`} rule={r} busy={action.isPending||preparing} onSave={(frequency,status,threshold)=>save(r,frequency,status,threshold)}/>)}</section>:null;})}</section>)}
 <button disabled={action.isPending||!me.data.rules.some(r=>r.status==='ACTIVE')} onClick={()=>action.mutate({path:'/disable-all'})}>Désactiver toutes les alertes</button><p>Le digest email et les appareils se gèrent séparément.</p><DevicePanel me={me.data}/>
 </>}{pushNotice&&<p role="alert">{pushNotice} <a href="/notifications">Voir les instructions</a></p>}{action.isError&&<p role="alert">{action.error.message}</p>}</main>;
}
export function NotificationsPage(){
 const ios=/iPhone|iPad/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);const android=/Android/.test(navigator.userAgent);
 const sections={ios:<section key="ios"><h2>iPhone / iPad (iOS 16.4 ou ultérieur)</h2><p>Les notifications nécessitent Trajetico installé sur l’écran d’accueil et ouvert comme web app. Une simple page Safari ne suffit pas.</p><ol><li>Ouvrez Trajetico dans Safari.</li><li>Touchez Partager, puis « Ajouter à l’écran d’accueil ».</li><li>Ouvrez Trajetico depuis l’écran d’accueil.</li><li>Connectez-vous par email et créez ou ouvrez une alerte.</li><li>Touchez « Activer les notifications » et autorisez-les.</li></ol><p>Si elles sont bloquées, ouvrez Réglages iOS → Notifications → Trajetico et autorisez-les. Si le lien email s’ouvre dans Safari, copiez son adresse et utilisez « Ouvrir un lien de connexion » dans l’app installée.</p></section>,android:<section key="android"><h2>Android</h2><p>Ouvrez Trajetico dans Chrome ou un navigateur compatible, choisissez une station, créez une alerte puis touchez « Activer les notifications ». Autorisez la demande du navigateur et ses notifications dans les réglages Android. L’installation sur l’écran d’accueil n’est pas obligatoire si le navigateur prend en charge Web Push.</p></section>,desktop:<section key="desktop"><h2>Ordinateur</h2><p>Ouvrez Trajetico, choisissez une station et un carburant, créez une alerte, puis cliquez sur « Activer les notifications » et autorisez la demande.</p><ul><li>Chrome : paramètres du site → Notifications.</li><li>Edge : autorisations du site → Notifications.</li><li>Firefox : icône des permissions près de l’adresse, ou Paramètres → Vie privée et sécurité → Notifications.</li><li>Safari macOS : Safari → Réglages → Sites web → Notifications ; vérifiez aussi les notifications de Safari dans les réglages système.</li></ul></section>};
 return <main className="alerts-page"><a href="/app">← Carte Trajetico</a><h1>Comment fonctionnent les alertes Trajetico ?</h1><p>Recevez une alerte au retour d’un carburant disponible ou lorsque le prix baisse sous votre seuil, selon les données officielles. Les signalements communautaires ne déclenchent pas ces alertes.</p><p>« Une seule fois » termine l’alerte après le premier événement. « À chaque retour en stock » attend chaque nouveau retour. « À chaque passage sous le seuil » signale une baisse strictement sous le prix choisi. Pour une nouvelle alerte, le prix doit revenir au seuil ou au-dessus, puis baisser à nouveau en dessous. Aucune alerte immédiate à la création.</p><p>Les alertes sont traitées après la prochaine mise à jour des données officielles (habituellement toutes les 15 minutes), pas en temps réel à la pompe. La réception dépend du navigateur, du réseau et des réglages de l’appareil ; elle n’est pas garantie.</p>{(ios?['ios','android','desktop']:android?['android','ios','desktop']:['desktop','android','ios']).map(key=>sections[key as keyof typeof sections])}<p><a href="/mes-alertes">Gérer mes alertes et mes appareils</a></p><p>Vous pouvez désactiver un appareil sans supprimer vos alertes. Le digest email reste indépendant.</p></main>;
}

function RuleControl({rule:r,busy,onSave}:{rule:Rule;busy:boolean;onSave:(frequency:Rule['frequency'],status:'ACTIVE'|'DISABLED',threshold:number|null)=>void}){
 const [threshold,setThreshold]=useState(r.priceThresholdMilliEur!=null?(r.priceThresholdMilliEur/1000).toFixed(3).replace('.',','):'');
 const [frequency,setFrequency]=useState(r.frequency);
 const price=r.eventType==='PRICE_DROP';const parsed=price?parsePrice(threshold):null;
 return <div className="alert-rule"><strong>{price?'Prix':'Disponibilité'}</strong><p>{r.status==='ACTIVE'?'Active':r.status==='COMPLETED'?'Terminée':'Désactivée'}</p>
 {price&&<label>Me prévenir en dessous de (€/L)<input disabled={busy} inputMode="decimal" placeholder="Ex. 1,850" value={threshold} onChange={e=>setThreshold(e.target.value)}/></label>}
 {price&&!parsed&&<p>Indiquez un seuil positif, avec au maximum 3 décimales.</p>}
 <label>Fréquence<select disabled={busy} value={frequency} onChange={e=>setFrequency(e.target.value as Rule['frequency'])}><option value="ONCE">Une seule fois</option><option value="RECURRING">{price?'À chaque passage sous le seuil':'À chaque retour en stock'}</option></select></label>
 <button disabled={busy||(price&&!parsed)} onClick={()=>onSave(frequency,r.status==='ACTIVE'?'ACTIVE':'DISABLED',parsed)}>Enregistrer</button>{' '}
 <button disabled={busy||(r.status!=='ACTIVE'&&price&&!parsed)} onClick={()=>onSave(frequency,r.status==='ACTIVE'?'DISABLED':'ACTIVE',parsed)}>{r.status==='ACTIVE'?'Désactiver':r.status==='COMPLETED'?'Réactiver':'Activer'}</button></div>;
}
