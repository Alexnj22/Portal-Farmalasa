import React, { useEffect, useState } from 'react';
import {
    Check, TrendingDown, TrendingUp, CircleOff, Thermometer, SprayCan,
    ArrowRight, Truck, Store, Clock, SlidersHorizontal, ShoppingBag, Landmark,
} from 'lucide-react';
import AvatarConEstado from './AvatarConEstado';
import Badge from './Badge';
import { formatMoney } from '../../utils/formatNumber';
import { shortEmployeeName } from '../../utils/nameUtils';
import { hora12, rango12 } from '../../utils/hora';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { VENTANA_BITACORA_MIN, TRASLADOS_VISIBLES } from '../../utils/avisosDeOperacion';

/* Tres tarjetas de la campana para avisos de la operación del día: el corte de
 * caja, la bitácora por cerrarse y los traslados despachados por respaldo.
 *
 * Segunda vuelta, el mismo día (usuario, 23-sep): «no me parece que sean
 * modernos · falta quien hizo el corte · los 3 se ven solo puro texto, no se
 * ven estructurados · que salga ver más». La primera versión cambiaba el
 * párrafo por renglones de texto, que sigue siendo texto. Lo que las vuelve
 * tarjetas es la ESTRUCTURA, y las tres usan las mismas tres piezas:
 *
 *  · la PERSONA con su cara — quien hizo el corte, quien despachó;
 *  · un PANEL de datos en columnas — la cifra con su rótulo, no dentro de una
 *    frase;
 *  · y una LISTA de renglones con ícono cuando hay varios, que se despliega
 *    con «Ver los N» en vez de cortarse.
 *
 * El título dice el hecho y la tarjeta no lo repite («quita la 2ª línea, se
 * repite como el título»).
 */

const tonos = (isDark) => ({
    verde:   { texto: isDark ? 'text-success-text' : 'text-success', disco: 'bg-success/10', barra: 'bg-success', variante: 'success' },
    naranja: { texto: isDark ? 'text-warning-text' : 'text-warning', disco: 'bg-warning/10', barra: 'bg-warning', variante: 'warning' },
    rojo:    { texto: isDark ? 'text-danger-text'  : 'text-danger',  disco: 'bg-danger/10',  barra: 'bg-danger',  variante: 'danger' },
    gris:    { texto: 'text-text-muted', disco: 'bg-surface-card-hover', barra: 'bg-border-card', variante: 'neutral' },
    azul:    { texto: 'text-brand-text', disco: 'bg-brand/10', barra: 'bg-brand', variante: 'info' },
});

/* ── Las piezas comunes ─────────────────────────────────────────────────── */

const Disco = ({ tono, Icono }) => (
    <span className={`w-9 h-9 flex-shrink-0 mt-0.5 rounded-xl grid place-items-center ${tono.disco} ${tono.texto}`}
        aria-hidden="true">
        <Icono className="w-4 h-4" />
    </span>
);

/** Una píldora de estado —el `Badge` canónico—: el color responde antes que
 *  la palabra. */
const Pildora = ({ tono, icon, children }) => (
    <Badge variant={tono.variante} icon={icon}>{children}</Badge>
);

/** El panel de datos: columnas con rótulo arriba y cifra abajo. */
const Panel = ({ datos, claseTenue }) => (
    <div className="grid rounded-xl bg-surface-card-hover divide-x divide-border-card"
        style={{ gridTemplateColumns: `repeat(${datos.length}, minmax(0, 1fr))` }}>
        {datos.map((d) => (
            <div key={d.etiqueta} className="px-2.5 py-2 min-w-0">
                <p className={`text-caption font-semibold uppercase tracking-wide truncate ${claseTenue}`}>
                    {d.etiqueta}
                </p>
                <p className={`text-body-sm font-black tabular-nums truncate ${d.clase ?? ''}`}>{d.valor}</p>
            </div>
        ))}
    </div>
);

/* La persona de un aviso, con su cara.
 *
 * La ficha del store trae la foto ya firmada, pero esa lista está ACOTADA por
 * permisos: quien no estaba en ella salía con la inicial (usuario, 24-sep: «no
 * me da la foto del empleado»). Por eso el aviso trae la URL guardada
 * (`quien_foto`) y, si hace falta, se firma acá. `getSignedFileUrl` guarda las
 * firmas en caché, así que la misma cara en diez avisos es una sola firma. */
function useFotoFirmada(url, hace_falta) {
    const [firmada, setFirmada] = useState(null);
    useEffect(() => {
        if (!hace_falta || !url) return undefined;
        let vivo = true;
        getSignedFileUrl(url, 43200).then((u) => { if (vivo) setFirmada(u || null); }).catch(() => {});
        return () => { vivo = false; };
    }, [url, hace_falta]);
    return hace_falta && url ? firmada : null;
}

function usePersona(id, nombre, foto, buscarEmpleado) {
    const ficha = id ? (buscarEmpleado?.(id) || null) : null;
    const firmada = useFotoFirmada(foto, !ficha?.photo);
    if (ficha) return firmada ? { ...ficha, photo: firmada } : ficha;
    if (!id && !nombre) return null;
    return { ...(id ? { id } : {}), name: nombre, ...(firmada ? { photo: firmada } : {}) };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** «2026-09-22» → «22 sep». */
const fechaCorta = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]}` : null;
};
/** «15 – 22 sep», o «28 ago – 3 sep» si cruza de mes. */
const rangoDeFechas = (desde, hasta) => {
    const a = fechaCorta(desde);
    const b = fechaCorta(hasta);
    if (!a || !b || a === b) return a || b;
    return a.split(' ')[1] === b.split(' ')[1] ? `${a.split(' ')[0]} – ${b}` : `${a} – ${b}`;
};

/* ── El corte de caja ─────────────────────────────────────────────────────
 * Quién lo hizo y en qué sala; y en el panel, la diferencia de ESTE corte,
 * con color. Confirmar y Descartar los
 * pone la tarjeta general, debajo. */
const CORTE = {
    cuadra:     { tono: 'verde',   Icono: Check },
    sobra:      { tono: 'naranja', Icono: TrendingUp },
    falta:      { tono: 'rojo',    Icono: TrendingDown },
    sin_conteo: { tono: 'naranja', Icono: CircleOff },
};

export function InsigniaDeCorte({ datos, isDark }) {
    const c = CORTE[datos.estado];
    return <Disco tono={tonos(isDark)[c.tono]} Icono={c.Icono} />;
}

export function CuerpoDeCorte({ datos, claseTenue, isDark, buscarEmpleado }) {
    const c = CORTE[datos.estado];
    const tono = tonos(isDark)[c.tono];
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);

    /* Tercera vuelta (usuario, 23-sep: «siento too much, límpialo»): el
     * faltante se decía cuatro veces —título, píldora, ícono y panel—. Queda
     * UNA fila: quién y dónde a la izquierda, la diferencia a la derecha. El
     * color lo dice el número; el título quedó neutro. */
    // El número solo no decía qué era (usuario, 23-sep: «no dice faltante ni
    // sobrante»): arriba del monto va la palabra, chica y del mismo color.
    const diferencia = datos.estado === 'cuadra' ? '$0.00'
        : `${datos.tramo > 0 ? '+' : '−'}${formatMoney(Math.abs(datos.tramo))}`;
    const rotulo = { cuadra: 'Cuadró', sobra: 'Sobrante', falta: 'Faltante', sin_conteo: 'Sin conteo' }[datos.estado];

    /* Cuarta vuelta (23-sep: «se ve desalineado, usa mejor las columnas y
     * estructura»): dos columnas de DOS renglones cada una, en un panel, así
     * los renglones se alinean entre sí — quién/dónde a la izquierda, qué
     * pasó/cuánto a la derecha, separados por una línea. La columna derecha
     * tiene ancho FIJO: con `auto` la línea caía en otro sitio en cada tarjeta
     * según la palabra («Cuadró» contra «Sin conteo»). */
    return (
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_6.5rem] items-stretch rounded-xl
            bg-surface-card-hover divide-x divide-border-card">
            <div className="flex items-center gap-2 px-2.5 py-2 min-w-0">
                {emp ? (
                    <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" mostrarChip={false} />
                ) : (
                    <span aria-hidden="true" className={`w-7 h-7 rounded-full grid place-items-center flex-shrink-0
                        bg-surface-card ${claseTenue}`}>
                        <Store className="w-4 h-4" />
                    </span>
                )}
                {/* El rótulo arriba, como en la columna de la derecha: sin él
                    la cara no decía qué hizo esa persona (usuario, 23-sep). Es
                    quien HIZO el corte; confirmarlo es el paso que falta. */}
                <div className="min-w-0 leading-tight">
                    <p className={`text-caption font-black uppercase tracking-wide truncate ${claseTenue}`}>
                        Hizo el corte
                    </p>
                    <p className="text-body-sm font-bold truncate mt-0.5">
                        {/* La sala va en el título del aviso; acá sólo quién. */}
                        {/* Sin ficha ligada el portal no sabe quién fue: se dice así,
                            como en la tarjeta de aperturas, y no se inventa un nombre. */}
                        {emp ? shortEmployeeName(emp) : 'Desde la caja'}
                    </p>
                </div>
            </div>
            <div className={`flex flex-col justify-center items-end px-2.5 py-2 leading-tight ${tono.texto}`}>
                <span className="text-caption font-black uppercase tracking-wide">{rotulo}</span>
                {datos.estado !== 'sin_conteo' && (
                    <span className="text-body-lg font-black tracking-tight tabular-nums mt-0.5">{diferencia}</span>
                )}
            </div>
        </div>
    );
}

/* ── La bitácora por cerrarse ─────────────────────────────────────────────
 * Un reloj que se vacía: el arco y la barra son lo que queda de la ventana, y
 * se calculan al dibujar — leído tarde dice «Ya cerró». Debajo, un renglón por
 * área con lo que falta anotar y en qué franja. */
const R = 19;
const VUELTA = 2 * Math.PI * R;

const tonoDeBitacora = (d, isDark) => {
    const t = tonos(isDark);
    if (d.cerrada) return t.gris;
    return d.quedan <= 15 ? t.rojo : t.naranja;
};

export function RelojDeBitacora({ datos, isDark }) {
    const tono = tonoDeBitacora(datos, isDark);
    const avance = datos.cerrada ? 0 : Math.max(0, Math.min(datos.quedan / VENTANA_BITACORA_MIN, 1));
    return (
        <div className="relative w-9 h-9 flex-shrink-0 mt-0.5">
            <svg viewBox="0 0 46 46" className="w-full h-full" role="img"
                aria-label={datos.cerrada ? 'La franja ya cerró' : `Quedan ${datos.quedan} minutos`}>
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4" className="stroke-border-card" />
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    strokeLinecap="round" transform="rotate(-90 23 23)"
                    className={`${tono.texto} stroke-current`}
                    strokeDasharray={`${VUELTA * avance} ${VUELTA}`} />
            </svg>
            <span className={`absolute inset-0 grid place-items-center tabular-nums text-caption font-black ${tono.texto}`}
                aria-hidden="true">
                {datos.cerrada ? <CircleOff className="w-3.5 h-3.5" /> : datos.quedan}
            </span>
        </div>
    );
}

const TIPO_BITACORA = {
    lectura:  { Icono: Thermometer, rotulo: 'Temperatura' },
    limpieza: { Icono: SprayCan,    rotulo: 'Limpieza' },
};

export function CuerpoDeBitacora({ datos, claseTenue, isDark }) {
    const tono = tonoDeBitacora(datos, isDark);
    const { pendientes, detalle, areas } = datos;
    const avance = datos.cerrada ? 0 : Math.max(0, Math.min(datos.quedan / VENTANA_BITACORA_MIN, 1));
    /* Si todas las áreas comparten la franja —lo normal—, se dice una vez
       arriba y los renglones quedan con el nombre del área entero. */
    const franjas = new Set(detalle.map((d) => `${d.desde}|${d.hasta}`));
    const unaFranja = franjas.size === 1 && detalle[0]?.desde && detalle[0]?.hasta
        ? rango12(detalle[0].desde, detalle[0].hasta) : null;

    return (
        <div className="flex flex-col gap-2 mt-1.5">
            <div className="flex items-center gap-2">
                <span className={`flex-1 text-body-lg font-black tracking-tight tabular-nums ${tono.texto}`}>
                    {datos.cerrada ? 'Ya cerró' : `Quedan ${datos.quedan} min`}
                </span>
                <Pildora tono={tono}>
                    {pendientes === 1 ? '1 pendiente' : `${pendientes} pendientes`}
                </Pildora>
            </div>
            <span className="h-1.5 rounded-full bg-border-card overflow-hidden" aria-hidden="true">
                <span className={`block h-full rounded-full ${tono.barra}`} style={{ width: `${avance * 100}%` }} />
            </span>
            {unaFranja && (
                <span className={`text-caption font-semibold tabular-nums ${claseTenue}`}>Franja de {unaFranja}</span>
            )}

            {detalle.length > 0 ? (
                <ul className="rounded-xl bg-surface-card-hover divide-y divide-border-card">
                    {detalle.map((d, i) => {
                        const t = TIPO_BITACORA[d.tipo] ?? TIPO_BITACORA.lectura;
                        return (
                            <li key={`${d.area}-${d.tipo}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                                <t.Icono className={`w-3.5 h-3.5 flex-shrink-0 ${tono.texto}`} aria-hidden="true" />
                                <span className="flex-1 min-w-0 truncate text-caption font-bold">{d.area}</span>
                                <span className={`flex-shrink-0 text-caption font-semibold tabular-nums ${claseTenue}`}>
                                    {t.rotulo}{!unaFranja && d.desde && d.hasta ? ` · ${rango12(d.desde, d.hasta)}` : ''}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            ) : areas.length > 0 && (
                <ul className="rounded-xl bg-surface-card-hover divide-y divide-border-card">
                    {areas.map((a) => (
                        <li key={a} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                            <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${tono.texto}`} aria-hidden="true" />
                            <span className="flex-1 min-w-0 truncate text-caption font-bold">{a}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/* ── Los traslados por respaldo ───────────────────────────────────────────
 * El panel resume cuántos, cuántas unidades y a cuántas salas. Debajo, un
 * renglón por traslado con la cara de quien lo despachó: qué salió, a dónde y
 * a qué hora. Se ven los primeros; el resto se despliega con «Ver los N
 * traslados» — el botón lo pone la tarjeta general. */
export function InsigniaDeTraslados({ isDark }) {
    return <Disco tono={tonos(isDark).naranja} Icono={Truck} />;
}

/* Un renglón de traslado es su propio componente: la cara se firma con un
 * hook, y los hooks no pueden vivir dentro de un `map`. */
function FilaDeTraslado({ t, claseTenue, naranja, buscarEmpleado }) {
    const emp = usePersona(t.quienId, t.quien, t.quienFoto, buscarEmpleado);
    const hora = hora12(t.hora);
    return (
        <li className="flex items-center gap-2 px-2.5 py-2 min-w-0">
            {emp ? (
                <AvatarConEstado emp={emp} px={24} radio="rounded-full" marco="" mostrarChip={false} />
            ) : (
                <span aria-hidden="true" className={`w-6 h-6 rounded-full grid place-items-center flex-shrink-0
                    ${naranja.disco} ${naranja.texto}`}>
                    <Truck className="w-3 h-3" />
                </span>
            )}
            <div className="flex-1 min-w-0 leading-tight">
                <p className="text-caption font-bold truncate">
                    {t.producto ?? 'Traslado'}{t.mas > 0 ? ` y ${t.mas} más` : ''}
                </p>
                {/* El destino primero: es lo que la sala tiene que ir a
                    comprobar. El nombre va último y es lo que se recorta — la
                    cara ya dice quién fue. */}
                <p className={`text-caption font-semibold truncate flex items-center gap-1 ${claseTenue}`}>
                    <ArrowRight className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    <span className="flex-shrink-0">{t.destino}</span>
                    {hora && <span className="tabular-nums flex-shrink-0">· {hora}</span>}
                    {emp && <span className="truncate">· {shortEmployeeName(emp)}</span>}
                </p>
            </div>
            {t.unidades != null && (
                <Pildora tono={naranja}>×{t.unidades}</Pildora>
            )}
        </li>
    );
}

export function CuerpoDeTraslados({ datos, claseTenue, isDark, buscarEmpleado, expandida }) {
    const { traslados, unidades } = datos;
    const visibles = expandida ? traslados : traslados.slice(0, TRASLADOS_VISIBLES);
    const salas = new Set(traslados.map((t) => t.destino)).size;
    const naranja = tonos(isDark).naranja;

    return (
        <div className="flex flex-col gap-2 mt-1.5">
            <Panel claseTenue={claseTenue} datos={[
                { etiqueta: 'Traslados', valor: traslados.length },
                { etiqueta: 'Unidades', valor: unidades },
                { etiqueta: salas === 1 ? 'Sala' : 'Salas', valor: salas },
            ]} />
            <ul className="rounded-xl bg-surface-card-hover divide-y divide-border-card">
                {visibles.map((t, i) => (
                    <FilaDeTraslado key={t.id ?? i} t={t} claseTenue={claseTenue} naranja={naranja}
                        buscarEmpleado={buscarEmpleado} />
                ))}
            </ul>
        </div>
    );
}

/* ── Segunda tanda (23-sep): MIN·MAX, bolsa que no cuadró y depósito ───────
 * Con la receta que el usuario aprobó en la de corte: un panel de columnas,
 * cada una con su RÓTULO arriba y su DATO abajo, alineadas; y el título del
 * aviso no se repite adentro. La grilla usa `gap-px` sobre el color del borde:
 * así las líneas entre celdas salen solas en 2 o en 3 columnas. */

const Grilla = ({ columnas, children }) => (
    <div className="mt-2 grid gap-px rounded-xl overflow-hidden bg-border-card"
        style={{ gridTemplateColumns: columnas }}>
        {children}
    </div>
);

const Celda = ({ rotulo, children, clase = '', claseTenue, derecha = false }) => (
    <div className={`bg-surface-card-hover px-2.5 py-2 min-w-0 leading-tight flex flex-col justify-center
        ${derecha ? 'items-end text-right' : ''} ${clase}`}>
        <span className={`text-caption font-black uppercase tracking-wide truncate max-w-full
            ${clase ? '' : claseTenue}`}>{rotulo}</span>
        <span className="text-body-sm font-bold tabular-nums truncate max-w-full mt-0.5">{children}</span>
    </div>
);

/* La persona ocupa su propio renglón a todo el ancho: en una columna angosta
 * el nombre se cortaba («Kevin …», «Celina Esc…»). */
const CeldaPersona = ({ emp, rotulo, respaldo, claseTenue }) => (
    <div className="bg-surface-card-hover flex items-center gap-2 px-2.5 py-2 min-w-0" style={{ gridColumn: '1 / -1' }}>
        {emp ? (
            <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" mostrarChip={false} />
        ) : (
            <span aria-hidden="true" className={`w-7 h-7 rounded-full grid place-items-center flex-shrink-0
                bg-surface-card ${claseTenue}`}>
                <Store className="w-3.5 h-3.5" />
            </span>
        )}
        <div className="min-w-0 leading-tight">
            <p className={`text-caption font-black uppercase tracking-wide truncate ${claseTenue}`}>{rotulo}</p>
            <p className="text-body-sm font-bold truncate mt-0.5">{emp ? shortEmployeeName(emp) : respaldo}</p>
        </div>
    </div>
);

/* ── MIN·MAX por aprobar ──────────────────────────────────────────────────
 * Tercera vuelta (usuario, 24-sep): «necesito ver las ventas de los últimos 6
 * meses, y del último mes» y «la nota/motivo, se debe entender mejor qué es
 * eso». Arriba el producto y quién lo pide; después las ventas de la sala mes a
 * mes —barras, con el último mes cerrado resaltado—; Hoy contra Propone; y el
 * motivo en su propia celda, con su rótulo. Aprobar y Rechazar los pone la
 * tarjeta general, debajo. */
const minmax = (min, max) => (min == null && max == null
    ? 'Sin definir'
    : `MIN ${min ?? '—'} · MAX ${max ?? '—'}`);

const unidades = (n) => (n == null ? '—' : Number(n).toLocaleString('es-SV', { maximumFractionDigits: 2 }));

export function InsigniaDeMinmax({ isDark }) {
    return <Disco tono={tonos(isDark).azul} Icono={SlidersHorizontal} />;
}

function VentasPorMes({ meses, mesCurso, existencia, claseTenue, azul }) {
    const tope = Math.max(1, ...meses.map((m) => m.unidades));
    const total = meses.reduce((s, m) => s + m.unidades, 0);
    return (
        <div className="bg-surface-card-hover px-2.5 py-2" style={{ gridColumn: '1 / -1' }}>
            <div className="flex items-baseline justify-between gap-2">
                <span className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                    Vendido · últimos 6 meses
                </span>
                <span className="text-body-sm font-black tabular-nums">{unidades(total)} u.</span>
            </div>
            <div className="mt-2 grid grid-cols-6 gap-1.5 items-end h-16" aria-hidden="true">
                {meses.map((m, i) => {
                    const ultimo = i === meses.length - 1;
                    return (
                        <div key={m.ym} className="flex flex-col items-center justify-end h-full min-w-0">
                            <span className={`text-caption tabular-nums font-bold ${ultimo ? azul.texto : claseTenue}`}>
                                {unidades(m.unidades)}
                            </span>
                            <span className={`w-full rounded-t-sm mt-0.5 ${ultimo ? azul.barra : 'bg-border-card'}`}
                                style={{ height: `${Math.max(3, (m.unidades / tope) * 36)}px` }} />
                        </div>
                    );
                })}
            </div>
            <div className="mt-1 grid grid-cols-6 gap-1.5">
                {meses.map((m, i) => (
                    <span key={m.ym} className={`text-center text-caption font-semibold uppercase
                        ${i === meses.length - 1 ? azul.texto : claseTenue}`}>
                        {MESES[Number(m.ym.slice(5, 7)) - 1]}
                    </span>
                ))}
            </div>
            {(mesCurso != null || existencia != null) && (
                <p className={`mt-1.5 text-caption font-semibold ${claseTenue}`}>
                    {mesCurso != null && <>Este mes van <b className="font-black">{unidades(mesCurso)} u.</b></>}
                    {mesCurso != null && existencia != null && ' · '}
                    {existencia != null && <>Hay <b className="font-black">{unidades(existencia)} u.</b> en la sala</>}
                </p>
            )}
            <span className="sr-only">
                {meses.map((m) => `${MESES[Number(m.ym.slice(5, 7)) - 1]}: ${unidades(m.unidades)}`).join(', ')}
            </span>
        </div>
    );
}

export function CuerpoDeMinmax({ datos, claseTenue, isDark, buscarEmpleado }) {
    const azul = tonos(isDark).azul;
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    return (
        <div className="mt-1">
            {datos.producto && (
                <p className="text-body-sm font-bold line-clamp-2">{datos.producto}</p>
            )}
            <Grilla columnas="minmax(0,1fr) minmax(0,1fr)">
                <CeldaPersona emp={emp} rotulo="Lo pide" respaldo="Sin nombre" claseTenue={claseTenue} />
                {datos.ventasMeses.length > 0 && (
                    <VentasPorMes meses={datos.ventasMeses} mesCurso={datos.ventasMesCurso}
                        existencia={datos.existencia} claseTenue={claseTenue} azul={azul} />
                )}
                <Celda rotulo="Hoy" claseTenue={claseTenue}>{minmax(datos.minHoy, datos.maxHoy)}</Celda>
                <Celda rotulo="Propone" clase={azul.texto} derecha>{minmax(datos.minNuevo, datos.maxNuevo)}</Celda>
                {datos.motivo && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                        <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                            Por qué lo pide
                        </p>
                        <p className="text-body-sm font-semibold mt-0.5 line-clamp-3 first-letter:uppercase lowercase">
                            {datos.motivo}
                        </p>
                    </div>
                )}
            </Grilla>
        </div>
    );
}

/* ── Bolsa que no cuadró ──────────────────────────────────────────────────
 * Cada bolsa con su fecha y su diferencia (FALTÓ en rojo, SOBRÓ en naranja);
 * con varias, el neto al pie; y abajo quién confirmó el conteo, con su cara
 * (usuario, 24-sep: «que ponga de qué fecha es la bolsa, y quién la
 * confirmó»). */
const difDeBolsa = (dif, isDark) => {
    const t = tonos(isDark);
    return dif < 0
        ? { rotulo: 'Faltó', clase: t.rojo.texto, valor: `−${formatMoney(Math.abs(dif))}` }
        : { rotulo: 'Sobró', clase: t.naranja.texto, valor: `+${formatMoney(dif)}` };
};

export function InsigniaDeBolsa({ datos, isDark }) {
    const t = tonos(isDark);
    return <Disco tono={datos.neto < 0 ? t.rojo : t.naranja} Icono={ShoppingBag} />;
}

export function CuerpoDeBolsa({ datos, claseTenue, isDark, buscarEmpleado }) {
    const quien = usePersona(datos.confirmoId, datos.confirmo, datos.confirmoFoto, buscarEmpleado);
    const neto = difDeBolsa(datos.neto, isDark);
    const varias = datos.lista.length > 1;
    return (
        <Grilla columnas="minmax(0,1fr) 7rem">
            {datos.lista.map((b) => {
                const d = difDeBolsa(b.dif, isDark);
                const fecha = fechaCorta(b.fecha);
                return (
                    <React.Fragment key={b.folio}>
                        <Celda rotulo={fecha ? `Bolsa del ${fecha}` : 'Bolsa'} claseTenue={claseTenue}>{b.folio}</Celda>
                        <Celda rotulo={d.rotulo} clase={d.clase} derecha>{d.valor}</Celda>
                    </React.Fragment>
                );
            })}
            {varias && (
                <>
                    <Celda rotulo="En total" claseTenue={claseTenue}>
                        {datos.lista.length} bolsas
                    </Celda>
                    <Celda rotulo={neto.rotulo} clase={neto.clase} derecha>{neto.valor}</Celda>
                </>
            )}
            {(quien || datos.confirmo) && (
                <CeldaPersona emp={quien} rotulo="Confirmó el conteo" respaldo={datos.confirmo ?? 'Sin nombre'}
                    claseTenue={claseTenue} />
            )}
        </Grilla>
    );
}

/* ── Depósito al banco ────────────────────────────────────────────────────
 * Tercera vuelta (usuario, 24-sep): el monto va GRANDE en el cuerpo y no en el
 * título; «Bolsas: 50» no decía nada —ahora es de qué fecha a qué fecha son
 * las bolsas—; y «Sin salir» pasa a «Quedó en efectivo». La persona con su
 * cara en su propio renglón; en el teléfono todo va en dos columnas. */
export function InsigniaDeDeposito({ isDark }) {
    return <Disco tono={tonos(isDark).verde} Icono={Landmark} />;
}

export function CuerpoDeDeposito({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const banco = (datos.banco ?? '').replace(/^Banco\s+/i, '');
    const rango = rangoDeFechas(datos.desde, datos.hasta);
    return (
        <div className="mt-1">
            <div className="flex flex-col gap-0.5">
                {datos.montoBanco > 0 && (
                    <p className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-title-sm font-black tracking-tight tabular-nums ${t.verde.texto}`}>
                            {formatMoney(datos.montoBanco)}
                        </span>
                        <span className={`text-body-sm font-semibold ${claseTenue}`}>
                            al banco{banco ? ` · ${banco}` : ''}
                        </span>
                    </p>
                )}
                {datos.montoEfectivo > 0 && (
                    <p className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-title-sm font-black tracking-tight tabular-nums ${t.verde.texto}`}>
                            {formatMoney(datos.montoEfectivo)}
                        </span>
                        <span className={`text-body-sm font-semibold ${claseTenue}`}>
                            en mano{datos.entregadoA ? ` a ${datos.entregadoA}` : ''}
                        </span>
                    </p>
                )}
            </div>
            {/* La derecha mide lo que su rótulo: «Quedó en efectivo» no cabía en
                media tarjeta del teléfono. */}
            <Grilla columnas="minmax(0,1fr) auto">
                <CeldaPersona emp={emp} rotulo={datos.quienLleva ? 'Lo lleva' : 'Lo cerró'}
                    respaldo="Sin nombre" claseTenue={claseTenue} />
                <Celda rotulo="Conteo del" claseTenue={claseTenue}>
                    {rango ?? '—'}
                </Celda>
                <Celda rotulo="Quedó en efectivo" clase={datos.remanente >= 0.01 ? t.naranja.texto : t.verde.texto} derecha>
                    {datos.remanente >= 0.01 ? formatMoney(datos.remanente) : 'Nada'}
                </Celda>
            </Grilla>
        </div>
    );
}
