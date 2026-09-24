import React, { useEffect, useState } from 'react';
import {
    Check, TrendingDown, TrendingUp, CircleOff, Thermometer, SprayCan,
    ArrowRight, Truck, Store, Clock, SlidersHorizontal, ShoppingBag, Landmark,
    FileWarning, ReceiptText, ClipboardCheck, Package, PackageCheck, PackageX,
    FileX, CreditCard, UserRound, Users, Wallet, HandCoins, ArrowLeftRight, PackagePlus, Trash2, CalendarDays,
    Undo2, Scale, X, Tag, Target, RotateCcw,
} from 'lucide-react';
import AvatarConEstado from './AvatarConEstado';
import Badge from './Badge';
import { formatMoney } from '../../utils/formatNumber';
import { shortEmployeeName } from '../../utils/nameUtils';
import { hora12, rango12, fechaHora12 } from '../../utils/hora';
import { getSignedFileUrl } from '../../utils/storageFiles';
import { fetchFotoDeEmpleado } from '../../data/notifications';
import { decidirDiferencia } from '../../data/diferencias';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useToastStore } from '../../store/toastStore';
import Button from './Button';
import PortalInput from './PortalInput';
import { VENTANA_BITACORA_MIN, TRASLADOS_VISIBLES, ETAPAS_DE_PEDIDO } from '../../utils/avisosDeOperacion';

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

/** Las cifras de resumen en una línea que se envuelve: «3 traslados · 6
 *  unidades · 2 salas». En columnas fijas, a 320 px el rótulo se partía a la
 *  mitad de la palabra («TRASL/ADOS»); así cada cifra baja entera. */
const Panel = ({ datos, claseTenue }) => (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl bg-surface-card-hover px-2.5 py-2">
        {datos.map((d) => (
            <span key={d.etiqueta} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                <span className={`text-body font-black tabular-nums ${d.clase ?? ''}`}>{d.valor}</span>
                <span className={`text-caption font-semibold ${claseTenue}`}>{d.etiqueta}</span>
            </span>
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

/* Si el aviso no trajo la foto (el conductor de un pedido, un aviso viejo) y
 * la persona no está en la lista, se le pregunta a la base por su id. */
function useFotoGuardada(id, foto, hace_falta) {
    const [leida, setLeida] = useState(null);
    useEffect(() => {
        if (!hace_falta || foto || !id) return undefined;
        let vivo = true;
        fetchFotoDeEmpleado(id).then((u) => { if (vivo) setLeida(u); });
        return () => { vivo = false; };
    }, [id, foto, hace_falta]);
    return foto || (hace_falta ? leida : null);
}

function usePersona(id, nombre, foto, buscarEmpleado) {
    const ficha = id ? (buscarEmpleado?.(id) || null) : null;
    const guardada = useFotoGuardada(id, foto, !ficha?.photo);
    const firmada = useFotoFirmada(guardada, !ficha?.photo);
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
                    <p className={`text-caption font-black uppercase tracking-wide break-words ${claseTenue}`}>
                        Hizo el corte
                    </p>
                    <p className="text-body-sm font-bold break-words mt-0.5">
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
                            // El tipo va DEBAJO del área y no a su derecha: a 320 px
                            // el nombre del área se partía («Refrigera/dor»).
                            <li key={`${d.area}-${d.tipo}-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                                <t.Icono className={`w-3.5 h-3.5 flex-shrink-0 ${tono.texto}`} aria-hidden="true" />
                                <div className="flex-1 min-w-0 leading-tight">
                                    <p className="text-caption font-bold break-words">{d.area}</p>
                                    <p className={`text-caption font-semibold tabular-nums ${claseTenue}`}>
                                        {t.rotulo}{!unaFranja && d.desde && d.hasta ? ` · ${rango12(d.desde, d.hasta)}` : ''}
                                    </p>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : areas.length > 0 && (
                <ul className="rounded-xl bg-surface-card-hover divide-y divide-border-card">
                    {areas.map((a) => (
                        <li key={a} className="flex items-center gap-2 px-2.5 py-1.5 min-w-0">
                            <Clock className={`w-3.5 h-3.5 flex-shrink-0 ${tono.texto}`} aria-hidden="true" />
                            <span className="flex-1 min-w-0 break-words text-caption font-bold">{a}</span>
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
                <p className="text-caption font-bold break-words">
                    {t.producto ?? 'Traslado'}{t.mas > 0 ? ` y ${t.mas} más` : ''}
                </p>
                {/* El destino primero: es lo que la sala tiene que ir a
                    comprobar. El nombre va último y es lo que se recorta — la
                    cara ya dice quién fue. */}
                <p className={`text-caption font-semibold flex flex-wrap items-center gap-1 ${claseTenue}`}>
                    <ArrowRight className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    <span className="flex-shrink-0">{t.destino}</span>
                    {hora && <span className="tabular-nums flex-shrink-0">· {hora}</span>}
                    {emp && <span className="break-words">· {shortEmployeeName(emp)}</span>}
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
                { etiqueta: traslados.length === 1 ? 'traslado' : 'traslados', valor: traslados.length },
                { etiqueta: unidades === 1 ? 'unidad' : 'unidades', valor: unidades },
                { etiqueta: salas === 1 ? 'sala' : 'salas', valor: salas },
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

/* Una sola columna es `minmax(0, 1fr)` y no `1fr`: con `1fr` la columna crece
 * hasta el ancho mínimo de su contenido, y una pieza que no se parte (un monto,
 * un rótulo) la ensanchaba más allá de la tarjeta — la grilla recorta lo que
 * sobra y el dato quedaba cortado sin que nada lo avisara (24-sep). */
const Grilla = ({ columnas, children }) => (
    <div className="mt-2 grid gap-px rounded-xl overflow-hidden bg-border-card"
        style={{ gridTemplateColumns: columnas === '1fr' ? 'minmax(0, 1fr)' : columnas }}>
        {children}
    </div>
);

/* Nada se recorta con «…»: el texto que no entra baja de renglón (usuario,
 * 24-sep: «responsive sin cortar»). Un dato cortado en el teléfono es un dato
 * que no se ve, y ninguna prueba lo marca. */
/* `apilable`: la celda vive en una grilla que se apila cuando no entra. Apilada
 * va CENTRADA (usuario, 24-sep: «en angosto, que queden en 2 filas pero
 * centradas»); con espacio para dos columnas vuelve a su lado. El corte sale
 * del ancho del panel —container query, `@container` en el padre—, no de la
 * pantalla: la misma tarjeta vive en la campana y en el historial. 15.1rem son
 * las dos columnas de 7.5rem más la línea entre ellas. */
const Celda = ({ rotulo, children, clase = '', claseTenue, derecha = false, apilable = false, sola = false }) => (
    /* `sola`: ocupa toda la fila. Una celda sin pareja en una grilla de dos
     * columnas deja media fila vacía (24-sep). */
    <div style={sola ? { gridColumn: '1 / -1' } : undefined}
        className={`bg-surface-card-hover px-2.5 py-2 min-w-0 leading-tight flex flex-col justify-center
        ${apilable
            ? `items-center text-center ${derecha
                ? '@min-[15.1rem]:items-end @min-[15.1rem]:text-right'
                : '@min-[15.1rem]:items-start @min-[15.1rem]:text-left'}`
            : (derecha ? 'items-end text-right' : '')} ${clase}`}>
        <span className={`text-caption font-black uppercase tracking-wide break-words max-w-full
            ${clase ? '' : claseTenue}`}>{rotulo}</span>
        <span className="text-body-sm font-bold tabular-nums break-words max-w-full mt-0.5">{children}</span>
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
            <p className={`text-caption font-black uppercase tracking-wide break-words ${claseTenue}`}>{rotulo}</p>
            <p className="text-body-sm font-bold break-words mt-0.5">{emp ? shortEmployeeName(emp) : respaldo}</p>
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

/* «Pedí la venta total de los 6 meses, y la del último mes; no la de cada mes»
 * (usuario, 24-sep). Dos cifras lado a lado, y debajo lo que va del mes y lo
 * que hay en la sala. El último mes es el último CERRADO y lleva su nombre. */
function Ventas({ meses, mesCurso, existencia, claseTenue, azul }) {
    const total = meses.reduce((s, m) => s + m.unidades, 0);
    const ultimo = meses[meses.length - 1];
    const nombre = ultimo ? MESES[Number(ultimo.ym.slice(5, 7)) - 1] : null;
    return (
        <>
            <Celda rotulo="En 6 meses" claseTenue={claseTenue}>{unidades(total)} u.</Celda>
            <Celda rotulo="Último mes" clase={azul.texto} derecha>
                {unidades(ultimo?.unidades ?? 0)} u.{nombre && <span className="font-semibold"> · {nombre}</span>}
            </Celda>
            {(mesCurso != null || existencia != null) && (
                <div className="bg-surface-card-hover px-2.5 py-1.5" style={{ gridColumn: '1 / -1' }}>
                    <p className={`text-caption font-semibold ${claseTenue}`}>
                        {mesCurso != null && <>Este mes van <b className="font-black">{unidades(mesCurso)} u.</b></>}
                        {mesCurso != null && existencia != null && ' · '}
                        {existencia != null && <>Hay <b className="font-black">{unidades(existencia)} u.</b> en la sala</>}
                    </p>
                </div>
            )}
        </>
    );
}

/* El motivo se escribe como sale del teclado —a veces TODO EN MAYÚSCULAS—:
 * se muestra en oración, con la primera en mayúscula. */
const enOracion = (t) => {
    const s = String(t ?? '').trim().toLowerCase();
    return s ? s[0].toUpperCase() + s.slice(1) : s;
};

export function CuerpoDeMinmax({ datos, claseTenue, isDark, buscarEmpleado }) {
    const azul = tonos(isDark).azul;
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    return (
        <Grilla columnas="minmax(0,1fr) minmax(0,1fr)">
            {/* El producto DENTRO del panel y grande: es de lo que se trata la
                solicitud (usuario, 24-sep: «intégralo en el cuerpo para que se
                note más»). */}
            {datos.producto && (
                <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                    <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Producto</p>
                    <p className={`text-body font-black break-words mt-0.5 ${azul.texto}`}>{datos.producto}</p>
                </div>
            )}
            <CeldaPersona emp={emp} rotulo="Lo pide" respaldo="Sin nombre" claseTenue={claseTenue} />
            {datos.ventasMeses.length > 0 && (
                <Ventas meses={datos.ventasMeses} mesCurso={datos.ventasMesCurso}
                    existencia={datos.existencia} claseTenue={claseTenue} azul={azul} />
            )}
            <Celda rotulo="Hoy" claseTenue={claseTenue}>{minmax(datos.minHoy, datos.maxHoy)}</Celda>
            <Celda rotulo="Propone" clase={azul.texto} derecha>{minmax(datos.minNuevo, datos.maxNuevo)}</Celda>
            {datos.motivo && (
                <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                    <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                        Por qué lo pide
                    </p>
                    <p className="text-body-sm font-semibold mt-0.5 break-words">{enOracion(datos.motivo)}</p>
                </div>
            )}
        </Grilla>
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
        <Grilla columnas="minmax(0,1fr) auto">
            {datos.lista.map((b) => {
                const d = difDeBolsa(b.dif, isDark);
                const fecha = fechaCorta(b.fecha);
                return (
                    <React.Fragment key={b.folio}>
                        {/* Tres renglones: qué bolsa, y de qué día y qué corte es
                            (24-sep: «pon la hora del corte de esa bolsa»). En uno
                            solo no entraba en el teléfono. */}
                        <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-tight">
                            <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Bolsa del corte</p>
                            <p className="text-body-sm font-bold tabular-nums break-words mt-0.5">{b.folio}</p>
                            {(fecha || b.hora) && (
                                <p className={`text-caption font-semibold break-words mt-0.5 ${claseTenue}`}>
                                    {[fecha, b.hora && hora12(b.hora)].filter(Boolean).join(' · ')}
                                </p>
                            )}
                        </div>
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
            {/* Dos columnas cuando entran y APILADAS cuando no (usuario, 24-sep:
                «responsive sin cortar» y, al ver que en escritorio también se
                apilaban, «se debe adaptar según el tamaño, no siempre»). 7.5rem
                por columna: dos entran desde ~240 px de panel —escritorio y un
                teléfono de 390— y se apilan a 320. */}
            <div className="@container">
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                <CeldaPersona emp={emp} rotulo={datos.quienLleva ? 'Lo lleva' : 'Lo cerró'}
                    respaldo="Sin nombre" claseTenue={claseTenue} />
                <Celda rotulo="Conteo del" claseTenue={claseTenue} apilable>
                    {rango ?? '—'}
                </Celda>
                <Celda rotulo="Quedó en efectivo" clase={datos.remanente >= 0.01 ? t.naranja.texto : t.verde.texto}
                    derecha apilable>
                    {datos.remanente >= 0.01 ? formatMoney(datos.remanente) : 'Nada'}
                </Celda>
            </Grilla>
            </div>
        </div>
    );
}

/* ── Tercera tanda (24-sep): alerta de CCF, factura de sala y cortes sin
 * confirmar ─────────────────────────────────────────────────────────────── */

/* La alerta de CCF. El título dice la sala y qué le pasa; la tarjeta dice DE
 * QUÉ factura se trata —número, cliente, monto, hora— y quién la vendió, con su
 * cara. Antes decía «CCF 0000000042_CCF está pendiente de recibir MH». */
export function InsigniaDeAlertaDeVentas({ datos, isDark }) {
    const t = tonos(isDark);
    return <Disco tono={datos.tipo === 'consecutive_mh' ? t.naranja : t.rojo} Icono={FileWarning} />;
}

export function CuerpoDeAlertaDeVentas({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const emp = usePersona(datos.vendedorId, datos.vendedor, datos.vendedorFoto, buscarEmpleado);
    const tono = datos.tipo === 'consecutive_mh' ? t.naranja : t.rojo;
    return (
        <div className="@container">
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                {datos.tipo === 'consecutive_mh' ? (
                    <>
                        <Celda rotulo="Ventas seguidas" clase={tono.texto} apilable>{datos.seguidas ?? '—'}</Celda>
                        <Celda rotulo="Desde la" claseTenue={claseTenue} derecha apilable>N.º {datos.numero}</Celda>
                    </>
                ) : (
                    <>
                        <Celda rotulo="CCF" claseTenue={claseTenue} apilable>N.º {datos.numero}</Celda>
                        <Celda rotulo="Monto" clase={tono.texto} derecha apilable>
                            {datos.total != null ? formatMoney(datos.total) : '—'}
                        </Celda>
                    </>
                )}
                {datos.cliente && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                        <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                            Cliente{datos.hora ? ` · ${hora12(datos.hora)}` : ''}
                        </p>
                        <p className="text-body-sm font-bold break-words mt-0.5">{datos.cliente}</p>
                    </div>
                )}
                {datos.problemas.length > 0 && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                        <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Qué tiene</p>
                        <p className={`text-body-sm font-bold break-words mt-0.5 ${tono.texto}`}>
                            {datos.problemas.join(' · ')}
                        </p>
                    </div>
                )}
                {emp && <CeldaPersona emp={emp} rotulo="La vendió" respaldo="Sin nombre" claseTenue={claseTenue} />}
            </Grilla>
        </div>
    );
}

/* Factura de sala: una fila por factura —qué, de qué fecha y cuánto— y el
 * total al pie. Antes el cuerpo repetía «Recarga Movistar · $99.99» por cada
 * una. */
export function InsigniaDeFacturaDeSala({ isDark }) {
    return <Disco tono={tonos(isDark).azul} Icono={ReceiptText} />;
}

export function CuerpoDeFacturaDeSala({ datos, claseTenue }) {
    const varias = datos.lista.length > 1;
    return (
        <ul className="mt-2 rounded-xl bg-surface-card-hover divide-y divide-border-card">
            {datos.lista.map((f, i) => (
                <li key={`${f.etiqueta}-${i}`} className="flex items-center justify-between gap-3 px-2.5 py-2">
                    <div className="min-w-0 leading-tight">
                        <p className="text-body-sm font-bold break-words">{f.etiqueta}</p>
                        {f.fecha && <p className={`text-caption font-semibold mt-0.5 ${claseTenue}`}>{fechaCorta(f.fecha)}</p>}
                    </div>
                    <span className="flex-shrink-0 text-body-sm font-black tabular-nums">
                        {f.monto != null ? formatMoney(f.monto) : '—'}
                    </span>
                </li>
            ))}
            {varias && (
                <li className="flex items-center justify-between gap-3 px-2.5 py-2">
                    <span className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>En total</span>
                    <span className="text-body font-black tabular-nums">{formatMoney(datos.total)}</span>
                </li>
            )}
        </ul>
    );
}

/* Cortes sin confirmar: un renglón por corte con quién lo hizo, de qué día y
 * a qué hora, y cómo quedó (FALTANTE / SOBRANTE / CUADRÓ / SIN CONTEO), igual
 * que la tarjeta del corte. Antes decía «2 del 05/09». */
const estadoDeTramo = (c) => (c.sinConteo ? 'sin_conteo'
    : c.tramo <= -0.01 ? 'falta' : c.tramo >= 0.01 ? 'sobra' : 'cuadra');
const ROTULO_DE_CORTE = { cuadra: 'Cuadró', sobra: 'Sobrante', falta: 'Faltante', sin_conteo: 'Sin conteo' };

function FilaDeCortePendiente({ c, claseTenue, isDark, buscarEmpleado }) {
    const emp = usePersona(c.quienId, c.quien, c.quienFoto, buscarEmpleado);
    const estado = estadoDeTramo(c);
    const tono = tonos(isDark)[CORTE[estado].tono];
    const cuando = [fechaCorta(c.fecha), hora12(c.hora)].filter(Boolean).join(' · ');
    return (
        <li className="flex items-center gap-2 px-2.5 py-2 min-w-0">
            {emp ? (
                <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" mostrarChip={false} />
            ) : (
                <span aria-hidden="true" className={`w-7 h-7 rounded-full grid place-items-center flex-shrink-0
                    bg-surface-card ${claseTenue}`}>
                    <Store className="w-3.5 h-3.5" />
                </span>
            )}
            <div className="flex-1 min-w-0 leading-tight">
                <p className="text-body-sm font-bold break-words">{emp ? shortEmployeeName(emp) : 'Desde la caja'}</p>
                <p className={`text-caption font-semibold mt-0.5 ${claseTenue}`}>{cuando}</p>
            </div>
            <div className={`flex-shrink-0 flex flex-col items-end leading-tight ${tono.texto}`}>
                <span className="text-caption font-black uppercase tracking-wide">{ROTULO_DE_CORTE[estado]}</span>
                {estado !== 'sin_conteo' && (
                    <span className="text-body-sm font-black tabular-nums mt-0.5">
                        {estado === 'cuadra' ? '$0.00' : `${c.tramo > 0 ? '+' : '−'}${formatMoney(Math.abs(c.tramo))}`}
                    </span>
                )}
            </div>
        </li>
    );
}

export function InsigniaDeCortesPendientes({ isDark }) {
    return <Disco tono={tonos(isDark).naranja} Icono={ClipboardCheck} />;
}

export function CuerpoDeCortesPendientes({ datos, claseTenue, isDark, buscarEmpleado }) {
    return (
        <ul className="mt-2 rounded-xl bg-surface-card-hover divide-y divide-border-card">
            {datos.lista.map((c) => (
                <FilaDeCortePendiente key={c.id} c={c} claseTenue={claseTenue} isDark={isDark}
                    buscarEmpleado={buscarEmpleado} />
            ))}
        </ul>
    );
}

/* ── Pedidos (24-sep): seguimiento, llegada del conductor y problemas ─────
 * Un recorrido de cuatro pasos —Preparación · En camino · Llegó · Recibido—
 * con el paso actual marcado: la pregunta que la sala se hace con un pedido es
 * «¿dónde va?», y una línea de pasos la contesta sin leer. Debajo, el número y
 * las cajas, quién lo lleva con su cara, y la novedad si la hubo (en rojo, y el
 * último paso también). Antes todos eran un párrafo. */
const PASOS_DE_PEDIDO = ['Preparación', 'En camino', 'Llegó', 'Recibido'];

export function InsigniaDePedido({ datos, isDark }) {
    const t = tonos(isDark);
    if (datos.etapa === 'problema') return <Disco tono={t.rojo} Icono={PackageX} />;
    if (datos.etapa === 'recibido') return <Disco tono={t.verde} Icono={PackageCheck} />;
    if (datos.etapa === 'en_camino' || datos.etapa === 'llego') return <Disco tono={t.azul} Icono={Truck} />;
    return <Disco tono={t.azul} Icono={Package} />;
}

function PasosDePedido({ etapa, cajas, claseTenue, isDark }) {
    const t = tonos(isDark);
    const problema = etapa === 'problema';
    const actual = problema ? 3 : Math.max(0, ETAPAS_DE_PEDIDO.indexOf(etapa));
    const tonoActual = problema ? t.rojo : t.azul;
    /* Las barras dicen el avance y UNA línea dice el paso: con los cuatro
     * nombres debajo de las barras, a 320 px se partían a media palabra
     * («Prepar/ación») y en escritorio quedaban pegados. */
    return (
        <div className="mt-2">
            <div className="grid grid-cols-4 gap-1" aria-hidden="true">
                {PASOS_DE_PEDIDO.map((paso, i) => (
                    <span key={paso} className={`h-1.5 rounded-full
                        ${i <= actual ? (problema && i === 3 ? t.rojo.barra : t.azul.barra) : 'bg-border-card'}`} />
                ))}
            </div>
            <p className="mt-1 text-caption font-bold">
                <span className={claseTenue}>Paso {actual + 1} de 4 · </span>
                <span className={tonoActual.texto}>{problema ? 'Con novedad' : PASOS_DE_PEDIDO[actual]}</span>
                {/* Las cajas van en la línea del paso: sola en una grilla de dos
                    columnas dejaba media fila vacía (24-sep). */}
                {cajas != null && <span className={claseTenue}> · {cajas === 1 ? '1 caja' : `${cajas} cajas`}</span>}
            </p>
        </div>
    );
}

export function CuerpoDePedido({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const conConductor = (datos.etapa === 'en_camino' || datos.etapa === 'llego') && (datos.conductor || datos.conductorId);
    const emp = usePersona(datos.conductorId, datos.conductor, null, buscarEmpleado);
    /* El número de pedido NO va en la tarjeta (usuario, 24-sep: «no sé qué
     * tan útil es poner el número de pedido, ¿qué aporta?»): donde importa ya
     * está en el título, y repetido adentro no dice nada nuevo. */
    return (
        <div>
            <PasosDePedido etapa={datos.etapa} cajas={datos.cajas} claseTenue={claseTenue} isDark={isDark} />
            {(conConductor || datos.detalle) && (
                <div>
                    {/* Una sola columna: cada dato ocupa su fila entera, así
                        ninguna combinación deja una celda sola con un hueco al
                        lado. */}
                    <Grilla columnas="minmax(0, 1fr)">
                        {conConductor && (
                            <CeldaPersona emp={emp} rotulo={datos.etapa === 'llego' ? 'Llegó' : 'Lo lleva'}
                                respaldo={datos.conductor ?? 'Sin nombre'} claseTenue={claseTenue} />
                        )}
                        {datos.detalle && (
                            <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                                <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                                    {datos.etapa === 'problema' ? 'Qué pasó' : 'Nota'}
                                </p>
                                <p className={`text-body-sm font-bold break-words mt-0.5 ${datos.etapa === 'problema' ? t.rojo.texto : ''}`}>
                                    {datos.detalle}
                                </p>
                            </div>
                        )}
                    </Grilla>
                </div>
            )}
        </div>
    );
}

/* ── Solicitudes pendientes (24-sep) ──────────────────────────────────────
 * Una sola tarjeta para todos los tipos, con las mismas piezas: quién la pide
 * (con su cara), la factura —fecha, monto, documento, pago y cliente—, qué cambia
 * —antes y después—, los productos y el motivo. Cada tipo usa las que tiene.
 * Aprobar, Rechazar y Ver detalle los pone la tarjeta general, debajo. */
const TIPO_DE_SOLICITUD = {
    ANNULMENT_REQUEST:          { tono: 'rojo',    Icono: FileX },
    PAYMENT_CHANGE_REQUEST:     { tono: 'azul',    Icono: CreditCard },
    VENDOR_CHANGE_REQUEST:      { tono: 'azul',    Icono: UserRound },
    CLIENT_CHANGE_REQUEST:      { tono: 'azul',    Icono: Users },
    CAJA_MOVIMIENTO_CHANGE:     { tono: 'naranja', Icono: Wallet },
    ABONO_CREDITO_CHANGE:       { tono: 'naranja', Icono: HandCoins },
    ABONO_APROBACION:           { tono: 'verde',   Icono: HandCoins },
    INVENTORY_TRANSFER_REQUEST: { tono: 'azul',    Icono: ArrowLeftRight },
    INVENTORY_LOAD_REQUEST:     { tono: 'verde',   Icono: PackagePlus },
    INVENTORY_DISCARD_REQUEST:  { tono: 'rojo',    Icono: Trash2 },
};
const tipoDeSolicitud = (tipo) => TIPO_DE_SOLICITUD[tipo] ?? { tono: 'azul', Icono: CalendarDays };

/* «efectivo» → «Efectivo»: las formas de pago vienen en minúsculas. */
const conMayuscula = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

export function InsigniaDeSolicitud({ datos, isDark }) {
    const t = tipoDeSolicitud(datos.tipo);
    return <Disco tono={tonos(isDark)[t.tono]} Icono={t.Icono} />;
}

/* Los productos de un traslado (usuario, 24-sep). El NOMBRE manda —es lo que
 * se pide—; debajo, cuántas pide y cuántas tiene la sala a la que se lo piden:
 * «[Pide 24]  Hay 52 en Salud 3». Las ventas se quitaron: «solo deja lo que solicitan, el
 * producto, cantidad y cuánto en inventario». Se ven tres; el resto con «Ver
 * los N productos», porque se aprueba desde aquí y hay que verlos todos antes. */
export const PRODUCTOS_VISIBLES = 3;

function ProductosDeTraslado({ productos, mas, sala, claseTenue, azul, expandida }) {
    const visibles = expandida ? productos : productos.slice(0, PRODUCTOS_VISIBLES);
    const ocultos = productos.length - visibles.length;
    return (
        <div className="bg-surface-card-hover" style={{ gridColumn: '1 / -1' }}>
            <ul className="divide-y divide-border-card">
                {visibles.map((p, i) => (
                    <li key={`${p.nombre}-${i}`} className="px-2.5 py-2">
                        <p className="text-body-sm font-black break-words leading-snug">{p.nombre}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-caption">
                            {p.cantidad != null && (
                                <Pildora tono={azul}>Pide {unidades(p.cantidad)}</Pildora>
                            )}
                            {p.existencia != null && (
                                /* «Hay 52 en Salud 3» y no «Hay en Salud 3 52»: con el
                                   número de la sala pegado al de la existencia se
                                   leía «353» (usuario, 24-sep). */
                                <span className="whitespace-nowrap">
                                    <span className={`font-semibold ${claseTenue}`}>Hay</span>{' '}
                                    <b className="font-black tabular-nums">{unidades(p.existencia)}</b>
                                    {sala && <span className={`font-semibold ${claseTenue}`}> en {sala}</span>}
                                </span>
                            )}
                        </div>
                    </li>
                ))}
                {!expandida && ocultos > 0 && (
                    <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                        y {ocultos === 1 ? '1 producto más' : `${ocultos} productos más`}
                    </li>
                )}
                {mas > 0 && (expandida || ocultos === 0) && (
                    <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                        y {mas === 1 ? '1 producto más' : `${mas} productos más`} en la solicitud
                    </li>
                )}
            </ul>
        </div>
    );
}

export function CuerpoDeSolicitud({ datos, claseTenue, isDark, buscarEmpleado, expandida = false }) {
    const azul = tonos(isDark).azul;
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const rango = rangoDeFechas(datos.desde, datos.hasta);
    return (
        <div className="@container">
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                <CeldaPersona emp={emp} rotulo="Lo pide" respaldo={datos.quien ?? 'Sin nombre'} claseTenue={claseTenue} />

                {(() => {
                    /* Las celdas van de a PARES y la que queda sin pareja ocupa
                     * la fila entera; el cliente —nombre largo— va siempre en
                     * la suya. El número de la factura no se muestra: «no es
                     * relevante en esa vista» (usuario, 24-sep). */
                    const abono = datos.tipo === 'ABONO_APROBACION';
                    const deFactura = !!(datos.doc || datos.fecha);
                    const nuevoRotulo = datos.antes ? 'Pasa a'
                        : (datos.tipo === 'VENDOR_CHANGE_REQUEST' ? 'Nuevo vendedor' : 'Nuevo');
                    const grupos = [
                        [
                            datos.fecha && { k: 'fecha', rotulo: 'Fecha', valor: fechaCorta(datos.fecha) },
                            datos.monto != null && (deFactura || abono) && { k: 'monto', rotulo: 'Monto', valor: formatMoney(datos.monto) },
                            datos.doc && { k: 'doc', rotulo: 'Documento', valor: datos.doc },
                            datos.pago && { k: 'pago', rotulo: 'Pago', valor: conMayuscula(datos.pago) },
                            abono && datos.creditos != null && { k: 'creditos', rotulo: 'Créditos', valor: datos.creditos },
                        ],
                        [datos.cliente && (deFactura || abono) && { k: 'cliente', rotulo: 'Cliente', valor: datos.cliente, fila: true }],
                        [
                            datos.antes && { k: 'antes', rotulo: 'Hoy', valor: conMayuscula(datos.antes) },
                            datos.despues && { k: 'despues', rotulo: nuevoRotulo, valor: conMayuscula(datos.despues), clase: azul.texto },
                        ],
                    ];
                    return grupos.flatMap((grupo) => {
                        const celdas = grupo.filter(Boolean);
                        return celdas.map((c, i) => {
                            const sola = c.fila || (i === celdas.length - 1 && i % 2 === 0);
                            return (
                                <Celda key={c.k} rotulo={c.rotulo} clase={c.clase} claseTenue={claseTenue}
                                    derecha={!sola && i % 2 === 1} apilable={!c.fila} sola={sola}>
                                    {c.valor}
                                </Celda>
                            );
                        });
                    });
                })()}

                {rango && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0" style={{ gridColumn: '1 / -1' }}>
                        <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Fechas</p>
                        <p className="text-body-sm font-bold mt-0.5">{rango}</p>
                    </div>
                )}

                {datos.tipo === 'INVENTORY_TRANSFER_REQUEST' && datos.productos.length > 0 ? (
                    <ProductosDeTraslado productos={datos.productos} mas={datos.mas} sala={datos.origen}
                        claseTenue={claseTenue} azul={azul} expandida={expandida} />
                ) : datos.productos.length > 0 && (
                    <ul className="bg-surface-card-hover divide-y divide-border-card" style={{ gridColumn: '1 / -1' }}>
                        {datos.productos.map((p, i) => (
                            <li key={`${p.nombre}-${i}`} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                                <span className="text-caption font-bold break-words min-w-0">{p.nombre}</span>
                                {p.cantidad != null && (
                                    <span className="flex-shrink-0 text-body-sm font-black tabular-nums">×{unidades(p.cantidad)}</span>
                                )}
                            </li>
                        ))}
                        {datos.mas > 0 && (
                            <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                                y {datos.mas === 1 ? '1 producto más' : `${datos.mas} productos más`}
                            </li>
                        )}
                    </ul>
                )}

                {datos.motivo && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
                        <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Por qué lo pide</p>
                        <p className="text-body-sm font-semibold break-words mt-0.5">{enOracion(datos.motivo)}</p>
                    </div>
                )}
            </Grilla>
        </div>
    );
}

/* ── Séptima tanda (usuario, 24-sep) ──────────────────────────────────────
 * Las respuestas: a un traslado que pedí, a un envío que mandé, a una
 * solicitud mía, y el paso en que va una diferencia de un pedido. Las cuatro
 * con las mismas piezas: quién respondió con su cara, qué producto o qué
 * venta, y el porqué cuando lo hay. */

/* Un bloque de texto a todo el ancho, con su rótulo. */
const Bloque = ({ rotulo, children, claseTenue, claseRotulo = '' }) => (
    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0 leading-snug" style={{ gridColumn: '1 / -1' }}>
        <p className={`text-caption font-black uppercase tracking-wide ${claseRotulo || claseTenue}`}>{rotulo}</p>
        <div className="text-body-sm font-semibold break-words mt-0.5">{children}</div>
    </div>
);

const RESPUESTA = {
    ENVIA:    { tono: 'verde',   Icono: PackageCheck, persona: 'Lo envía' },
    PARTE:    { tono: 'naranja', Icono: Package,      persona: 'Lo envía' },
    NO:       { tono: 'rojo',    Icono: PackageX,     persona: 'Lo revisó' },
    RECIBIDO: { tono: 'verde',   Icono: PackageCheck, persona: 'Lo recibió' },
    DEVUELVE: { tono: 'naranja', Icono: Undo2,        persona: 'Lo recibió' },
};
const deRespuesta = (e) => RESPUESTA[e] ?? RESPUESTA.ENVIA;

export function InsigniaDeRespuesta({ datos, isDark }) {
    const r = deRespuesta(datos.estado);
    return <Disco tono={tonos(isDark)[r.tono]} Icono={r.Icono} />;
}

export function CuerpoDeRespuesta({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const r = deRespuesta(datos.estado);
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const esEnvio = datos.tipo === 'envio';
    /* Cuánto sale de cada producto, en su color: entero en verde, una parte en
     * naranja, nada en rojo. En un rechazo, lo que se había pedido. */
    const pildora = (p) => {
        if (datos.estado === 'NO') return p.pedida != null ? <Pildora tono={t.gris}>Pediste {unidades(p.pedida)}</Pildora> : null;
        /* «Se envía(n)» y no «Van»: «no lo siento acorde al lenguaje del
         * portal» (usuario, 24-sep). */
        const se = (n) => (n === 1 ? 'Se envía' : 'Se envían');
        if (p.enviada === 0) return <Pildora tono={t.rojo}>No se envía</Pildora>;
        if (p.enviada != null && p.pedida != null && p.enviada < p.pedida) {
            return <Pildora tono={t.naranja}>{se(p.enviada)} {unidades(p.enviada)} de {unidades(p.pedida)}</Pildora>;
        }
        return p.enviada != null ? <Pildora tono={t.verde}>{se(p.enviada)} {unidades(p.enviada)}</Pildora> : null;
    };
    return (
        <div className="@container">
            <Grilla columnas="1fr">
                <CeldaPersona emp={emp} rotulo={r.persona} respaldo={datos.quien ?? datos.origen ?? datos.sala ?? '—'} claseTenue={claseTenue} />

                {!esEnvio && datos.productos.length > 0 && (
                    <ul className="bg-surface-card-hover divide-y divide-border-card">
                        {datos.productos.map((p, i) => (
                            <li key={`${p.nombre}-${i}`} className="px-2.5 py-2">
                                <p className="text-body-sm font-black break-words leading-snug">{p.nombre}</p>
                                {pildora(p) && <div className="mt-1 text-caption">{pildora(p)}</div>}
                            </li>
                        ))}
                        {datos.mas > 0 && (
                            <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                                y {datos.mas === 1 ? '1 producto más' : `${datos.mas} productos más`}
                            </li>
                        )}
                    </ul>
                )}

                {/* El envío, dicho de corrido (usuario, 24-sep: «explica más,
                    no entiendo de qué es»): es un envío que ESTA sala mandó, y
                    la otra se quedó con una parte y devuelve el resto. */}
                {esEnvio && (
                    <Bloque rotulo={`Tu envío a ${datos.sala ?? 'la otra sala'}`} claseTenue={claseTenue}>
                        {[
                            datos.aceptados > 0 && `Se quedó con ${datos.aceptados === 1 ? 'un producto' : `${datos.aceptados} productos`}`,
                            datos.devueltos.length > 0 && `te devuelve ${datos.devueltos.length === 1 ? 'uno' : datos.devueltos.length}`,
                        ].filter(Boolean).join(' y ').replace(/^t/, 'T')}.
                        {datos.noLlegaron > 0 && (
                            <span className={t.rojo.texto}>
                                {' '}{datos.noLlegaron === 1 ? 'Un producto no llegó' : `${datos.noLlegaron} productos no llegaron`} en la caja: revisa si quedó en tu sala.
                            </span>
                        )}
                    </Bloque>
                )}
                {esEnvio && datos.devueltos.length > 0 && (
                    <ul className="bg-surface-card-hover divide-y divide-border-card">
                        {datos.devueltos.map((p, i) => (
                            <li key={`${p.nombre}-${i}`} className="px-2.5 py-2">
                                <p className="text-body-sm font-black break-words leading-snug">{p.nombre}</p>
                                {p.motivo && (
                                    <p className="text-caption mt-0.5">
                                        <span className={`font-black uppercase tracking-wide ${claseTenue}`}>Por qué lo devuelve</span>{' '}
                                        <span className="font-semibold">{enOracion(p.motivo)}</span>
                                    </p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {esEnvio && datos.estado === 'DEVUELVE' && (
                    <Bloque rotulo="Qué sigue" claseTenue={claseTenue} claseRotulo={t.naranja.texto}>
                        Confirma en Envíos cuando la caja esté de vuelta en tu sala.
                    </Bloque>
                )}

                {(datos.motivo || datos.nota) && (
                    <Bloque rotulo={datos.estado === 'NO' ? 'Por qué no' : 'Por qué no va todo'} claseTenue={claseTenue}>
                        {[datos.motivo, datos.nota].filter(Boolean).map(enOracion)
                            .map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ')}
                    </Bloque>
                )}
                {datos.alternativa && (
                    <Bloque rotulo="Dónde más hay" claseTenue={claseTenue} claseRotulo={t.azul.texto}>
                        {/* Sin `enOracion`: bajaría a minúscula las salas («salud 3»). */}
                        {datos.alternativa.replace(/^sí hay en /i, '').replace(/^./, (c) => c.toUpperCase())}
                    </Bloque>
                )}
            </Grilla>
        </div>
    );
}

/* ── Lo que decidieron sobre mi solicitud ─────────────────────────────── */
export function InsigniaDeDecision({ datos, isDark }) {
    const t = tonos(isDark);
    return <Disco tono={datos.aprobada ? t.verde : t.rojo} Icono={datos.aprobada ? Check : CircleOff} />;
}

export function CuerpoDeDecision({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const rango = rangoDeFechas(datos.desde, datos.hasta);
    const pares = [
        [
            datos.fecha && { k: 'fecha', rotulo: 'Fecha',
                // Dos piezas que no se parten, separadas por un espacio: con «·»
                // el punto quedaba colgando al envolver.
                valor: <><span className="whitespace-nowrap">{fechaCorta(datos.fecha)}</span>
                    {datos.hora && <>{' '}<span className="whitespace-nowrap">{hora12(datos.hora)}</span></>}</> },
            datos.monto != null && { k: 'monto', rotulo: 'Monto', valor: formatMoney(datos.monto) },
            datos.doc && { k: 'doc', rotulo: 'Documento', valor: datos.doc },
            datos.pago && { k: 'pago', rotulo: 'Pago', valor: conMayuscula(datos.pago) },
        ],
        // El cliente en su propia fila: es un nombre largo (24-sep: «tipo de
        // pago y cliente»).
        [datos.cliente && { k: 'cliente', rotulo: 'Cliente', valor: datos.cliente, fila: true }],
        [
            datos.antes && { k: 'antes', rotulo: 'Era', valor: conMayuscula(datos.antes) },
            datos.despues && { k: 'despues', rotulo: datos.antes ? 'Pasa a' : 'Nuevo', valor: conMayuscula(datos.despues),
                clase: datos.aprobada ? t.verde.texto : '' },
        ],
    ];
    return (
        <div className="@container">
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                <CeldaPersona emp={emp} rotulo={datos.aprobada ? 'La aprobó' : 'La rechazó'}
                    respaldo={datos.quien ?? '—'} claseTenue={claseTenue} />

                {datos.producto && (
                    <Bloque rotulo="Producto" claseTenue={claseTenue}>
                        <span className="font-black">{datos.producto}</span>
                        {datos.sala && <span className={`font-semibold ${claseTenue}`}> · {datos.sala}</span>}
                    </Bloque>
                )}
                {(datos.min != null || datos.max != null) && (
                    <Bloque rotulo={datos.aprobada ? 'Queda en' : 'Pediste'} claseTenue={claseTenue}
                        claseRotulo={datos.aprobada ? t.verde.texto : ''}>
                        <span className="font-black tabular-nums">MIN {datos.min ?? '—'} · MAX {datos.max ?? '—'}</span>
                    </Bloque>
                )}

                {pares.flatMap((grupo) => {
                    const celdas = grupo.filter(Boolean);
                    return celdas.map((c, i) => {
                        const sola = c.fila || (i === celdas.length - 1 && i % 2 === 0);
                        return (
                            <Celda key={c.k} rotulo={c.rotulo} clase={c.clase} claseTenue={claseTenue}
                                derecha={!sola && i % 2 === 1} apilable={!c.fila} sola={sola}>
                                {c.valor}
                            </Celda>
                        );
                    });
                })}

                {rango && <Bloque rotulo="Fechas" claseTenue={claseTenue}>{rango}</Bloque>}

                {datos.productos.length > 0 && (
                    <ul className="bg-surface-card-hover divide-y divide-border-card" style={{ gridColumn: '1 / -1' }}>
                        {datos.productos.map((p, i) => (
                            <li key={`${p.nombre}-${i}`} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                                <span className="text-caption font-bold break-words min-w-0">{p.nombre}</span>
                                {p.cantidad != null && (
                                    <span className="flex-shrink-0 text-body-sm font-black tabular-nums">×{unidades(p.cantidad)}</span>
                                )}
                            </li>
                        ))}
                        {datos.mas > 0 && (
                            <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                                y {datos.mas === 1 ? '1 producto más' : `${datos.mas} productos más`}
                            </li>
                        )}
                    </ul>
                )}

                {datos.nota && (
                    <Bloque rotulo={datos.aprobada ? 'Nota' : 'Por qué'} claseTenue={claseTenue}
                        claseRotulo={datos.aprobada ? '' : t.rojo.texto}>
                        {enOracion(datos.nota)}
                    </Bloque>
                )}
                {datos.instruccion && (
                    <Bloque rotulo="Falta hacer" claseTenue={claseTenue} claseRotulo={t.naranja.texto}>
                        {datos.instruccion}
                    </Bloque>
                )}
            </Grilla>
        </div>
    );
}

/* ── Una diferencia de un pedido ──────────────────────────────────────────
 * El producto manda; debajo qué pasó y en cuánto, la salida que se propone o
 * que quedó, y quién movió el paso. */
const DIFERENCIA = {
    propuesta:       { tono: 'azul',    persona: 'La propone',  salida: 'Propone' },
    contrapropuesta: { tono: 'naranja', persona: 'La propone',  salida: 'Bodega propone' },
    escalada:        { tono: 'rojo',    persona: 'La rechazó',  salida: 'Se había propuesto' },
    acordada:        { tono: 'verde',   persona: 'La aceptó',   salida: 'Quedó en' },
    confirmada:      { tono: 'verde',   persona: 'La cerró',    salida: 'Quedó en' },
};
const deDiferencia = (e) => DIFERENCIA[e] ?? DIFERENCIA.propuesta;

export function InsigniaDeDiferencia({ datos, isDark }) {
    const d = deDiferencia(datos.estado);
    const tono = tonos(isDark)[d.tono];
    return <Disco tono={tono} Icono={datos.estado === 'confirmada' ? Check : Scale} />;
}

/* «Faltaron 2», «Sobró 1»: qué pasó y cuánto, en una sola cifra. */
const queCantidad = (d) => {
    const n = d.problema ?? (d.enviada != null && d.recibida != null ? Math.abs(d.enviada - d.recibida) : null);
    if (!n) return d.que;
    if (d.que === 'Faltó')  return n === 1 ? 'Faltó 1' : `Faltaron ${unidades(n)}`;
    if (d.que === 'Sobró')  return n === 1 ? 'Sobró 1' : `Sobraron ${unidades(n)}`;
    return d.que;
};

export function CuerpoDeDiferencia({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const d = deDiferencia(datos.estado);
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const cantidades = datos.recibida != null && datos.enviada != null;
    const que = queCantidad(datos);
    return (
        <div className="@container">
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                {datos.producto && (
                    <div className="bg-surface-card-hover px-2.5 py-2 min-w-0" style={{ gridColumn: '1 / -1' }}>
                        <p className="text-body-sm font-black break-words leading-snug">{datos.producto}</p>
                    </div>
                )}
                {que && (
                    <Celda rotulo="Qué pasó" claseTenue={claseTenue} apilable sola={!cantidades}>{que}</Celda>
                )}
                {cantidades && (
                    <Celda rotulo="Llegaron" claseTenue={claseTenue} derecha={!!que} apilable sola={!que}>
                        {unidades(datos.recibida)} de {unidades(datos.enviada)}
                    </Celda>
                )}
                {/* La salida, si se arregla con un traslado o en físico, y qué
                    significa para quien lee — la misma explicación que Pedidos
                    (24-sep: «¿se refiere al sistema? deja claros esos
                    mensajes»). */}
                {datos.salida && (
                    <Bloque rotulo={d.salida} claseTenue={claseTenue} claseRotulo={t[d.tono].texto}>
                        <span className="font-black">{datos.salida}</span>
                        {datos.corto && <span className="ml-1.5 inline-block align-middle"><Pildora tono={t.gris}>{datos.corto}</Pildora></span>}
                        {datos.ayuda && datos.estado !== 'confirmada' && (
                            <p className={`text-caption font-semibold mt-1 ${claseTenue}`}>{datos.ayuda}</p>
                        )}
                    </Bloque>
                )}
                {(emp || datos.quien) && (
                    <CeldaPersona emp={emp} rotulo={d.persona} respaldo={datos.quien ?? '—'} claseTenue={claseTenue} />
                )}
                {datos.nota && (
                    <Bloque rotulo={datos.estado === 'escalada' ? 'Por qué no' : 'Nota'} claseTenue={claseTenue}>
                        {enOracion(datos.nota)}
                    </Bloque>
                )}
            </Grilla>
        </div>
    );
}

/* ── Contestar la diferencia desde la campana (usuario, 24-sep) ────────────
 * Los mismos turnos que `DecisionDiferencia` en Pedidos: bodega contesta una
 * propuesta (acepta o propone la otra), la sala contesta una contrapropuesta
 * (acepta o rechaza con motivo), supervisión decide una escalada. Sólo se
 * pintan para quien tiene el turno; la base igual lo vuelve a comprobar. */
export function AccionesDeDiferencia({ datos }) {
    const [ocupado, setOcupado] = useState(false);
    const [hecho, setHecho] = useState(null);
    const [rechazando, setRechazando] = useState(false);
    const [motivo, setMotivo] = useState('');
    const laOtra = datos.opciones.find((o) => o.valor !== datos.valor);

    const decidir = async (e, accion, tipo = null, nota = null) => {
        e?.stopPropagation?.();
        setOcupado(true);
        const { error } = await decidirDiferencia({ itemId: datos.itemId, accion, tipo, nota });
        setOcupado(false);
        if (error) {
            useToastStore.getState().showToast('No se pudo', mensajeAmigable(error, 'No se pudo guardar la respuesta.'), 'error');
            return;
        }
        setHecho(accion);
    };

    if (hecho) {
        return (
            <p className="text-caption font-bold text-success-text px-0.5">
                {hecho === 'aceptar' ? 'Aceptaste la salida.' : hecho === 'rechazar' ? 'La mandaste a supervisión.' : 'Listo: se avisó a la otra parte.'}
            </p>
        );
    }
    const alto = (e) => e.stopPropagation();

    if (datos.estado === 'escalada') {
        return (
            <div className="flex flex-wrap items-stretch gap-2" onClick={alto}>
                {datos.opciones.map((o) => (
                    <Button key={o.valor} size="xs" variant="secondary" className="flex-1 min-w-0" disabled={ocupado}
                        onClick={(e) => decidir(e, 'supervisar', o.valor)}>
                        {o.corto}
                    </Button>
                ))}
            </div>
        );
    }
    if (rechazando) {
        return (
            <div className="flex gap-2" onClick={alto}>
                <PortalInput aria-label="Por qué no" className="flex-1" tono="danger" compact autoFocus
                    value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Por qué no… (lo lee supervisión)" />
                <Button size="xs" tone="danger" soft loading={ocupado} disabled={!motivo.trim()}
                    onClick={(e) => decidir(e, 'rechazar', null, motivo.trim())}>Rechazar</Button>
                <Button size="xs" variant="ghost" icon={X} iconOnly title="Cancelar"
                    onClick={(e) => { e.stopPropagation(); setRechazando(false); }} />
            </div>
        );
    }
    return (
        <div className="flex items-stretch gap-2" onClick={alto}>
            <Button size="xs" tone="success" soft icon={Check} className="flex-1 min-w-0" loading={ocupado}
                onClick={(e) => decidir(e, 'aceptar')}>
                Aceptar
            </Button>
            {datos.estado === 'propuesta' && laOtra && (
                <Button size="xs" variant="secondary" icon={ArrowLeftRight} className="flex-1 min-w-0" disabled={ocupado}
                    onClick={(e) => decidir(e, 'contraproponer', laOtra.valor)}>
                    Proponer {laOtra.corto.toLowerCase()}
                </Button>
            )}
            {datos.estado === 'contrapropuesta' && (
                <Button size="xs" tone="danger" soft icon={X} className="flex-1 min-w-0" disabled={ocupado}
                    onClick={(e) => { e.stopPropagation(); setRechazando(true); }}>
                    Rechazar
                </Button>
            )}
        </div>
    );
}

/* ── Octava tanda (usuario, 24-sep): conteo, Hacienda y promociones ─────── */

/* Una cifra con su rótulo pegado, que baja entera si no cabe. */
const Cifra = ({ rotulo, valor, clase = '', claseTenue }) => (
    <span className="whitespace-nowrap">
        <b className={`font-black tabular-nums ${clase}`}>{valor}</b>{' '}
        <span className={`font-semibold ${claseTenue}`}>{rotulo}</span>
    </span>
);

/* El conteo cíclico del mes: cuántos productos y de qué clase. */
const CLASE_DE_CONTEO = { A: 'de clase A', B: 'de clase B', C: 'de clase C', BAJO_RECETA: 'bajo receta' };

export function InsigniaDeConteo({ isDark }) {
    return <Disco tono={tonos(isDark).azul} Icono={ClipboardCheck} />;
}

export function CuerpoDeConteo({ datos, claseTenue }) {
    return (
        <Grilla columnas="1fr">
            <div className="bg-surface-card-hover px-2.5 py-2">
                <p className="text-body-sm"><Cifra rotulo="productos por contar" valor={datos.productos} claseTenue={claseTenue} /></p>
                {datos.grupos.length > 0 && (
                    <p className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-caption">
                        {datos.grupos.map((g) => (
                            <Cifra key={g.clave} rotulo={CLASE_DE_CONTEO[g.clave] ?? g.clave.toLowerCase()} valor={g.n} claseTenue={claseTenue} />
                        ))}
                    </p>
                )}
            </div>
            <Bloque rotulo="Cómo se cuenta" claseTenue={claseTenue}>
                A ciegas: anota lo que ves en el estante, sin mirar lo que dice el sistema.
            </Bloque>
        </Grilla>
    );
}

/* El envío nocturno a Hacienda: cuáles facturas no entraron y por qué. */
export function InsigniaDeHacienda({ isDark }) {
    return <Disco tono={tonos(isDark).rojo} Icono={FileWarning} />;
}

export function CuerpoDeHacienda({ datos, claseTenue, isDark }) {
    const t = tonos(isDark);
    if (!datos.corrio) {
        return (
            <Grilla columnas="1fr">
                <Bloque rotulo="Qué pasó" claseTenue={claseTenue} claseRotulo={t.rojo.texto}>
                    El envío automático de las {hora12('22:30')} no dejó registro.
                    {datos.esperando != null && (datos.esperando === 0
                        ? ' Ahora no hay ninguna factura esperando.'
                        : ` ${datos.esperando === 1 ? 'Hay 1 factura esperando' : `Hay ${datos.esperando} facturas esperando`} y no se van a mandar hasta que vuelva a correr.`)}
                </Bloque>
            </Grilla>
        );
    }
    return (
        <Grilla columnas="1fr">
            <div className="bg-surface-card-hover px-2.5 py-2 flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
                <Cifra rotulo="no entraron" valor={datos.fallidas} clase={t.rojo.texto} claseTenue={claseTenue} />
                {datos.resueltas > 0 && <Cifra rotulo="sí entraron" valor={datos.resueltas} clase={t.verde.texto} claseTenue={claseTenue} />}
                {datos.restantes > 0 && <Cifra rotulo="en cola" valor={datos.restantes} claseTenue={claseTenue} />}
            </div>
            {datos.facturas.length > 0 && (
                <ul className="bg-surface-card-hover divide-y divide-border-card">
                    {datos.facturas.map((f, i) => (
                        <li key={i} className="px-2.5 py-2 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-body-sm font-black break-words leading-snug">{f.cliente ?? 'Sin nombre'}</p>
                                    {/* Piezas que no se parten, sin «·»: al envolver
                                        el punto quedaba colgando. */}
                                    <p className={`flex flex-wrap gap-x-2 text-caption font-semibold mt-0.5 ${claseTenue}`}>
                                        {[f.sala, f.doc, fechaCorta(f.fecha)].filter(Boolean).map((x) => (
                                            <span key={x}>{x}</span>
                                        ))}
                                    </p>
                                </div>
                                {f.monto != null && (
                                    <span className="flex-shrink-0 text-body-sm font-black tabular-nums">{formatMoney(f.monto)}</span>
                                )}
                            </div>
                            {f.motivo && (
                                <p className="text-caption mt-1">
                                    <span className={`font-black uppercase tracking-wide ${t.rojo.texto}`}>Hacienda dice</span>{' '}
                                    <span className="font-semibold">{f.motivo}</span>
                                </p>
                            )}
                        </li>
                    ))}
                    {datos.fallidas > datos.facturas.length && (
                        <li className={`px-2.5 py-1.5 text-caption font-semibold ${claseTenue}`}>
                            y {datos.fallidas - datos.facturas.length} más
                        </li>
                    )}
                </ul>
            )}
            <Bloque rotulo="Qué sigue" claseTenue={claseTenue} claseRotulo={t.naranja.texto}>
                Las que no se arreglan solas quedan en Facturación, en Observaciones.
            </Bloque>
        </Grilla>
    );
}

/* Una promoción: terminó, se le acaba el lote a una sala, o cerró su mes. */
export function InsigniaDePromo({ datos, isDark }) {
    const t = tonos(isDark);
    if (datos.tipo === 'lote') return <Disco tono={t.naranja} Icono={Package} />;
    if (datos.tipo === 'resumen') return <Disco tono={t.azul} Icono={Tag} />;
    if (datos.tipo === 'mes') return <Disco tono={t.azul} Icono={CalendarDays} />;
    return <Disco tono={t.gris} Icono={Tag} />;
}

/* Cuántos días le quedan a una fecha «AAAA-MM-DD», contados en fechas del
 * calendario y no en horas: hoy es 0. */
const diasHasta = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
    if (!m) return null;
    const hoy = new Date();
    const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const b = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Math.round((b - a) / 86400000);
};

const nombreDelMes = (ym) => {
    const m = /^(\d{4})-(\d{2})/.exec(String(ym ?? ''));
    return m ? `${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][Number(m[2]) - 1]} ${m[1]}` : null;
};

export function CuerpoDePromo({ datos, claseTenue, isDark }) {
    const t = tonos(isDark);
    /* El resumen del día para supervisión (usuario, 24-sep: «quiero un
     * reporte de todos, no sólo de una sucursal, y 1 al día»): una fila por
     * promoción, con lo vendido y cuánto va cada sala. La sala y su cifra van
     * separadas por «:» para que dos números no se lean como uno. */
    if (datos.tipo === 'resumen') {
        /* Segunda vuelta (24-sep: «mejora este»): cada sala en su celda, en
         * el mismo orden en todas las promociones y con las que van en cero,
         * con una barra de lo que vendió frente a la sala que más vendió. Así
         * se compara de un vistazo, que es para lo que es el resumen. */
        return (
            <Grilla columnas="1fr">
                {datos.promociones.map((pr) => {
                    const tope = Math.max(1, ...pr.salas.map((x) => x.vendido));
                    const dias = diasHasta(pr.fin);
                    return (
                        <div key={pr.nombre} className="bg-surface-card-hover px-2.5 py-2 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-body-sm font-black break-words leading-snug">{pr.nombre}</p>
                                    <p className={`flex flex-wrap gap-x-2 text-caption font-semibold mt-0.5 ${claseTenue}`}>
                                        {pr.productos != null && (
                                            <span className="whitespace-nowrap">{pr.productos === 1 ? '1 producto' : `${pr.productos} productos`}</span>
                                        )}
                                        {dias != null && (
                                            <span className={`whitespace-nowrap ${dias <= 3 ? t.naranja.texto : ''}`}>
                                                {dias <= 0 ? 'termina hoy' : dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}
                                            </span>
                                        )}
                                    </p>
                                </div>
                                <p className="flex-shrink-0 text-right leading-tight">
                                    <b className="block text-title font-black tabular-nums">{unidades(pr.vendido)}</b>
                                    <span className={`text-caption font-semibold ${claseTenue}`}>vendidas</span>
                                </p>
                            </div>
                            {pr.salas.length > 0 && (
                                /* 4.5rem: dos columnas desde ~150 px de ancho, o sea
                                   también en un teléfono de 320 px; con 5.5 caía a
                                   una sola y la tarjeta se volvía larguísima. */
                                <div className="mt-2 grid gap-x-2.5 gap-y-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(4.5rem, 1fr))' }}>
                                    {pr.salas.map((sa) => (
                                        <div key={sa.sala} className="min-w-0">
                                            <div className="flex items-baseline justify-between gap-1 text-caption">
                                                <span className={`font-semibold break-words min-w-0 ${claseTenue}`}>{sa.sala}</span>
                                                <b className={`font-black tabular-nums ${sa.vendido === 0 ? claseTenue : ''}`}>{unidades(sa.vendido)}</b>
                                            </div>
                                            <div className="mt-1 h-1 rounded-full bg-border-card overflow-hidden" data-medida="dato">
                                                <div className={`h-full ${t.azul.barra}`} style={{ width: `${Math.round(sa.vendido / tope * 100)}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {pr.porAgotarse.map((bj, i) => (
                                <p key={i} className="text-caption mt-2">
                                    <span className={`font-black uppercase tracking-wide ${t.naranja.texto}`}>Por agotarse</span>{' '}
                                    <span className="font-semibold">{bj.producto} — {bj.sala}: {unidades(bj.vendido)} de {unidades(bj.asignado)}</span>
                                </p>
                            ))}
                        </div>
                    );
                })}
            </Grilla>
        );
    }
    if (datos.tipo === 'lote') {
        const pct = datos.asignado ? Math.min(100, Math.round((datos.vendido ?? 0) / datos.asignado * 100)) : null;
        const agotado = datos.asignado != null && (datos.vendido ?? 0) >= datos.asignado;
        return (
            <Grilla columnas="1fr">
                <div className="bg-surface-card-hover px-2.5 py-2 min-w-0">
                    <p className="text-body-sm font-black break-words leading-snug">{datos.producto}</p>
                    {datos.nombre && <p className={`text-caption font-semibold mt-0.5 ${claseTenue}`}>{datos.nombre}</p>}
                </div>
                {pct != null && (
                    <div className="bg-surface-card-hover px-2.5 py-2">
                        <p className="text-body-sm">
                            <b className={`font-black tabular-nums ${agotado ? t.rojo.texto : t.naranja.texto}`}>{datos.vendido ?? 0}</b>{' '}
                            <span className={`font-semibold ${claseTenue}`}>
                                de {datos.asignado} vendidas{datos.sala ? ` en ${datos.sala}` : ''}
                            </span>
                        </p>
                        <div className="mt-1.5 h-1.5 rounded-full bg-border-card overflow-hidden" data-medida="dato">
                            <div className={`h-full ${agotado ? t.rojo.barra : t.naranja.barra}`} style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                )}
                <Bloque rotulo="Todavía hay en" claseTenue={claseTenue} claseRotulo={t.azul.texto}>
                    {/* Los avisos anteriores traen «Salud 1 12»: se lee como un
                        solo número, así que la cantidad va entre paréntesis. */}
                    {datos.donde ? datos.donde.replace(/([^\s(]) (\d+)(?=\s*·|$)/g, '$1 ($2)') : 'Ya no queda en ninguna otra sala.'}
                </Bloque>
            </Grilla>
        );
    }
    if (datos.tipo === 'mes') {
        return (
            <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
                <Celda rotulo="Mes" claseTenue={claseTenue} apilable sola={datos.costo == null}>
                    {conMayuscula(nombreDelMes(datos.mes) ?? datos.mes ?? '—')}
                </Celda>
                {datos.costo != null && (
                    <Celda rotulo="Costo" claseTenue={claseTenue} derecha apilable>{formatMoney(datos.costo)}</Celda>
                )}
                {datos.salas.length > 0 && (
                    <ul className="bg-surface-card-hover divide-y divide-border-card" style={{ gridColumn: '1 / -1' }}>
                        {datos.salas.map((s) => (
                            <li key={s.sala} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                                <span className="text-body-sm font-bold break-words min-w-0">{s.sala}</span>
                                <span className="flex-shrink-0 text-caption">
                                    {s.nivel && <span className={`font-semibold ${claseTenue}`}>Nivel {s.nivel}</span>}
                                    {s.costo != null && <b className="font-black tabular-nums ml-2">{formatMoney(s.costo)}</b>}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </Grilla>
        );
    }
    return (
        <Grilla columnas="repeat(auto-fit, minmax(7.5rem, 1fr))">
            <Celda rotulo="Cómo terminó" claseTenue={claseTenue} apilable sola={!datos.fin}>
                {datos.motivo ?? 'Cerró su último producto'}
            </Celda>
            {datos.fin && (
                <Celda rotulo="Último día" claseTenue={claseTenue} derecha apilable>{fechaCorta(datos.fin)}</Celda>
            )}
        </Grilla>
    );
}

/* ── Novena tanda (usuario, 24-sep): metas por aprobar y reinicio ───────── */

/* «−3.4%» / «+2.1%»: cuánto cambia contra el mes anterior. */
const cambio = (hoy, antes) => {
    if (hoy == null || !antes) return null;
    const pct = (hoy - antes) / antes * 100;
    return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct).toLocaleString('es-SV', { maximumFractionDigits: 1 })}%`;
};

export function InsigniaDeMetasPorAprobar({ isDark }) {
    return <Disco tono={tonos(isDark).azul} Icono={Target} />;
}

/* La meta de cada sala contra la del mes anterior, el total y quién las
 * confirmó. Aprobarlas se hace en Metas: la tarjeta lleva ahí. */
export function CuerpoDeMetasPorAprobar({ datos, claseTenue, buscarEmpleado }) {
    const emp = usePersona(datos.quienId, datos.quien, datos.quienFoto, buscarEmpleado);
    const totalCambio = cambio(datos.total, datos.anterior);
    return (
        <Grilla columnas="1fr">
            {(emp || datos.quien) && (
                <CeldaPersona emp={emp} rotulo="Las confirmó" respaldo={datos.quien ?? '—'} claseTenue={claseTenue} />
            )}
            {/* Apilado y no lado a lado: a 320 px el cambio se salía por la
                derecha y la grilla lo recortaba sin que se notara. */}
            <div className="bg-surface-card-hover px-2.5 py-2 min-w-0">
                <p className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>Meta de la empresa</p>
                <p className="text-title font-black tabular-nums mt-0.5">{formatMoney(datos.total)}</p>
                {totalCambio && (
                    <p className={`text-caption font-semibold mt-0.5 ${claseTenue}`}>
                        <b className="font-black tabular-nums text-text-primary">{totalCambio}</b> contra el mes anterior
                    </p>
                )}
            </div>
            <ul className="bg-surface-card-hover divide-y divide-border-card">
                {datos.salas.map((s) => (
                    <li key={s.sala} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                        <span className="text-body-sm font-bold break-words min-w-0">{s.sala}</span>
                        <span className="flex-shrink-0 text-right leading-tight">
                            <b className="block text-body-sm font-black tabular-nums">{formatMoney(s.meta)}</b>
                            {cambio(s.meta, s.anterior) && (
                                <span className={`text-caption font-semibold tabular-nums ${claseTenue}`}>{cambio(s.meta, s.anterior)}</span>
                            )}
                        </span>
                    </li>
                ))}
            </ul>
        </Grilla>
    );
}

export function InsigniaDeReinicio({ isDark }) {
    return <Disco tono={tonos(isDark).naranja} Icono={RotateCcw} />;
}

/* Cuándo volvió a arrancar, y qué significa para quien lo lee. */
export function CuerpoDeReinicio({ datos, claseTenue }) {
    // `fechaHora12` es el canónico: fecha y hora de El Salvador, en 12 horas.
    const cuando = fechaHora12(datos.arranco, { day: 'numeric', month: 'short' });
    return (
        <Grilla columnas="1fr">
            {cuando && (
                <Celda rotulo="Volvió a arrancar" claseTenue={claseTenue}>{cuando}</Celda>
            )}
            <Bloque rotulo="Qué significa" claseTenue={claseTenue}>
                Si poco antes el portal estuvo lento o no dejaba entrar, fue esto. No hay que hacer nada: ya está funcionando.
            </Bloque>
        </Grilla>
    );
}
