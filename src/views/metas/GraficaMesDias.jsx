import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip, Cell } from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatMoney } from '../../utils/formatNumber';

/**
 * El «día por día» del mes en curso, en su propio módulo para que `recharts`
 * viaje en un chunk aparte.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 * `recharts` pesa **95 kB gzip** y entraba en el cierre estático de `MetasView`
 * —o sea, se bajaba al abrir Metas— aunque el gráfico sólo aparece en una de
 * las dos mitades de una de las cinco pestañas: con una sala elegida manda el
 * termómetro, que no dibuja nada, y las pestañas Bono, Confirmación y Gastos no
 * tienen gráficos. Es el caso de la regla de CLAUDE.md: librerías pesadas sólo
 * por `await import()`.
 *
 * **El chunk se descarga gratis.** `GraficaMes` no se monta hasta que
 * `cargandoMes` es falso, o sea después de `fetchMesEnCurso`, y el `React.lazy`
 * de acá va DENTRO de la tarjeta: el encabezado, el interruptor y el resto de la
 * card pintan enseguida y sólo el área del dibujo espera. La descarga corre en
 * paralelo con esa consulta.
 *
 * Se separa el «día por día» y no la tarjeta entera a propósito: el termómetro
 * no usa recharts, así que quien mira una sola sala nunca baja los 95 kB.
 *
 * ── OJO al tocar esto: el bucle de WebKit ────────────────────────────────
 * `ChartContainer` NO es decorativo — resuelve un bucle infinito de recharts
 * («Maximum update depth exceeded») que sólo aparece en WebKit móvil, cuando un
 * ancestro se está animando, y que era **intermitente**: 3 de 5 corridas. El
 * detalle completo está en el encabezado de `ChartContainer.jsx`.
 */

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

export default function GraficaMesDias({ dias, ritmo }) {
    return (
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
    );
}
