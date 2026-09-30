import type { EmailMessage } from './email.service';

export interface DigestStation {
  id: string; name: string; address: string | null; city: string | null;
  price: number | null; availability: string; distance: number;
  source_updated_at: string | null; last_seen_at: string;
}
export interface DigestSnapshot {
  from: string; appUrl: string; recipient: string; fuel: string; date: string;
  top: DigestStation[]; favorite: DigestStation | null;
}
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const price = (value: number | null) => value === null ? 'Prix non disponible' : `${(value / 1000).toFixed(3).replace('.', ',')} €/L`;
function layout(title: string, content: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f0f4f1;font-family:Arial,sans-serif;color:#18382f"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:580px;background:#fff;border-radius:14px" cellspacing="0" cellpadding="0"><tr><td style="padding:28px"><div style="font-size:24px;font-weight:bold;color:#176b51">Trajetico</div><h1 style="font-size:21px;line-height:1.4">${escape(title)}</h1>${content}</td></tr></table></td></tr></table></body></html>`;
}
const button = (url: string, label: string) => `<p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 20px;background:#176b51;color:white;border-radius:8px;text-decoration:none">${escape(label)}</a></p>`;
export function verificationEmail(from: string, to: string, url: string, summary: string): EmailMessage {
  const subject = 'Confirmez votre abonnement Trajetico';
  return { from, to: [to], subject,
    html: layout(subject, `<p>${escape(summary)}</p><p>Un email les jours choisis à 08:00 (Europe/Paris), trois jours par semaine maximum.</p>${button(url,'Confirmer mon abonnement')}<p>Ce lien expire dans 24 heures. Si vous n’avez pas demandé cet abonnement, ignorez cet email.</p>`),
    text: `${subject}\n${summary}\nLes jours choisis à 08:00 (Europe/Paris), trois jours par semaine maximum.\nConfirmer mon abonnement : ${url}\nCe lien expire dans 24 heures. Si vous n’avez pas fait cette demande, ignorez cet email.`,
  };
}
export function digestEmail(snapshot: DigestSnapshot, unsubscribeUrl: string): EmailMessage {
  const {top, favorite, fuel, date, appUrl, from, recipient} = snapshot;
  const manageUrl = new URL('/mes-alertes',appUrl).toString();
  const heading = `Les meilleurs prix du ${fuel} — ${date}`;
  const lines = top.map((s,i)=>`${i+1}. ${s.name}\n${[s.address,s.city].filter(Boolean).join(', ')}\n${price(s.price)} · ${(s.distance/1000).toFixed(1).replace('.',',')} km`);
  const favoriteStatus = !favorite ? '' : favorite.availability === 'AVAILABLE' ? 'Disponible' : favorite.availability === 'UNKNOWN' ? 'Disponibilité inconnue' : 'Carburant actuellement indisponible';
  const freshness = favorite ? `Dernière présence dans la source : ${new Date(favorite.last_seen_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}${favorite.source_updated_at ? `. Prix mis à jour le ${new Date(favorite.source_updated_at).toLocaleString('fr-FR',{timeZone:'Europe/Paris'})}` : ''}` : '';
  const empty = 'Aucune station avec un prix officiel disponible dans votre rayon ce matin.';
  const favoriteText = favorite ? `Votre station favorite\n${favorite.name}\n${[favorite.address,favorite.city].filter(Boolean).join(', ')}\n${price(favorite.price)}\n${favoriteStatus}\n${freshness}` : '';
  return {from, to:[recipient], subject:`Trajetico — Votre point carburant du ${date}`,
    html:layout(heading, `<p>Bonjour,</p><p>Voici les prix officiels disponibles autour de votre zone ce matin.</p>${lines.length ? lines.map(l=>`<p style="padding:14px 0;border-bottom:1px solid #dbe5de;line-height:1.6">${escape(l).replace(/\n/g,'<br>')}</p>`).join('') : `<p>${empty}</p>`}${favorite ? `<h2 style="font-size:18px">Votre station favorite</h2><p style="line-height:1.6">${escape(favoriteText.split('\n').slice(1).join('\n')).replace(/\n/g,'<br>')}</p>` : ''}<p style="font-size:12px;color:#64766f">Source : données officielles. La disponibilité et les prix peuvent évoluer.</p>${button(appUrl,'Ouvrir Trajetico')}<p><a href="${escape(manageUrl)}">Gérer mes alertes</a></p><p><a href="${escape(unsubscribeUrl)}" style="color:#64766f">Se désabonner</a></p>`),
    text:`Bonjour,\n${heading}\n\n${lines.join('\n\n') || empty}\n\n${favoriteText}\n\nSource : données officielles. La disponibilité et les prix peuvent évoluer.\nOuvrir Trajetico : ${appUrl}\nGérer mes alertes : ${manageUrl}\nSe désabonner : ${unsubscribeUrl}`,
  };
}
