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
    ComposedChart, Area, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatQty, formatMoney, formatMoneyCorto } from '../../utils/formatNumber';

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

// ── Puntos o dólares ───────────────────────────────────────────────────────
// 100 puntos = US$1.00. La `unidad` decide el EJE; el tooltip dice siempre las
// dos cosas, porque quien mira dólares igual quiere saber cuántos puntos son.
// Los datos no se convierten: el eje se re-rotula, así la forma de la curva es
// idéntica en las dos lecturas y no hay un redondeo distinto en cada una.
const dolares = (v) => formatMoney((Number(v) || 0) / 100);
const ejeDe = (unidad) => (unidad === 'dolares'
    // Sin centavos en el eje: «$100.00» no entra en su ancho y el tooltip
    // ya lleva el monto exacto.
    ? (v) => (v >= 100_000 ? formatMoneyCorto(v / 100) : formatMoney(v / 100, { decimales: 0 }))
    : corto);
const ambos = (v) => `${pts(v)} pts · ${dolares(v)}`;

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
export function GraficaDiaria({ serie, unidad = 'puntos' }) {
    const datos = (serie ?? []).map((d) => ({ ...d, etiqueta: dia(d.fecha) }));
    const paso = Math.max(0, Math.ceil(datos.length / 8) - 1);
    return (
        <ChartContainer minHeight={190}>
            <ComposedChart data={datos} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                    <linearGradient id="puntosAcumulado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLOR.acumulado} stopOpacity={0.22} />
                        <stop offset="95%" stopColor={COLOR.acumulado} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" interval={paso} minTickGap={18} tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={EJE} tickFormatter={ejeDe(unidad)} />
                <Tooltip contentStyle={TOOLTIP}
                    cursor={{ stroke: COLOR.texto, strokeDasharray: '4 4' }}
                    formatter={(v, nombre) => [ambos(v), nombre]}
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
export function GraficaSalas({ salas, unidad = 'puntos' }) {
    const datos = salas ?? [];
    return (
        <ChartContainer minHeight={Math.max(150, datos.length * 32 + 40)}>
            <BarChart data={datos} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                barGap={2} barCategoryGap="22%">
                <CartesianGrid stroke={COLOR.rejilla} horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tick={EJE} tickFormatter={ejeDe(unidad)} />
                <YAxis type="category" dataKey="sala" tickLine={false} axisLine={false} width={84}
                    tick={{ ...EJE, fontSize: 11, fill: 'var(--text-secondary)' }} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                    formatter={(v, nombre) => [ambos(v), nombre]} />
                <Legend {...LEYENDA} />
                <Bar dataKey="acumulado" name="Acumulados" fill={COLOR.acumulado} radius={[0, 4, 4, 0]}
                    maxBarSize={12} isAnimationActive={false} />
                <Bar dataKey="canjeado" name="Canjeados" fill={COLOR.canjeado} radius={[0, 4, 4, 0]}
                    maxBarSize={12} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

/** Cuántos puntos vencen, por mes. Una sola serie: el título la nombra. */
export function GraficaVencimientos({ vencimientos, unidad = 'puntos' }) {
    const datos = (vencimientos ?? []).map((v) => ({ ...v, etiqueta: mes(v.mes) }));
    return (
        <ChartContainer minHeight={150}>
            <BarChart data={datos} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={EJE} tickFormatter={ejeDe(unidad)} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                    formatter={(v, _n, p) => [`${ambos(v)} de ${pts(p?.payload?.clientes)} clientes`, 'Vencen']} />
                <Bar dataKey="puntos" name="Vencen" fill={COLOR.acumulado} radius={[4, 4, 0, 0]}
                    maxBarSize={56} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

/**
 * La historia de UN cliente, por mes: lo acumulado y lo canjeado. Es la
 * gráfica del detalle del cliente, y es un control: tocar un mes filtra sus
 * movimientos (`onElegir`); los demás meses se atenúan mientras hay uno elegido.
 * El saldo al cierre de cada mes va en el tooltip — no es otra serie: dibujado
 * junto a los flujos del mes aplasta las barras contra el piso.
 */
export function GraficaCliente({ meses, unidad = 'puntos', activo = null, onElegir }) {
    const datos = (meses ?? []).map((m) => ({ ...m, etiqueta: mes(`${m.mes}-01`) }));
    const opacidad = (m) => (activo && activo !== m.mes ? 0.3 : 1);
    const elegir = (d) => onElegir?.(d?.mes === activo ? null : d?.mes ?? null);
    return (
        <ChartContainer minHeight={170}>
            <BarChart data={datos} margin={{ top: 8, right: 8, left: -8, bottom: 0 }} barGap={2} barCategoryGap="24%">
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={EJE} minTickGap={12} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={EJE} tickFormatter={ejeDe(unidad)} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: COLOR.rejilla, opacity: 0.35 }}
                    formatter={(v, nombre) => [ambos(v), nombre]}
                    labelFormatter={(l, p) => {
                        const saldo = p?.[0]?.payload?.saldo;
                        return saldo == null ? l : `${l} · quedaron ${pts(saldo)} pts`;
                    }} />
                <Legend {...LEYENDA} />
                <Bar dataKey="acumulado" name="Acumulados" fill={COLOR.acumulado} radius={[4, 4, 0, 0]}
                    maxBarSize={18} isAnimationActive={false} cursor="pointer" onClick={elegir}>
                    {datos.map((m) => <Cell key={m.mes} fillOpacity={opacidad(m)} />)}
                </Bar>
                <Bar dataKey="canjeado" name="Canjeados" fill={COLOR.canjeado} radius={[4, 4, 0, 0]}
                    maxBarSize={18} isAnimationActive={false} cursor="pointer" onClick={elegir}>
                    {datos.map((m) => <Cell key={m.mes} fillOpacity={opacidad(m)} />)}
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}

export default GraficaDiaria;
