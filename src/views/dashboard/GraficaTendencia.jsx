import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import ChartContainer from '../../components/common/ChartContainer';

/**
 * El área de «Tendencia de Asistencia» del Inicio, en su propio módulo para que
 * `recharts` viaje en un chunk aparte.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────────
 * `recharts` pesa **95 kB gzip** y era el 46% de los 204 kB que se bajaban al
 * entrar al Inicio — para dibujar **un** gráfico, dentro de **un** widget que
 * además es opcional (permiso `dash_trend` y el usuario puede sacarlo de su
 * tablero). O sea: casi la mitad del costo de la pantalla de aterrizaje del
 * portal la pagaba todo el mundo, la mirara o no.
 *
 * Es exactamente el caso de la regla de CLAUDE.md —librerías pesadas sólo por
 * `await import()`— y el motivo por el que `DashboardView` cruzaba su techo del
 * `bundle-gate` (204 contra 196). El `React.lazy` va del lado del llamador; acá
 * sólo vive el gráfico.
 *
 * **El chunk se descarga gratis.** El gráfico no se monta hasta que
 * `attendanceLoaded` es verdadero, o sea después de una consulta a la base, y
 * hasta entonces el widget ya pintaba un esqueleto. La descarga de recharts corre
 * en paralelo con esa consulta y usa el mismo esqueleto como espera: no hay un
 * segundo estado de carga que el usuario pueda notar.
 *
 * ── OJO al tocar esto: el bucle de WebKit ────────────────────────────────
 * El envoltorio `ChartContainer` NO es decorativo — resuelve un bucle infinito
 * de recharts (`Maximum update depth exceeded`) que sólo aparece en WebKit
 * móvil, cuando un ancestro se está animando, y que era **intermitente**: 3 de
 * 5 corridas. Por eso el gráfico va siempre dentro de él y por eso cualquier
 * cambio acá se verifica con 5-6 corridas en WebKit con viewport de teléfono,
 * no con una. El detalle completo está en el encabezado de `ChartContainer.jsx`.
 */
export default function GraficaTendencia({ data }) {
    return (
        <ChartContainer>
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs><linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--brand)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--brand)" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false}/>
                <XAxis dataKey="day" tick={{fontSize:11,fill:"var(--text-tertiary)",fontWeight:600}} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip contentStyle={{background:"var(--tooltip-bg)",border:'none',borderRadius:'0.75rem',fontSize:12,color:"var(--tooltip-text)"}} labelStyle={{color:'var(--tooltip-text-2)',fontWeight:700}} formatter={(v,_,p)=>[v,`Presentes · ${p.payload?.date||''}`]}/>
                <Area type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2.5} fill="url(#colorTotal)" dot={{fill:"var(--brand)",strokeWidth:0,r:3}} activeDot={{r:5,fill:"var(--brand)"}}/>
            </AreaChart>
        </ChartContainer>
    );
}
