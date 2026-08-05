import React, { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, Cell } from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import SegmentedControl from '../../components/common/SegmentedControl';
import BarraAvance from './BarraAvance';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { TRAMO_CFG } from './metasUtils';

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

// Los colores van como `var(--token)` directo al SVG, no leídos con
// `getComputedStyle`. Dos razones: un hex clavado se ve mal en tres de los
// cuatro temas del portal, y una variable CSS la resuelve el navegador en cada
// pintada — así el gráfico cambia de tema solo, sin que React tenga que
// re-renderizar ni recordar volver a leer el token.
const COLOR = {
    barra:   'var(--chart-1)',
    ritmo:   'var(--text-secondary)',
    rejilla: 'var(--divider)',
    texto:   'var(--text-tertiary)',
};

export default function GraficaMes({ data, vista, onVista }) {
    // Con una sala elegida no hay interruptor y manda el termómetro. Se resuelve
    // acá y no en el padre para que no haya forma de pintar «día por día» sin
    // control para volver.
    const conInterruptor = !!data?.todas;
    const vistaReal = conInterruptor ? vista : 'termo';

    const dias = useMemo(() => {
        const porDia = new Map((data?.dias || []).map((d) => [Number(d.dia), d]));
        return Array.from({ length: Number(data?.dias_mes || 30) }, (_, i) => {
            const n = i + 1;
            const d = porDia.get(n);
            return { dia: n, venta: d ? Number(d.venta) : null, esHoy: !!d?.es_hoy };
        });
    }, [data]);

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
                    <div className="h-[190px]">
                        <ChartContainer minHeight={190}>
                            <BarChart data={dias} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                                <XAxis
                                    dataKey="dia" interval={4} tickLine={false} axisLine={false}
                                    tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                                />
                                <YAxis
                                    tickLine={false} axisLine={false} width={52}
                                    tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                                    tickFormatter={(v) => (v ? `$${Math.round(v / 1000)}k` : '0')}
                                />
                                <Tooltip
                                    cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                                    contentStyle={{
                                        background: 'var(--surface-modal)', border: '1px solid var(--border-modal)',
                                        borderRadius: '0.75rem', fontSize: 12, color: 'var(--text-primary)',
                                        backdropFilter: 'blur(20px)',
                                    }}
                                    formatter={(v) => [formatMoney(v), 'Vendido']}
                                    labelFormatter={(d) => `Día ${d}`}
                                />
                                {/* La raya es lo que hay que vender CADA día para llegar
                                    justo a fin de mes. Una barra encima es un día que
                                    empujó; debajo, uno que quedó debiendo. */}
                                <ReferenceLine
                                    y={ritmo} stroke={COLOR.ritmo} strokeWidth={2} strokeDasharray="6 5"
                                    label={{
                                        value: `ritmo ${formatMoney(ritmo)}`, position: 'insideTopRight',
                                        fill: COLOR.texto, fontSize: 10, fontWeight: 800,
                                    }}
                                />
                                <Bar dataKey="venta" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                    {dias.map((d) => (
                                        // El día de hoy va translúcido: todavía no termina, y
                                        // pintarlo lleno lo haría parecer un mal día.
                                        <Cell key={d.dia} fill={COLOR.barra} fillOpacity={d.esHoy ? 0.42 : 1} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ChartContainer>
                    </div>
                    <p className="text-micro font-semibold text-content-3 mt-2">
                        El día de hoy va más claro porque todavía no termina.
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
        </div>
    );
}
