import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import ChartContainer from '../common/ChartContainer';

/**
 * El heatmap de afluencia de «Análisis de la operación», en su propio módulo
 * para que `recharts` viaje en un chunk aparte.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 * `recharts` pesa **95 kB gzip** y era 95 de los 119 kB del chunk de
 * `FormWfmAnalytics` — o sea, el 80% de lo que se baja al abrir este modal se
 * gastaba en la librería antes de que hubiera un solo dato que dibujar. Es el
 * caso de la regla de CLAUDE.md: librerías pesadas sólo por `await import()`.
 *
 * **El chunk se descarga gratis.** El gráfico no se monta hasta que hay datos,
 * o sea después de `fetchBranchHourlySalesOrdered`, y hasta entonces el modal ya
 * pintaba `AiThinkingState`. La descarga corre en paralelo con esa consulta y
 * usa **el mismo** estado de espera como `Suspense`: las dos esperas se leen
 * como una.
 *
 * ── Qué se queda del otro lado ───────────────────────────────────────────
 * El tooltip llega como elemento (`tooltip`) y no vive acá: lee `branchName`,
 * `timeRange` y `activeView` del estado del formulario, así que moverlo
 * significaría o pasar cuatro props más o duplicar el estado. Lo que este
 * archivo aporta es exclusivamente el dibujo.
 *
 * ── La rejilla y los ejes van por token ──────────────────────────────────
 * Al mudarse acá, el `gate:design` señaló tres hex crudos que arrastraba este
 * dibujo desde siempre: `#E2E8F0` en la rejilla y `#64748B` en los dos ejes.
 * No estaban ahí por una decisión —el archivo de origen tiene una excepción
 * `hex` de manga ancha, escrita para la marca de agua y la leyenda, que los
 * tapaba de paso— y valen exactamente lo que ya usan los otros cuatro gráficos
 * del portal para el MISMO papel: `--divider` para la rejilla y
 * `--text-tertiary` para las etiquetas. De paso los arregla en tema oscuro,
 * donde un slate-200 clavado pintaba la rejilla casi blanca sobre la card.
 * Los colores de las BARRAS no se tocan: salen de `--txvol-*` y los decide
 * quien arma los datos.
 *
 * ── OJO al tocar esto: el bucle de WebKit ────────────────────────────────
 * `ChartContainer` NO es decorativo — resuelve un bucle infinito de recharts
 * («Maximum update depth exceeded») que sólo aparece en WebKit móvil, cuando un
 * ancestro se está animando, y que era **intermitente**: 3 de 5 corridas. El
 * detalle completo está en el encabezado de `ChartContainer.jsx`.
 */
export default function GraficaAfluencia({ data, tooltip, onBarClick, barCursor = 'default' }) {
    return (
        <ChartContainer>
            <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} transform-gpu>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--divider)" />
                <XAxis dataKey="displayLabel" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: 'var(--text-tertiary)' }} dy={12} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: 'var(--text-tertiary)' }} />
                <Tooltip content={tooltip} cursor={{ fill: 'transparent' }} />
                <Bar
                    dataKey="avgTransactions"
                    radius={[5, 5, 0, 0]}
                    onClick={onBarClick}
                    cursor={barCursor}
                    className="transform-gpu transition-all duration-[var(--dur-slow)] hover:opacity-90"
                >
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}
