import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/idioma';
import { romano } from '../lib/romanos';

// Leaflet (y su CSS) bajan sólo cuando el mapa está por entrar en pantalla.
let leaflet = null;
function cargarLeaflet() {
  if (!leaflet) {
    leaflet = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([m]) => m.default || m)
      .catch((err) => { leaflet = null; throw err; });
  }
  return leaflet;
}
const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Mapa interactivo con OpenStreetMap (sin clave de API). En el teléfono no
 * secuestra el scroll: se arrastra con dos dedos, y el aviso lo dice.
 */
export default function Mapa({ lugares, enfocado }) {
  const nodo = useRef(null);
  const mapa = useRef(null);
  const marcas = useRef({});
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState(false);

  useEffect(() => {
    const el = nodo.current;
    if (!el) return undefined;
    if (!('IntersectionObserver' in window)) { setVisible(true); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    let m = null; let vivo = true;
    cargarLeaflet().then((L) => {
      if (!vivo || !nodo.current) return;
      const movil = L.Browser.mobile;
      m = L.map(nodo.current, { scrollWheelZoom: false, dragging: !movil, tap: false });
      mapa.current = m;
      // Teselas oscuras de CARTO (sobre OpenStreetMap), del tono de la noche del sitio.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
      const icono = (n) => L.divIcon({
        className: 'marca-mapa', html: `<span>${n}</span>`,
        iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
      });
      lugares.forEach((l, i) => {
        marcas.current[l.id] = L.marker([l.lat, l.lng], { icon: icono(romano(i + 1)), title: l.nombre, alt: l.nombre })
          .addTo(m)
          .bindPopup(`<b>${escapar(l.tipo)}</b><br>${escapar(l.nombre)}<br><small>${escapar(l.hora)}</small>`);
      });
      m.fitBounds(L.latLngBounds(lugares.map((l) => [l.lat, l.lng])), { padding: [50, 50], maxZoom: 15 });
      if (movil) {
        // Con dos dedos se mueve el mapa; con uno, la página (y se avisa cómo).
        const el = nodo.current;
        let reloj = null;
        const toque = (e) => {
          if (e.touches.length >= 2) { m.dragging.enable(); setAviso(false); } else {
            m.dragging.disable(); setAviso(true);
            clearTimeout(reloj); reloj = setTimeout(() => setAviso(false), 1600);
          }
        };
        el.addEventListener('touchstart', toque, { passive: true });
        m.on('unload', () => { el.removeEventListener('touchstart', toque); clearTimeout(reloj); });
      }
    }).catch((e) => { console.error('Mapa', e); if (vivo) setError(t('No se pudo cargar el mapa. Usa los botones para abrirlo en tu teléfono.', 'The map could not load. Use the buttons to open it on your phone.')); });
    return () => { vivo = false; m?.remove(); mapa.current = null; };
  }, [visible, lugares]);

  useEffect(() => {
    const l = lugares.find((x) => x.id === enfocado);
    if (l && mapa.current) {
      mapa.current.flyTo([l.lat, l.lng], 16, { duration: 0.8 });
      marcas.current[l.id]?.openPopup();
    }
  }, [enfocado, lugares, visible]);

  return (
    <div className="mapa-caja">
      <div ref={nodo} className="mapa" role="region" aria-label={t('Mapa de los lugares', 'Map of the venues')} />
      <p className={`mapa-aviso ${aviso ? 'visto' : ''}`} aria-hidden>{t('Usa dos dedos para mover el mapa', 'Use two fingers to move the map')}</p>
      {error && <p className="aviso error mapa-error" role="alert">{error}</p>}
    </div>
  );
}
