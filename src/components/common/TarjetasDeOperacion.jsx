import React from 'react';
import {
    Check, TrendingDown, TrendingUp, CircleOff, Thermometer, SprayCan,
    ArrowRight, Truck, Store,
} from 'lucide-react';
import AvatarConEstado from './AvatarConEstado';
import { formatMoney } from '../../utils/formatNumber';
import { VENTANA_BITACORA_MIN } from '../../utils/avisosDeOperacion';

/* Tres tarjetas de la campana para avisos de la operación del día: el corte de
 * caja, la bitácora por cerrarse y los traslados despachados por respaldo.
 *
 * Pedido del usuario (23-sep): «rediseñalas para que sean modernas», después
 * de ver la de créditos vencidos. Las tres eran un párrafo; la regla que las
 * ordena es la misma de las otras tarjetas: **el título dice el hecho y la
 * tarjeta no lo repite** («quita la 2ª línea, se repite como el título») —
 * dibuja lo que el título no alcanza a decir.
 */

const tonos = (isDark) => ({
    verde:   { texto: isDark ? 'text-success-text' : 'text-success', disco: 'bg-success/10', trazo: 'text-success' },
    naranja: { texto: isDark ? 'text-warning-text' : 'text-warning', disco: 'bg-warning/10', trazo: 'text-warning' },
    rojo:    { texto: isDark ? 'text-danger-text'  : 'text-danger',  disco: 'bg-danger/10',  trazo: 'text-danger' },
});

const Disco = ({ tono, Icono }) => (
    <span className={`w-9 h-9 flex-shrink-0 mt-0.5 rounded-xl grid place-items-center ${tono.disco} ${tono.texto}`}
        aria-hidden="true">
        <Icono className="w-4 h-4" />
    </span>
);

const Sala = ({ nombre, claseTenue }) => (nombre ? (
    <span className={`inline-flex items-center gap-1 text-caption font-semibold ${claseTenue}`}>
        <Store className="w-3 h-3" aria-hidden="true" />{nombre}
    </span>
) : null);

/* ── El corte de caja ─────────────────────────────────────────────────────
 * La pregunta es **¿cuadró?**, y el color la contesta antes de leer. Cuando
 * falta, el monto ya está en el título («Faltan $2.10 en el corte…») y acá no
 * se repite. Confirmar y Descartar los pone la tarjeta general, debajo. */
const CORTE = {
    cuadra:     { tono: 'verde',   Icono: Check,        texto: () => 'Cuadró al centavo' },
    sobra:      { tono: 'naranja', Icono: TrendingUp,   texto: (d) => `Sobran ${formatMoney(Math.abs(d.tramo))}` },
    falta:      { tono: 'rojo',    Icono: TrendingDown, texto: () => null },
    sin_conteo: { tono: 'naranja', Icono: CircleOff,    texto: () => 'Salió sin contar el efectivo' },
};

export function InsigniaDeCorte({ datos, isDark }) {
    const c = CORTE[datos.estado];
    return <Disco tono={tonos(isDark)[c.tono]} Icono={c.Icono} />;
}

export function CuerpoDeCorte({ datos, claseTenue, isDark }) {
    const c = CORTE[datos.estado];
    const tono = tonos(isDark)[c.tono];
    const texto = c.texto(datos);
    return (
        <div className="flex flex-col gap-1.5 mt-1">
            {texto && (
                <span className={`text-body-lg font-black tracking-tight tabular-nums ${tono.texto}`}>{texto}</span>
            )}
            <div className="flex items-center gap-2 flex-wrap">
                <Sala nombre={datos.sala} claseTenue={claseTenue} />
                <span className={`text-caption font-bold ${tono.texto}`}>
                    {datos.estado === 'sin_conteo'
                        ? 'Hay que descartarlo y volver a cortar'
                        : 'Hay que revisarlo y confirmarlo'}
                </span>
            </div>
        </div>
    );
}

/* ── La bitácora por cerrarse ─────────────────────────────────────────────
 * Un reloj: el arco es lo que queda de la ventana de aviso y el número, los
 * minutos. Se calcula al dibujar, así que un aviso leído tarde dice «cerró» en
 * vez de seguir prometiendo 29 minutos. */
const R = 19;
const VUELTA = 2 * Math.PI * R;

const tonoDeBitacora = (d, isDark) => {
    const t = tonos(isDark);
    if (d.cerrada) return { texto: 'text-text-muted', trazo: 'text-text-muted' };
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
                    className={`${tono.trazo} stroke-current`}
                    strokeDasharray={`${VUELTA * avance} ${VUELTA}`} />
            </svg>
            <span className={`absolute inset-0 grid place-items-center tabular-nums text-caption font-black ${tono.texto}`}
                aria-hidden="true">
                {datos.cerrada ? <CircleOff className="w-3.5 h-3.5" /> : datos.quedan}
            </span>
        </div>
    );
}

const Chip = ({ children, claseTenue }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-surface-card-hover
        text-caption font-semibold ${claseTenue}`}>
        {children}
    </span>
);

export function CuerpoDeBitacora({ datos, claseTenue, isDark }) {
    const tono = tonoDeBitacora(datos, isDark);
    const { pendientes, lecturas, limpiezas, areas } = datos;
    return (
        <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-baseline gap-2 flex-wrap tabular-nums">
                <span className={`text-body-lg font-black tracking-tight ${tono.texto}`}>
                    {datos.cerrada ? 'Ya cerró' : `Quedan ${datos.quedan} min`}
                </span>
                <span className={`text-body-sm font-semibold ${claseTenue}`}>
                    {pendientes === 1 ? 'falta 1 registro' : `faltan ${pendientes} registros`}
                </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
                {lecturas > 0 && (
                    <Chip claseTenue={claseTenue}>
                        <Thermometer className="w-3 h-3" aria-hidden="true" />
                        {lecturas === 1 ? '1 temperatura' : `${lecturas} temperaturas`}
                    </Chip>
                )}
                {limpiezas > 0 && (
                    <Chip claseTenue={claseTenue}>
                        <SprayCan className="w-3 h-3" aria-hidden="true" />
                        {limpiezas === 1 ? '1 limpieza' : `${limpiezas} limpiezas`}
                    </Chip>
                )}
                {areas.map((a) => <Chip key={a} claseTenue={claseTenue}>{a}</Chip>)}
            </div>
        </div>
    );
}

/* ── Los traslados por respaldo ───────────────────────────────────────────
 * Un renglón por traslado: a qué hora, quién, qué y a dónde. Es lo que la sala
 * necesita para ir al estante a comprobar que la existencia cuadra — antes el
 * aviso sólo nombraba destinos, repetidos, y se cortaba. */
const MAX_RENGLONES = 5;

const horaSV = (iso) => {
    const d = iso ? new Date(iso) : null;
    if (!d || Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('es-SV', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador',
    });
};

export function InsigniaDeTraslados({ isDark }) {
    return <Disco tono={tonos(isDark).naranja} Icono={Truck} />;
}

export function CuerpoDeTraslados({ datos, claseTenue, buscarEmpleado }) {
    const { traslados, unidades } = datos;
    const visibles = traslados.slice(0, MAX_RENGLONES);
    const resto = traslados.length - visibles.length;
    return (
        <div className="flex flex-col gap-1.5 mt-1">
            <span className={`text-caption font-semibold tabular-nums ${claseTenue}`}>
                {unidades === 1 ? '1 unidad salió de su existencia' : `${unidades} unidades salieron de su existencia`}
            </span>
            <ul className="flex flex-col gap-0.5">
                {visibles.map((t, i) => {
                    const emp = t.quienId
                        ? (buscarEmpleado?.(t.quienId) || { id: t.quienId, name: t.quien })
                        : null;
                    return (
                        <li key={t.id ?? i} className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1">
                            <span className={`flex-shrink-0 w-10 tabular-nums text-caption font-black ${claseTenue}`}>
                                {horaSV(t.hora) ?? '—'}
                            </span>
                            {emp && (
                                <span className="flex-shrink-0">
                                    <AvatarConEstado emp={emp} px={22} radio="rounded-full" marco="" mostrarChip={false} />
                                </span>
                            )}
                            <span className="flex-1 min-w-0 truncate text-caption font-semibold">
                                {t.producto ?? 'Traslado'}{t.mas > 0 ? ` y ${t.mas} más` : ''}
                            </span>
                            <span className={`flex-shrink-0 inline-flex items-center gap-1 text-caption font-semibold ${claseTenue}`}>
                                <ArrowRight className="w-3 h-3" aria-hidden="true" />{t.destino}
                            </span>
                            {t.unidades != null && (
                                <span className="flex-shrink-0 w-8 text-right tabular-nums text-caption font-black">
                                    ×{t.unidades}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
            {resto > 0 && (
                <span className={`text-caption font-semibold ${claseTenue}`}>
                    y {resto === 1 ? '1 traslado más' : `${resto} traslados más`}
                </span>
            )}
        </div>
    );
}
