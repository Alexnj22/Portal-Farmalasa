// Extracted from TabMinMax.jsx (Bloque 6.C)
import { Target } from 'lucide-react';
import { fmtMoney } from './helpers';

export default function DraftCostCard({ draftCost, isBodega }) {
    const pubMin  = Number(draftCost?.pub_min_cost  ?? draftCost?.min_cost  ?? 0);
    const pubMax  = Number(draftCost?.pub_max_cost  ?? draftCost?.max_cost  ?? 0);
    const effMin  = Number(draftCost?.eff_min_cost  ?? pubMin);
    const effMax  = Number(draftCost?.eff_max_cost  ?? pubMax);
    const hasDraft = Number(draftCost?.draft_count ?? 0) > 0;
    const deltaMax = effMax - pubMax;
    const hasAnyDelta = hasDraft && Math.abs(deltaMax) > 0.01;
    if (!draftCost || (!pubMin && !pubMax && !effMin && !effMax)) return null;
    const label = isBodega ? 'Σ red efectiva' : 'Catálogo a MIN·MAX';
    const tooltip = isBodega
        ? 'Costo de la suma de sucursales al MIN → al MAX (efectivo: usa el borrador si hay uno pendiente).'
        : 'Costo de tener el catálogo COMPLETO al nivel MIN → al nivel MAX (usa el borrador si hay uno pendiente). No resta el stock actual — no es "lo que falta comprar", es el rango de inversión total del catálogo configurado.';
    return (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-border-card backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}
            title={tooltip}>
            <Target size={13} className={`shrink-0 ${isBodega ? 'text-warning' : 'text-violet-400'}`} />
            <div className="flex flex-col leading-snug gap-0.5">
                <span className="text-[10px] font-semibold text-content-3">
                    {label}
                    {hasAnyDelta && (
                        <span className={`ml-1.5 tabular-nums font-bold ${deltaMax >= 0 ? 'text-success' : 'text-danger'}`}>
                            {deltaMax >= 0 ? '+' : ''}{fmtMoney(deltaMax)}
                        </span>
                    )}
                </span>
                <div className="flex items-baseline gap-1">
                    <span className="text-[14px] font-black tabular-nums leading-none text-content">{fmtMoney(hasDraft ? effMin : pubMin)}</span>
                    <span className="text-[10px] text-content-3 leading-none">→</span>
                    <span className="text-[14px] font-black tabular-nums leading-none text-content">{fmtMoney(hasDraft ? effMax : pubMax)}</span>
                </div>
            </div>
        </div>
    );
}
