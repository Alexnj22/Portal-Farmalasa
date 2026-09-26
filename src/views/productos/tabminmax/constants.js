// Estilos de MIN·MAX. Los nombres y las claves viven en `constants/minmax.js`
// (los usa la lógica); acá sólo va cómo se ven. Los nombres de sala son los de
// `constants/erp.js` — esta pantalla tenía su propia copia, idéntica.
import { ERP_NAMES, ERP_ORDEN as ERP_ORDER } from '../../../constants/erp';
import { ALERTA_ETIQUETA, ESTADOS_DE_STOCK, ESTADOS_DE_AJUSTE } from '../../../constants/minmax';

export { ERP_NAMES, ERP_ORDER };
export { MOTIVO_AJUSTE } from '../../../constants/minmax';

export const ALERT = {
    out_of_stock: { label: ALERTA_ETIQUETA.out_of_stock, pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-out',         row: 'bg-stock-out/10'         },
    below_min:    { label: ALERTA_ETIQUETA.below_min, pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-below-min',   row: 'bg-stock-below-min/10'   },
    approaching:  { label: ALERTA_ETIQUETA.approaching, pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-approaching', row: ''                        },
    ok:           { label: ALERTA_ETIQUETA.ok, pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-ok',          row: ''                        },
    overstocked:  { label: ALERTA_ETIQUETA.overstocked, pill: 'bg-surface-card-hover text-content-2 border-border-card', dot: 'bg-stock-overstocked', row: 'bg-stock-overstocked/10' },
    dead_stock:   { label: ALERTA_ETIQUETA.dead_stock, pill: 'bg-surface-card-hover text-content-3 border-border-card', dot: 'bg-stock-dead',        row: 'bg-surface-card-hover/60' },
    no_data:      { label: ALERTA_ETIQUETA.no_data, pill: 'bg-surface-card-hover text-content-3 border-border-card', dot: 'bg-stock-no-data',     row: ''                        },
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
const ESTILO_DE_ESTADO = {
    out_of_stock: { dot: 'bg-stock-out',         active: 'bg-stock-out/20 backdrop-blur-sm border-stock-out/40 text-danger-text shadow-[var(--shadow-glow-danger-md)]',             chipActive: 'bg-stock-out/10 text-danger-text' },
    below_min: { dot: 'bg-stock-below-min',   active: 'bg-stock-below-min/20 backdrop-blur-sm border-stock-below-min/40 text-chart-4-text shadow-[var(--shadow-glow-chart-4-md)]',   chipActive: 'bg-stock-below-min/10 text-chart-4-text' },
    approaching: { dot: 'bg-stock-approaching', active: 'bg-stock-approaching/20 backdrop-blur-sm border-stock-approaching/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]',      chipActive: 'bg-stock-approaching/10 text-warning-text' },
    ok: { dot: 'bg-stock-ok', active: 'bg-stock-ok/20 backdrop-blur-sm border-stock-ok/40 text-success-text shadow-[var(--shadow-glow-success-md)]', chipActive: 'bg-stock-ok/10 text-success-text' },
    overstocked: { dot: 'bg-stock-overstocked',    active: 'bg-stock-overstocked/20 backdrop-blur-sm border-stock-overstocked/40 text-chart-1-text shadow-[var(--shadow-glow-chart-1-md)]',         chipActive: 'bg-stock-overstocked/10 text-chart-1-text' },
    dead_stock: { dot: 'bg-stock-dead',   active: 'bg-surface-card-hover backdrop-blur-sm border-border-card text-content-2 shadow-[var(--shadow-elevation-sm)]',     chipActive: 'bg-surface-card-hover text-content-2' },
    no_data: { dot: 'bg-stock-no-data',   active: 'bg-stock-no-data/20 backdrop-blur-sm border-stock-no-data/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]',    chipActive: 'bg-stock-no-data/10 text-warning-text' },
};
export const STAT_CFGS = ESTADOS_DE_STOCK.map((e) => ({ ...e, ...ESTILO_DE_ESTADO[e.key] }));
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
// Los motivos y los estados (con su texto de ayuda) viven en
// `constants/minmax.js`; acá sólo el color de cada chip.
const ESTILO_DE_AJUSTE = {
    a_mano: { dot: 'bg-content-3', active: 'bg-surface-card-hover backdrop-blur-sm border-border-card text-content-2', chipActive: 'bg-surface-card-hover text-content-2' },
    en_conflicto: { dot: 'bg-stock-approaching', active: 'bg-stock-approaching/20 backdrop-blur-sm border-stock-approaching/40 text-warning-text shadow-[var(--shadow-glow-warning-md)]', chipActive: 'bg-stock-approaching/10 text-warning-text' },
    volvio_a_moverse: { dot: 'bg-stock-overstocked', active: 'bg-stock-overstocked/20 backdrop-blur-sm border-stock-overstocked/40 text-chart-1-text shadow-[var(--shadow-glow-chart-1-md)]', chipActive: 'bg-stock-overstocked/10 text-chart-1-text' },
    respetado: { dot: 'bg-stock-ok', active: 'bg-stock-ok/20 backdrop-blur-sm border-stock-ok/40 text-success-text shadow-[var(--shadow-glow-success-md)]', chipActive: 'bg-stock-ok/10 text-success-text' },
};
export const AJUSTE_CFGS = ESTADOS_DE_AJUSTE.map((e) => ({ ...e, ...ESTILO_DE_AJUSTE[e.key] }));
