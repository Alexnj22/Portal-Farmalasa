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
    const label = isBodega ? 'Σ red efectiva' : 'Inversión proyectada';
    return (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-white/70 backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
            <Target size={13} className={`shrink-0 ${isBodega ? 'text-amber-400' : 'text-violet-400'}`} />
            <div className="flex flex-col leading-snug gap-0.5">
                <span className="text-[10px] font-semibold text-slate-500">
                    {label}
                    {hasAnyDelta && (
                        <span className={`ml-1.5 tabular-nums font-bold ${deltaMax >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            {deltaMax >= 0 ? '+' : ''}{fmtMoney(deltaMax)}
                        </span>
                    )}
                </span>
                <div className="flex items-baseline gap-1">
                    <span className="text-[14px] font-black tabular-nums leading-none text-slate-800">{fmtMoney(hasDraft ? effMin : pubMin)}</span>
                    <span className="text-[10px] text-slate-500 leading-none">→</span>
                    <span className="text-[14px] font-black tabular-nums leading-none text-slate-800">{fmtMoney(hasDraft ? effMax : pubMax)}</span>
                </div>
            </div>
        </div>
    );
}
