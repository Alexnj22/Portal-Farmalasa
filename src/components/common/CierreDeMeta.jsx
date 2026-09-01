import React from 'react';
import { formatMoney } from '../../utils/formatNumber';

/* El cierre de mes de una sala, dentro de la campana.
 *
 * El aviso del día 1 cuenta dos hechos —cómo cerró el mes y cuánto le toca al
 * que empieza— y hasta hoy los contaba en un párrafo de tres renglones con tres
 * cifras adentro. Había que LEERLO para saber si el mes se cumplió, y el
 * recuadro de la izquierda gastaba 36×36 px en un ícono que vale igual para un
 * pedido, una solicitud y una meta: o sea, en el único lugar de la tarjeta que
 * se mira antes de leer no había ni un dato.
 *
 * Acá ese recuadro pasa a ser el cumplimiento dibujado. El arco ES el
 * porcentaje y el color es el estado, así que el resultado se ve sin leer y la
 * tarjeta no crece un pixel.
 *
 * ── El texto del aviso NO se va ────────────────────────────────────────────
 * `notifications.body` sigue trayendo la frase completa y es lo que se lee si
 * el aviso llega a un sitio que no sabe pintar esta tarjeta. Lo que se reemplaza
 * es el RENDER, no el dato — por eso `datosDeCierreDeMeta` devuelve `null` en
 * cuanto falta algo y la campana vuelve sola a su fila de siempre.
 */

const R = 19;                      // radio del anillo, en las 46 unidades del viewBox
const VUELTA = 2 * Math.PI * R;    // 119.38

/**
 * El anillo, en el lugar exacto que ocupaba el recuadro del ícono.
 *
 * El arco se TOPA en la vuelta completa y el excedente se dice con un punto en
 * las doce: un 101.5% dibujado como 1.015 vueltas se ve idéntico a un 1.5%, que
 * es la peor confusión posible en una tarjeta que habla de si la meta se
 * cumplió. Salud 3 cerró agosto en 101.5%, así que el caso no es hipotético.
 *
 * El color dice el estado pero nunca solo: el porcentaje va escrito adentro y
 * el título del aviso lo repite en palabras. Ámbar y verde son justo el par que
 * más gente confunde.
 */
export function AnilloDeMeta({ pct, cumplida, isDark }) {
    const tono = cumplida
        ? (isDark ? 'text-success-text' : 'text-success')
        : (isDark ? 'text-warning-text' : 'text-warning');
    const avance = Math.max(0, Math.min(pct, 100)) / 100;

    return (
        <div className="relative w-9 h-9 flex-shrink-0 mt-0.5">
            <svg
                viewBox="0 0 46 46" className="w-full h-full" role="img"
                aria-label={`Cerró en ${pct}% de la meta`}
            >
                <circle
                    cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    className="stroke-current text-content-3 opacity-20"
                />
                <circle
                    cx="23" cy="23" r={R} fill="none" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${(VUELTA * avance).toFixed(2)} ${VUELTA.toFixed(2)}`}
                    transform="rotate(-90 23 23)"
                    className={`stroke-current ${tono}`}
                />
                {pct > 100 && (
                    /* El excedente. Va sobre el arranque del arco —las doce— porque
                       es donde la vuelta se cierra sobre sí misma. */
                    <circle cx="23" cy="4" r="3.2" className={`fill-current ${tono}`} />
                )}
            </svg>
            <span className={`absolute inset-0 grid place-items-center text-caption font-black tabular-nums ${tono}`}>
                {Math.round(pct)}%
            </span>
        </div>
    );
}

/**
 * El cuerpo con montos: la venta grande, la meta al lado en tono bajo, y debajo
 * —tras una línea— el mes que empieza.
 *
 * Sin montos no se dibuja nada de esto: se deja el `body` del aviso tal cual,
 * que ya está escrito en porcentaje. Una segunda redacción acá sería una copia
 * de la regla que decide quién ve dólares, y la copia es la que se queda vieja.
 */
export function CuerpoDeCierreDeMeta({ datos, claseTenue }) {
    const { venta, meta, metaNueva, mesCerrado, mesNuevo } = datos;
    if (venta == null) return null;

    // «1.6% menos que Agosto» y no «−1.6%»: el signo hay que interpretarlo, la
    // palabra no. Y el mes va sin año — el título ya dijo cuál es.
    const mesCorto = (mesCerrado || '').split(' ')[0];
    const delta = (meta && metaNueva)
        ? (metaNueva - meta) / meta * 100
        : null;

    return (
        <>
            <div className="flex items-baseline gap-2 flex-wrap tabular-nums mt-1">
                <span className="text-body-lg font-black tracking-tight">{formatMoney(venta)}</span>
                {meta != null && (
                    <span className={`text-body-sm font-semibold ${claseTenue}`}>de {formatMoney(meta)}</span>
                )}
            </div>

            {metaNueva != null && (
                <>
                    <div className="h-px bg-border-card my-2" />
                    <div className="flex items-baseline gap-2 flex-wrap tabular-nums">
                        <span className={`text-caption font-black uppercase tracking-widest ${claseTenue}`}>
                            {mesNuevo}
                        </span>
                        <span className="text-body font-black tracking-tight">{formatMoney(metaNueva)}</span>
                        {delta != null && Math.abs(delta) >= 0.05 && mesCorto && (
                            <span className={`text-caption font-medium ${claseTenue}`}>
                                {Math.abs(delta).toFixed(1)}% {delta < 0 ? 'menos' : 'más'} que {mesCorto}
                            </span>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
