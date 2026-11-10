import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Mapa interactivo con OpenStreetMap: no necesita clave de API.
export default function Mapa({ lugares, enfocado }) {
  const nodo = useRef(null);
  const mapa = useRef(null);
  const marcas = useRef({});

  useEffect(() => {
    const m = L.map(nodo.current, { scrollWheelZoom: false });
    mapa.current = m;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap',
    }).addTo(m);
    const icono = (n) => L.divIcon({
      className: '',
      html: `<div style="background:oklch(0.45 0.072 118);color:oklch(0.955 0.017 85);width:36px;height:36px;border-radius:50%;display:grid;place-items:center;border:2px solid oklch(0.955 0.017 85);box-shadow:0 4px 14px oklch(0.2 0.03 118 / .35);font:600 15px 'Hanken Grotesk',sans-serif">${n}</div>`,
      iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18],
    });
    lugares.forEach((l, i) => {
      marcas.current[l.id] = L.marker([l.lat, l.lng], { icon: icono(i + 1) })
        .addTo(m)
        .bindPopup(`<b>${l.tipo}</b><br>${l.nombre}<br><small>${l.hora}</small>`);
    });
    m.fitBounds(L.latLngBounds(lugares.map((l) => [l.lat, l.lng])), { padding: [50, 50], maxZoom: 15 });
    return () => m.remove();
  }, [lugares]);

  useEffect(() => {
    const l = lugares.find((x) => x.id === enfocado);
    if (l && mapa.current) {
      mapa.current.flyTo([l.lat, l.lng], 16, { duration: 0.8 });
      marcas.current[l.id]?.openPopup();
    }
  }, [enfocado, lugares]);

  return <div ref={nodo} className="mapa" role="region" aria-label="Mapa" />;
}
