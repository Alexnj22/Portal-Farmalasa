/**
 * Las gráficas del tablero de la distribuidora, en su propio módulo para que
 * `recharts` viaje en un chunk aparte (regla de CLAUDE.md: librerías pesadas
 * sólo por import diferido; el tablero las pide con `React.lazy`).
 *
 * Todas van dentro de `ChartContainer` por el bucle de recharts en WebKit
 * móvil (ver su encabezado), y sin animación por lo mismo.
 *
 * Color: la serie del período es `--chart-1`; el período anterior va en
 * pizarra (`--chart-8`) y punteado, para que se lea como referencia y no como
 * otra serie que compite. Las categorías (rutas, tipos, formas de pago) toman
 * la paleta vigente por posición (la misma lista `PUNTOS` del tablero).
 */
import React from 'react';
import {
    ComposedChart, Area, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie,
} from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';
import { formatMoney, formatMoneyCorto, formatQty } from '@nucleo/utils/formatNumber';
import { diaCorto, serieDiaria, semanaCompleta, horasDelDia } from '@nucleo/utils/distribucionTablero';

// La paleta vigente de DESIGN.md §6 (chart-2, -5 y -7 están retirados).
const COLORES = ['var(--chart-1)', 'var(--success)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-9)',
    'var(--chart-6)', 'var(--warning)', 'var(--chart-8)'];
const REJILLA = 'var(--divider)';
const TEXTO = 'var(--text-tertiary)';
const EJE = { fontSize: 10, fill: TEXTO, fontWeight: 700 };
const TOOLTIP = {
    background: 'var(--surface-modal)', border: '1px solid var(--border-modal)',
    borderRadius: '0.75rem', fontSize: 12, color: 'var(--text-primary)', backdropFilter: 'blur(20px)',
};
// Los días, las horas y la serie salen del núcleo: la app pinta los mismos.
const dia = diaCorto;
const dinero = (v) => formatMoney(Number(v) || 0);
const dineroCorto = (v) => formatMoneyCorto(Number(v) || 0);

/**
 * Ventas (o documentos) por día, con el período anterior de referencia. El
 * anterior se alinea por POSICIÓN (día 1 con día 1), así la curva punteada
 * dice «así íbamos entonces» sin importar qué fecha era.
 */
export function GraficaVentasDiarias({ serie, metrica = 'ventas' }) {
    const datos = serieDiaria(serie);
    const esDinero = metrica === 'ventas';
    return (
        <ChartContainer minHeight={240}>
            <ComposedChart data={datos} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                <defs>
                    <linearGradient id="tableroVentas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={REJILLA} vertical={false} />
                <XAxis dataKey="etiqueta" interval="preserveStartEnd" minTickGap={28} tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={EJE} tickFormatter={esDinero ? dineroCorto : formatQty} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ stroke: TEXTO, strokeDasharray: '4 4' }}
                    formatter={(v, nombre) => [esDinero ? dinero(v) : `${formatQty(v)} documentos`, nombre]} />
                <Area type="monotone" dataKey={metrica} name={esDinero ? 'Ventas' : 'Documentos'} stroke="var(--chart-1)"
                    strokeWidth={2} fill="url(#tableroVentas)" dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface-card)' }} isAnimationActive={false} />
                {esDinero && (
                    <Line type="monotone" dataKey="anterior" name="Período anterior" stroke="var(--chart-8)"
                        strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                )}
            </ComposedChart>
        </ChartContainer>
    );
}

/**
 * La utilidad por día (Reportes): la venta sin IVA como área y lo que queda
 * después del costo como barras verdes encima de la misma escala, así el alto
 * de la barra contra el área ES el margen del día.
 */
export function GraficaUtilidadDiaria({ serie }) {
    const datos = (serie ?? []).map(d => {
        const venta = Number(d.venta) || 0;
        return { etiqueta: dia(d.fecha), venta, utilidad: Math.round((venta - (Number(d.costo) || 0)) * 100) / 100 };
    });
    return (
        <ChartContainer minHeight={220}>
            <ComposedChart data={datos} margin={{ top: 8, right: 12, left: -4, bottom: 0 }}>
                <defs>
                    <linearGradient id="utilidadVenta" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid stroke={REJILLA} vertical={false} />
                <XAxis dataKey="etiqueta" interval="preserveStartEnd" minTickGap={28} tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={52} tick={EJE} tickFormatter={dineroCorto} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'var(--surface-card-hover)' }} formatter={(v, nombre) => [dinero(v), nombre]} />
                <Area type="monotone" dataKey="venta" name="Venta sin IVA" stroke="var(--chart-1)" strokeWidth={2}
                    fill="url(#utilidadVenta)" dot={false} isAnimationActive={false} />
                <Bar dataKey="utilidad" name="Utilidad" fill="var(--success)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </ComposedChart>
        </ChartContainer>
    );
}

/**
 * Una dona de participación. Tocar un sector lo elige (y otro toque lo
 * suelta): el tablero lo usa para filtrar por ruta.
 */
export function GraficaDona({ datos, clave, valor = 'ventas', activo = null, onElegir, alto = 190 }) {
    const filas = (datos ?? []).map(d => ({ ...d, [valor]: Number(d[valor]) || 0 }));
    return (
        <ChartContainer minHeight={alto}>
            <PieChart>
                <Tooltip contentStyle={TOOLTIP} formatter={(v, n) => [dinero(v), n]} />
                <Pie data={filas} dataKey={valor} nameKey={clave} innerRadius="58%" outerRadius="88%" paddingAngle={2}
                    isAnimationActive={false} stroke="var(--surface-card)" strokeWidth={2}
                    onClick={onElegir ? (d) => onElegir(d?.[clave] === activo ? null : d?.[clave]) : undefined}
                    cursor={onElegir ? 'pointer' : undefined}>
                    {filas.map((d, i) => (
                        <Cell key={d[clave]} fill={COLORES[i % COLORES.length]} fillOpacity={activo && activo !== d[clave] ? 0.3 : 1} />
                    ))}
                </Pie>
            </PieChart>
        </ChartContainer>
    );
}

/** Ventas por día de la semana (lunes a domingo, los que no tienen van en cero). */
export function GraficaSemana({ datos }) {
    const filas = semanaCompleta(datos);
    return (
        <ChartContainer minHeight={170}>
            <BarChart data={filas} margin={{ top: 8, right: 8, left: -4, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke={REJILLA} vertical={false} />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={EJE} />
                <YAxis tickLine={false} axisLine={false} width={46} tick={EJE} tickFormatter={dineroCorto} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: REJILLA, opacity: 0.35 }}
                    formatter={(v, _n, p) => [`${dinero(v)} · ${formatQty(p?.payload?.documentos)} documentos`, 'Ventas']} />
                <Bar dataKey="ventas" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                    {/* El mejor día resalta: es lo que se busca en esta gráfica. */}
                    {filas.map(f => <Cell key={f.etiqueta} fill={f.mejor ? 'var(--success)' : 'var(--chart-1)'} />)}
                </Bar>
            </BarChart>
        </ChartContainer>
    );
}

/** Documentos por hora del día (de 6 a 20). */
export function GraficaHoras({ datos }) {
    const filas = horasDelDia(datos);
    return (
        <ChartContainer minHeight={170}>
            <BarChart data={filas} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="16%">
                <CartesianGrid stroke={REJILLA} vertical={false} />
                <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tick={EJE} interval={1} />
                <YAxis tickLine={false} axisLine={false} width={40} tick={EJE} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP} cursor={{ fill: REJILLA, opacity: 0.35 }}
                    formatter={(v, _n, p) => [`${formatQty(v)} documentos · ${dinero(p?.payload?.ventas)}`, 'A esa hora']} />
                <Bar dataKey="documentos" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
        </ChartContainer>
    );
}

export default GraficaVentasDiarias;
