import { GeolocateControl } from 'maplibre-gl';
import type { Map, MapEventType } from 'maplibre-gl';

/** Cancel an in-flight request by detaching its control, using only public lifecycle APIs.
 * MapLibre ignores callbacks after removal; a fresh control allows another explicit attempt.
 */
export function installGeolocation(map: Map, notify: (message: string) => void) {
  let control: GeolocateControl;
  let pending = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const finish = () => { pending = false; clearTimeout(timeout); };
  let releaseClick = () => {};
  const attach = () => {
    control = new GeolocateControl({ trackUserLocation: false, showUserLocation: true, showAccuracyCircle: true,
      positionOptions: { enableHighAccuracy: false, maximumAge: 0, timeout: 8000 }, fitBoundsOptions: { maxZoom: 13, padding: 50 } });
    // Wrap the public onAdd method to observe a user's click, never trigger on page load.
    const onAdd = control.onAdd.bind(control);
    control.onAdd = target => {
      const element = onAdd(target);
      const clicked = (event: Event) => {
        if (pending) { event.stopImmediatePropagation(); event.preventDefault(); return; }
        pending = true; notify('Recherche de votre position…');
        timeout = setTimeout(() => {
          if (!pending) return;
          finish(); releaseClick(); map.removeControl(control); attach();
          notify('La localisation a pris trop de temps. Réessayez.');
        }, 11000);
      };
      element.addEventListener('click', clicked, true);
      releaseClick = () => element.removeEventListener('click', clicked, true);
      return element;
    };
    control.on('geolocate', () => { finish(); notify('Votre position est affichée. Couverture : 64 · 65.'); });
    control.on('error', event => {
      finish();
      notify(event.code === 1 ? 'Localisation refusée. Vous pouvez déplacer la carte manuellement.'
        : event.code === 3 ? 'La localisation a pris trop de temps. Réessayez.' : 'Position indisponible. Réessayez plus tard.');
    });
    map.addControl(control, 'top-right');
  };
  const moved = (event: MapEventType['movestart'] & { geolocateSource?: boolean }) => {
    if (!pending || event.geolocateSource) return;
    finish(); releaseClick(); map.removeControl(control);
    notify('Localisation annulée pour conserver votre vue.'); attach();
  };
  attach(); map.on('movestart', moved);
  return () => { finish(); map.off('movestart', moved); releaseClick(); map.removeControl(control); };
}
