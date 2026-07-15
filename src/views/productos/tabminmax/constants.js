// ABC — revenue contribution class (extracted from TabMinMax.jsx, Bloque 6.C)
export const ABC_CFG = {
    A: { bg: 'bg-slate-50 text-slate-600 border-slate-200',       title: 'Clase A — top 70% ingresos', color: '#64748b' },
    B: { bg: 'bg-slate-50 text-slate-500 border-slate-200',       title: 'Clase B — siguiente 20%',    color: '#94a3b8' },
    C: { bg: 'bg-amber-50 text-amber-600 border-amber-200',       title: 'Clase C — restante 10%',     color: '#f59e0b' },
    D: { bg: 'bg-slate-50 text-slate-500 border-slate-200',       title: 'Sin ventas en período',      color: '#94a3b8' },
};

// XYZ — demand variability (replaces stable/moderate/erratic)
export const XYZ_CFG = {
    X: { label: 'X', desc: 'Estable',   cls: 'text-slate-600 bg-slate-50 border-slate-200', color: '#64748b' },
    Y: { label: 'Y', desc: 'Moderada',  cls: 'text-slate-500 bg-slate-50 border-slate-200', color: '#94a3b8' },
    Z: { label: 'Z', desc: 'Errática',  cls: 'text-rose-600 bg-rose-50 border-rose-200',    color: '#e11d48' },
    // Legacy support (old data before migration)
    stable:   { label: 'X', desc: 'Estable',  cls: 'text-slate-600 bg-slate-50 border-slate-200', color: '#64748b' },
    moderate: { label: 'Y', desc: 'Moderada', cls: 'text-slate-500 bg-slate-50 border-slate-200', color: '#94a3b8' },
    erratic:  { label: 'Z', desc: 'Errática', cls: 'text-rose-600 bg-rose-50 border-rose-200',    color: '#e11d48' },
};
