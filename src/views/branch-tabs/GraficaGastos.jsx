import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatMoney } from '../../utils/formatNumber';

/**
 * La «Tendencia de Gastos» de la pestaña Gastos de una sucursal, en su propio
 * módulo para que `recharts` viaje en un chunk aparte.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 * `recharts` pesa **95 kB gzip** y entraba en el cierre estático de
 * `BranchDetailView` —o sea, se bajaba al abrir CUALQUIER sucursal— aunque el
 * gráfico vive en una sola de sus pestañas y sólo en las que tienen gastos
 * configurados. Es el caso de la regla de CLAUDE.md: librerías pesadas sólo por
 * `await import()`.
 *
 * **El chunk se descarga gratis.** El gráfico no se monta hasta que
 * `isLoadingData` es falso, o sea después de `fetchBranchExpensesHistory`, y
 * hasta entonces la pestaña ya pintaba un esqueleto de barras. La descarga corre
 * en paralelo con esa consulta y usa **el mismo** esqueleto como espera de
 * `Suspense` — por eso está extraído a `EsqueletoBarras` en `TabExpenses` en vez
 * de escrito dos veces: dos esqueletos distintos harían que el gráfico entrara
 * después de un segundo hueco con otra forma.
 *
 * ── OJO al tocar esto: el bucle de WebKit ────────────────────────────────
 * `ChartContainer` NO es decorativo — resuelve un bucle infinito de recharts
 * («Maximum update depth exceeded») que sólo aparece en WebKit móvil, cuando un
 * ancestro se está animando, y que era **intermitente**: 3 de 5 corridas. El
 * detalle completo está en el encabezado de `ChartContainer.jsx`.
 */

const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <div data-surface="card" className="p-4">
                <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-1.5">{label}</p>
                <p className="text-body-xl font-black text-content flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-brand shadow-sm"></span>
                    {formatMoney(payload[0].value)}
                </p>
            </div>
        );
    }
    return null;
};

export default function GraficaGastos({ data }) {
    return (
        <ChartContainer>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.9}/>
                        <stop offset="95%" stopColor="var(--brand)" stopOpacity={0.1}/>
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--divider)" opacity={0.5} />
                <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--chart-8)', fontSize: 10, fontWeight: 800 }}
                    dy={10}
                />
                <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-tertiary)', fontSize: 10, fontWeight: 800 }}
                    tickFormatter={(value) => `$${value}`}
                />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--brand) 5%, transparent)', rx: 8 }} />
                <Bar
                    dataKey="total"
                    fill="url(#colorTotal)"
                    radius={[8, 8, 8, 8]}
                    barSize={36}
                    className="transition-all duration-[var(--dur-slow)] hover:opacity-90"
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={index === data.length - 1 ? 'var(--brand)' : 'url(#colorTotal)'} />
                    ))}
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}
