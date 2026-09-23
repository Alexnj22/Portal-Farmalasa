import React from 'react';
import {
    Check, TrendingDown, TrendingUp, CircleOff, Thermometer, SprayCan,
    ArrowRight, Truck, Store, Clock, SlidersHorizontal, ShoppingBag, Landmark,
} from 'lucide-react';
import AvatarConEstado from './AvatarConEstado';
import Badge from './Badge';
import { formatMoney } from '../../utils/formatNumber';
import { shortEmployeeName } from '../../utils/nameUtils';
import { hora12, rango12 } from '../../utils/hora';
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

/* La ficha del store trae la foto firmada; si no está (o el aviso sólo trae el
 * nombre), la cara sale de las iniciales — nunca se esconde a la persona. */
const personaDe = (id, nombre, buscarEmpleado) => {
    if (id) return buscarEmpleado?.(id) || { id, name: nombre };
    return nombre ? { name: nombre } : null;
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
    const emp = personaDe(datos.quienId, datos.quien, buscarEmpleado);

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
                {visibles.map((t, i) => {
                    const emp = personaDe(t.quienId, t.quien, buscarEmpleado);
                    const hora = hora12(t.hora);
                    return (
                        <li key={t.id ?? i} className="flex items-center gap-2 px-2.5 py-2 min-w-0">
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
                                {/* El destino primero: es lo que la sala tiene que
                                    ir a comprobar. El nombre va último y es lo que
                                    se recorta — la cara ya dice quién fue. */}
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
                })}
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
 * El producto arriba; en el panel quién lo pide, cómo está hoy y qué propone
 * —lo propuesto en azul, que es lo que se decide—; y el motivo debajo, entre
 * comillas. Aprobar y Rechazar los pone la tarjeta general. */
const minmax = (min, max) => (min == null && max == null
    ? 'Sin definir'
    : `MIN ${min ?? '—'} · MAX ${max ?? '—'}`);

export function InsigniaDeMinmax({ isDark }) {
    return <Disco tono={tonos(isDark).azul} Icono={SlidersHorizontal} />;
}

export function CuerpoDeMinmax({ datos, claseTenue, isDark, buscarEmpleado }) {
    const azul = tonos(isDark).azul;
    const emp = personaDe(datos.quienId, datos.quien, buscarEmpleado);
    return (
        <div className="mt-1">
            {datos.producto && (
                <p className="text-body-sm font-bold line-clamp-2">{datos.producto}</p>
            )}
            <Grilla columnas="minmax(0,1fr) minmax(0,1fr)">
                <CeldaPersona emp={emp} rotulo="Lo pide" respaldo="Sin nombre" claseTenue={claseTenue} />
                <Celda rotulo="Hoy" claseTenue={claseTenue}>{minmax(datos.minHoy, datos.maxHoy)}</Celda>
                <Celda rotulo="Propone" clase={azul.texto} derecha>{minmax(datos.minNuevo, datos.maxNuevo)}</Celda>
            </Grilla>
            {datos.motivo && (
                <p className={`mt-1.5 text-caption font-semibold italic line-clamp-2 ${claseTenue}`}>
                    «{datos.motivo}»
                </p>
            )}
        </div>
    );
}

/* ── Bolsa que no cuadró ──────────────────────────────────────────────────
 * Un renglón por bolsa: el folio a la izquierda y, a la derecha, FALTÓ o SOBRÓ
 * con el monto en su color. Con varias bolsas, un renglón más con el neto. */
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

export function CuerpoDeBolsa({ datos, claseTenue, isDark }) {
    if (datos.lista.length === 1) {
        const b = datos.lista[0];
        const d = difDeBolsa(b.dif, isDark);
        return (
            <Grilla columnas="minmax(0,1fr) 7rem">
                <Celda rotulo="Bolsa" claseTenue={claseTenue}>{b.folio}</Celda>
                <Celda rotulo={d.rotulo} clase={d.clase} derecha>{d.valor}</Celda>
            </Grilla>
        );
    }
    /* Varias bolsas: una línea por bolsa —folio y monto con su signo y su
     * color— y el neto al pie. Repetir «BOLSA / FALTÓ» en cada renglón era
     * ruido (23-sep). */
    const neto = difDeBolsa(datos.neto, isDark);
    return (
        <ul className="mt-2 rounded-xl bg-surface-card-hover divide-y divide-border-card">
            {datos.lista.map((b) => {
                const d = difDeBolsa(b.dif, isDark);
                return (
                    <li key={b.folio} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                        <span className="text-body-sm font-bold tabular-nums">{b.folio}</span>
                        <span className={`text-body-sm font-black tabular-nums ${d.clase}`}>{d.valor}</span>
                    </li>
                );
            })}
            <li className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className={`text-caption font-black uppercase tracking-wide ${claseTenue}`}>
                    {neto.rotulo} en total
                </span>
                <span className={`text-body-lg font-black tabular-nums ${neto.clase}`}>{neto.valor}</span>
            </li>
        </ul>
    );
}

/* ── Depósito al banco ────────────────────────────────────────────────────
 * El monto ya está en el título. El panel dice quién lo lleva (o quién lo
 * cerró), a qué banco o a quién en mano, cuántas bolsas y cuánto no salió. */
export function InsigniaDeDeposito({ isDark }) {
    return <Disco tono={tonos(isDark).verde} Icono={Landmark} />;
}

export function CuerpoDeDeposito({ datos, claseTenue, isDark, buscarEmpleado }) {
    const t = tonos(isDark);
    const emp = personaDe(datos.quienId, datos.quien, buscarEmpleado);
    const destino = datos.destino === 'EFECTIVO'
        ? { rotulo: 'En mano a', valor: datos.entregadoA ?? '—' }
        // «Banco Davivienda» bajo el rótulo BANCO decía «banco» dos veces.
        : { rotulo: 'Banco', valor: (datos.banco ?? '—').replace(/^Banco\s+/i, '') };
    return (
        <Grilla columnas="minmax(0,1.3fr) minmax(0,0.8fr) minmax(0,1fr)">
            <CeldaPersona emp={emp} rotulo={datos.quienLleva ? 'Lo lleva' : 'Lo cerró'}
                respaldo="Sin nombre" claseTenue={claseTenue} />
            <Celda rotulo={destino.rotulo} claseTenue={claseTenue}>{destino.valor}</Celda>
            <Celda rotulo="Bolsas" claseTenue={claseTenue}>{datos.bolsas ?? '—'}</Celda>
            <Celda rotulo="Sin salir" clase={datos.remanente >= 0.01 ? t.naranja.texto : t.verde.texto} derecha>
                {datos.remanente >= 0.01 ? formatMoney(datos.remanente) : 'Nada'}
            </Celda>
        </Grilla>
    );
}
