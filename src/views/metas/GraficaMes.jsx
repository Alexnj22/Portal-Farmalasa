import React, { lazy, Suspense, useMemo } from 'react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { Skeleton } from '../../components/common/StateViews';
import BarraAvance from './BarraAvance';
import AvisoSinProducto from '../../components/common/AvisoSinProducto';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { TRAMO_CFG } from './metasUtils';

// El dibujo vive en `GraficaMesDias.jsx` para que `recharts` (95 kB gzip) no
// entre en el cierre estático de Metas; leer su encabezado antes de tocarlo.
const GraficaMesDias = lazy(() => import('./GraficaMesDias'));

// Cómo va el mes en curso.
//
//   «Día por día»   → ¿cómo venimos trabajando? Útil desde el día 1.
//   «Termómetro»    → ¿dónde estamos parados? La foto, de un vistazo.
//
// El interruptor aparece SOLO con todas las salas juntas (decisión del usuario,
// 2026-08-05). Mirando una sala sola va el termómetro y nada más: ahí la
// pregunta es «¿cómo vamos?», no comparar formas de mirarlo — y es la misma
// vista que ve la sala en su Inicio, así que supervisión y sala hablan del
// mismo dibujo.
//
// El termómetro NO trae barra propia: reusa `BarraAvance`, que es la canónica
// del módulo y ya lleva dibujadas las marcas del 95% y del 100% y el rombo de
// la proyección. Escribir otra sería tener la regla del bono en dos lugares.
const VISTAS = [
    { value: 'dias',  label: 'Día por día' },
    { value: 'termo', label: 'Termómetro' },
];

// La espera del chunk de `recharts`, con la forma de lo que va a reemplazar:
// barras de alto disparejo sobre la línea del eje. Un `null` acá dejaría un
// hueco de 190px que se llena de golpe; esto se lee como el gráfico cargando.
const EsqueletoBarras = () => (
    <div className="h-full flex items-end gap-1 pl-[52px] pr-2 pb-4">
        {[52, 68, 45, 80, 60, 92, 38, 74, 55, 86].map((h, i) => (
            <Skeleton key={i} className="flex-1" w="100%" h={`${h}%`} rounded="0.25rem 0.25rem 0 0" />
        ))}
    </div>
);

export default function GraficaMes({ data, vista, onVista }) {
    // Con una sala elegida no hay interruptor y manda el termómetro. Se resuelve
    // acá y no en el padre para que no haya forma de pintar «día por día» sin
    // control para volver.
    const conInterruptor = !!data?.todas;
    const vistaReal = conInterruptor ? vista : 'termo';

    // La gráfica termina HOY (pedido del usuario, 2026-08-10). Antes el eje iba
    // del 1 al 31 siempre, así que el día 10 dibujaba diez barras en un tercio
    // del ancho y dos tercios de nada: el mes que todavía no pasó ocupaba más
    // lugar que el que sí. Ahora las barras se reparten el ancho y lo que falta
    // se dice en la franja de la derecha — un dato, no un hueco.
    const diasMes = Number(data?.dias_mes || 30);
    const diaHoy = Math.min(diasMes, Math.max(1, Number(data?.dia_hoy || diasMes)));
    const porVenir = Math.max(0, diasMes - diaHoy);   // los que no empezaron; hoy NO cuenta, ya tiene barra

    const dias = useMemo(() => {
        const porDia = new Map((data?.dias || []).map((d) => [Number(d.dia), d]));
        return Array.from({ length: diaHoy }, (_, i) => {
            const n = i + 1;
            const d = porDia.get(n);
            return { dia: n, venta: d ? Number(d.venta) : null, esHoy: !!d?.es_hoy };
        });
    }, [data, diaHoy]);

    const ritmo = Number(data?.ritmo_diario || 0);
    const cerrados = dias.filter((d) => d.venta != null && !d.esHoy);
    const sobreRitmo = cerrados.filter((d) => d.venta >= ritmo).length;

    const meta = Number(data?.meta || 0);
    const acum = Number(data?.acumulado || 0);
    const proy = data?.proyeccion != null ? Number(data.proyeccion) : null;
    const pct = meta > 0 ? (acum / meta) * 100 : null;
    const pctProy = meta > 0 && proy != null ? (proy / meta) * 100 : null;
    const tramoProy = pctProy == null ? null
        : pctProy >= Number(data.umbral_total) ? 'completo'
        : pctProy >= Number(data.umbral_medio) ? 'medio' : 'nada';
    const falta = meta - acum;
    const diasRestantes = Math.max(0, Number(data?.dias_mes || 0) - Number(data?.dia_hoy || 0) + 1);

    return (
        <div data-surface="card" className="p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="min-w-0">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3">
                        {data?.sala} · este mes
                    </p>
                    <p className="text-label font-semibold text-content-2 mt-0.5 tabular-nums">
                        {vistaReal === 'dias'
                            ? <><strong className="text-content">{sobreRitmo} de {cerrados.length}</strong> días cerrados por encima del ritmo</>
                            : <>Día {data?.dia_hoy} de {data?.dias_mes} · faltan {formatMoney(Math.max(0, falta))}</>}
                    </p>
                </div>
                {conInterruptor && (
                    <SegmentedControl
                        options={VISTAS} value={vistaReal} onChange={onVista} size="sm"
                        label="Cómo mirar el mes"
                    />
                )}
            </div>

            {vistaReal === 'dias' ? (
                <>
                    {/* Más alta cuando la tarjeta ocupa el ancho entero: 31 días
                        en 1,312px con 190px de alto es una franja de 7:1 y las
                        barras se leen aplastadas. El alto de teléfono no se toca. */}
                    <div className="flex items-stretch gap-3 h-[190px] xl:h-[260px]">
                        <div className="flex-1 min-w-0">
                            <Suspense fallback={<EsqueletoBarras />}>
                                <GraficaMesDias dias={dias} ritmo={ritmo} />
                            </Suspense>
                        </div>

                        {/* Lo que falta del mes, dicho en vez de dibujado en
                            blanco. El `mb` levanta la franja hasta el piso del
                            área de dibujo — los 30px de abajo son la fila de
                            días del eje, que no tiene nada que ver con esto. */}
                        {porVenir > 0 && (
                            <div className="shrink-0 w-[14%] min-w-[78px] max-w-[170px] mb-[30px]
                                            flex flex-col items-center justify-center text-center px-2
                                            rounded-xl border border-dashed border-divider bg-surface-card-hover/50">
                                <span className="text-title-sm font-black tabular-nums text-content-2 leading-none">
                                    {porVenir}
                                </span>
                                <span className="text-micro font-bold uppercase tracking-widest text-content-3 leading-tight mt-1">
                                    días por<br />venir
                                </span>
                            </div>
                        )}
                    </div>
                    <p className="text-micro font-semibold text-content-3 mt-2">
                        El día de hoy va más claro porque todavía no termina.
                        {porVenir > 0 && <> La gráfica llega hasta hoy: quedan {porVenir} día{porVenir !== 1 ? 's' : ''} del mes.</>}
                    </p>
                </>
            ) : (
                <div className="pt-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-display-lg font-black tabular-nums tracking-tight">{formatMoney(acum)}</span>
                        {pct != null && (
                            <span className="text-body-lg font-black text-chart-1-text tabular-nums">{formatPct(pct)}</span>
                        )}
                        <span className="text-label font-semibold text-content-3">de {formatMoney(meta)}</span>
                    </div>

                    <BarraAvance
                        pct={pct} pctProyectado={pctProy}
                        umbralMedio={Number(data?.umbral_medio ?? 95)}
                        umbralTotal={Number(data?.umbral_total ?? 100)}
                    />

                    {proy != null && (
                        <p className="mt-3 text-label font-semibold text-content-2 tabular-nums">
                            Cierra en <strong>{formatMoney(proy)}</strong>
                            {' → '}
                            <strong className={TRAMO_CFG[tramoProy]?.textCls || ''}>{formatPct(pctProy)}</strong>
                            {falta > 0 && diasRestantes > 0 && (
                                <span className="text-content-3">
                                    {' · '}faltan {formatMoney(falta)} en {diasRestantes} día{diasRestantes !== 1 ? 's' : ''}
                                    {' — '}{formatMoney(falta / diasRestantes)} por día
                                </span>
                            )}
                        </p>
                    )}
                </div>
            )}

            {/* Va al pie de la tarjeta y no dentro de una de las dos vistas: el
                dato es el mismo mire uno el día por día o el termómetro, y la
                barra de un día con un cobro adentro engaña igual que el
                acumulado. `AvisoSinProducto` no pinta nada si no hay ninguno o
                si quien mira no tiene el permiso — el servidor manda cero. */}
            <AvisoSinProducto
                datos={data}
                contexto={vistaReal === 'dias' ? 'El mes que se dibuja aquí' : 'Este acumulado'}
                className="mt-3"
            />
        </div>
    );
}
