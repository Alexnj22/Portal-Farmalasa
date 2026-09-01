import React from 'react';
import { Crown, Medal } from 'lucide-react';
import { formatMoney } from '../../utils/formatNumber';
import { shortEmployeeName } from '../../utils/nameUtils';
import AvatarConEstado from './AvatarConEstado';

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
 * En qué lugar quedó LA PERSONA entre los vendedores de su sala.
 *
 * Va para todos —también para quien no ve montos—: la participación es un
 * porcentaje, no un monto, así que no dice cuánto vendió nadie en plata.
 * Nada se pinta si esa persona no vendió ese mes.
 */
function PuestoDelVendedor({ datos, claseTenue, isDark }) {
    const { puesto, de, promedio, miParte } = datos;
    if (!puesto || !de || miParte == null) return null;

    const podio = PODIO[puesto];
    const ordinal = puesto === 1 ? '1er' : `${puesto}º`;
    // «bajo el promedio» y no un signo: la palabra no hay que interpretarla.
    const contraPromedio = promedio == null ? null
        : miParte >= promedio ? `sobre el promedio (${promedio}%)`
                              : `bajo el promedio (${promedio}%)`;
    const parte = `${miParte}% de la venta de la sala`;

    if (podio) {
        const Icono = podio.Icono;
        return (
            <div className={`flex items-center gap-1.5 flex-wrap ${isDark ? podio.oscuro : podio.claro}`}>
                <Icono size={14} strokeWidth={2.5} />
                <span className="text-caption font-black uppercase tracking-widest">
                    {podio.texto} de {de}
                </span>
                <span className={`text-caption font-medium ${claseTenue}`}>· {parte}</span>
            </div>
        );
    }

    return (
        <p className={`text-caption font-semibold ${claseTenue}`}>
            {ordinal} lugar de {de} · {parte}{contraPromedio ? ` · ${contraPromedio}` : ''}
        </p>
    );
}

/**
 * Los vendedores de la sala, en participación.
 *
 * Nunca en dólares: una participación dice quién movió más mostrador sin
 * publicar cuánto factura nadie. Es la misma decisión que ya tomó el ranking
 * del Inicio cuando falta `dash_vendedores_vista_completa`.
 *
 * La barra arranca en cero y se mide contra el mayor de la lista. Empezarla más
 * arriba haría ver enorme una diferencia de dos décimas — que es justo la que
 * hay entre el primero y el segundo de La Popular (20.7% y 20.4%).
 */
function TablaDeVendedores({ tabla, claseTenue, isDark }) {
    if (!tabla?.length) return null;
    const tope = Math.max(...tabla.map(f => f.parte), 1);

    return (
        <ul className="flex flex-col gap-1">
            {tabla.map(({ nombre, parte, yo }, i) => (
                <li key={`${nombre}-${i}`} className="flex items-center gap-2 min-w-0">
                    <span className={`text-caption truncate w-24 flex-shrink-0
                        ${yo ? 'font-black' : `font-semibold ${claseTenue}`}`}>
                        {shortEmployeeName(nombre)}
                    </span>
                    <span className="flex-1 h-1.5 rounded-full bg-border-card overflow-hidden">
                        <span
                            className={`block h-full rounded-full ${isDark ? 'bg-chart-1' : 'bg-chart-1-solid'} ${yo ? '' : 'opacity-45'}`}
                            style={{ width: `${(parte / tope) * 100}%` }}
                        />
                    </span>
                    <span className={`text-caption tabular-nums w-10 text-right flex-shrink-0
                        ${yo ? 'font-black' : `font-semibold ${claseTenue}`}`}>
                        {parte.toFixed(1)}%
                    </span>
                </li>
            ))}
        </ul>
    );
}

/**
 * El cuerpo dibujado: las cifras (sólo para quien ve montos), el puesto de la
 * persona entre los vendedores de su sala (para todos), el listado de esos
 * vendedores (sólo para el jefe de sala) y el mes que empieza.
 *
 * Sin montos, el `body` del aviso se sigue mostrando tal cual —ya está escrito
 * en porcentaje— y acá se le suma nada más el puesto. Redactar una segunda
 * versión de esa frase sería copiar la regla que decide quién ve dólares, y la
 * copia es la que se queda vieja.
 */
export function CuerpoDeCierreDeMeta({ datos, claseTenue, isDark }) {
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

            <PuestoDelVendedor datos={datos} claseTenue={claseTenue} isDark={isDark} />

            {tabla?.length > 0 && (
                <TablaDeVendedores tabla={tabla} claseTenue={claseTenue} isDark={isDark} />
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

/* ── El podio de la empresa ────────────────────────────────────────────────
 * Los tres que más vendieron, con su cara. La foto no viaja en el aviso: viaja
 * la ficha, y la campana busca a la persona en el mismo store del que salen las
 * caras del resto del portal. Una URL firmada guardada en la metadata
 * expiraría, y una cruda no se puede mostrar.
 *
 * El orden es por venta total del mes. Conviene saber que eso premia a quien
 * más horas estuvo: el ranking del módulo de Metas tiene «por día» y «por hora»
 * justamente por eso —en agosto, Katherine Salinas quedaba 6ª por total y 1ª
 * por hora—. Un aviso no puede llevar un interruptor, y «los tres que más
 * vendieron» es lo que la frase significa en la sala. */
const MEDALLA = ['text-warning-text', 'text-content-2', 'text-content-3'];

function PodioDeLaEmpresa({ top3, buscarEmpleado, claseTenue }) {
    if (!top3?.length) return null;
    return (
        <ul className="flex flex-col gap-2">
            {top3.map((v, i) => {
                const emp = buscarEmpleado?.(v.employeeId) || { id: v.employeeId, name: v.nombre };
                return (
                    <li key={v.employeeId} className="flex items-center gap-2 min-w-0">
                        <span className={`text-caption font-black w-4 flex-shrink-0 tabular-nums ${MEDALLA[i] || ''}`}>
                            {i + 1}º
                        </span>
                        <AvatarConEstado emp={emp} px={26} radio="rounded-full" marco="" />
                        <span className="flex-1 min-w-0">
                            <span className="block text-caption font-black truncate">{shortEmployeeName(emp)}</span>
                            <span className={`block text-micro font-semibold truncate ${claseTenue}`}>{v.sala}</span>
                        </span>
                        {v.venta != null && (
                            <span className="text-caption font-black tabular-nums flex-shrink-0">
                                {formatMoney(v.venta)}
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * El cierre para administración: el global de la empresa, cada sucursal y el
 * podio de vendedores.
 *
 * El porcentaje del título es venta total sobre meta total, no el promedio de
 * los seis: promediar le daría el mismo peso a la sala que vende $14,345.77 que
 * a la que vende $50,354.03, y ése no es el cumplimiento de la empresa.
 */
export function CuerpoDeCierreDeEmpresa({ datos, claseTenue, isDark, buscarEmpleado }) {
    const { venta, meta, sucursales, top3 } = datos;

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

            {sucursales?.length > 0 && (
                <ul className="flex flex-col gap-1">
                    {sucursales.map(({ sala, pct }) => (
                        <li key={sala} className="flex items-center gap-2 min-w-0">
                            <span className={`text-caption font-semibold truncate w-24 flex-shrink-0 ${claseTenue}`}>
                                {sala}
                            </span>
                            <span className="flex-1 h-1.5 rounded-full bg-border-card overflow-hidden">
                                <span
                                    className={`block h-full rounded-full ${pct >= 100
                                        ? (isDark ? 'bg-success-text' : 'bg-success')
                                        : (isDark ? 'bg-warning-text' : 'bg-warning')}`}
                                    style={{ width: `${Math.min(pct, 130) / 130 * 100}%` }}
                                />
                            </span>
                            <span className="text-caption font-black tabular-nums w-12 text-right flex-shrink-0">
                                {pct.toFixed(1)}%
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {top3?.length > 0 && (
                <>
                    <div className="h-px bg-border-card" />
                    <p className={`text-caption font-black uppercase tracking-widest ${claseTenue}`}>
                        Los que más vendieron
                    </p>
                    <PodioDeLaEmpresa top3={top3} buscarEmpleado={buscarEmpleado} claseTenue={claseTenue} />
                </>
            )}
        </div>
    );
}
