import './landing.css';

export default function Landing() {
  return <div className="landing">
    <header className="landing-header">
      <a href="/" aria-label="Trajetico — accueil"><img src="/brand/trajetico-logo-full.png" alt="Trajetico" width="2172" height="724" /></a>
      <nav aria-label="Navigation principale"><a href="/app">Carte</a><a href="/mes-alertes">Alertes</a><a href="/notifications">Comment ça marche ?</a></nav>
    </header>
    <main>
      <section className="landing-hero">
        <div><p className="landing-eyebrow">TRAJETICO · LE CARBURANT DANS LE 64</p>
          <h1>Votre essence moins chère <em>autour de vous.</em></h1>
          <p className="landing-intro">Trajetico réunit les prix et la disponibilité officiels des carburants et les informations récentes de la communauté pour vous aider à choisir votre station.</p>
          <div className="landing-actions"><a className="landing-primary" href="/app">Ouvrir la carte <span aria-hidden="true">↗</span></a><a href="/notifications">Découvrir les alertes →</a></div>
          <p className="landing-area">Comparez essence et gazole dans les Pyrénées-Atlantiques (64).</p>
        </div>
        <div className="landing-illustration" aria-hidden="true">
          <svg className="landing-map-art" viewBox="0 0 500 480" fill="none">
            <path d="M0 55L155 0L210 110L125 190L0 155Z M335 0H500V130L415 165L330 90Z M0 330L115 280L180 380L130 480H0Z M360 340L500 295V480H320Z" fill="#c6ddab"/>
            <path d="M-20 240C85 185 90 330 210 250S340 170 520 225" stroke="#a7d3d7" strokeWidth="28"/>
            <g stroke="#fffef4" strokeWidth="16"><path d="M70 -20L430 500M-20 390L520 50M-20 95L520 360"/><path d="M235 -20L245 500M-20 315L520 140" strokeWidth="8"/></g>
            <path d="M120 357L245 278L242 168L345 100" stroke="#176b51" strokeWidth="5" strokeDasharray="8 9" strokeLinecap="round"/>
            <g fill="#176b51" stroke="white" strokeWidth="5"><circle cx="120" cy="357" r="12"/><circle cx="242" cy="168" r="12"/><circle cx="345" cy="100" r="12"/></g>
          </svg>
          <div className="landing-map-heading"><span>VOTRE PROCHAIN ARRÊT</span><strong>On fait le plein ?</strong></div>
          <span className="landing-place place-pau">Pau</span><span className="landing-place place-billere">Billère</span><span className="landing-place place-lons">Lons</span>
          <span className="landing-map-chip chip-fuel">✓ Votre carburant</span><span className="landing-map-chip chip-price">€ Comparez les prix</span>
          <div className="landing-map-card"><span>PRIX · DISPONIBILITÉ · COMMUNAUTÉ</span><strong>Le bon plein.<br/>Au bon endroit.</strong><span className="landing-card-tag">Tout sur une carte ↗</span></div>
          <span className="landing-map-note">Illustration · Explorez les données sur la carte</span>
        </div>
      </section>
      <div className="landing-ribbon"><span>Un détour en moins.</span><span>Un choix plus clair.</span><span>Et vous voilà reparti. ↗</span></div>
      <section className="landing-section" aria-labelledby="features-title">
        <p className="landing-eyebrow">L’ESSENTIEL, À PORTÉE DE MAIN</p><h2 id="features-title">Moins de recherches.<br/>Plus de visibilité.</h2>
        <div className="landing-features">
          <article><span className="landing-feature-icon" aria-hidden="true">€</span><h3>Prix des carburants</h3><p>Comparez les prix officiels par carburant et trouvez la station qui vous convient.</p><div className="landing-fuels">{['Gazole','SP95','SP98','E10','E85','GPLc'].map(fuel=><span key={fuel}>{fuel}</span>)}</div></article>
          <article><span className="landing-feature-icon" aria-hidden="true">✓</span><h3>Disponibilité</h3><p>Repérez les carburants déclarés disponibles et filtrez la carte selon celui dont vous avez besoin.</p></article>
          <article><span className="landing-feature-icon" aria-hidden="true">◎</span><h3>Informations communautaires</h3><p>Consultez les files d’attente, confirmez les données ou proposez une correction de prix ou de disponibilité. Les données officielles restent la référence.</p></article>
          <article><span className="landing-feature-icon" aria-hidden="true">↗</span><h3>Alertes personnalisées</h3><p>Choisissez une station et un carburant à suivre : retour en stock ou baisse sous votre seuil de prix.</p><p className="landing-detail">La réception dépend de l’activation des notifications et des réglages de votre appareil.</p></article>
          <article className="landing-digest"><span className="landing-feature-icon" aria-hidden="true">✉</span><div><h3>Votre digest du matin</h3><p>Les 3 stations les moins chères pour votre carburant, dans un rayon de 5, 10 ou 15 km, et votre station favorite. Par email, jusqu’à trois matins par semaine, aux jours que vous choisissez.</p><a href="/app?digest=open">Choisir mes matins →</a></div></article>
        </div>
      </section>
      <section className="landing-section landing-how" aria-labelledby="how-title"><h2 id="how-title">Un plein, en trois étapes.</h2><ol><li><span>01</span><h3>Choisissez votre zone</h3><p>Explorez la carte autour de vous.</p></li><li><span>02</span><h3>Comparez les stations</h3><p>Prix, carburants et informations utiles.</p></li><li><span>03</span><h3>Suivez les prix et la disponibilité</h3><p>Créez les alertes qui vous intéressent.</p></li></ol></section>
      <section className="landing-transparency"><p className="landing-eyebrow">DES SOURCES CLAIRES</p><h2>Des données utiles.<br/>En toute transparence.</h2><p>Les prix et la disponibilité proviennent principalement des données officielles, automatiquement actualisées à intervalles réguliers. Les signalements de la communauté sont affichés séparément et ne remplacent pas l’état officiel. La situation en station peut évoluer entre deux mises à jour.</p></section>
      <section className="landing-section landing-local" aria-labelledby="local-title">
        <p className="landing-eyebrow">PAU, BÉARN ET PAYS BASQUE</p>
        <h2 id="local-title">Où trouver du carburant pas cher dans le 64 ?</h2>
        <p>Vous cherchez de l’essence pas chère à Pau, Billère ou Lons, du gazole autour de Bayonne ou une station sur votre trajet dans les Pyrénées-Atlantiques ? Trajetico vous aide à comparer les prix au litre et la disponibilité sur une même carte.</p>
        <p>Sélectionnez votre carburant — gazole (diesel), SP95, SP98, E10, E85 ou GPLc — puis consultez les stations autour de votre zone. Pensez aussi à la distance : un détour peut réduire l’économie réalisée sur le plein.</p>
        <a className="landing-primary" href="/app">Comparer les stations du 64 →</a>
      </section>
      <section className="landing-section landing-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Vos questions sur les prix des carburants</h2>
        <details><summary>Comment trouver de l’essence pas chère autour de moi ?</summary><p>Ouvrez la carte Trajetico, déplacez-la sur votre zone et choisissez votre carburant. Consultez les prix et la disponibilité des stations voisines. Le service couvre actuellement les Pyrénées-Atlantiques (64).</p></details>
        <details><summary>Peut-on comparer les stations à Pau et dans le Béarn ?</summary><p>Oui. La carte permet de consulter les stations présentes dans les données officielles à Pau, Billère, Lons, Lescar, Orthez et dans le reste du département, ainsi que sur la côte basque.</p></details>
        <details><summary>D’où viennent les prix de l’essence et du gazole ?</summary><p>Les prix et la disponibilité reposent sur les données officielles françaises des prix des carburants. Chaque carte de station indique sa dernière synchronisation. Les signalements des utilisateurs sont présentés séparément ; la situation à la pompe peut évoluer entre deux mises à jour.</p></details>
        <details><summary>Comment suivre une baisse de prix ou un retour de carburant ?</summary><p>Dans la fiche d’une station, créez une alerte pour le carburant souhaité : retour en disponibilité ou baisse sous un seuil de prix. Vous pouvez aussi recevoir un digest email jusqu’à trois matins par semaine. <a href="/notifications">Comprendre les notifications</a>.</p></details>
      </section>
      <section className="landing-final"><h2>Prêt à trouver votre station ?</h2><p>Votre prochain arrêt commence ici.</p><a className="landing-primary" href="/app">Ouvrir Trajetico <span aria-hidden="true">↗</span></a></section>
    </main>
    <footer className="landing-footer"><strong>Trajetico</strong><nav aria-label="Liens de bas de page"><a href="/app">La carte</a><a href="/notifications">Les notifications</a><a href="/mentions-legales">Mentions légales</a><a href="/privacy">Confidentialité</a></nav><span>Le carburant, plus simplement.</span></footer>
  </div>;
}
