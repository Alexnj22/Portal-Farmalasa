import React, { useMemo } from 'react';
import {
    ComposedChart, LineChart, Line, Bar, XAxis, YAxis, CartesianGrid,
    ReferenceLine, Tooltip,
} from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { ymLabelCorto } from './metasUtils';

// Las dos gráficas del histórico, sobre los últimos 12 meses cerrados.
//
//   1. Cumplimiento por mes — la línea contra las marcas del 95% y el 100%,
//      que son los dos números que deciden el bono.
//   2. Meta y venta en dinero — la venta es la barra; la meta, un listón
//      encima. Es la forma correcta para «cuánto contra un objetivo»: UNA cosa
//      medida y su referencia. Dos barras lado a lado harían competir a la meta
//      con la venta como si fueran categorías rivales, y no lo son.
//
// Un solo eje por gráfica: los dólares y el porcentaje NO comparten dibujo.
// Dos escalas en uno hace que cualquier cruce entre las líneas parezca
// significar algo cuando no significa nada.
//
// Los puntos NO se colorean por tramo del bono. El validador de color lo
// desaconseja: verde contra ámbar quedan a ΔE 6.8 en protanopía, así que quien
// no distingue rojo y verde vería la misma línea de puntos. Las marcas de
// referencia dicen lo mismo sin depender del color.
const MESES = 12;

const COLOR = {
    barra:   'var(--chart-1)',
    liston:  'var(--text-secondary)',
    rejilla: 'var(--divider)',
    texto:   'var(--text-tertiary)',
    meta:    'var(--success)',
    medio:   'var(--warning)',
};

const TOOLTIP = {
    background: 'var(--surface-modal)',
    border: '1px solid var(--border-modal)',
    borderRadius: '0.75rem',
    fontSize: 12,
    color: 'var(--text-primary)',
    backdropFilter: 'blur(20px)',
};

// El listón de la meta: un trazo horizontal por mes, sin línea que los una.
// Unirlos sugeriría una continuidad que la meta no tiene — cada mes se decide
// por separado.
function ListonMeta({ cx, cy }) {
    if (cx == null || cy == null) return null;
    return (
        <line
            x1={cx - 12} x2={cx + 12} y1={cy} y2={cy}
            stroke={COLOR.liston} strokeWidth={2.5} strokeLinecap="round"
        />
    );
}

export default function GraficasHistorico({ rows, umbralMedio = 95, umbralTotal = 100 }) {
    // Un punto por mes: las filas vienen por sala, así que se suman. Si la
    // píldora tiene una sala elegida, `rows` ya viene recortado y esto suma una
    // sola — el mismo código sirve para los dos casos.
    const datos = useMemo(() => {
        const porMes = new Map();
        for (const r of rows || []) {
            if (r.monto_meta == null) continue;   // sin meta no hay cumplimiento
            const m = porMes.get(r.year_month) || { ym: r.year_month, meta: 0, venta: 0 };
            m.meta += Number(r.monto_meta);
            m.venta += Number(r.venta_total || 0);
            porMes.set(r.year_month, m);
        }
        return [...porMes.values()]
            .sort((a, b) => a.ym.localeCompare(b.ym))
            .slice(-MESES)
            .map((m) => ({
                ...m,
                mes: ymLabelCorto(m.ym),
                pct: m.meta > 0 ? Math.round((m.venta / m.meta) * 1000) / 10 : null,
            }));
    }, [rows]);

    if (datos.length < 2) return null;

    const pcts = datos.map((d) => d.pct).filter((v) => v != null);
    const min = Math.floor(Math.min(...pcts, umbralMedio) - 2);
    const max = Math.ceil(Math.max(...pcts, umbralTotal) + 2);

    const mejor = datos.reduce((a, b) => (b.pct > a.pct ? b : a));
    const peor = datos.reduce((a, b) => (b.pct < a.pct ? b : a));

    return (
        <div className="grid gap-4 xl:grid-cols-2">
            {/* ── 1. Cumplimiento ─────────────────────────────────────────── */}
            <div data-surface="card" className="p-5">
                <p className="text-caption font-black uppercase tracking-widest text-content-3">
                    Cumplimiento por mes
                </p>
                <p className="text-label font-semibold text-content-3 mt-0.5 tabular-nums">
                    {datos.length} meses · el más alto <strong className="text-content-2">{mejor.mes} {formatPct(mejor.pct)}</strong>
                    {' · el más bajo '}<strong className="text-content-2">{peor.mes} {formatPct(peor.pct)}</strong>
                </p>
                <div className="h-[210px] mt-3">
                    <ChartContainer minHeight={210}>
                        {/* Sin margen izquierdo negativo: con tres dígitos y el
                            `%`, la etiqueta del eje mide más de lo que parece y
                            «106%» salía cortado en «6%» — un número que además
                            se lee como si fuera válido. */}
                        <LineChart data={datos} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                            <XAxis
                                dataKey="mes" tickLine={false} axisLine={false}
                                tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                            />
                            <YAxis
                                domain={[min, max]} tickLine={false} axisLine={false} width={52}
                                tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                                tickFormatter={(v) => `${v}%`}
                            />
                            <Tooltip
                                contentStyle={TOOLTIP}
                                formatter={(v) => [formatPct(v), 'Cumplimiento']}
                            />
                            {/* Las dos marcas que deciden el bono. Sin ellas la
                                línea es un garabato; con ellas se ve de un
                                vistazo qué meses pasaron y cuáles no. */}
                            <ReferenceLine
                                y={umbralTotal} stroke={COLOR.meta} strokeWidth={1.5} strokeDasharray="5 4"
                                label={{ value: 'bono completo', position: 'insideTopRight',
                                    fill: COLOR.meta, fontSize: 9, fontWeight: 900 }}
                            />
                            <ReferenceLine
                                y={umbralMedio} stroke={COLOR.medio} strokeWidth={1.5} strokeDasharray="5 4"
                                label={{ value: 'medio bono', position: 'insideBottomRight',
                                    fill: COLOR.medio, fontSize: 9, fontWeight: 900 }}
                            />
                            <Line
                                type="linear" dataKey="pct" stroke={COLOR.barra} strokeWidth={2}
                                dot={{ r: 3.5, fill: COLOR.barra, strokeWidth: 0 }}
                                activeDot={{ r: 5.5 }} isAnimationActive={false}
                            />
                        </LineChart>
                    </ChartContainer>
                </div>
                <p className="text-micro font-semibold text-content-3 mt-2">
                    El eje arranca cerca del 95%, no en cero: son porcentajes alrededor del 100 y
                    forzar el cero aplastaría toda la historia en una franja.
                </p>
            </div>

            {/* ── 2. Meta y venta ─────────────────────────────────────────── */}
            <div data-surface="card" className="p-5">
                <p className="text-caption font-black uppercase tracking-widest text-content-3">
                    Meta y venta
                </p>
                <p className="text-label font-semibold text-content-3 mt-0.5 tabular-nums">
                    Lo más lejos <strong className="text-content-2">{peor.mes}, {formatMoney(peor.meta - peor.venta)} por debajo</strong>
                    {mejor.venta > mejor.meta && (
                        <> · lo más alto <strong className="text-content-2">{mejor.mes}, {formatMoney(mejor.venta - mejor.meta)} por encima</strong></>
                    )}
                </p>
                <div className="h-[210px] mt-3">
                    <ChartContainer minHeight={210}>
                        <ComposedChart data={datos} margin={{ top: 10, right: 10, left: -8, bottom: 0 }}>
                            <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                            <XAxis
                                dataKey="mes" tickLine={false} axisLine={false}
                                tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                            />
                            <YAxis
                                tickLine={false} axisLine={false} width={52}
                                tick={{ fontSize: 10, fill: COLOR.texto, fontWeight: 700 }}
                                tickFormatter={(v) => (v ? `$${Math.round(v / 1000)}k` : '0')}
                            />
                            <Tooltip
                                contentStyle={TOOLTIP}
                                formatter={(v, n) => [formatMoney(v), n === 'venta' ? 'Vendido' : 'Meta del mes']}
                            />
                            {/* Las barras arrancan en CERO — es dinero, y truncar
                                el eje de una barra la vuelve mentirosa. */}
                            <Bar dataKey="venta" fill={COLOR.barra} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                            <Line
                                dataKey="meta" stroke="none" dot={<ListonMeta />}
                                activeDot={false} isAnimationActive={false} legendType="none"
                            />
                        </ComposedChart>
                    </ChartContainer>
                </div>
                <div className="flex items-center gap-4 flex-wrap mt-2">
                    <span className="inline-flex items-center gap-1.5 text-micro font-bold text-content-3">
                        <span className="w-3.5 h-2.5 rounded-sm bg-chart-1" /> Vendido
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-micro font-bold text-content-3">
                        <span className="w-4 h-0 border-t-2 border-content-2 rounded" /> Meta del mes
                    </span>
                </div>
            </div>
        </div>
    );
}
