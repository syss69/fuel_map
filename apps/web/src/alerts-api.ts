const base=import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1';
export async function alertRequest<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const r=await fetch(`${base}/alerts${path}`,{method,credentials:'include',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 if(!r.ok){const data=await r.json().catch(()=>({}));throw Object.assign(new Error(data.message||'Impossible de charger les alertes.'),{status:r.status});}return r.json();
}
