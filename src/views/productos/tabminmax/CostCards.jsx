// Extracted from TabMinMax.jsx (Bloque 6.C)
import { DollarSign, TrendingUp, TrendingDown, Layers } from 'lucide-react';
import { fmtMoney } from './helpers';
import StatCard from '../../../components/common/StatCard';

/**
 * Las tarjetas de costo de MIN·MAX. Devuelve las `StatCard` SUELTAS —sin
 * envoltorio— porque quien las coloca es el `CarrilCards` de la vista.
 *
 * Hasta el 2026-07-30 eran tarjetas a mano: su propio `rounded-2xl` (no el
 * token), su propia tipografía y su propio `flex-wrap`. Dos consecuencias, las
 * dos visibles en la vista:
 *
 * · No se parecían a las tarjetas de ninguna otra vista del portal.
 * · Y como traían envoltorio propio, la fila de controles tenía que ser
 *   `flex-wrap` — así que la píldora saltaba de línea y se estiraba de borde a
 *   borde, que es exactamente lo que se reportó: ni a la derecha ni con
 *   desborde.
 *
 * El `tooltip` de cada una pasa a `sub`: el texto explicativo entero vivía en un
 * `title` nativo, que en el canónico no existe (§25). Y las etiquetas se acortan
 * a una o dos palabras — con la tarjeta topada en 200px, "Capital excedente" se
 * leía "Capital exce…", que no dice nada.
 */
export default function CostCards({ summary, isBodega }) {
    const total  = Number(summary.total_cost)  || 0;
    const useful = Number(summary.useful_cost) || 0;
    const excess = Number(summary.excess_cost) || 0;
    const dead   = Number(summary.dead_cost)   || 0;

    const STATS = [
        { label: 'Inventario', value: fmtMoney(total), icon: DollarSign,
            sub: 'Stock total' },
        ...(!isBodega ? [
            { label: 'Útil', value: fmtMoney(useful), icon: TrendingUp,
                sub: 'Bajo MAX' },
            { label: 'Excedente', value: fmtMoney(excess), icon: TrendingDown,
                sub: 'Sobre MAX' },
        ] : []),
        { label: 'Sin movimiento', value: fmtMoney(dead), icon: Layers,
            sub: 'Sin MIN/MAX' },
    ];

    return STATS.map(s => <StatCard key={s.label} {...s} />);
}
