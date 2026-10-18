import { useEffect, useRef, useState } from 'react';
import './landing.css';

function Arrow() { return <span className="landing-arrow" aria-hidden="true">↗</span>; }
function LineArt({ variant }: { variant: number }) {
  return <svg className="landing-line-art" viewBox="0 0 360 150" fill="none" aria-hidden="true">
    {Array.from({ length: 15 }, (_, i) => <path key={i} d={variant === 0
      ? `M${-80+i*16} 160 Q${90+i*9} ${-160+i*12} 410 ${40+i*9}`
      : variant === 1 ? `M-20 ${20+i*8} C100 ${180-i*10} 180 ${-100+i*9} 390 ${45+i*9}`
      : `M${20+i*9} 160 C${300-i*12} -90 ${70+i*12} -60 ${340-i*7} 160`} />)}
  </svg>;
}
const features = [
  { icon: '€', title: 'Prix des carburants', text: 'Comparez les prix officiels par carburant et trouvez la station qui vous convient.' },
  { icon: '✓', title: 'Disponibilité', text: 'Repérez les carburants déclarés disponibles et filtrez la carte selon celui dont vous avez besoin.' },
  { icon: '◎', title: 'Informations communautaires', text: 'Consultez les files d’attente, confirmez les données ou proposez une correction de prix ou de disponibilité. Les données officielles restent la référence.' },
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen]);
  return <div className="landing">
    <a className="landing-skip" href="#landing-main">Aller au contenu</a>
    <header className="landing-header">
      <a className="landing-brand" href="/" aria-label="Trajetico — accueil"><img src="/brand/trajetico-logo-full.png" alt="Trajetico" width="2172" height="724" /></a>
      <nav id="landing-navigation" className={menuOpen ? 'is-open' : ''} aria-label="Navigation principale" onClick={() => setMenuOpen(false)}>
        <a href="/app">Carte</a><a href="/mes-alertes">Alertes</a><a href="/notifications">Comment ça marche ?</a>
      </nav>
      <a className="landing-primary landing-header-cta" href="/app">Ouvrir la carte <Arrow /></a>
      <button ref={menuButton} className="landing-menu-toggle" aria-label={menuOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-expanded={menuOpen} aria-controls="landing-navigation" onClick={() => setMenuOpen(!menuOpen)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={menuOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 8h16M4 16h16'} /></svg>
      </button>
    </header>
    <main id="landing-main">
      <section className="landing-hero">
        <p className="landing-eyebrow"><span className="landing-live-dot" /> LE CARBURANT DANS LE 40, LE 64 ET LE 65</p>
        <h1>Votre essence moins chère<br /><em>autour de vous.</em></h1>
        <p className="landing-intro">Trajetico réunit les prix et la disponibilité officiels des carburants et les informations récentes de la communauté pour vous aider à choisir votre station.</p>
        <div className="landing-actions"><a className="landing-primary" href="/app">Ouvrir la carte <Arrow /></a><a className="landing-secondary" href="/notifications">Découvrir les alertes <span aria-hidden="true">↗</span></a></div>
        <p className="landing-area">Landes (40) · Pyrénées-Atlantiques (64) · Hautes-Pyrénées (65)</p>
      </section>
      <figure className="landing-map-preview">
        <a href="/app" aria-label="Ouvrir la carte des stations autour de Pau">
          <picture><source media="(max-width: 600px)" srcSet="/landing/map-mobile.webp" width="390" height="640" /><img src="/landing/map-desktop.webp" alt="Aperçu de la carte Trajetico autour de Pau, avec les stations regroupées et les filtres de carburant." width="1280" height="720" fetchPriority="high" /></picture>
          <span className="landing-preview-link">Explorez la carte <Arrow /></span>
        </a>
        <figcaption><span>Aperçu de la carte · Consultez les données actuelles dans l’application.</span><span>Fond : <a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a></span></figcaption>
      </figure>
      <div className="landing-fuel-strip"><p>Votre carburant.<br /><strong>Votre prochain arrêt.</strong></p><ul aria-label="Carburants disponibles dans le comparateur">{['Gazole', 'SP95', 'SP98', 'E10', 'E85', 'GPLc'].map(fuel => <li key={fuel}>{fuel}</li>)}</ul></div>
      <section className="landing-section" aria-labelledby="features-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">L’ESSENTIEL, À PORTÉE DE MAIN</p><h2 id="features-title">Moins de recherches.<br />Plus de visibilité.</h2></div><p>Un détour en moins. Un choix plus clair.<br />Et vous voilà reparti.</p></div>
        <div className="landing-features">{features.map((feature, index) => <article key={feature.title}>
          <div className="landing-feature-copy"><span className="landing-feature-icon" aria-hidden="true">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.text}</p></div><LineArt variant={index} />
        </article>)}</div>
      </section>
      <section className="landing-section" aria-labelledby="follow-title">
        <div className="landing-section-heading"><div><p className="landing-eyebrow">GARDEZ UN ŒIL SUR VOTRE STATION</p><h2 id="follow-title">Les bonnes informations.<br />Au bon moment.</h2></div><p>Sur votre appareil ou dans votre boîte mail,<br />choisissez ce que vous souhaitez suivre.</p></div>
        <div className="landing-follow">
          <article className="landing-alerts-feature"><span className="landing-feature-icon" aria-hidden="true">↗</span><h3>Alertes personnalisées</h3><p>Choisissez une station et un carburant à suivre : retour en stock ou baisse sous votre seuil de prix.</p><div className="landing-notice-art" aria-hidden="true"><span className="landing-notice-symbol">✓</span><div><strong>Votre station. Vos critères.</strong><span>Disponibilité · Seuil de prix</span></div></div><p className="landing-detail">La réception dépend de l’activation des notifications et des réglages de votre appareil.</p><a className="landing-text-link" href="/notifications">Découvrir les alertes <span aria-hidden="true">↗</span></a></article>
          <article className="landing-digest"><span className="landing-feature-icon" aria-hidden="true">✉</span><h3>Votre digest du matin</h3><p>Les 3 stations les moins chères pour votre carburant, dans un rayon de 5, 10 ou 15 km, et votre station favorite. Par email, jusqu’à trois matins par semaine, aux jours que vous choisissez.</p><div className="landing-days" aria-hidden="true">{['L','M','M','J','V','S','D'].map((day,index)=><span className={[0,2,4].includes(index)?'chosen':''} key={index}>{day}</span>)}</div><p className="landing-detail">Vos jours, votre zone, votre carburant.</p><a className="landing-text-link" href="/app?digest=open">Choisir mes matins <span aria-hidden="true">↗</span></a></article>
        </div>
      </section>
      <section className="landing-section landing-how" aria-labelledby="how-title"><p className="landing-eyebrow">COMMENT ÇA MARCHE</p><h2 id="how-title">Un plein, en trois étapes.</h2><ol><li><span>01</span><h3>Choisissez votre zone</h3><p>Explorez la carte autour de vous.</p></li><li><span>02</span><h3>Comparez les stations</h3><p>Prix, carburants et informations utiles.</p></li><li><span>03</span><h3>Suivez les prix et la disponibilité</h3><p>Créez les alertes qui vous intéressent.</p></li></ol></section>
      <div className="landing-section landing-sources">
        <section className="landing-transparency" aria-labelledby="sources-title"><p className="landing-eyebrow">DES SOURCES CLAIRES</p><h2 id="sources-title">Des données utiles.<br />En toute transparence.</h2><p>Les prix et la disponibilité proviennent principalement des données officielles, automatiquement actualisées à intervalles réguliers. Les signalements de la communauté sont affichés séparément et ne remplacent pas l’état officiel. La situation en station peut évoluer entre deux mises à jour.</p><div className="landing-source-note"><span aria-hidden="true">◎</span> Données officielles et contributions, clairement distinguées.</div></section>
        <section className="landing-local" aria-labelledby="local-title"><p className="landing-eyebrow">PAU, TARBES, LOURDES, LANDES, BÉARN ET PAYS BASQUE</p><h2 id="local-title">Où trouver du carburant pas cher dans le 40, le 64 et le 65 ?</h2><p>Vous cherchez de l’essence pas chère à Pau, Billère ou Lons, du gazole autour de Bayonne ou une station sur votre trajet vers Tarbes et Lourdes dans les Hautes-Pyrénées, ou Dax et Mont-de-Marsan dans les Landes ? Trajetico vous aide à comparer les prix au litre et la disponibilité sur une même carte.</p><p>Sélectionnez votre carburant — gazole (diesel), SP95, SP98, E10, E85 ou GPLc — puis consultez les stations autour de votre zone. Pensez aussi à la distance : un détour peut réduire l’économie réalisée sur le plein.</p><a className="landing-text-link" href="/app">Comparer les stations du 40, du 64 et du 65 <span aria-hidden="true">↗</span></a></section>
      </div>
      <section className="landing-section landing-faq" aria-labelledby="faq-title"><div><p className="landing-eyebrow">ON VOUS RÉPOND</p><h2 id="faq-title">Vos questions sur les prix des carburants</h2></div><div>
        <details><summary>Comment trouver de l’essence pas chère autour de moi ?</summary><p>Ouvrez la carte Trajetico, déplacez-la sur votre zone ou utilisez « Me localiser », puis choisissez votre carburant. Consultez les prix et la disponibilité des stations voisines. Le service couvre actuellement les Landes (40), les Pyrénées-Atlantiques (64) et les Hautes-Pyrénées (65).</p></details>
        <details><summary>Peut-on comparer les stations à Pau et dans le Béarn ?</summary><p>Oui. La carte permet de consulter les stations présentes dans les données officielles à Pau, Billère, Lons, Lescar, Orthez et dans le reste du département, ainsi que sur la côte basque. Elle couvre aussi les Hautes-Pyrénées, notamment Tarbes et Lourdes, ainsi que les Landes, dont Dax et Mont-de-Marsan.</p></details>
        <details><summary>D’où viennent les prix de l’essence et du gazole ?</summary><p>Les prix et la disponibilité reposent sur les données officielles françaises des prix des carburants. Chaque carte de station indique sa dernière synchronisation. Les signalements des utilisateurs sont présentés séparément ; la situation à la pompe peut évoluer entre deux mises à jour.</p></details>
        <details><summary>Comment suivre une baisse de prix ou un retour de carburant ?</summary><p>Dans la fiche d’une station, créez une alerte pour le carburant souhaité : retour en disponibilité ou baisse sous un seuil de prix. Vous pouvez aussi recevoir un digest email jusqu’à trois matins par semaine. <a href="/notifications">Comprendre les notifications</a>.</p></details>

      </div></section>
      <section className="landing-final"><p className="landing-eyebrow">LE BON PLEIN, AU BON ENDROIT</p><h2>Prêt à trouver<br />votre station ?</h2><p>Votre prochain arrêt commence ici.</p><a className="landing-primary" href="/app">Ouvrir Trajetico <Arrow /></a></section>
    </main>
    <footer className="landing-footer"><a className="landing-brand" href="/" aria-label="Trajetico — accueil"><img src="/brand/trajetico-logo-full.png" alt="Trajetico" width="2172" height="724" /></a><nav aria-label="Liens de bas de page"><a href="/app">La carte</a><a href="/notifications">Les notifications</a><a href="/mentions-legales">Mentions légales</a><a href="/privacy">Confidentialité</a></nav><span>Le carburant, plus simplement.</span></footer>
  </div>;
}
