// Extracted from TabMinMax.jsx (Bloque 6.C)
export default function StockBar({ current, min, max }) {
    const c  = Number(current) || 0;
    const mn = Number(min)     || 0;
    const mx = Number(max)     || 0;
    if (!mx && !mn) return null;
    const ceil = Math.max(mx * 1.3, c * 1.15, mn * 3, 1);
    const pct  = v => `${Math.min(100, (v / ceil) * 100).toFixed(2)}%`;
    const fill = c === 0 ? 'bg-danger' : c < mn ? 'bg-chart-4' : c > mx ? 'bg-chart-1' : 'bg-success';
    return (
        <div className="relative h-[3px] w-full bg-surface-card-hover rounded-full mt-1.5">
            <div className={`absolute left-0 top-0 h-full rounded-full ${fill} transition-all`} style={{ width: pct(c) }} />
            {mn > 0 && <div className="absolute top-[-2px] h-[7px] w-[2px] bg-chart-4/80 rounded-full" style={{ left: pct(mn) }} />}
            {mx > 0 && <div className="absolute top-[-2px] h-[7px] w-[2px] bg-chart-1/70 rounded-full"   style={{ left: pct(mx) }} />}
        </div>
    );
}
