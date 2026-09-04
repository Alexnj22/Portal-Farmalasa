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
//
// D3.8 (2026-07-28): los siete glows eran `rgba()` literales con el color de
// cada estado quemado — `rgba(239,68,68,.22)` para "sin stock", etc. La escala
// `--shadow-glow-*-{sm,md,lg}` ya existía y ninguno la usaba, así que un cambio
// de paleta no los alcanzaba: el chip seguía brillando del rojo viejo. El de
// "sin movimiento" no era un glow sino una sombra gris, y por eso va a
// `--shadow-elevation-sm`.
export const STAT_CFGS = [
    { key: 'out_of_stock', label: 'Sin stock',      dot: 'bg-stock-out',         active: 'bg-stock-out/20 backdrop-blur-sm border-stock-out/40 text-danger-text shadow-[var(--shadow-glow-danger-md)]',             chipActive: 'bg-stock-out/10 text-danger-text'       },
    { key: 'below_min',    label: 'Bajo mínimo',    dot: 'bg-stock-below-min',   active: 'bg-stock-below-min/20 backdrop-blur-sm border-stock-below-min/40 text-chart-4-text shadow-[var(--shadow-glow-chart-4-md)]',   chipActive: 'bg-stock-below-min/10 text-chart-4-text' },
    { key: 'approaching',  label: 'Próx. mínimo',   dot: 'bg-stock-approaching', active: 'bg-stock-approaching/20 backdrop-blur-sm border-stock-approaching/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]',      chipActive: 'bg-stock-approaching/10 text-warning-text'   },
    { key: 'ok',           label: 'OK',              dot: 'bg-stock-ok', active: 'bg-stock-ok/20 backdrop-blur-sm border-stock-ok/40 text-success-text shadow-[var(--shadow-glow-success-md)]', chipActive: 'bg-stock-ok/10 text-success-text'},
    { key: 'overstocked',  label: 'Excesos',         dot: 'bg-stock-overstocked',    active: 'bg-stock-overstocked/20 backdrop-blur-sm border-stock-overstocked/40 text-chart-1-text shadow-[var(--shadow-glow-chart-1-md)]',         chipActive: 'bg-stock-overstocked/10 text-chart-1-text'     },
    { key: 'dead_stock',   label: 'Sin movimiento',  dot: 'bg-stock-dead',   active: 'bg-surface-card-hover backdrop-blur-sm border-border-card text-content-2 shadow-[var(--shadow-elevation-sm)]',     chipActive: 'bg-surface-card-hover text-content-2'  },
    { key: 'no_data',      label: 'Sin historial',   dot: 'bg-stock-no-data',   active: 'bg-stock-no-data/20 backdrop-blur-sm border-stock-no-data/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]',    chipActive: 'bg-stock-no-data/10 text-warning-text' },
];
// Solo estos chips se muestran en el filtro bar
export const VISIBLE_STAT_KEYS = ['overstocked', 'dead_stock', 'no_data'];

// ABC — revenue contribution class (extracted from TabMinMax.jsx, Bloque 6.C)
export const ABC_CFG = {
    A: { bg: 'bg-surface-card-hover text-content-2 border-border-card',       title: 'Clase A — top 70% ingresos', color: 'var(--chart-8)' },
    B: { bg: 'bg-surface-card-hover text-content-3 border-border-card',       title: 'Clase B — siguiente 20%',    color: 'var(--chart-8-muted)' },
    C: { bg: 'bg-warning/10 text-warning-text border-warning/30',       title: 'Clase C — restante 10%',     color: 'var(--warning)' },
    D: { bg: 'bg-surface-card-hover text-content-3 border-border-card',       title: 'Sin ventas en período',      color: 'var(--chart-8-muted)' },
};

// XYZ — demand variability (replaces stable/moderate/erratic)
export const XYZ_CFG = {
    X: { label: 'X', desc: 'Estable',   cls: 'text-content-2 bg-surface-card-hover border-border-card', color: 'var(--chart-8)' },
    Y: { label: 'Y', desc: 'Moderada',  cls: 'text-content-3 bg-surface-card-hover border-border-card', color: 'var(--chart-8-muted)' },
    Z: { label: 'Z', desc: 'Errática',  cls: 'text-danger-text bg-danger/10 border-danger/30',    color: 'var(--danger)' },
    // Legacy support (old data before migration)
    stable:   { label: 'X', desc: 'Estable',  cls: 'text-content-2 bg-surface-card-hover border-border-card', color: 'var(--chart-8)' },
    moderate: { label: 'Y', desc: 'Moderada', cls: 'text-content-3 bg-surface-card-hover border-border-card', color: 'var(--chart-8-muted)' },
    erratic:  { label: 'Z', desc: 'Errática', cls: 'text-danger-text bg-danger/10 border-danger/30',    color: 'var(--danger)' },
};

// ── Ajuste a mano ────────────────────────────────────────────────────────────
// Los motivos son los mismos cuatro que acepta el CHECK de
// `product_stock_params.manual_motivo`, y salieron de las 16 razones que la
// gente YA escribía en las solicitudes de cambio — no de una lista inventada.
// Ver docs/planes-cerrados/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md §2.5.
export const MOTIVO_AJUSTE = {
    ya_no_rota:   { label: 'Ya no rota',        detalle: 'Se dejó de vender o sólo se trae por encargo' },
    lo_buscan:    { label: 'Lo están buscando', detalle: 'Hay demanda que no aparece porque no hubo producto' },
    cliente_fijo: { label: 'Cliente fijo',      detalle: 'Un cliente compra una cantidad conocida cada cierto tiempo' },
    otro:         { label: 'Otro',              detalle: 'Queda anotado, y la fila se revisa a mano' },
};

// Los tres estados de un ajuste. El orden es el de urgencia: lo primero que hay
// que mirar es lo que el cálculo contradice.
export const AJUSTE_CFGS = [
    // «A mano» va primero porque es el más común y el más flojo: sólo dice que
    // el número de hoy lo escribió una persona. Los otros tres son SELLADOS —
    // solicitud aprobada o motivo declarado— y son los únicos que el cálculo
    // del mes que viene respeta.
    {
        key: 'a_mano',
        label: 'A mano',
        ayuda: 'Este número lo escribió una persona en la revisión del mes. El cálculo del mes que viene lo va a reemplazar.',
        dot: 'bg-content-3',
        active: 'bg-surface-card-hover backdrop-blur-sm border-border-card text-content-2',
        chipActive: 'bg-surface-card-hover text-content-2',
    },
    {
        key: 'en_conflicto',
        label: 'En conflicto',
        ayuda: 'Se aprobó una solicitud con este número y el cálculo propone otro. Hay que decidir cuál queda.',
        dot: 'bg-stock-approaching',
        active: 'bg-stock-approaching/20 backdrop-blur-sm border-stock-approaching/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]',
        chipActive: 'bg-stock-approaching/10 text-warning-text',
    },
    {
        key: 'volvio_a_moverse',
        label: 'Volvió a moverse',
        ayuda: 'Se marcó como «ya no rota» y volvió a venderse. El motivo dejó de ser cierto.',
        dot: 'bg-stock-overstocked',
        active: 'bg-stock-overstocked/20 backdrop-blur-sm border-stock-overstocked/40 text-chart-1-text shadow-[var(--shadow-glow-chart-1-md)]',
        chipActive: 'bg-stock-overstocked/10 text-chart-1-text',
    },
    {
        key: 'respetado',
        label: 'Respetado',
        ayuda: 'El ajuste sigue en pie y el cálculo no lo contradice.',
        dot: 'bg-stock-ok',
        active: 'bg-stock-ok/20 backdrop-blur-sm border-stock-ok/40 text-success-text shadow-[var(--shadow-glow-success-md)]',
        chipActive: 'bg-stock-ok/10 text-success-text',
    },
];
