// El avance del pedido en UNA línea (rediseño 2026-10-06, partido en dos
// tramos el 2026-10-07).
//
// La línea de tiempo completa (`LifecycleTimeline`: hora, foto y nombre en cada
// paso) iba siempre abierta y hacía que cada tarjeta midiera ~270px: cabían
// tres pedidos por pantalla y uno en el teléfono. Para ESCANEAR la lista basta
// con saber en qué paso va cada sala; quién y a qué hora se ve al abrirla
// (`detalle`), en ESTA misma línea — no en una segunda debajo.
//
// Dos tramos, porque son dos responsables (pedido del usuario): BODEGA Y
// TRANSPORTE —confirmado, preparación, listo, salida, entrega— y SUCURSAL
// —llegada y cierre—. Cada tramo con su color y un corte entre los dos.
//
// Los pasos y el paso activo salen de las MISMAS fuentes que la línea completa
// —`pasosDelPedido` y `PASO_DE_LA_ETAPA` del núcleo— con la misma regla de
// «hecho», así que las dos vistas no pueden decir cosas distintas. Sólo los
// siete pasos del flujo: los extra (falta caja, reenvío, diferencias) los dice
// la fila de datos con su número.
import React from 'react';
import { Check, Pause } from 'lucide-react';
import { pasosDelPedido, PASO_DE_LA_ETAPA, fmtHM, fmtMin, elapsed } from '@nucleo/utils/tableroDePedidos';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import AvatarConEstado from '../../../components/common/AvatarConEstado';

// El rótulo del paso EN CURSO dice lo que está pasando, no el nombre del hito
// que lo abrió: preparando es «Preparando», no «Inicio».
const EN_CURSO = { confirmado: 'Por preparar', iniciado: 'Preparando', preparado: 'Listo', enviado: 'En ruta', llegada: 'Recibiendo' };

// Literales: Tailwind escanea texto.
const TRAMO = {
    bodega: { titulo: 'Bodega y transporte', punto: 'bg-chart-3', borde: 'border-chart-3', linea: 'bg-chart-3/60', texto: 'text-chart-3-text' },
    sala:   { titulo: 'Sucursal',            punto: 'bg-chart-9', borde: 'border-chart-9', linea: 'bg-chart-9/60', texto: 'text-chart-9-text' },
};
const LADO = { confirmado: 'bodega', iniciado: 'bodega', preparado: 'bodega', enviado: 'bodega', ruta_entregado: 'bodega', llegada: 'sala', erp: 'sala' };

/**
 * `rotulos`: 'siempre', 'activo' (sólo el paso en curso: la lista, que dice
 *   los nombres UNA vez en su encabezado) o 'sm' (la tarjeta: en el teléfono
 *   sólo el paso en curso, porque siete rótulos en 330px se pisaban).
 * `detalle`: la fila abierta — hora, foto, persona y duración de cada tramo.
 * `quien`: id → empleado, para el detalle.
 * `apoyo`: `{ bodega: [...], sala: [...] }` — quién apoyó en cada lado.
 */
export function EncabezadoDeAvance() {
    // Los nombres de los pasos y de los tramos, una vez, alineados con los
    // puntos de las filas: usa el MISMO reparto (5 : 2, `flex-1` por paso).
    return (
        <div className="flex items-end w-full gap-3" aria-hidden="true">
            {[['bodega', ['Confirmado', 'Inicio', 'Listo', 'En ruta', 'Entregado']], ['sala', ['Llegada', 'Finalizado']]].map(([lado, nombres], ti) => (
                <React.Fragment key={lado}>
                    {ti > 0 && <span className="self-stretch w-px shrink-0" />}
                    <div className={`min-w-0 ${ti === 0 ? 'flex-[5]' : 'flex-[2]'}`}>
                        <p className={`text-micro font-semibold uppercase tracking-wider mb-1 ${TRAMO[lado].texto}`}>{TRAMO[lado].titulo}</p>
                        <div className="flex w-full">
                            {nombres.map((n, i) => (
                                i === nombres.length - 1
                                    ? <span key={n} className="w-4 shrink-0 flex justify-end overflow-visible"><span className="text-micro text-content-3 leading-tight whitespace-nowrap">{n}</span></span>
                                    : <span key={n} className="flex-1 min-w-0 truncate text-micro text-content-3 leading-tight pr-1 whitespace-nowrap">{n}</span>
                            ))}
                        </div>
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}

export default function AvanceCompacto({ row, stage, rutaStop = null, conductor = null, rotulos = 'sm', detalle = false, quien = () => null, apoyo = null }) {
    const pasos     = pasosDelPedido(row, { entrega: rutaStop, quien, conductor }).slice(0, 7);
    const activeIdx = PASO_DE_LA_ETAPA[stage] ?? 0;
    const pausado   = stage === 'pausado';
    // En «Finalizado» ya no hay nada en curso: el último paso es un hecho.
    const cerrado   = stage === 'erp';

    const estado = pasos.map((paso, idx) => ({
        paso, idx,
        lado:   LADO[paso.key] ?? 'bodega',
        hecho:  paso.time != null && (paso.isRutaNode || idx < activeIdx || (cerrado && idx === activeIdx)),
        activo: !cerrado && !paso.isRutaNode && idx === activeIdx,
    }));
    const tramos = ['bodega', 'sala'].map(lado => estado.filter(e => e.lado === lado));
    const conTitulos = rotulos === 'siempre' || detalle;  // en 'activo' los dice el encabezado

    const renderPaso = (e, i, lista) => {
        const t = TRAMO[e.lado];
        const ultimo = i === lista.length - 1;
        const sig = lista[i + 1];
        const tramoHecho = e.hecho && sig?.paso.time != null;
        const dur = detalle && e.paso.time && sig?.paso.time ? fmtMin(elapsed(e.paso.time, sig.paso.time)) : null;
        const rotulo = e.activo ? (pausado ? 'Pausado' : EN_CURSO[e.paso.key] ?? e.paso.label) : e.paso.label;
        const verRotulo = rotulos === 'siempre' || detalle || e.activo;
        const ocultarRotulo = !verRotulo && rotulos === 'activo';
        return (
            // El último paso mide lo mismo que su punto (`w-4`) y su rótulo
            // desborda: si midiera lo que su rótulo, los puntos de cada fila
            // caerían en otro lugar que los nombres del encabezado.
            // Su rótulo se alinea a la DERECHA del punto y desborda hacia la
            // izquierda: hacia la derecha chocaba con el tramo siguiente
            // («EntregadoLlegada») o lo cortaba el borde de la tarjeta.
            <li key={e.paso.key} className={`flex flex-col ${ultimo ? 'w-4 shrink-0 overflow-visible items-end text-right' : 'flex-1 min-w-0'}`}
                aria-current={e.activo ? 'step' : undefined}>
                <span className="flex items-center w-full">
                    <span className={`shrink-0 w-4 h-4 rounded-full grid place-items-center ${
                        e.hecho  ? t.punto
                        : e.activo ? (pausado ? 'bg-warning-solid' : `bg-surface-card border-2 ${t.borde}`)
                        : 'bg-surface-card border border-divider'}`}>
                        {e.hecho && <Check size={10} strokeWidth={3} className="text-white" aria-hidden="true" />}
                        {e.activo && pausado && <Pause size={8} strokeWidth={3} className="text-white" aria-hidden="true" />}
                        {e.activo && !pausado && <span className={`w-1.5 h-1.5 rounded-full ${t.punto}`} />}
                    </span>
                    {!ultimo && (
                        <span className="relative flex-1 mx-1">
                            <span className={`block h-0.5 rounded-full ${tramoHecho ? t.linea : 'bg-divider'}`} />
                            {dur && (
                                <span className="absolute left-1/2 -translate-x-1/2 -top-4 text-micro text-content-3 tabular-nums whitespace-nowrap">{dur}</span>
                            )}
                        </span>
                    )}
                </span>
                {/* El rótulo puede bajar a dos renglones antes que pisar al
                    vecino: en un tramo angosto «Por preparar» se pegaba a
                    «Inicio». */}
                <span className={`mt-1 pr-1 text-micro leading-tight ${ultimo || e.activo || !detalle ? 'whitespace-nowrap' : 'break-words'} ${
                    e.activo ? `font-bold ${pausado ? 'text-warning-text' : t.texto}`
                    : e.hecho ? 'text-content-2' : 'text-content-3'
                } ${verRotulo ? '' : ocultarRotulo ? 'invisible' : 'hidden sm:block'}`}>
                    {rotulo}
                </span>
                {detalle && e.paso.time && (
                    <span className="text-micro text-content-3 tabular-nums leading-tight whitespace-nowrap">
                        {fmtHM(e.paso.time)}
                    </span>
                )}
                {detalle && e.paso.emp && (
                    <span className={`mt-1 flex items-center gap-1 min-w-0 ${ultimo ? 'whitespace-nowrap' : ''}`}>
                        <AvatarConEstado emp={e.paso.emp} px={20} radio="rounded-full" marco="" mostrarChip={false} />
                        <span className="text-micro text-content-2 leading-tight truncate">{shortEmployeeName(e.paso.emp)}</span>
                    </span>
                )}
                {detalle && e.paso.key === 'iniciado' && (row.min_pausado_total ?? 0) > 0 && (
                    <span className="text-micro text-warning-text leading-tight whitespace-nowrap">
                        {fmtMin(row.min_pausado_total)} en pausa
                    </span>
                )}
            </li>
        );
    };

    return (
        <div className="flex items-start w-full gap-3" aria-label="Avance del pedido">
            {tramos.map((lista, ti) => {
                const lado = ti === 0 ? 'bodega' : 'sala';
                return (
                    <React.Fragment key={lado}>
                        {ti > 0 && <span aria-hidden="true" className="self-stretch w-px bg-divider shrink-0" />}
                        <div className={`min-w-0 ${ti === 0 ? 'flex-[5]' : 'flex-[2]'}`}>
                            {conTitulos && (
                                <p className={`text-micro font-semibold uppercase tracking-wider mb-1 ${TRAMO[lado].texto}`}>
                                    {TRAMO[lado].titulo}
                                </p>
                            )}
                            <ol className={`flex items-start w-full ${detalle ? 'pt-3' : ''}`}>
                                {lista.map((e, i) => renderPaso(e, i, lista))}
                            </ol>
                            {detalle && (apoyo?.[lado] ?? []).length > 0 && (
                                <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                    <span className="text-micro text-content-3 uppercase tracking-wider">Apoyo</span>
                                    {apoyo[lado].map(a => (
                                        <span key={a.id ?? a.employee_id} className="flex items-center gap-1">
                                            <AvatarConEstado emp={a} px={20} radio="rounded-full" marco="" mostrarChip={false} />
                                            <span className="text-micro text-content-2">{shortEmployeeName(a)}</span>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}
