// Extracted from TabMinMax.jsx (Bloque 6.C)
import { DollarSign, TrendingUp, TrendingDown, Layers } from 'lucide-react';
import { fmtMoney } from './helpers';

export default function CostCards({ summary, isBodega }) {
    const total  = Number(summary.total_cost)  || 0;
    const useful = Number(summary.useful_cost) || 0;
    const excess = Number(summary.excess_cost) || 0;
    const dead   = Number(summary.dead_cost)   || 0;

    const STATS = [
        { label: 'Inventario', value: fmtMoney(total),  color: 'text-content', icon: DollarSign,  iconCls: 'text-content-3',
            tooltip: 'Valor a costo de TODO el inventario físico en esta sucursal — tenga o no MIN/MAX calculado.' },
        ...(!isBodega ? [
            { label: 'Inventario útil',  value: fmtMoney(useful), color: 'text-content', icon: TrendingUp,  iconCls: 'text-content-3',
                tooltip: 'Parte del inventario que está DENTRO del MAX configurado — la porción que vas a rotar en el ciclo normal de reposición.' },
            { label: 'Capital excedente',value: fmtMoney(excess), color: 'text-content', icon: TrendingDown,iconCls: 'text-content-3',
                tooltip: 'Parte del inventario que SUPERA el MAX configurado — capital de más, inmovilizado innecesariamente (sobre-stock).' },
        ] : []),
        { label: 'Sin movimiento', value: fmtMoney(dead),   color: 'text-content', icon: Layers,      iconCls: 'text-content-3',
            tooltip: 'Productos con stock físico pero SIN ningún MIN/MAX calculado en esta sucursal — nunca tuvieron venta suficiente para generar una referencia.' },
    ];

    return (
        <div className="flex items-center gap-2.5 flex-wrap">
            {STATS.map(({ label, value, color, icon: Icon, iconCls, tooltip }) => (
                <div key={label}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-border-card backdrop-blur-sm"
                    style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}
                    title={tooltip}>
                    <Icon size={13} className={`shrink-0 ${iconCls}`} />
                    <div className="flex flex-col leading-snug gap-0.5">
                        <span className="text-[10px] font-semibold text-content-3">{label}</span>
                        <span className={`text-[14px] font-black tabular-nums leading-none ${color}`}>{value}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}
