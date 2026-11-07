import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { LoadingState } from '../../components/common/StateViews';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { lecturaNps } from '@nucleo/utils/encuestasClientes';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fetchUbicaciones } from '@nucleo/data/encuestasClientes';
import { loadLeaflet } from '../../plataforma/mapas';

/**
 * Dónde se hicieron las encuestas de campo: un mapa con un punto por
 * respuesta (color según la recomendación) y la lista por lugar, que es lo que
 * sirve como dato de mercado. Leaflet + OpenStreetMap: no cuesta peticiones de
 * Google, y la librería se carga recién al abrir esta sección.
 *
 * El color del punto sale de la escala NPS: 9-10 promotor, 7-8 pasivo, 0-6
 * detractor; sin recomendación, neutro. Se lee del tema para respetar el modo
 * oscuro (Leaflet pinta en SVG con colores literales).
 */
const colorDe = (nps) => {
    const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || undefined;
    if (nps == null) return v('--color-content-3');
    if (nps >= 9) return v('--color-success');
    if (nps >= 7) return v('--color-warning');
    return v('--color-danger');
};

export default function UbicacionesDeCampo({ encuestaId }) {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const mapa = useRef(null);
    const instancia = useRef(null);

    useEffect(() => {
        let vivo = true;
        fetchUbicaciones(encuestaId)
            .then((d) => { if (vivo) setDatos(d); })
            .catch((e) => { if (vivo) setError(e); });
        return () => { vivo = false; };
    }, [encuestaId]);

    const puntos = useMemo(() => datos?.puntos || [], [datos]);
    useEffect(() => {
        if (!puntos.length || !mapa.current) return undefined;
        let cancelado = false;
        loadLeaflet().then((L) => {
            if (cancelado || !mapa.current) return;
            instancia.current?.remove();
            const m = L.map(mapa.current, { zoomControl: true, scrollWheelZoom: false });
            instancia.current = m;
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
            }).addTo(m);
            const capa = L.featureGroup(puntos.map((p) => L.circleMarker([p.lat, p.lng], {
                radius: 7, weight: 2, color: colorDe(p.nps), fillColor: colorDe(p.nps), fillOpacity: 0.6,
            }).bindTooltip(`${p.lugar || 'Sin nombre'}${p.nps != null ? ` · recomendación ${p.nps}` : ''}`))).addTo(m);
            m.fitBounds(capa.getBounds(), { padding: [24, 24], maxZoom: 16 });
        }).catch((e) => { if (!cancelado) setError(e); });
        return () => { cancelado = true; instancia.current?.remove(); instancia.current = null; };
    }, [puntos]);

    if (error) return <Notice variant="danger" compact>{mensajeAmigable(error, 'No se pudo cargar dónde se hicieron.')}</Notice>;
    if (!datos) return <LoadingState label="Buscando ubicaciones…" />;
    if (!datos.por_lugar.length) return null;

    return (
        <section data-surface="card" className="p-4 space-y-3">
            <TituloDeSeccion nivel="seccion" className="flex items-center gap-1.5"><MapPin size={13} /> Dónde se hizo en campo</TituloDeSeccion>
            {puntos.length > 0 ? (
                <div ref={mapa} className="h-72 rounded-xl overflow-hidden border border-border-card z-base" data-medida="dato"
                    role="img" aria-label={`Mapa con ${puntos.length} encuestas de campo`} />
            ) : (
                <p className="text-micro text-content-3">Ninguna respuesta de campo trae coordenadas: se ven sólo los lugares escritos.</p>
            )}
            <ul className="divide-y divide-border-card">
                {datos.por_lugar.map((l) => {
                    const lec = lecturaNps(l.nps);
                    return (
                        <li key={`${l.lugar}-${l.desde}`} className="flex items-center gap-2 py-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-body-sm text-content truncate">{l.lugar}</p>
                                <p className="text-micro text-content-3">
                                    {fechaTexto(l.desde, { day: 'numeric', month: 'short' })}
                                    {fechaTexto(l.hasta, { day: 'numeric', month: 'short' }) !== fechaTexto(l.desde, { day: 'numeric', month: 'short' })
                                        && ` – ${fechaTexto(l.hasta, { day: 'numeric', month: 'short' })}`}
                                </p>
                            </div>
                            <span className="text-micro text-content-3">{l.respuestas} resp.</span>
                            {l.con_nps > 0 && <Badge size="sm" variant={lec.variant} title="NPS de este lugar">{l.nps}</Badge>}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
