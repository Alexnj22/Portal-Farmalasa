// ERP branch names/order/alert config — shared by TabMinMax.jsx (main
// component body) and its extracted sub-components (Bloque 6.C).
export const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
export const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

export const ALERT = {
    out_of_stock: { label: 'Sin stock',     pill: 'bg-slate-100/90 text-slate-600 border-slate-200', dot: 'bg-red-500',     row: 'bg-red-50/40'    },
    below_min:    { label: 'Bajo mínimo',   pill: 'bg-slate-100/90 text-slate-600 border-slate-200', dot: 'bg-orange-500',  row: 'bg-orange-50/20' },
    approaching:  { label: 'Próx. mínimo',  pill: 'bg-slate-100/90 text-slate-600 border-slate-200', dot: 'bg-amber-400',   row: ''                },
    ok:           { label: 'OK',            pill: 'bg-slate-100/90 text-slate-600 border-slate-200', dot: 'bg-emerald-500', row: ''                },
    overstocked:  { label: 'Exceso',        pill: 'bg-slate-100/90 text-slate-600 border-slate-200', dot: 'bg-blue-400',    row: 'bg-blue-50/10'   },
    dead_stock:   { label: 'Sin movimiento',pill: 'bg-slate-100/90 text-slate-500 border-slate-200', dot: 'bg-slate-300',   row: 'bg-slate-50/60'  },
    no_data:      { label: 'Sin historial', pill: 'bg-slate-100/90 text-slate-500 border-slate-200', dot: 'bg-slate-300',   row: ''                },
};

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
