// Extracted from TabMinMax.jsx (Bloque 6.C)
export default function CardSkeletons({ isBodega }) {
    const count = isBodega ? 2 : 4;
    return (
        <div className="flex items-center gap-2.5 flex-wrap">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-border-card backdrop-blur-sm animate-pulse"
                    style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
                    <div className="w-3.5 h-3.5 rounded-full bg-surface-card-hover/80 shrink-0" />
                    <div className="flex flex-col gap-1.5">
                        <div className="h-2 w-16 rounded bg-surface-card-hover/80" />
                        <div className="h-3 w-20 rounded bg-surface-card-hover/80" />
                    </div>
                </div>
            ))}
        </div>
    );
}
