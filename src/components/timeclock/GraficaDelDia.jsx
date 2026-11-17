import React from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartContainer from '../common/ChartContainer';
import { formatMoney, formatMoneyCorto } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';

// Aparte para que `recharts` viaje en su propio chunk (regla de librerías
// pesadas): «Cómo va hoy» lo carga con `lazy` sólo cuando se abre.
const COLOR = {
    real: 'var(--chart-1)',
    esperado: 'var(--text-tertiary)',
    rejilla: 'var(--divider)',
    texto: 'var(--text-tertiary)',
};
const rotulo = (h) => hora12(`${h}:00`).replace(':00', '');

export default function GraficaDelDia({ serie, ocultarMontos = false, base = 1 }) {
    const valor = (v) => (ocultarMontos ? `${Math.round((v / base) * 100)} %` : formatMoney(v));
    return (
        <ChartContainer minHeight={220}>
            <ComposedChart data={serie} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <defs>
                    <linearGradient id="relleno-hoy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={COLOR.real} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={COLOR.real} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={COLOR.rejilla} vertical={false} />
                <XAxis dataKey="hora" tickFormatter={rotulo} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: COLOR.texto, fontWeight: 700 }} />
                <YAxis tickLine={false} axisLine={false} width={68}
                    tick={{ fontSize: 11, fill: COLOR.texto, fontWeight: 700 }}
                    tickFormatter={(v) => (ocultarMontos ? '' : v ? formatMoneyCorto(v) : '0')} />
                <Tooltip
                    contentStyle={{ background: 'var(--surface-modal)', border: '1px solid var(--border-modal)', borderRadius: '0.75rem', fontSize: 12, color: 'var(--text-primary)' }}
                    labelFormatter={(h) => `Hasta las ${hora12(`${(Number(h) + 1) % 24}:00`)}`}
                    formatter={(v, k) => [valor(v), k === 'real' ? 'Hoy' : 'Lo esperado']} />
                <Line type="monotone" dataKey="esperado" stroke={COLOR.esperado} strokeWidth={2} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="real" stroke={COLOR.real} strokeWidth={3} fill="url(#relleno-hoy)" connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
        </ChartContainer>
    );
}
