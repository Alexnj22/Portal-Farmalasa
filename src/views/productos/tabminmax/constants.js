// ERP branch names/order/alert config — shared by TabMinMax.jsx (main
// component body) and its extracted sub-components (Bloque 6.C).
export const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
export const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

export const ALERT = {
    out_of_stock: { label: 'Sin stock',     pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-out',         row: 'bg-stock-out/10'         },
    below_min:    { label: 'Bajo mínimo',   pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-below-min',   row: 'bg-stock-below-min/10'   },
    approaching:  { label: 'Próx. mínimo',  pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-approaching', row: ''                        },
    ok:           { label: 'OK',            pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-ok',          row: ''                        },
    overstocked:  { label: 'Exceso',        pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-overstocked', row: 'bg-stock-overstocked/10' },
    dead_stock:   { label: 'Sin movimiento',pill: 'bg-surface-card-hover text-content-3 border-border-card', dot: 'bg-stock-dead',        row: 'bg-surface-card-hover/60' },
    no_data:      { label: 'Sin historial', pill: 'bg-surface-card-hover text-content-3 border-border-card', dot: 'bg-stock-no-data',     row: ''                        },
};

// Alert stat chips — usados por useMinMaxData.js (inicializar contadores) y
// por TabMinMax.jsx (render de los chips de filtro). Extraído de TabMinMax.jsx
// a este archivo compartido (Bloque 6.C, continuación) para que ambos lo importen.
export const STAT_CFGS = [
    { key: 'out_of_stock', label: 'Sin stock',      dot: 'bg-stock-out',         active: 'bg-stock-out/20 backdrop-blur-sm border-stock-out/40 text-danger-text shadow-[0_3px_14px_rgba(239,68,68,0.22)]',             chipActive: 'bg-stock-out/10 text-danger-text'       },
    { key: 'below_min',    label: 'Bajo mínimo',    dot: 'bg-stock-below-min',   active: 'bg-stock-below-min/20 backdrop-blur-sm border-stock-below-min/40 text-chart-4-text shadow-[0_3px_14px_rgba(249,115,22,0.22)]',   chipActive: 'bg-stock-below-min/10 text-chart-4-text' },
    { key: 'approaching',  label: 'Próx. mínimo',   dot: 'bg-stock-approaching', active: 'bg-stock-approaching/20 backdrop-blur-sm border-stock-approaching/40 text-warning-text shadow-[0_3px_14px_rgba(245,158,11,0.22)]',      chipActive: 'bg-stock-approaching/10 text-warning-text'   },
    { key: 'ok',           label: 'OK',              dot: 'bg-stock-ok', active: 'bg-stock-ok/20 backdrop-blur-sm border-stock-ok/40 text-success-text shadow-[0_3px_14px_rgba(16,185,129,0.22)]', chipActive: 'bg-stock-ok/10 text-success-text'},
    { key: 'overstocked',  label: 'Excesos',         dot: 'bg-stock-overstocked',    active: 'bg-stock-overstocked/20 backdrop-blur-sm border-stock-overstocked/40 text-chart-1-text shadow-[0_3px_14px_rgba(59,130,246,0.22)]',         chipActive: 'bg-stock-overstocked/10 text-chart-1-text'     },
    { key: 'dead_stock',   label: 'Sin movimiento',  dot: 'bg-stock-dead',   active: 'bg-surface-card-hover backdrop-blur-sm border-border-card text-content-2 shadow-[0_3px_14px_rgba(148,163,184,0.18)]',     chipActive: 'bg-surface-card-hover text-content-2'  },
    { key: 'no_data',      label: 'Sin historial',   dot: 'bg-stock-no-data',   active: 'bg-stock-no-data/20 backdrop-blur-sm border-stock-no-data/40 text-chart-7-text shadow-[0_3px_14px_rgba(234,179,8,0.18)]',    chipActive: 'bg-stock-no-data/10 text-chart-7-text' },
];
// Solo estos chips se muestran en el filtro bar
export const VISIBLE_STAT_KEYS = ['overstocked', 'dead_stock', 'no_data'];

// ABC — revenue contribution class (extracted from TabMinMax.jsx, Bloque 6.C)
export const ABC_CFG = {
    A: { bg: 'bg-surface-card-hover text-content-2 border-border-card',       title: 'Clase A — top 70% ingresos', color: 'var(--chart-8)' },
    B: { bg: 'bg-surface-card-hover text-content-3 border-border-card',       title: 'Clase B — siguiente 20%',    color: '#94a3b8' },
    C: { bg: 'bg-warning/10 text-warning-text border-warning/30',       title: 'Clase C — restante 10%',     color: 'var(--warning)' },
    D: { bg: 'bg-surface-card-hover text-content-3 border-border-card',       title: 'Sin ventas en período',      color: '#94a3b8' },
};

// XYZ — demand variability (replaces stable/moderate/erratic)
export const XYZ_CFG = {
    X: { label: 'X', desc: 'Estable',   cls: 'text-content-2 bg-surface-card-hover border-border-card', color: 'var(--chart-8)' },
    Y: { label: 'Y', desc: 'Moderada',  cls: 'text-content-3 bg-surface-card-hover border-border-card', color: '#94a3b8' },
    Z: { label: 'Z', desc: 'Errática',  cls: 'text-danger-text bg-danger/10 border-danger/30',    color: 'var(--danger)' },
    // Legacy support (old data before migration)
    stable:   { label: 'X', desc: 'Estable',  cls: 'text-content-2 bg-surface-card-hover border-border-card', color: 'var(--chart-8)' },
    moderate: { label: 'Y', desc: 'Moderada', cls: 'text-content-3 bg-surface-card-hover border-border-card', color: '#94a3b8' },
    erratic:  { label: 'Z', desc: 'Errática', cls: 'text-danger-text bg-danger/10 border-danger/30',    color: 'var(--danger)' },
};
