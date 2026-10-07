// El avance del pedido en UNA línea — lo que la tarjeta muestra cerrada
// (rediseño 2026-10-06).
//
// La línea de tiempo completa (`LifecycleTimeline`: hora, foto y nombre en cada
// paso) iba siempre abierta y hacía que cada tarjeta midiera ~270px: cabían
// tres pedidos por pantalla y uno en el teléfono. Para ESCANEAR la lista basta
// con saber en qué paso va cada sala; quién y a qué hora se ve al abrirla.
//
// Los pasos y el paso activo salen de las MISMAS fuentes que la línea completa
// —`pasosDelPedido` y `PASO_DE_LA_ETAPA` del núcleo— con la misma regla de
// «hecho», así que las dos vistas no pueden decir cosas distintas. Sólo los
// siete pasos del flujo: los extra (falta caja, reenvío, diferencias) los dice
// la fila de datos de la tarjeta con su número.
import React from 'react';
import { Check, Pause } from 'lucide-react';
import { pasosDelPedido, PASO_DE_LA_ETAPA } from '@nucleo/utils/tableroDePedidos';

// El rótulo del paso EN CURSO dice lo que está pasando, no el nombre del hito
// que lo abrió: preparando es «Preparando», no «Inicio».
const EN_CURSO = { confirmado: 'Por preparar', iniciado: 'Preparando', preparado: 'Listo', enviado: 'En ruta', llegada: 'Recibiendo' };

export default function AvanceCompacto({ row, stage, rutaStop = null }) {
    const pasos     = pasosDelPedido(row, { entrega: rutaStop }).slice(0, 7);
    const activeIdx = PASO_DE_LA_ETAPA[stage] ?? 0;
    const pausado   = stage === 'pausado';
    // En «Finalizado» ya no hay nada en curso: el último paso es un hecho.
    const cerrado   = stage === 'erp';

    return (
        <ol className="flex items-start w-full" aria-label="Avance del pedido">
            {pasos.map((paso, idx) => {
                const hecho  = paso.time != null && (paso.isRutaNode || idx < activeIdx || (cerrado && idx === activeIdx));
                const activo = !cerrado && !paso.isRutaNode && idx === activeIdx;
                const ultimo = idx === pasos.length - 1;
                const tramoHecho = hecho && pasos[idx + 1]?.time != null;
                return (
                    <li key={paso.key} className={`flex flex-col items-center min-w-0 ${ultimo ? 'shrink-0' : 'flex-1'}`}
                        aria-current={activo ? 'step' : undefined}>
                        <span className="flex items-center w-full">
                            <span className={`shrink-0 w-4 h-4 rounded-full grid place-items-center ${
                                hecho  ? 'bg-chart-3'
                                : activo ? (pausado ? 'bg-warning-solid' : 'bg-surface-card border-2 border-chart-3')
                                : 'bg-surface-card border border-divider'}`}>
                                {hecho && <Check size={10} strokeWidth={3} className="text-white" aria-hidden="true" />}
                                {activo && pausado && <Pause size={8} strokeWidth={3} className="text-white" aria-hidden="true" />}
                                {activo && !pausado && <span className="w-1.5 h-1.5 rounded-full bg-chart-3" />}
                            </span>
                            {!ultimo && (
                                <span className={`h-0.5 flex-1 mx-1 rounded-full ${tramoHecho ? 'bg-chart-3/60' : 'bg-divider'}`} />
                            )}
                        </span>
                        {/* En el teléfono sólo se rotula el paso en curso: siete
                            rótulos no entran en 330px y se pisaban. */}
                        <span className={`mt-1 text-micro leading-tight whitespace-nowrap self-start ${
                            activo ? `font-bold ${pausado ? 'text-warning-text' : 'text-chart-3-text'}`
                            : hecho ? 'text-content-2 hidden sm:block' : 'text-content-3 hidden sm:block'}`}>
                            {activo ? (pausado ? 'Pausado' : EN_CURSO[paso.key] ?? paso.label) : paso.label}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
