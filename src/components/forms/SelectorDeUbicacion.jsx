import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, loadLeaflet } from '../../plataforma/mapas';
import { SkeletonText } from '../common/StateViews';

// El mapa donde se marca la sucursal (2026-10-29). Pedido del usuario: «que se
// seleccione de maps y se marque, así mejor desde ahí se selecciona».
//
// Un toque en el mapa pone el pin ahí; el pin también se arrastra. Cada vez que
// se suelta, `onElegir(lat, lng)` — quien lo usa decide qué hacer con el punto
// (pedir la dirección, completar la ficha). Si el punto cambia desde AFUERA
// (se pegó un enlace), el pin se mueve solo y el mapa lo sigue.
//
// Google primero —es el mapa que la gente conoce y donde ubica la farmacia—, y
// Leaflet con OpenStreetMap si la llave falla: es el mismo respaldo que usa la
// ruta de pedidos (`RutaMapModal`), y no necesita llave.

const CENTRO_DEL_PAIS = { lat: 13.794, lng: -88.897 };   // El Salvador entero a zoom 8
const hayPunto = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng);

export default function SelectorDeUbicacion({ lat, lng, onElegir }) {
    const caja = useRef(null);
    const mover = useRef(null);         // (lat, lng) → mueve pin y mapa, del motor que haya cargado
    const elegir = useRef(onElegir);
    const [estado, setEstado] = useState('cargando');   // cargando · listo · sin-mapa

    useEffect(() => { elegir.current = onElegir; });

    useEffect(() => {
        let cancelado = false;
        const inicio = hayPunto(lat, lng) ? { lat, lng } : null;

        async function conLeaflet() {
            const L = await loadLeaflet();
            if (cancelado || !caja.current) return;
            caja.current.innerHTML = '';
            const mapa = L.map(caja.current, { zoomControl: true })
                .setView(inicio ? [inicio.lat, inicio.lng] : [CENTRO_DEL_PAIS.lat, CENTRO_DEL_PAIS.lng], inicio ? 17 : 8);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap', maxZoom: 19,
            }).addTo(mapa);
            let pin = null;
            const poner = (p) => {
                if (!pin) {
                    pin = L.marker([p.lat, p.lng], { draggable: true }).addTo(mapa);
                    pin.on('dragend', () => { const q = pin.getLatLng(); elegir.current?.(q.lat, q.lng); });
                } else pin.setLatLng([p.lat, p.lng]);
            };
            if (inicio) poner(inicio);
            mapa.on('click', (e) => { poner(e.latlng); elegir.current?.(e.latlng.lat, e.latlng.lng); });
            mover.current = (p) => { poner(p); mapa.setView([p.lat, p.lng], Math.max(mapa.getZoom(), 17)); };
            setEstado('listo');
            return () => mapa.remove();
        }

        async function conGoogle() {
            const maps = await loadGoogleMaps();
            if (cancelado || !caja.current) return;
            const mapa = new maps.Map(caja.current, {
                center: inicio || CENTRO_DEL_PAIS, zoom: inicio ? 17 : 8,
                mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
                gestureHandling: 'cooperative', clickableIcons: false,
            });
            let pin = null;
            const poner = (p) => {
                if (!pin) {
                    pin = new maps.Marker({ map: mapa, position: p, draggable: true });
                    pin.addListener('dragend', (e) => elegir.current?.(e.latLng.lat(), e.latLng.lng()));
                } else pin.setPosition(p);
            };
            if (inicio) poner(inicio);
            mapa.addListener('click', (e) => {
                const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
                poner(p); elegir.current?.(p.lat, p.lng);
            });
            mover.current = (p) => { poner(p); mapa.panTo(p); if (mapa.getZoom() < 17) mapa.setZoom(17); };
            setEstado('listo');
            return null;
        }

        let limpiar = null;
        conGoogle()
            .catch(() => conLeaflet())
            .then((fn) => { limpiar = fn || null; })
            .catch(() => { if (!cancelado) setEstado('sin-mapa'); });
        return () => { cancelado = true; mover.current = null; limpiar?.(); };
        // Se monta UNA vez: el punto de afuera lo sigue el efecto de abajo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // El punto cambió desde afuera (se pegó un enlace): el pin lo sigue.
    useEffect(() => {
        if (estado === 'listo' && hayPunto(lat, lng)) mover.current?.({ lat, lng });
    }, [estado, lat, lng]);

    return (
        <div className="relative">
            <div ref={caja} data-medida="dato"
                className="h-64 w-full rounded-2xl overflow-hidden border border-border-card bg-surface-card-hover" />
            {estado === 'cargando' && (
                <div className="absolute inset-0 p-4"><SkeletonText lines={3} /></div>
            )}
            {estado === 'sin-mapa' && (
                <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-label text-content-3">
                    No se pudo abrir el mapa. El enlace de Google Maps sigue sirviendo para ubicarla.
                </p>
            )}
        </div>
    );
}
