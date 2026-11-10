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
      html: `<div style="background:#9a7b4f;color:#fff;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;border:3px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.3)"><span style="transform:rotate(45deg);font:600 14px Inter,sans-serif">${n}</span></div>`,
      iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30],
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

  return <div ref={nodo} className="mapa" role="region" aria-label="Mapa de los lugares" />;
}
