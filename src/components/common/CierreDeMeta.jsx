import React from 'react';
import { Crown, Medal } from 'lucide-react';
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
 * porcentaje y el color es el estado, así que el resultado se ve sin leer.
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
 * El número va SIN el signo de porcentaje: con él, un 101.5% se escribe «102%»
 * y a 10 px no entra en los 28 px de adentro del anillo — se vio recortado como
 * «02%», que es un número distinto y no un número feo. El signo no hace falta:
 * el título, a dos centímetros, dice «en 101.5%» con todas las letras.
 *
 * El color dice el estado pero nunca solo, por lo mismo: ámbar y verde son
 * justo el par que más gente confunde.
 */
export function AnilloDeMeta({ pct, cumplida, isDark }) {
    const tono = cumplida
        ? (isDark ? 'text-success-text' : 'text-success')
        : (isDark ? 'text-warning-text' : 'text-warning');
    const avance = Math.max(0, Math.min(pct, 100)) / 100;
    const entero = Math.round(pct);

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
            <span
                aria-hidden="true"
                className={`absolute inset-0 grid place-items-center leading-none tabular-nums
                    font-black tracking-tighter ${entero >= 100 ? 'text-micro' : 'text-caption'} ${tono}`}
            >
                {entero}
            </span>
        </div>
    );
}

/* ── El podio ──────────────────────────────────────────────────────────────
 * Primero y segundo tienen cara propia. El resto no: un adorno para los seis
 * puestos no distinguiría a nadie, que es justo lo contrario de lo que un
 * podio hace. */
const PODIO = {
    1: { Icono: Crown, texto: '1er lugar', claro: 'text-warning',   oscuro: 'text-warning-text' },
    2: { Icono: Medal, texto: '2º lugar',  claro: 'text-content-2', oscuro: 'text-content-2' },
};

/**
 * En qué lugar quedó la sala, y de qué lado del promedio.
 *
 * Va para todos —también para quien no ve montos—: es el contexto del número
 * que el título ya dijo, no un dato nuevo sobre dinero.
 */
function PuestoDeLaSala({ datos, claseTenue, isDark }) {
    const { puesto, de, promedio, pct } = datos;
    if (!puesto || !de) return null;

    const podio = PODIO[puesto];
    const ordinal = puesto === 1 ? '1er' : `${puesto}º`;
    // «bajo el promedio» y no un signo: la palabra no hay que interpretarla.
    const contraPromedio = promedio == null ? null
        : pct >= promedio ? `sobre el promedio (${promedio}%)`
                          : `bajo el promedio (${promedio}%)`;

    if (podio) {
        const Icono = podio.Icono;
        return (
            <div className={`flex items-center gap-1.5 flex-wrap ${isDark ? podio.oscuro : podio.claro}`}>
                <Icono size={14} strokeWidth={2.5} />
                <span className="text-caption font-black uppercase tracking-widest">
                    {podio.texto} de {de}
                </span>
                {contraPromedio && (
                    <span className={`text-caption font-medium ${claseTenue}`}>
                        · {contraPromedio}
                    </span>
                )}
            </div>
        );
    }

    return (
        <p className={`text-caption font-semibold ${claseTenue}`}>
            {ordinal} lugar de {de}{contraPromedio ? ` · ${contraPromedio}` : ''}
        </p>
    );
}

/**
 * Las seis salas, en cumplimiento.
 *
 * Nunca en dólares: Salud 1 vendió $50,354.03 y Salud 5 $14,345.77, así que un
 * ranking por monto sería el tamaño de la sala —algo que nadie eligió y nadie
 * puede cambiar—. El cumplimiento sí es comparable: cada una contra la meta que
 * le tocó.
 *
 * La barra se mide contra el MAYOR de la tabla y no contra 100, para que el mes
 * en que todas queden por debajo siga teniendo diferencias visibles. Quién
 * cumplió lo dice el color, y al lado está el número.
 */
function TablaDeSalas({ tabla, salaPropia, claseTenue, isDark }) {
    if (!tabla?.length) return null;
    const tope = Math.max(...tabla.map(f => f.pct), 1);

    return (
        <ul className="flex flex-col gap-1">
            {tabla.map(({ sala, pct }) => {
                const propia   = sala === salaPropia;
                const cumplida = pct >= 100;
                const tono = cumplida
                    ? (isDark ? 'bg-success-text' : 'bg-success')
                    : (isDark ? 'bg-chart-1' : 'bg-chart-1-solid');
                return (
                    <li key={sala} className="flex items-center gap-2 min-w-0">
                        <span className={`text-caption truncate w-20 flex-shrink-0
                            ${propia ? 'font-black' : `font-semibold ${claseTenue}`}`}>
                            {sala}
                        </span>
                        <span className="flex-1 h-1.5 rounded-full bg-border-card overflow-hidden">
                            <span
                                className={`block h-full rounded-full ${tono} ${propia ? '' : 'opacity-45'}`}
                                style={{ width: `${(pct / tope) * 100}%` }}
                            />
                        </span>
                        <span className={`text-caption tabular-nums w-12 text-right flex-shrink-0
                            ${propia ? 'font-black' : `font-semibold ${claseTenue}`}`}>
                            {pct.toFixed(1)}%
                        </span>
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * El cuerpo dibujado: las cifras (sólo para quien ve montos), el puesto entre
 * las salas (para todos), el listado completo (sólo para el jefe de sala) y el
 * mes que empieza.
 *
 * Sin montos, el `body` del aviso se sigue mostrando tal cual —ya está escrito
 * en porcentaje— y acá se le suma nada más el puesto. Redactar una segunda
 * versión de esa frase sería copiar la regla que decide quién ve dólares, y la
 * copia es la que se queda vieja.
 */
export function CuerpoDeCierreDeMeta({ datos, claseTenue, isDark, salaPropia }) {
    const { venta, meta, metaNueva, mesCerrado, mesNuevo, tabla } = datos;

    // «1.6% menos que Agosto» y no «−1.6%»: el signo hay que interpretarlo, la
    // palabra no. Y el mes va sin año — el título ya dijo cuál es.
    const mesCorto = (mesCerrado || '').split(' ')[0];
    const delta = (meta && metaNueva) ? (metaNueva - meta) / meta * 100 : null;

    return (
        <div className="flex flex-col gap-2 mt-1">
            {venta != null && (
                <div className="flex items-baseline gap-2 flex-wrap tabular-nums">
                    <span className="text-body-lg font-black tracking-tight">{formatMoney(venta)}</span>
                    {meta != null && (
                        <span className={`text-body-sm font-semibold ${claseTenue}`}>de {formatMoney(meta)}</span>
                    )}
                </div>
            )}

            <PuestoDeLaSala datos={datos} claseTenue={claseTenue} isDark={isDark} />

            {tabla?.length > 0 && (
                <TablaDeSalas tabla={tabla} salaPropia={salaPropia} claseTenue={claseTenue} isDark={isDark} />
            )}

            {venta != null && metaNueva != null && (
                <>
                    <div className="h-px bg-border-card" />
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
        </div>
    );
}
