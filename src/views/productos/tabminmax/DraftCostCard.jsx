// Extracted from TabMinMax.jsx (Bloque 6.C)
import { Target } from 'lucide-react';
import { fmtMoney } from './helpers';
import StatCard from '../../../components/common/StatCard';

/**
 * El rango de inversión del catálogo, como una tarjeta más del carril.
 *
 * Era la única de la fila que dibujaba DOS montos con una flecha en medio, y por
 * eso medía casi el doble que sus vecinas. En el canónico el valor es uno: acá
 * es `MIN → MAX` en una sola cadena, y la delta del borrador —que es lo que
 * cambia— baja al detalle en vez de colgar de la etiqueta.
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
            label={isBodega ? 'Σ red' : 'Rango MIN·MAX'}
            value={`${fmtMoney(hasDraft ? effMin : pubMin)} → ${fmtMoney(hasDraft ? effMax : pubMax)}`}
            sub={hasAnyDelta
                ? `Borrador ${deltaMax >= 0 ? '+' : ''}${fmtMoney(deltaMax)}`
                : 'Inversión'}
        />
    );
}
