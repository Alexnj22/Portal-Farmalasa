import React from 'react';
import {
    Check, TrendingDown, TrendingUp, CircleOff, Thermometer, SprayCan,
    ArrowRight, Truck, Store, Clock,
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
 *  · la PERSONA arriba, con su cara — quien hizo el corte, quien despachó;
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

/** La persona: cara, nombre corto y un renglón de contexto debajo. */
const Persona = ({ emp, contexto, claseTenue, derecha }) => (
    <div className="flex items-center gap-2 min-w-0">
        {emp ? (
            <AvatarConEstado emp={emp} px={28} radio="rounded-full" marco="" mostrarChip={false} />
        ) : (
            <span aria-hidden="true" className={`w-7 h-7 rounded-full grid place-items-center flex-shrink-0
                bg-surface-card-hover ${claseTenue}`}>
                <Store className="w-3.5 h-3.5" />
            </span>
        )}
        <div className="flex-1 min-w-0 leading-tight">
            {emp && <p className="text-body-sm font-bold truncate">{shortEmployeeName(emp)}</p>}
            <p className={`text-caption font-semibold truncate ${emp ? claseTenue : 'text-body-sm font-bold'}`}>
                {contexto}
            </p>
        </div>
        {derecha}
    </div>
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
    cuadra:     { tono: 'verde',   Icono: Check,        pildora: 'Cuadró' },
    sobra:      { tono: 'naranja', Icono: TrendingUp,   pildora: 'Sobrante' },
    falta:      { tono: 'rojo',    Icono: TrendingDown, pildora: 'Faltante' },
    sin_conteo: { tono: 'naranja', Icono: CircleOff,    pildora: 'Sin conteo' },
};

export function InsigniaDeCorte({ datos, isDark }) {
    const c = CORTE[datos.estado];
    return <Disco tono={tonos(isDark)[c.tono]} Icono={c.Icono} />;
}

export function CuerpoDeCorte({ datos, claseTenue, isDark, buscarEmpleado }) {
    const c = CORTE[datos.estado];
    const tono = tonos(isDark)[c.tono];
    const emp = personaDe(datos.quienId, datos.quien, buscarEmpleado);
    // La hora ya está en el título; acá sólo la sala.
    const contexto = datos.sala;

    const diferencia = datos.estado === 'sin_conteo' ? 'Sin conteo'
        : datos.estado === 'cuadra' ? '$0.00'
        : `${datos.tramo > 0 ? '+' : '−'}${formatMoney(Math.abs(datos.tramo))}`;
    // Sólo la diferencia (usuario, 23-sep: «contado y ventas que no vayan
    // ahí, solo las diferencias»).
    const panel = [{ etiqueta: 'Diferencia', valor: diferencia, clase: tono.texto }];

    return (
        <div className="flex flex-col gap-2 mt-1.5">
            <Persona emp={emp} contexto={contexto || 'Corte de caja'} claseTenue={claseTenue}
                derecha={<Pildora tono={tono} icon={c.Icono}>{c.pildora}</Pildora>} />
            <Panel datos={panel} claseTenue={claseTenue} />
            {datos.estado === 'sin_conteo' && (
                <p className={`text-caption font-bold ${tono.texto}`}>Hay que descartarlo y volver a cortar</p>
            )}
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
