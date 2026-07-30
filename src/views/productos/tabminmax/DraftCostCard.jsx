// Extracted from TabMinMax.jsx (Bloque 6.C)
import { Target } from 'lucide-react';
import { fmtMoney } from './helpers';
import StatCard from '../../../components/common/StatCard';

/**
 * El rango de inversión del catálogo, como una tarjeta más del carril.
 *
 * Era la única de la fila que dibujaba DOS montos con una flecha en medio, y por
 * eso medía casi el doble que sus vecinas. Se probó juntarlos en una cadena
 * `MIN → MAX` y tampoco entra: con la tarjeta topada en 200px se leía
 * `$15.9k → …`, o sea el segundo monto —el que importa— cortado.
 *
 * Queda **el MAX solo**. Es el techo de la inversión, que es la pregunta que se
 * le hace a esta tarjeta ("¿cuánto cuesta tener el catálogo completo?"); el MIN
 * es el piso teórico y se consulta mucho menos. El detalle dice cuál es, para
 * que el número no quede sin apellido.
 */
export default function DraftCostCard({ draftCost, isBodega }) {
    const pubMin  = Number(draftCost?.pub_min_cost  ?? draftCost?.min_cost  ?? 0);
    const pubMax  = Number(draftCost?.pub_max_cost  ?? draftCost?.max_cost  ?? 0);
    const effMin  = Number(draftCost?.eff_min_cost  ?? pubMin);
    const effMax  = Number(draftCost?.eff_max_cost  ?? pubMax);
    const hasDraft = Number(draftCost?.draft_count ?? 0) > 0;
    const deltaMax = effMax - pubMax;
    const hasAnyDelta = hasDraft && Math.abs(deltaMax) > 0.01;
    if (!draftCost || (!pubMin && !pubMax && !effMin && !effMax)) return null;

    return (
        <StatCard
            icon={Target}
            label={isBodega ? 'Σ red al MAX' : 'Catálogo al MAX'}
            value={fmtMoney(hasDraft ? effMax : pubMax)}
            sub={hasAnyDelta
                ? `Borrador ${deltaMax >= 0 ? '+' : ''}${fmtMoney(deltaMax)}`
                : 'Techo al MAX'}
        />
    );
}
