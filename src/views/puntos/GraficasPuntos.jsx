/**
 * Las gráficas de la vista «Puntos», en su propio módulo para que `recharts`
 * viaje en un chunk aparte (regla de CLAUDE.md: librerías pesadas sólo por
 * import diferido; la vista las pide con `React.lazy`).
 *
 * ── Color ───────────────────────────────────────────────────────────────────
 * Dos series y siempre las mismas: acumulado en `--chart-1` (azul) y canjeado
 * en `--chart-6` (rosa). Se eligió el par con el validador de paleta, no a ojo:
 * azul/naranja —el primer candidato— sale de la banda de luminosidad sobre el
 * fondo oscuro del portal; azul/rosa pasa las seis pruebas en claro y en oscuro
 * (separación para daltonismo ΔE ≥ 30). El color sigue a la SERIE en las tres
 * gráficas: el rosa es «canjeado» en todas.
 *
 * Un solo eje por gráfica: acumulado y canjeado son la misma unidad (puntos).
 * Todas van dentro de `ChartContainer` por el bucle de recharts en WebKit móvil
 * (ver su encabezado).
 */
import React from 'react';
import {
    ComposedChart, Area, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatQty } from '../../utils/formatNumber';

const COLOR = {
    acumulado: 'var(--chart-1)',
    canjeado:  'var(--chart-6)',
    rejilla:   'var(--divider)',
    texto:     'var(--text-tertiary)',
};

const EJE = { fontSize: 10, fill: COLOR.texto, fontWeight: 700 };
const TOOLTIP = {
    background: 'var(--surface-modal)', border: '1px solid var(--border-modal)',
    borderRadius: '0.75rem', fontSize: 12, color: 'var(--text-primary)', backdropFilter: 'blur(20px)',
};
const pts = (v) => formatQty(Number(v) || 0);
const corto = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v));

// «2026-09-25» → «25 sep», sin pasar por `new Date` en UTC (retrocede un día).
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dia = (iso) => {
    const [, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return `${d} ${MESES[m - 1]}`;
};
const mes = (iso) => {
    const [a, m] = String(iso).slice(0, 10).split('-').map(Number);
    return `${MESES[m - 1]} ${a}`;
};

const LEYENDA = {
    wrapperStyle: { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', paddingTop: 4 },
    iconType: 'circle', iconSize: 8,
};

/** Acumulado y canjeado por día. */
export function GraficaDiaria({ serie }) {
    const datos = (serie ?? []).map((d) => ({ ...d, etiqueta: dia(d.fecha) }));
    const paso = Math.max(0, Math.ceil(datos.length / 8) - 1);
    return (
        <ChartContainer minHeight={240}>
            <ComposedChart data={datos} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                    <linearGradient id="puntosAcumulado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLOR.acumulado} stopOpacity={0.22} />
                        <stop offset="95%" stopColor={COLOR.acumulado} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" interval={paso} minTickGap={18} tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={EJE} tickFormatter={corto} />
                <Tooltip contentStyle={TOOLTIP}
                    cursor={{ stroke: COLOR.texto, strokeDasharray: '4 4' }}
                    formatter={(v, nombre) => [pts(v), nombre]}
                    labelFormatter={(l) => l} />
                <Legend {...LEYENDA} />
                <Area type="monotone" dataKey="acumulado" name="Acumulados" stroke={COLOR.acumulado}
                    strokeWidth={2} fill="url(#puntosAcumulado)" dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface-card)' }} isAnimationActive={false} />
                <Line type="monotone" dataKey="canjeado" name="Canjeados" stroke={COLOR.canjeado}
                    strokeWidth={2} dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface-card)' }} isAnimationActive={false} />
            </ComposedChart>
        </ChartContainer>
    );
}

/** Acumulado y canjeado del mes, por sala. */
export function GraficaSalas({ salas }) {
    const datos = salas ?? [];
    return (
        <ChartContainer minHeight={Math.max(180, datos.length * 44 + 40)}>
            <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                barGap={2} barCategoryGap="22%">
                <CartesianGrid stroke={COLOR.rejilla} horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={EJE} tickFormatter={corto} />
                <YAxis type="category" dataKey="sala" tickLine={false} axisLine={false} width={84}
                    tick={{ ...EJE, fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                    formatter={(v, nombre) => [pts(v), nombre]} />
                <Legend {...LEYENDA} />
                <Bar dataKey="acumulado" name="Acumulados" fill={COLOR.acumulado} radius={[0, 4, 4, 0]}
                    maxBarSize={16} isAnimationActive={false} />
                <Bar dataKey="canjeado" name="Canjeados" fill={COLOR.canjeado} radius={[0, 4, 4, 0]}
                    maxBarSize={16} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

/** Cuántos puntos vencen, por mes. Una sola serie: el título la nombra. */
export function GraficaVencimientos({ vencimientos }) {
    const datos = (vencimientos ?? []).map((v) => ({ ...v, etiqueta: mes(v.mes) }));
    return (
        <ChartContainer minHeight={180}>
            <BarChart data={datos} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={44} tick={EJE} tickFormatter={corto} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                    formatter={(v, _n, p) => [`${pts(v)} de ${pts(p?.payload?.clientes)} clientes`, 'Vencen']} />
                <Bar dataKey="puntos" name="Vencen" fill={COLOR.acumulado} radius={[4, 4, 0, 0]}
                    maxBarSize={56} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

export default GraficaDiaria;
