// Extracted from TabMinMax.jsx (Bloque 6.C)
import React, { useMemo } from 'react';
import { BarChart2, X } from 'lucide-react';
import { normXyz } from './helpers';

const XYZ_KEYS = ['X', 'Y', 'Z'];
const ABC_KEYS = ['A', 'B', 'C'];

export default function AbcXyzMatrix({ data, filterAbc, setFilterAbc, filterXyz, setFilterXyz, loading }) {
    const matrix = useMemo(() => {
        const m = {};
        for (const abc of ABC_KEYS)
            for (const xyz of XYZ_KEYS)
                m[`${abc}${xyz}`] = 0;
        for (const r of data) {
            if (r.is_dead_stock || r.alert_status === 'no_data') continue;
            const abc = r.draft_abc_class || r.abc_class || 'D';
            const xyz = normXyz(r.draft_demand_variability || r.demand_variability);
            if (m[`${abc}${xyz}`] !== undefined) m[`${abc}${xyz}`]++;
        }
        return m;
    }, [data]);

    const maxCell = Math.max(1, ...Object.values(matrix));

    const toggle = (abc, xyz) => {
        setFilterAbc(pa => pa === abc ? 'all' : abc);
        setFilterXyz(px => px === xyz ? 'all' : xyz);
    };

    // Era `background: rgba(255,255,255,.52)` con su propio brillo interior:
    // blanco FIJO, así que la matriz quedaba clara sobre los dos temas
    // oscuros. La superficie sale de `data-surface="card"` y el vidrio de la
    // escala `--shadow-glass-*`, que ya modela elevación + brillo (D3.8).

    const isAbcActive = (abc) => filterAbc === abc;
    const isXyzActive = (xyz) => filterXyz === xyz;

    if (loading || data.length === 0) {
        return (
            <div className="rounded-2xl border border-border-card p-2.5 flex flex-col gap-1.5" data-surface="card">
                <span className="text-micro font-black uppercase tracking-widest text-content-2">ABC × XYZ</span>
                {loading ? (
                    <div className="grid gap-[3px] animate-pulse" style={{ gridTemplateColumns: '20px repeat(3, 1fr)' }}>
                        {Array.from({ length: 16 }).map((_, i) => (
                            <div key={i} className="h-8 rounded-lg bg-surface-card-hover/70" />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-4 gap-1.5 text-content-3">
                        <BarChart2 size={22} className="text-content-3" />
                        <span className="text-micro font-semibold">Sin datos — presioná Calcular</span>
                    </div>
                )}
            </div>
        );
    }

    const headerBtnCls = (active) =>
        `py-1 px-2 rounded-md text-caption font-black text-center
         transition-[background-color,box-shadow,color] duration-75
         ${active
             ? 'text-brand-text bg-[rgba(0,82,204,0.11)] shadow-[var(--shadow-glass-1)]'
             : 'text-content-3 hover:text-content-2 hover:bg-surface-card'}`;

    return (
        <div className="rounded-2xl border border-border-card p-2 flex flex-col gap-1" data-surface="card">
            <div className="flex items-center justify-between gap-2">
                <span className="text-micro font-black uppercase tracking-widest text-content-2">ABC × XYZ</span>
                {(filterAbc !== 'all' || filterXyz !== 'all') && (
                    <button
                        onClick={() => { setFilterAbc('all'); setFilterXyz('all'); }}
                        className="text-micro font-bold text-content-3 hover:text-danger-text flex items-center gap-0.5 transition-colors duration-75 px-1.5 py-0.5 rounded-md hover:bg-danger/10">
                        <X size={8} strokeWidth={2.5} /> limpiar
                    </button>
                )}
            </div>

            <div className="grid gap-[3px]" style={{ gridTemplateColumns: '18px repeat(3, 1fr)' }}>
                {/* XYZ header */}
                <div />
                {XYZ_KEYS.map(xyz => (
                    <button key={xyz}
                        onClick={() => setFilterXyz(p => p === xyz ? 'all' : xyz)}
                        className={headerBtnCls(isXyzActive(xyz))}>
                        {xyz}
                    </button>
                ))}

                {/* Rows */}
                {ABC_KEYS.map(abc => (
                    <React.Fragment key={abc}>
                        <button
                            onClick={() => setFilterAbc(p => p === abc ? 'all' : abc)}
                            className={headerBtnCls(isAbcActive(abc))}>
                            {abc}
                        </button>
                        {XYZ_KEYS.map(xyz => {
                            const count = matrix[`${abc}${xyz}`];
                            const isActive = filterAbc === abc && filterXyz === xyz;
                            const intensity = count > 0 ? Math.max(0.07, (count / maxCell) * 0.28) : 0;
                            return (
                                <button key={xyz}
                                    onClick={() => count > 0 && toggle(abc, xyz)}
                                    className={`relative py-1.5 rounded-md text-center
                                        transition-transform duration-150
                                        ${count > 0 ? 'active:scale-[0.97] hover:translate-y-[var(--lift-hover)]' : ''}
                                        ${count === 0 ? 'opacity-20 cursor-default' : 'cursor-pointer'}
                                        ${isActive ? 'z-base' : ''}`}
                                    style={{
                                        background: isActive
                                            ? `rgba(0,82,204,${Math.min(0.22, intensity + 0.10)})`
                                            : count > 0 ? `rgba(0,82,204,${intensity})` : 'rgba(0,0,0,0.02)',
                                        backdropFilter: isActive ? 'blur(10px) saturate(180%)' : undefined,
                                        WebkitBackdropFilter: isActive ? 'blur(10px) saturate(180%)' : undefined,
                                        boxShadow: isActive
                                            ? '0 4px 14px rgba(0,82,204,0.24), inset 0 1px 0 rgba(255,255,255,0.85)'
                                            : count > 0 ? '0 1px 4px rgba(0,82,204,0.07)' : undefined,
                                        outline: isActive ? '1.5px solid rgba(0,82,204,0.55)' : undefined,
                                        outlineOffset: isActive ? '1.5px' : undefined,
                                    }}
                                    disabled={count === 0}>
                                    <span className="text-label font-black text-content-2 tabular-nums leading-none">{count || '—'}</span>
                                    {count > 0 && <span className="text-micro font-semibold text-content-3 block">{abc}{xyz}</span>}
                                </button>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>

            {/* Legend — one line */}
            <div className="flex items-center gap-2.5 border-t border-border-card pt-1">
                {XYZ_KEYS.map((xyz, i) => {
                    const descs = ['Estable', 'Mod.', 'Errática'];
                    return (
                        <span key={xyz} className="flex items-center gap-0.5 text-micro">
                            <span className={`font-black transition-colors duration-100 ${isXyzActive(xyz) ? 'text-brand-text' : 'text-content-3'}`}>{xyz}</span>
                            <span className="text-content-3">{descs[i]}</span>
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
