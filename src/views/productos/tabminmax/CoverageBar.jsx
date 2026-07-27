// Extracted from TabMinMax.jsx (Bloque 6.C)
export default function CoverageBar({ current, velocity, cycleDays }) {
    const days = velocity > 0 ? current / velocity : null;
    if (days === null) return <span className="text-content-3 text-xs">—</span>;
    const pct  = Math.min(100, (days / cycleDays) * 100);
    const fill = days === 0 ? 'var(--stock-out)' : days < (cycleDays * 0.2) ? 'var(--stock-below-min)' : days < (cycleDays * 0.5) ? 'var(--warning)' : 'var(--chart-2)';
    const label = days >= 999 ? '>999d' : `${Math.round(days)}d`;
    return (
        <div className="flex flex-col gap-0.5 items-end">
            <span className="text-label font-black tabular-nums" style={{ color: fill }}>{label}</span>
            <div className="w-14 h-[3px] rounded-full bg-surface-card-hover overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: fill }} />
            </div>
        </div>
    );
}
