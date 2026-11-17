import React from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartContainer from '../common/ChartContainer';
import { formatMoney, formatMoneyCorto } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';

// Aparte para que `recharts` viaje en su propio chunk (regla de librerías
// pesadas): «Cómo va hoy» lo carga con `lazy` sólo cuando se abre.
// Los valores llegan como PARTE de la base del día (1 = la meta del día). Con
// `base` (sólo quien ve montos) se dibujan en dinero; sin ella, en %.
const COLOR = {
    real: 'var(--chart-1)',
    esperado: 'var(--text-tertiary)',
    pasada: 'var(--chart-3)',
    rejilla: 'var(--divider)',
    texto: 'var(--text-tertiary)',
};
const rotulo = (h) => hora12(`${h}:00`).replace(':00', '');
const NOMBRE = { real: 'Hoy', esperado: 'Lo esperado', pasada: 'Semana pasada' };

export default function GraficaDelDia({ serie, base = null }) {
    const valor = (v) => (base ? formatMoney(v * base) : `${Math.round(v * 100)} %`);
    const eje = (v) => (base ? (v ? formatMoneyCorto(v * base) : '0') : `${Math.round(v * 100)} %`);
    return (
        <ChartContainer minHeight={240}>
            <ComposedChart data={serie} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                    <linearGradient id="relleno-hoy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR.real} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLOR.real} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="hora" tickFormatter={rotulo} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: COLOR.texto, fontWeight: 700 }} />
                <YAxis tickLine={false} axisLine={false} width={68} tickFormatter={eje}
                    tick={{ fontSize: 11, fill: COLOR.texto, fontWeight: 700 }} />
                <Tooltip
                    contentStyle={{ background: 'var(--surface-modal)', border: '1px solid var(--border-modal)', borderRadius: '0.75rem', fontSize: 12, color: 'var(--text-primary)' }}
                    labelFormatter={(h) => `Hasta las ${hora12(`${(Number(h) + 1) % 24}:00`)}`}
                    formatter={(v, k) => [valor(v), NOMBRE[k] ?? k]} />
                <Line type="monotone" dataKey="esperado" stroke={COLOR.esperado} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="pasada" stroke={COLOR.pasada} strokeWidth={1.5} strokeOpacity={0.7} dot={false} connectNulls isAnimationActive={false} />
                <Area type="monotone" dataKey="real" stroke={COLOR.real} strokeWidth={3} fill="url(#relleno-hoy)" connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
        </ChartContainer>
    );
}
