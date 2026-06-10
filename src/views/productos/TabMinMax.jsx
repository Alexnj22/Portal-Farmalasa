import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, Loader2,
    Building2, Package, X, Download,
    CheckCircle2, Check, Info, RotateCcw, ChevronRight, History,
    DollarSign, TrendingUp, TrendingDown, Layers, Settings2, Save, Clock, Upload, XCircle, Eye, EyeOff, BarChart2, Target, FlaskConical, Search,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import ConfirmModal from '../../components/common/ConfirmModal';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useAuth } from '../../context/AuthContext';

// ─── Animation presets ────────────────────────────────────────────────────────
// easeOutExpo — snappy entry, silky exit. Standard for Apple/Liquid Glass UIs.
const EASE_OUT_EXPO = [0.16, 1, 0.3, 1];

// Chip / pill — subtle lift, no bounce
const chipAnim = {
    whileHover: { scale: 1.045, transition: { duration: 0.18, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.955, transition: { duration: 0.06, ease: 'easeIn' } },
};
// CTA button (Calcular, Publicar) — a bit more prominent
const ctaAnim = {
    whileHover: { scale: 1.03,  transition: { duration: 0.18, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.97,  transition: { duration: 0.06, ease: 'easeIn' } },
};
// Icon button — snappier, tighter
const iconAnim = {
    whileHover: { scale: 1.15,  transition: { duration: 0.14, ease: EASE_OUT_EXPO } },
    whileTap:   { scale: 0.88,  transition: { duration: 0.06, ease: 'easeIn' } },
};
// Entrance — fade up, stagger via delay passed at call site
const fadeUp = (delay = 0) => ({
    initial:  { opacity: 0, y: 8 },
    animate:  { opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO, delay } },
});

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const ALERT = {
    out_of_stock: { label: 'Sin stock',     pill: 'bg-red-100 text-red-700 border-red-200',            dot: 'bg-red-500',     row: 'bg-red-50/40'    },
    below_min:    { label: 'Bajo mínimo',   pill: 'bg-orange-100 text-orange-700 border-orange-200',   dot: 'bg-orange-500',  row: 'bg-orange-50/20' },
    approaching:  { label: 'Próx. mínimo',  pill: 'bg-amber-100 text-amber-700 border-amber-200',      dot: 'bg-amber-400',   row: ''                },
    ok:           { label: 'OK',            pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', row: ''                },
    overstocked:  { label: 'Exceso',        pill: 'bg-blue-100 text-blue-700 border-blue-200',          dot: 'bg-blue-400',    row: 'bg-blue-50/10'   },
    dead_stock:   { label: 'Sin movimiento',pill: 'bg-slate-100 text-slate-500 border-slate-200',       dot: 'bg-slate-300',   row: 'bg-slate-50/60'  },
    no_data:      { label: 'Sin historial', pill: 'bg-yellow-50 text-yellow-700 border-yellow-200',      dot: 'bg-yellow-300',  row: ''                },
};

const STAT_CFGS = [
    { key: 'out_of_stock', label: 'Sin stock',      dot: 'bg-red-500',     active: 'bg-red-100/75 backdrop-blur-sm border-red-300/70 text-red-700 shadow-[0_3px_14px_rgba(239,68,68,0.22)]'            },
    { key: 'below_min',    label: 'Bajo mínimo',    dot: 'bg-orange-500',  active: 'bg-orange-100/75 backdrop-blur-sm border-orange-300/70 text-orange-700 shadow-[0_3px_14px_rgba(249,115,22,0.22)]'   },
    { key: 'approaching',  label: 'Próx. mínimo',   dot: 'bg-amber-400',   active: 'bg-amber-100/75 backdrop-blur-sm border-amber-300/70 text-amber-700 shadow-[0_3px_14px_rgba(245,158,11,0.22)]'      },
    { key: 'ok',           label: 'OK',              dot: 'bg-emerald-500', active: 'bg-emerald-100/75 backdrop-blur-sm border-emerald-300/70 text-emerald-700 shadow-[0_3px_14px_rgba(16,185,129,0.22)]' },
    { key: 'overstocked',  label: 'Exceso',          dot: 'bg-blue-400',    active: 'bg-blue-100/75 backdrop-blur-sm border-blue-300/70 text-blue-700 shadow-[0_3px_14px_rgba(59,130,246,0.22)]'         },
    { key: 'dead_stock',   label: 'Sin movimiento',  dot: 'bg-slate-300',   active: 'bg-slate-100/75 backdrop-blur-sm border-slate-300/70 text-slate-600 shadow-[0_3px_14px_rgba(148,163,184,0.18)]'     },
    { key: 'no_data',      label: 'Sin historial',   dot: 'bg-yellow-300',  active: 'bg-yellow-50/75 backdrop-blur-sm border-yellow-300/70 text-yellow-700 shadow-[0_3px_14px_rgba(234,179,8,0.18)]'            },
];

const ABC_CFG = {
    A: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'Clase A — top 70% ingresos', color: '#10b981' },
    B: { bg: 'bg-blue-50 text-blue-700 border-blue-200',          title: 'Clase B — siguiente 20%',    color: '#3b82f6' },
    C: { bg: 'bg-amber-50 text-amber-700 border-amber-200',       title: 'Clase C — restante 10%',     color: '#f59e0b' },
    D: { bg: 'bg-slate-50 text-slate-400 border-slate-200',       title: 'Sin ventas en período',      color: '#94a3b8' },
};

// XYZ — demand variability (replaces stable/moderate/erratic)
const XYZ_CFG = {
    X: { label: 'X', desc: 'Estable',   cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', color: '#10b981' },
    Y: { label: 'Y', desc: 'Moderada',  cls: 'text-amber-600 bg-amber-50 border-amber-200',       color: '#f59e0b' },
    Z: { label: 'Z', desc: 'Errática',  cls: 'text-red-500 bg-red-50 border-red-200',             color: '#ef4444' },
    // Legacy support (old data before migration)
    stable:   { label: 'X', desc: 'Estable',  cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', color: '#10b981' },
    moderate: { label: 'Y', desc: 'Moderada', cls: 'text-amber-600 bg-amber-50 border-amber-200',       color: '#f59e0b' },
    erratic:  { label: 'Z', desc: 'Errática', cls: 'text-red-500 bg-red-50 border-red-200',             color: '#ef4444' },
};

// Normalize legacy demand_variability values → X/Y/Z
const normXyz = (v) => ({ stable: 'X', moderate: 'Y', erratic: 'Z' }[v] ?? v ?? 'X');

const translateDbError = (msg) => {
    if (!msg) return 'Error desconocido';
    if (/statement timeout|canceling statement/i.test(msg))
        return 'La consulta tardó demasiado. Intenta nuevamente.';
    if (/row-level security/i.test(msg))
        return 'Sin permisos para esta operación.';
    if (/unique constraint/i.test(msg))
        return 'Ya existe un registro con esos datos.';
    if (/foreign key constraint/i.test(msg))
        return 'No se puede eliminar: hay registros relacionados.';
    if (/not-null constraint/i.test(msg))
        return 'Falta un campo requerido.';
    if (/check constraint/i.test(msg))
        return 'Valor fuera del rango permitido.';
    return msg;
};

// Warns (but does NOT block) when a saved value is 4× above or 4× below the calculated reference.
const warnIfOutrageous = (field, numVal, row) => {
    if (!numVal || numVal <= 0 || !row) return;
    const calcRef = field === 'min' ? (row.calc_min ?? 0) : (row.calc_max ?? 0);
    if (calcRef <= 0) return;
    const label = field === 'min' ? 'MIN' : 'MAX';
    if (numVal > calcRef * 4) {
        const mult = Math.round(numVal / calcRef);
        useToastStore.getState().showToast(
            row.product_name || 'Producto',
            `${label} ${numVal} es ${mult}× el calculado (${calcRef}). Verifica que sea correcto.`,
            'info'
        );
    } else if (numVal * 4 < calcRef) {
        const mult = Math.round(calcRef / numVal);
        useToastStore.getState().showToast(
            row.product_name || 'Producto',
            `${label} ${numVal} está ${mult}× por debajo del calculado (${calcRef}). Verifica que sea correcto.`,
            'info'
        );
    }
};

// Pure validation: receives the edit + the current row object directly (no closure lookup)
const validateEditForRow = (edit, row) => {
    if (!edit || !row) return null;
    const numVal = edit.value === '' ? null : parseInt(edit.value, 10);
    if (numVal === null || Number.isNaN(numVal)) return null;
    const hasDraftRow = row.draft_status === 'pending';
    const other = Number(edit.field === 'max'
        ? (hasDraftRow ? (row.draft_min ?? 0) : (row.effective_min ?? 0))
        : (hasDraftRow ? (row.draft_max ?? 0) : (row.effective_max ?? 0)));
    if (edit.field === 'max') {
        if (numVal > 0 && numVal <= other) return 'MAX debe ser mayor al MIN';
        if (other === 0 && numVal > 1)     return 'Con MIN=0 solo se permite MAX=0 o MAX=1';
    } else {
        if (numVal > 0 && other > 0 && numVal >= other) return 'MIN debe ser menor al MAX';
        if (numVal === 0 && other > 1)                   return 'Con MIN=0 el MAX no puede ser mayor a 1';
    }
    return null;
};

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1000)}k`;
    if (v >= 1_000)     return `$${(v / 1000).toFixed(1)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeTime(iso) {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (mins < 2)  return 'hace un momento';
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `hace ${hrs}h`;
    return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
}

function exportCsv(rows, name, sucursalName) {
    const h = ['Sucursal','Laboratorio','Producto','Clase','MIN (und)','MAX (und)','Ventas período'];
    const lines = rows.map(r => {
        const abc = (r.draft_abc_class || r.abc_class || '—');
        const xyz = normXyz(r.draft_demand_variability || r.demand_variability);
        return [
            `"${(sucursalName||'').replace(/"/g,'""')}"`,
            `"${(r.laboratorio_nombre||'').replace(/"/g,'""')}"`,
            `"${(r.product_name||'').replace(/"/g,'""')}"`,
            `${abc}${xyz}`,
            r.effective_min ?? '—',
            r.effective_max ?? '—',
            r.units_sold_6m ?? 0,
        ].join(',');
    });
    const blob = new Blob([[h.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `minmax_${name}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
}

// ─── ABC × XYZ Matrix ────────────────────────────────────────────────────────

function AbcXyzMatrix({ data, filterAbc, setFilterAbc, filterXyz, setFilterXyz, loading }) {
    const XYZ_KEYS = ['X', 'Y', 'Z'];
    const ABC_KEYS = ['A', 'B', 'C'];

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

    const xyzColors  = { X: '#10b981', Y: '#f59e0b', Z: '#ef4444' };
    const abcColors  = { A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#94a3b8' };
    const maxCell    = Math.max(1, ...Object.values(matrix));

    const toggle = (abc, xyz) => {
        setFilterAbc(pa => pa === abc ? 'all' : abc);
        setFilterXyz(px => px === xyz ? 'all' : xyz);
    };

    const glassBox = {
        background: 'rgba(255,255,255,0.52)',
        backdropFilter: 'blur(4px)',
        boxShadow: '0 8px 32px rgba(0,82,204,0.08), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.03)',
    };

    if (loading || data.length === 0) {
        return (
            <div className="rounded-2xl border border-white/70 p-3 flex flex-col gap-2" style={glassBox}>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-300">Matriz ABC × XYZ</span>
                {loading ? (
                    <div className="grid gap-1.5 animate-pulse" style={{ gridTemplateColumns: '26px repeat(3, 1fr)' }}>
                        {Array.from({ length: 16 }).map((_, i) => (
                            <div key={i} className="h-10 rounded-xl bg-slate-100/70" />
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-5 gap-2 text-slate-300">
                        <BarChart2 size={28} className="text-slate-200" />
                        <span className="text-[10px] font-semibold">Sin datos — presioná Calcular</span>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-white/70 p-3 flex flex-col gap-2" style={glassBox}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Matriz ABC × XYZ</span>
                {(filterAbc !== 'all' || filterXyz !== 'all') && (
                    <button onClick={() => { setFilterAbc('all'); setFilterXyz('all'); }}
                        className="text-[9px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-0.5 transition-colors">
                        <X size={9} /> limpiar
                    </button>
                )}
            </div>

            {/* Grid — isolation:isolate ensures z-index on hover works within the stacking context */}
            <div className="grid gap-1" style={{ gridTemplateColumns: '26px repeat(3, 1fr)', isolation: 'isolate' }}>
                {/* Header row: XYZ */}
                <div />
                {XYZ_KEYS.map(xyz => (
                    <button key={xyz} onClick={() => setFilterXyz(p => p === xyz ? 'all' : xyz)}
                        className="relative py-1 rounded-lg text-[11px] font-black text-center transition-colors duration-150"
                        style={{
                            color: xyzColors[xyz],
                            background: filterXyz === xyz ? `${xyzColors[xyz]}22` : 'transparent',
                            boxShadow: filterXyz === xyz ? `0 2px 8px ${xyzColors[xyz]}40` : undefined,
                        }}>
                        {xyz}
                    </button>
                ))}

                {/* Data rows */}
                {ABC_KEYS.map(abc => (
                    <React.Fragment key={abc}>
                        {/* ABC label */}
                        <button onClick={() => setFilterAbc(p => p === abc ? 'all' : abc)}
                            className="relative py-1 rounded-lg text-[11px] font-black text-center transition-colors duration-150"
                            style={{
                                color: abcColors[abc],
                                background: filterAbc === abc ? `${abcColors[abc]}22` : 'transparent',
                            }}>
                            {abc}
                        </button>
                        {/* Cells */}
                        {XYZ_KEYS.map(xyz => {
                            const count = matrix[`${abc}${xyz}`];
                            const isActive = filterAbc === abc && filterXyz === xyz;
                            const intensity = count > 0 ? Math.max(0.10, (count / maxCell) * 0.38) : 0;
                            const rgb = abc === 'A' ? '16,185,129' : abc === 'B' ? '59,130,246' : abc === 'C' ? '245,158,11' : '148,163,184';
                            return (
                                <button key={xyz} onClick={() => toggle(abc, xyz)}
                                    className={`relative py-2 rounded-xl text-center transition-[transform,box-shadow,background-color] duration-200
                                        ${count === 0 ? 'opacity-20 cursor-default' : 'cursor-pointer hover:z-10 hover:scale-[1.08]'}
                                        ${isActive ? 'z-20' : ''}`}
                                    style={{
                                        background: count > 0 ? `rgba(${rgb},${intensity})` : 'rgba(0,0,0,0.025)',
                                        boxShadow: isActive
                                            ? `0 6px 18px rgba(${rgb},0.25)`
                                            : count > 0 ? `0 2px 8px rgba(${rgb},0.12)` : undefined,
                                        outline: isActive ? `2.5px solid rgba(${rgb},0.80)` : undefined,
                                        outlineOffset: isActive ? '2px' : undefined,
                                    }}
                                    disabled={count === 0}>
                                    <span className="text-[12px] font-black text-slate-700 tabular-nums leading-none">{count || '—'}</span>
                                    {count > 0 && <span className="text-[9px] font-bold text-slate-400 block mt-0.5 tracking-wider">{abc}{xyz}</span>}
                                </button>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>

            {/* XYZ legend */}
            <div className="flex items-center gap-4 flex-wrap border-t border-white/60 pt-2">
                {XYZ_KEYS.map(xyz => (
                    <span key={xyz} className="flex items-center gap-1.5 text-[9px]">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: xyzColors[xyz], boxShadow: `0 0 6px ${xyzColors[xyz]}60` }} />
                        <span className="font-black" style={{ color: xyzColors[xyz] }}>{xyz}</span>
                        <span className="text-slate-400">{XYZ_CFG[xyz].desc}</span>
                    </span>
                ))}
            </div>
        </div>
    );
}

// ─── Cost summary cards ───────────────────────────────────────────────────────

function CostCards({ summary, isBodega }) {
    const total  = Number(summary.total_cost)  || 0;
    const useful = Number(summary.useful_cost) || 0;
    const excess = Number(summary.excess_cost) || 0;
    const dead   = Number(summary.dead_cost)   || 0;

    const STATS = [
        { label: 'Total retenido', value: fmtMoney(total),  color: 'text-slate-800',   icon: DollarSign,  iconCls: 'text-slate-400'   },
        ...(!isBodega ? [
            { label: 'Inventario útil',  value: fmtMoney(useful), color: 'text-emerald-700', icon: TrendingUp,  iconCls: 'text-emerald-500' },
            { label: 'Capital excedente',value: fmtMoney(excess), color: 'text-orange-700',  icon: TrendingDown,iconCls: 'text-orange-500'  },
        ] : []),
        { label: 'Sin movimiento', value: fmtMoney(dead),   color: 'text-slate-500',   icon: Layers,      iconCls: 'text-slate-400'   },
    ];

    return (
        <div className="flex items-center gap-2.5 flex-wrap">
            {STATS.map(({ label, value, color, icon: Icon, iconCls }) => (
                <div key={label}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-white/70 backdrop-blur-sm"
                    style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
                    <Icon size={13} className={`shrink-0 ${iconCls}`} />
                    <div className="flex flex-col leading-snug gap-0.5">
                        <span className="text-[10px] font-semibold text-slate-500">{label}</span>
                        <span className={`text-[14px] font-black tabular-nums leading-none ${color}`}>{value}</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function DraftCostCard({ draftCost }) {
    if (!draftCost || !Number(draftCost.product_count)) return null;
    const minC = Number(draftCost.min_cost);
    const maxC = Number(draftCost.max_cost);
    return (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-white/70 backdrop-blur-sm"
            style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
            <Target size={13} className="shrink-0 text-violet-400" />
            <div className="flex flex-col leading-snug gap-1">
                <span className="text-[10px] font-semibold text-slate-500">Inversión borrador</span>
                <div className="flex items-baseline gap-2">
                    <div className="flex items-baseline gap-1">
                        <span className="text-[9px] font-bold text-amber-500 uppercase tracking-wide">MIN</span>
                        <span className="text-[13px] font-black tabular-nums text-amber-700">{fmtMoney(minC)}</span>
                    </div>
                    <span className="text-[10px] text-slate-300">→</span>
                    <div className="flex items-baseline gap-1">
                        <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wide">MAX</span>
                        <span className="text-[14px] font-black tabular-nums text-blue-700">{fmtMoney(maxC)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CardSkeletons({ isBodega }) {
    const count = isBodega ? 2 : 4;
    return (
        <div className="flex items-center gap-2.5 flex-wrap">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-white/70 backdrop-blur-sm animate-pulse"
                    style={{ background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
                    <div className="w-3.5 h-3.5 rounded-full bg-slate-200/80 shrink-0" />
                    <div className="flex flex-col gap-1.5">
                        <div className="h-2 w-16 rounded bg-slate-200/80" />
                        <div className="h-3 w-20 rounded bg-slate-200/80" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortedPres(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}

function formatUnits(units, presentations) {
    const n = Number(units);
    if (n === 0) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) { parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`); rem %= factor; }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n.toLocaleString()} und`;
}

function formatDominant(units, presentations) {
    const n = Number(units);
    if (!n) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    const { tipo, factor } = pres[0];
    // ceil: boxes are indivisible — always round up so the displayed quantity covers the unit threshold
    return `≥${Math.ceil(n / factor)} ${tipo.trim()}`;
}

function getBreakdown(units, presentations) {
    const n = Number(units);
    if (!n) return [];
    const pres = sortedPres(presentations);
    if (!pres.length) return [{ tipo: 'und', factor: 1, qty: n, base: n }];
    let rem = n;
    const result = [];
    for (const { tipo, factor } of pres) {
        const qty = Math.floor(rem / factor);
        if (qty > 0) { result.push({ tipo: tipo.trim(), factor, qty, base: qty * factor }); rem %= factor; }
    }
    if (rem > 0) result.push({ tipo: 'und', factor: 1, qty: rem, base: rem });
    return result;
}

// ─── Coverage bar ─────────────────────────────────────────────────────────────

function CoverageBar({ current, velocity, cycleDays }) {
    const days = velocity > 0 ? current / velocity : null;
    if (days === null) return <span className="text-slate-300 text-xs">—</span>;
    const pct  = Math.min(100, (days / cycleDays) * 100);
    const fill = days === 0 ? '#ef4444' : days < (cycleDays * 0.2) ? '#f97316' : days < (cycleDays * 0.5) ? '#f59e0b' : '#10b981';
    const label = days >= 999 ? '>999d' : `${Math.round(days)}d`;
    return (
        <div className="flex flex-col gap-0.5 items-end">
            <span className="text-[11px] font-black tabular-nums" style={{ color: fill }}>{label}</span>
            <div className="w-14 h-[3px] rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: fill }} />
            </div>
        </div>
    );
}

// ─── Stock mini-bar ───────────────────────────────────────────────────────────

function StockBar({ current, min, max }) {
    const c  = Number(current) || 0;
    const mn = Number(min)     || 0;
    const mx = Number(max)     || 0;
    if (!mx && !mn) return null;
    const ceil = Math.max(mx * 1.3, c * 1.15, mn * 3, 1);
    const pct  = v => `${Math.min(100, (v / ceil) * 100).toFixed(2)}%`;
    const fill = c === 0 ? 'bg-red-400' : c < mn ? 'bg-orange-400' : c > mx ? 'bg-blue-400' : 'bg-emerald-400';
    return (
        <div className="relative h-[3px] w-full bg-slate-100 rounded-full mt-1.5">
            <div className={`absolute left-0 top-0 h-full rounded-full ${fill} transition-all`} style={{ width: pct(c) }} />
            {mn > 0 && <div className="absolute top-[-2px] h-[7px] w-[2px] bg-orange-400/80 rounded-full" style={{ left: pct(mn) }} />}
            {mx > 0 && <div className="absolute top-[-2px] h-[7px] w-[2px] bg-blue-400/70 rounded-full"   style={{ left: pct(mx) }} />}
        </div>
    );
}

// ─── Combined ABC×XYZ badge ───────────────────────────────────────────────────

function AbcXyzBadge({ abc, xyz }) {
    const abcCfg = ABC_CFG[abc] ?? ABC_CFG.D;
    const xyzCfg = XYZ_CFG[normXyz(xyz)] ?? XYZ_CFG.X;
    return (
        <div className="flex items-center gap-0.5 shrink-0">
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-l-md border-y border-l ${abcCfg.bg}`} title={abcCfg.title}>{abc}</span>
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-r-md border ${xyzCfg.cls}`} title={xyzCfg.desc}>{normXyz(xyz)}</span>
        </div>
    );
}

// ─── Expanded panel — multi-branch view + current branch breakdown ────────────

function ExpandedPanel({ row, cycleDays }) {
    const pres        = row.presentations || [];
    const stock       = Number(row.current_stock);
    const minN        = Number(row.effective_min);
    const maxN        = Number(row.effective_max);
    const breakdown   = getBreakdown(stock, pres);
    const hasDominant = sortedPres(pres).length > 0;
    const coverDays   = row.daily_velocity > 0 ? (stock / row.daily_velocity).toFixed(1) : null;

    const [branchData,      setBranchData]      = useState(null);
    const [expiryData,      setExpiryData]      = useState([]);
    const [historyData,     setHistoryData]     = useState([]);
    const [purchaseData,    setPurchaseData]    = useState([]);
    const [loadingBranches, setLoadingBranches] = useState(true);
    const [deadAction,      setDeadAction]      = useState(null);

    const logDeadStockAction = async (action) => {
        setDeadAction(action);
        await useStaff.getState().appendAuditLog('DEAD_STOCK_ACTION', String(row.erp_product_id), {
            product: row.product_name, action, stock: Number(row.current_stock), erp_sucursal_id: row._erp_sucursal_id,
        });
    };

    useEffect(() => {
        Promise.all([
            supabase.rpc('get_product_branch_summary', { p_erp_product_id: row.erp_product_id }),
            supabase.rpc('get_product_expiring_lots',  { p_erp_product_id: row.erp_product_id }),
            supabase.from('product_stock_params_history')
                .select('captured_at, min_units, max_units, daily_velocity, velocity_30d, abc_class, demand_variability')
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id)
                .order('captured_at', { ascending: false })
                .limit(5),
            supabase.from('product_cost_history')
                .select('fecha, proveedor, precio_unitario, cantidad, lote, fecha_vencimiento')
                .eq('erp_product_id', row.erp_product_id)
                .order('fecha', { ascending: false })
                .limit(6),
        ]).then(([{ data: bData }, { data: eData }, { data: hData }, { data: pData }]) => {
            setBranchData(bData || []);
            setExpiryData(eData || []);
            setHistoryData(hData || []);
            setPurchaseData(pData || []);
        }).finally(() => setLoadingBranches(false));
    }, [row.erp_product_id, row._erp_sucursal_id]);

    const netStock   = branchData?.filter(b => b.erp_sucursal_id !== 6).reduce((s, b) => s + Number(b.current_stock), 0) ?? null;
    const totalStock = branchData?.reduce((s, b) => s + Number(b.current_stock), 0) ?? null;

    const pedir = (!row.is_dead_stock && maxN > 0 && (row.alert_status === 'out_of_stock' || row.alert_status === 'below_min'))
        ? Math.max(0, maxN - stock)
        : null;

    const transferSuggestions = useMemo(() => {
        if (!branchData || pedir === null || pedir === 0) return [];
        return branchData
            .filter(b => b.erp_sucursal_id !== row._erp_sucursal_id && b.alert_status === 'overstocked')
            .map(b => ({
                name:        ERP_NAMES[b.erp_sucursal_id] || `Suc. ${b.erp_sucursal_id}`,
                transferable: Math.max(0, Number(b.current_stock) - Number(b.effective_max)),
                stock:        Number(b.current_stock),
            }))
            .filter(s => s.transferable > 0)
            .sort((a, b) => b.transferable - a.transferable);
    }, [branchData, row._erp_sucursal_id, pedir]);

    return (
        <div className="mx-4 mb-2 rounded-xl border border-slate-100 overflow-hidden"
            style={{ background: 'rgba(248,250,252,0.8)' }}>

            {/* ── Multi-branch grid ── */}
            <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Stock en red</span>
                    {netStock !== null && (
                        <div className="flex items-center gap-3 text-[9px] text-slate-400">
                            <span>Red: <strong className="text-slate-600 tabular-nums">{netStock.toLocaleString()} und</strong></span>
                            <span className="text-slate-300">·</span>
                            <span>Incl. Bodega: <strong className="text-slate-600 tabular-nums">{totalStock.toLocaleString()} und</strong></span>
                        </div>
                    )}
                </div>

                {loadingBranches ? (
                    <div className="flex items-center justify-center py-5">
                        <Loader2 size={14} className="animate-spin text-slate-300" />
                    </div>
                ) : (
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                        {ERP_ORDER.map(erpId => {
                            const bd        = branchData?.find(b => b.erp_sucursal_id === erpId);
                            const isCurrent = erpId === row._erp_sucursal_id;
                            const bStock    = Number(bd?.current_stock ?? 0);
                            const bMin      = Number(bd?.effective_min ?? 0);
                            const bMax      = Number(bd?.effective_max ?? 0);
                            const alert     = ALERT[bd?.alert_status ?? 'ok'] ?? ALERT.ok;
                            const hasData   = !!bd;

                            return (
                                <div key={erpId}
                                    className={`rounded-xl px-2 py-2 border transition-colors ${
                                        isCurrent
                                            ? 'border-[#0052CC]/40 bg-blue-50/60 ring-1 ring-[#0052CC]/20'
                                            : 'border-slate-100 bg-white/60'
                                    } ${!hasData ? 'opacity-35' : ''}`}>
                                    <div className="flex items-center justify-between gap-0.5 mb-0.5">
                                        <span className="text-[8px] font-black text-slate-500 truncate leading-tight">
                                            {erpId === 6 ? 'Bodega' : ERP_NAMES[erpId].replace('Salud ', 'S.')}
                                        </span>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                    </div>
                                    <div className={`text-[12px] font-black tabular-nums leading-none ${
                                        !hasData ? 'text-slate-300' :
                                        bStock === 0 ? 'text-red-500' :
                                        bStock < bMin ? 'text-orange-600' : 'text-slate-800'
                                    }`}>
                                        {!hasData ? '—' : bStock === 0 ? '0' : bStock.toLocaleString()}
                                    </div>
                                    {hasData && <StockBar current={bStock} min={bMin} max={bMax} />}
                                    {hasData && (bMin > 0 || bMax > 0) && (
                                        <div className="flex items-center gap-0.5 mt-0.5 text-[9px] tabular-nums leading-tight">
                                            <span className="text-orange-500 font-black">{bMin > 0 ? bMin.toLocaleString() : '—'}</span>
                                            <span className="text-slate-200">·</span>
                                            <span className="text-blue-500 font-black">{bMax > 0 ? bMax.toLocaleString() : '—'}</span>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Current branch breakdown by presentation ── */}
            {breakdown.length > 0 ? (
                <div className="border-t border-slate-100/80 divide-y divide-slate-100">
                    {breakdown.map(({ tipo, factor, qty, base }, i) => {
                        const pct = stock > 0 ? (base / stock) * 100 : 0;
                        return (
                            <div key={i} className="grid items-center px-4 py-2"
                                style={{ gridTemplateColumns: '120px 1fr 72px 64px' }}>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[12px] font-bold text-slate-700">{tipo}</span>
                                    {factor > 1 && <span className="text-[9px] font-mono text-slate-400 bg-slate-200/60 px-1 rounded">×{factor}</span>}
                                </div>
                                <div className="flex items-center gap-2.5 pr-4">
                                    <div className="flex-1 h-[5px] bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-400/70 rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%` }} />
                                    </div>
                                    <span className="text-[14px] font-black text-slate-800 tabular-nums shrink-0 w-8 text-right">{qty}</span>
                                </div>
                                <div className="text-right text-[10px] text-slate-500 tabular-nums font-mono">{base.toLocaleString()} und</div>
                                <div className="text-right text-[10px] text-slate-400 tabular-nums">{pct.toFixed(0)}%</div>
                            </div>
                        );
                    })}
                </div>
            ) : !loadingBranches && stock === 0 && (
                <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-400 italic">
                    <Package size={13} className="shrink-0 text-slate-300" /> Sin existencias en esta sucursal
                </div>
            )}

            {/* ── Referencia pedido (sucursal actual) ── */}
            {!row.is_dead_stock && (minN > 0 || coverDays) && (
                <div className="px-4 py-2.5 border-t border-slate-200/60 bg-white/50 flex items-center gap-5 flex-wrap">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Referencia pedido</span>
                    {coverDays && (
                        <span className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                            <span className="text-slate-500 font-semibold">Cobertura</span>
                            <span className="font-black text-slate-700">{coverDays} días</span>
                            <span className="text-slate-400 text-[10px]">de {cycleDays}d objetivo</span>
                        </span>
                    )}
                    {minN > 0 && (
                        <>
                            <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                                <span className="text-slate-500 font-semibold">MIN</span>
                                <span className="font-black text-orange-600">{hasDominant ? formatDominant(minN, pres) : `${minN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-slate-400 text-[10px]">({minN.toLocaleString()} und)</span>}
                            </span>
                            <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                <span className="text-slate-500 font-semibold">MAX</span>
                                <span className="font-black text-blue-600">{hasDominant ? formatDominant(maxN, pres) : `${maxN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-slate-400 text-[10px]">({maxN.toLocaleString()} und)</span>}
                            </span>
                        </>
                    )}
                    {pedir !== null && (
                        <span className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                            <span className="text-slate-500 font-semibold">Pedir</span>
                            <span className="font-black text-red-600">{hasDominant ? formatDominant(pedir, pres) : `${pedir.toLocaleString()} und`}</span>
                            {hasDominant && <span className="text-slate-400 text-[10px]">({pedir.toLocaleString()} und)</span>}
                        </span>
                    )}
                </div>
            )}

            {/* ── Traslado sugerido ── */}
            {transferSuggestions.length > 0 && (
                <div className="px-4 py-2.5 border-t border-amber-100/80 bg-amber-50/30 flex flex-col gap-1.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">Traslado sugerido</span>
                    <div className="flex flex-wrap gap-2">
                        {transferSuggestions.map(s => (
                            <div key={s.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200">
                                <Building2 size={9} className="text-amber-600 shrink-0" />
                                <span className="text-[10px] font-black text-amber-800">{s.name}</span>
                                <span className="text-[10px] font-bold text-amber-600 tabular-nums">{s.transferable.toLocaleString()} und disponibles</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Vencimientos próximos (60 días) ── */}
            {expiryData.length > 0 && (
                <div className="px-4 py-2.5 border-t border-orange-100/80 bg-orange-50/20 flex flex-col gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-orange-500">Vencimientos próximos (60 días)</span>
                    <div className="flex flex-col gap-1">
                        {expiryData.map((lot, i) => {
                            const daysLeft = Math.ceil((new Date(lot.fecha_vencimiento) - Date.now()) / 86400000);
                            const urgent   = daysLeft <= 30;
                            return (
                                <div key={i} className="flex items-center gap-3 text-[10px]">
                                    <span className={`font-black tabular-nums w-8 shrink-0 ${urgent ? 'text-red-600' : 'text-orange-600'}`}>{daysLeft}d</span>
                                    <span className="text-slate-400 font-mono text-[9px] shrink-0">{lot.lote || '—'}</span>
                                    <span className="text-slate-600 font-semibold tabular-nums">{Number(lot.cantidad).toLocaleString()} und</span>
                                    <span className="text-slate-400 text-[9px]">{new Date(lot.fecha_vencimiento).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Historial de cálculos ── */}
            {historyData.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-100/80 bg-slate-50/30 flex flex-col gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Historial de cálculos</span>
                    <div className="flex flex-col gap-1">
                        {historyData.map((h, i) => (
                            <div key={i} className="flex items-center gap-3 text-[10px] text-slate-500">
                                <span className="text-[9px] text-slate-400 shrink-0 w-14 tabular-nums">
                                    {new Date(h.captured_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                </span>
                                <span className="font-bold text-orange-500">{(h.min_units ?? 0).toLocaleString()}</span>
                                <span className="text-slate-300">→</span>
                                <span className="font-bold text-blue-500">{(h.max_units ?? 0).toLocaleString()}</span>
                                <span className="text-slate-400">{Number(h.daily_velocity || 0).toFixed(1)}/día</span>
                                {h.abc_class && <AbcXyzBadge abc={h.abc_class} xyz={h.demand_variability} />}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Últimas compras (Bodega) ── */}
            {purchaseData.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-100/80 bg-slate-50/30 flex flex-col gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Últimas compras (Bodega)</span>
                    <div className="flex flex-col gap-1">
                        {purchaseData.map((p, i) => (
                            <div key={i} className="flex items-center gap-2.5 text-[10px]">
                                <span className="text-[9px] text-slate-400 shrink-0 w-14 tabular-nums">
                                    {new Date(p.fecha).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                </span>
                                <span className="font-bold text-slate-700 tabular-nums w-12 shrink-0 text-right">
                                    {Number(p.cantidad).toLocaleString()} und
                                </span>
                                <span className="text-slate-400 shrink-0">
                                    ${Number(p.precio_unitario).toFixed(2)}
                                </span>
                                <span className="text-slate-500 truncate min-w-0 flex-1">{p.proveedor || '—'}</span>
                                {p.lote && p.lote !== 'GENERICO' && (
                                    <span className="shrink-0 text-[8px] font-mono text-slate-400 bg-slate-100 px-1 rounded">{p.lote}</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Proyección de cobertura (productos activos) ── */}
            {!row.is_dead_stock && row.daily_velocity > 0 && stock > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-100/80 bg-slate-50/20 flex flex-col gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Proyección de stock</span>
                    <div className="flex items-center gap-6 flex-wrap">
                        {[30, 60, 90].map(days => {
                            const projected = Math.max(0, Math.round(stock - row.daily_velocity * days));
                            const depleted  = projected === 0;
                            const low       = projected > 0 && projected < minN;
                            const color     = depleted ? 'text-red-600' : low ? 'text-orange-600' : 'text-emerald-600';
                            return (
                                <div key={days} className="flex flex-col items-center gap-0.5">
                                    <span className="text-[9px] text-slate-400 font-semibold">+{days}d</span>
                                    <span className={`text-[15px] font-black tabular-nums leading-none ${color}`}>
                                        {depleted ? '0 ✗' : projected.toLocaleString()}
                                    </span>
                                    <span className="text-[8px] text-slate-400">und</span>
                                </div>
                            );
                        })}
                        <div className="flex-1 text-[9px] text-slate-400 leading-snug">
                            a {Number(row.daily_velocity).toFixed(2)} und/día promedio
                        </div>
                    </div>
                </div>
            )}

            {/* ── Acciones para dead stock ── */}
            {row.is_dead_stock && (
                <div className="px-4 py-2.5 border-t border-slate-100/80 bg-slate-50/40 flex flex-col gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Opciones</span>
                    {deadAction ? (
                        <div className="flex items-center gap-2 text-[11px] text-emerald-700 font-semibold">
                            <CheckCircle2 size={12} />
                            {deadAction === 'transfer' ? 'Marcado para traslado' : 'Marcado para liquidación'} — registrado en auditoría
                        </div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button onClick={() => logDeadStockAction('transfer')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors">
                                <Building2 size={11} /> Marcar para traslado
                            </button>
                            <button onClick={() => logDeadStockAction('liquidate')}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors">
                                <TrendingDown size={11} /> Marcar para liquidación
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditRow({ row, onSave, onCancel }) {
    const [mn,      setMn]      = useState(String(row.effective_min ?? ''));
    const [mx,      setMx]      = useState(String(row.effective_max ?? ''));
    const [lt,      setLt]      = useState('');
    const [ltLoaded, setLtLoaded] = useState(false);
    const [saving,  setSaving]  = useState(false);
    const [err,     setErr]     = useState('');
    const mnRef = useRef();
    useEffect(() => { mnRef.current?.select(); }, []);

    useEffect(() => {
        supabase.from('product_stock_params')
            .select('lead_time_days')
            .eq('erp_product_id', row.erp_product_id)
            .eq('erp_sucursal_id', row._erp_sucursal_id)
            .maybeSingle()
            .then(({ data }) => {
                setLt(data?.lead_time_days != null ? String(data.lead_time_days) : '');
                setLtLoaded(true);
            });
    }, [row.erp_product_id, row._erp_sucursal_id]);

    const save = async (clearManual = false) => {
        const newMin = clearManual ? null : (mn === '' ? null : parseInt(mn, 10));
        const newMax = clearManual ? null : (mx === '' ? null : parseInt(mx, 10));
        const newLt  = lt === '' ? null : parseInt(lt, 10);
        if (!clearManual && (newMin === null) !== (newMax === null)) { setErr('Completá ambos (MIN y MAX) o dejá los dos en blanco'); return; }
        if (!clearManual && newMin !== null && newMax !== null && newMax <= newMin) { setErr('MAX debe ser mayor al MIN'); return; }
        if (newLt !== null && newLt < 1) { setErr('Lead time debe ser ≥ 1 día'); return; }
        setSaving(true);
        try {
            const { error } = await supabase.from('product_stock_params')
                .update({ manual_min: newMin, manual_max: newMax, lead_time_days: newLt, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            useStaff.getState().appendAuditLog('MINMAX_MANUAL_OVERRIDE', String(row.erp_product_id), {
                product: row.product_name,
                sucursal_id: row._erp_sucursal_id,
                action: clearManual ? 'reset' : 'override',
                manual_min: newMin,
                manual_max: newMax,
                lead_time_days: newLt,
            });
            onSave();
        } catch (e) { setErr(e.message); setSaving(false); }
    };

    const alert = ALERT[row.alert_status] ?? ALERT.ok;
    const pres  = row.presentations || [];

    return (
        <div className="bg-blue-50/40 border-b border-blue-100">
            <div className="grid items-center px-4 py-2"
                style={{ gridTemplateColumns: '1fr 68px 100px 105px 105px 88px 56px' }}>
                <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{row.product_name || '—'}</span>
                        {row.has_manual && <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>}
                    </div>
                    <span className="text-[10px] text-slate-400">{Number(row.daily_velocity||0).toFixed(1)} und/día</span>
                    <StockBar current={row.current_stock} min={parseInt(mn)||row.effective_min} max={parseInt(mx)||row.effective_max} />
                </div>
                <div className="flex justify-center"><AbcXyzBadge abc={row.abc_class} xyz={row.demand_variability} /></div>
                <div className="text-right">
                    <span className={`text-[12px] font-bold tabular-nums ${Number(row.current_stock)===0?'text-red-500':'text-slate-700'}`}>
                        {formatUnits(row.current_stock, pres)}
                    </span>
                </div>
                <div className="px-1.5">
                    <input ref={mnRef} type="number" min="0" value={mn}
                        onChange={e => { setMn(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.effective_min)}
                        className="w-full text-right text-[12px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300" />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">und</div>
                </div>
                <div className="px-1.5">
                    <input type="number" min="0" value={mx}
                        onChange={e => { setMx(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.effective_max)}
                        className="w-full text-right text-[12px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">und</div>
                </div>
                <div className="flex items-center justify-center gap-1.5">
                    <button onClick={() => save()} disabled={saving}
                        className="h-7 px-3 rounded-lg text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-1">
                        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
                    </button>
                    <button onClick={onCancel} disabled={saving}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={13} /></button>
                </div>
                <div className="flex justify-end">
                    {row.has_manual && (
                        <button onClick={() => save(true)} disabled={saving} title="Restablecer valores calculados"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-orange-500 hover:bg-orange-50 transition-colors"><RotateCcw size={12} /></button>
                    )}
                </div>
            </div>
            {err && <div className="px-4 pb-2 text-[11px] font-semibold text-red-500">{err}</div>}
            {ltLoaded && (
                <div className="flex items-center gap-3 px-4 pb-2.5">
                    <Clock size={10} className="text-slate-400 shrink-0" />
                    <span className="text-[10px] text-slate-500 font-medium flex-1">Lead time específico</span>
                    <span className="text-[9px] text-slate-400">(vacío = usar clase XYZ)</span>
                    <input type="number" min="1" value={lt}
                        onChange={e => { setLt(e.target.value); setErr(''); }}
                        placeholder="—"
                        className="w-14 text-right text-[12px] font-bold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300" />
                    <span className="text-[10px] text-slate-400 shrink-0">días</span>
                </div>
            )}
        </div>
    );
}

// ─── Edit draft row ───────────────────────────────────────────────────────────

function EditDraftRow({ row, onSave, onCancel }) {
    const [mn,     setMn]     = useState(String(row.draft_min ?? ''));
    const [mx,     setMx]     = useState(String(row.draft_max ?? ''));
    const [saving, setSaving] = useState(false);
    const [err,    setErr]    = useState('');
    const mnRef = useRef();
    useEffect(() => { mnRef.current?.select(); }, []);

    const pres = row.presentations || [];

    const save = async () => {
        const newMin = mn === '' ? null : parseInt(mn, 10);
        const newMax = mx === '' ? null : parseInt(mx, 10);
        if (newMin !== null && newMax !== null && newMax <= newMin) { setErr('MAX debe ser mayor al MIN'); return; }
        setSaving(true);
        try {
            const { error } = await supabase.from('product_stock_params')
                .update({ draft_min: newMin, draft_max: newMax, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            useStaff.getState().appendAuditLog('MINMAX_DRAFT_EDIT', String(row.erp_product_id), {
                product: row.product_name, sucursal_id: row._erp_sucursal_id,
                draft_min: newMin, draft_max: newMax,
            });
            onSave();
        } catch (e) { setErr(e.message); setSaving(false); }
    };

    return (
        <div className="bg-amber-50/30 border-b border-amber-100">
            <div className="grid items-center px-4 py-2"
                style={{ gridTemplateColumns: '1fr 68px 100px 105px 105px 88px 56px' }}>
                <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{row.product_name}</span>
                        <span className="shrink-0 text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">BORRADOR</span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                        En uso: MIN <span className="text-orange-500 font-bold">{Number(row.effective_min || 0).toLocaleString()}</span> · MAX <span className="text-blue-500 font-bold">{Number(row.effective_max || 0).toLocaleString()}</span> und
                    </span>
                </div>
                <div className="flex justify-center">
                    <AbcXyzBadge abc={row.draft_abc_class || row.abc_class} xyz={row.draft_demand_variability || row.demand_variability} />
                </div>
                <div className="text-right">
                    <span className={`text-[12px] font-bold tabular-nums ${Number(row.current_stock) === 0 ? 'text-red-500' : 'text-slate-700'}`}>
                        {formatUnits(row.current_stock, pres)}
                    </span>
                </div>
                <div className="px-1.5">
                    <input ref={mnRef} type="number" min="0" value={mn}
                        onChange={e => { setMn(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.draft_min ?? '')}
                        className="w-full text-right text-[12px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">MIN borrador</div>
                </div>
                <div className="px-1.5">
                    <input type="number" min="0" value={mx}
                        onChange={e => { setMx(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.draft_max ?? '')}
                        className="w-full text-right text-[12px] font-bold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">MAX borrador</div>
                </div>
                <div className="flex items-center justify-center gap-1.5">
                    <button onClick={save} disabled={saving}
                        className="h-7 px-3 rounded-lg text-[11px] font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-1">
                        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
                    </button>
                    <button onClick={onCancel} disabled={saving}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={13} /></button>
                </div>
                <div />
            </div>
            {err && <div className="px-4 pb-2 text-[11px] font-semibold text-red-500">{err}</div>}
        </div>
    );
}

// ─── Config Panel ─────────────────────────────────────────────────────────────

function ConfigPanel({ config, onSave, onClose }) {
    const [form,   setForm]   = useState({ ...config });
    const [saving, setSaving] = useState(false);
    const [saved,  setSaved]  = useState(false);
    const [err,    setErr]    = useState('');

    const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

    const handleSave = async () => {
        if (Number(form.cycle_days) < 1) { setErr('El ciclo debe ser ≥ 1 día'); return; }
        if (Number(form.abc_a_pct) >= Number(form.abc_b_pct)) { setErr('El umbral A debe ser menor que el B'); return; }
        if (Number(form.xyz_x_cv_max) >= Number(form.xyz_y_cv_max)) { setErr('El CV máximo de X debe ser menor que el de Y'); return; }
        if (Number(form.approaching_pct) < 1 || Number(form.approaching_pct) > 100) { setErr('Alerta próximo debe estar entre 1 y 100%'); return; }
        setSaving(true); setErr('');
        const { data: { user } } = await supabase.auth.getUser();
        const payload = {
            cycle_days:          Number(form.cycle_days),
            reorder_x_days:      Number(form.reorder_x_days),
            reorder_y_days:      Number(form.reorder_y_days),
            reorder_z_days:      Number(form.reorder_z_days),
            xyz_x_cv_max:        Number(form.xyz_x_cv_max),
            xyz_y_cv_max:        Number(form.xyz_y_cv_max),
            abc_a_pct:           Number(form.abc_a_pct),
            abc_b_pct:           Number(form.abc_b_pct),
            analysis_days:       Number(form.analysis_days),
            approaching_pct:     Number(form.approaching_pct),
            buffer_x_days:       Number(form.buffer_x_days),
            buffer_y_days:       Number(form.buffer_y_days),
            buffer_z_days:       Number(form.buffer_z_days),
            outlier_percentile:  Number(form.outlier_percentile ?? 95),
            updated_at:          new Date().toISOString(),
            updated_by:          user?.email ?? null,
        };
        try {
            const { error } = await supabase.from('stock_config').update(payload).eq('id', 1);
            if (error) throw error;
            onSave({ ...payload });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) { setErr(e.message); }
        finally { setSaving(false); }
    };

    const Field = ({ label, k, unit, min = 0, max, step = 1 }) => (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-600 font-medium flex-1">{label}</span>
            <div className="flex items-center gap-1.5">
                <input type="number" min={min} max={max} step={step} value={form[k] ?? 0}
                    onChange={e => set(k, e.target.value)}
                    className="w-16 text-right text-[12px] font-bold text-slate-800 bg-white/80 border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#0052CC]/30 focus:border-[#0052CC]" />
                {unit && <span className="text-[10px] text-slate-400 shrink-0 w-8">{unit}</span>}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-20 pointer-events-none">
            <div className="pointer-events-auto w-80 rounded-2xl border border-white/70 shadow-[0_20px_60px_rgba(0,0,0,0.12)] overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.88)', backdropFilter: 'blur(24px)' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                        <Settings2 size={14} className="text-[#0052CC]" />
                        <span className="text-[12px] font-black text-slate-800">Configuración Min/Max</span>
                    </div>
                    <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <X size={12} />
                    </button>
                </div>

                <div className="px-4 py-3 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
                    {/* Ciclo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ciclo de reposición</span>
                        <Field label="MAX — días de cobertura objetivo" k="cycle_days" unit="días" min={1} />
                        <Field label="Ventana histórica de ventas"       k="analysis_days" unit="días" min={30} />
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Reorden por XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">MIN — días de reorden por clase XYZ</span>
                        <Field label="Clase X — demanda estable"   k="reorder_x_days" unit="días" min={1} />
                        <Field label="Clase Y — demanda moderada"  k="reorder_y_days" unit="días" min={1} />
                        <Field label="Clase Z — demanda errática"  k="reorder_z_days" unit="días" min={1} />
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Umbrales XYZ */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Umbrales XYZ (coeficiente de variación)</span>
                        <Field label="X si CV ≤" k="xyz_x_cv_max" unit="%" min={1} step={1} />
                        <Field label="Y si CV ≤" k="xyz_y_cv_max" unit="%" min={1} step={1} />
                        <p className="text-[9px] text-slate-400">Z = CV mayor al umbral Y</p>
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Umbrales ABC */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Umbrales ABC (% revenue acumulado)</span>
                        <Field label="A = top" k="abc_a_pct" unit="%" min={1} step={1} />
                        <Field label="B = hasta" k="abc_b_pct" unit="%" min={1} step={1} />
                        <p className="text-[9px] text-slate-400">C y D = resto. Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Alerta próximo mínimo */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Alerta "próximo a mínimo"</span>
                        <Field label="Umbral (stock &lt; MIN × (1 + X%))" k="approaching_pct" unit="%" min={1} max={100} step={1} />
                        <p className="text-[9px] text-slate-400">Ej: 25% → alerta si stock &lt; MIN × 1.25</p>
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Buffer de seguridad */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Buffer de seguridad (días extra al MIN)</span>
                        <Field label="Clase X — demanda estable"  k="buffer_x_days" unit="días" min={0} />
                        <Field label="Clase Y — demanda moderada" k="buffer_y_days" unit="días" min={0} />
                        <Field label="Clase Z — demanda errática" k="buffer_z_days" unit="días" min={0} />
                        <p className="text-[9px] text-slate-400">MIN = velocidad × (reorden + buffer). Recalcula para aplicar.</p>
                    </section>

                    <div className="h-px bg-slate-100" />

                    {/* Filtrado de demanda mayorista */}
                    <section className="flex flex-col gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Filtrado de outliers (winsorización)</span>
                        <Field label="Percentil de corte" k="outlier_percentile" unit="%" min={50} max={100} step={1} />
                        <p className="text-[9px] text-slate-400 leading-snug">
                            Capea ventas diarias al percentil indicado antes de calcular velocidad y CV. P95 = estándar industria. P100 = sin filtro. Recalculá para aplicar.
                        </p>
                    </section>

                    {err && <p className="text-[11px] text-red-500 font-semibold">{err}</p>}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <CheckCircle2 size={12} /> : <Save size={12} />}
                        {saved ? '¡Guardado!' : 'Guardar configuración'}
                    </button>
                    <button onClick={onClose} className="px-3 py-2 rounded-xl text-[12px] font-bold text-slate-500 hover:bg-slate-100 transition-colors">Cerrar</button>
                </div>
            </div>
        </div>
    );
}

// ─── Labs Panel ───────────────────────────────────────────────────────────────

function LabsPanel({ onClose, onChanged }) {
    const [labs,      setLabs]      = useState([]);
    const [counts,    setCounts]    = useState({});  // laboratorio_id → product count
    const [loading,   setLoading]   = useState(true);
    const [saving,    setSaving]    = useState(null);
    const [search,    setSearch]    = useState('');
    const searchRef = useRef();

    useEffect(() => {
        Promise.all([
            supabase.from('laboratorios').select('id, nombre, ocultar_en_minmax').order('nombre'),
            supabase.from('products').select('laboratorio_id').eq('activo', true),
        ]).then(([{ data: labData }, { data: prodData }]) => {
            setLabs(labData || []);
            const cm = {};
            (prodData || []).forEach(p => { if (p.laboratorio_id) cm[p.laboratorio_id] = (cm[p.laboratorio_id] || 0) + 1; });
            setCounts(cm);
            setLoading(false);
        });
        // Auto-focus search after mount
        setTimeout(() => searchRef.current?.focus(), 80);
    }, []);

    const toggle = async (lab) => {
        setSaving(lab.id);
        const newVal = !lab.ocultar_en_minmax;
        const { error } = await supabase.from('laboratorios')
            .update({ ocultar_en_minmax: newVal })
            .eq('id', lab.id);
        if (!error) {
            // Al desocultar un lab, limpia is_hidden individual para que los productos
            // reaparezcan sin estar marcados como ocultos a nivel de producto
            if (!newVal) {
                const { data: prods } = await supabase.from('products').select('id').eq('laboratorio_id', lab.id);
                if (prods?.length) {
                    await supabase.from('product_stock_params')
                        .update({ is_hidden: false, updated_at: new Date().toISOString() })
                        .in('erp_product_id', prods.map(p => p.id));
                }
            }
            setLabs(prev => prev.map(l => l.id === lab.id ? { ...l, ocultar_en_minmax: newVal } : l));
            useStaff.getState().appendAuditLog('MINMAX_LAB_VISIBILITY', String(lab.id), {
                lab: lab.nombre, ocultar: newVal,
            });
            onChanged?.();
        }
        setSaving(null);
    };

    const q = search.trim().toLowerCase();
    const visible = q ? labs.filter(l => l.nombre.toLowerCase().includes(q)) : labs;
    const hiddenCount = labs.filter(l => l.ocultar_en_minmax).length;

    // Glassmorphism tokens shared across elements
    const glass = {
        panel:  { background: 'rgba(240,245,255,0.72)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', border: '1px solid rgba(255,255,255,0.65)', boxShadow: '0 24px 64px rgba(0,30,80,0.13), inset 0 1px 0 rgba(255,255,255,0.9)' },
        divider:{ borderColor: 'rgba(148,163,184,0.15)' },
        search: { background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(8px)', border: '1px solid rgba(148,163,184,0.22)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.04)' },
        row:    { background: 'rgba(255,255,255,0.42)', border: '1px solid rgba(226,232,240,0.5)' },
        rowOff: { background: 'rgba(254,242,242,0.6)',  border: '1px solid rgba(252,165,165,0.4)' },
        footer: { background: 'rgba(255,255,255,0.38)', border: '1px solid rgba(226,232,240,0.4)' },
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-20 pointer-events-none">
            <motion.div
                className="pointer-events-auto w-72 rounded-2xl overflow-hidden flex flex-col"
                style={glass.panel}
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b" style={glass.divider}>
                    <div className="flex items-center gap-2">
                        <FlaskConical size={14} className="text-[#0052CC]" />
                        <span className="text-[12px] font-black text-slate-800">Visibilidad de laboratorios</span>
                        {hiddenCount > 0 && (
                            <span className="text-[9px] font-black text-[#0052CC] bg-blue-50/80 border border-blue-200/70 px-1.5 py-0.5 rounded-full leading-none">
                                {hiddenCount} oculto{hiddenCount !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose}
                        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 transition-colors"
                        style={{ background: 'rgba(255,255,255,0.6)' }}>
                        <X size={11} />
                    </button>
                </div>

                {/* Search */}
                <div className="px-3 pt-3 pb-1.5">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl" style={glass.search}>
                        <Search size={11} className="text-slate-400 shrink-0" />
                        <input
                            ref={searchRef}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar laboratorio…"
                            className="flex-1 text-[11px] text-slate-700 placeholder-slate-400 bg-transparent outline-none"
                        />
                        {search && (
                            <button onClick={() => setSearch('')} className="text-slate-300 hover:text-slate-500 transition-colors shrink-0">
                                <X size={10} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Hint */}
                <p className="px-4 pb-1.5 text-[9.5px] text-slate-400 leading-relaxed">
                    Ocultos: no aparecen en MinMax ni en el cálculo. No se cuentan como productos ocultos individualmente.
                </p>

                {/* List */}
                <div className="px-3 pb-2 flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: '54vh' }}>
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 size={18} className="animate-spin text-slate-300" />
                        </div>
                    ) : visible.length === 0 ? (
                        <div className="flex flex-col items-center py-8 gap-2 text-slate-300">
                            <FlaskConical size={22} />
                            <span className="text-[10px] font-semibold">Sin resultados</span>
                        </div>
                    ) : visible.map(lab => {
                        const hidden = lab.ocultar_en_minmax;
                        const count  = counts[lab.id] ?? 0;
                        return (
                            <button key={lab.id}
                                onClick={() => toggle(lab)}
                                disabled={saving === lab.id}
                                className="flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all duration-200 disabled:opacity-60 hover:scale-[1.01] active:scale-[0.99]"
                                style={hidden ? glass.rowOff : glass.row}>
                                <div className="flex-1 min-w-0">
                                    <div className={`text-[11px] font-semibold truncate ${hidden ? 'text-red-700' : 'text-slate-700'}`}>
                                        {lab.nombre}
                                    </div>
                                    {count > 0 && (
                                        <div className={`text-[9px] tabular-nums ${hidden ? 'text-red-400' : 'text-slate-400'}`}>
                                            {count} producto{count !== 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                                <div className="shrink-0">
                                    {saving === lab.id ? (
                                        <Loader2 size={12} className="animate-spin text-slate-400" />
                                    ) : (
                                        <div className={`w-8 h-4 rounded-full transition-all duration-300 relative ${hidden ? 'bg-red-400' : 'bg-slate-200'}`}
                                            style={hidden ? { boxShadow: '0 0 8px rgba(248,113,113,0.35)' } : {}}>
                                            <div className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-300 ${hidden ? 'left-[18px]' : 'left-0.5'}`} />
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="px-3 pb-3 pt-1 border-t mt-auto" style={glass.divider}>
                    <button onClick={onClose}
                        className="w-full py-2 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors duration-150"
                        style={glass.footer}
                        onMouseOver={e => Object.assign(e.currentTarget.style, { background: 'rgba(255,255,255,0.65)' })}
                        onMouseOut={e => Object.assign(e.currentTarget.style, glass.footer)}>
                        Cerrar
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabMinMax({ searchTerm = '', config, onConfigChange }) {
    const cycleDays = config?.cycle_days ?? 45;

    const { hasPermission } = useAuth();
    const canManage = hasPermission('minmax', 'can_edit');

    const [selectedErp,  setSelectedErp]  = useState(5);
    const [filterAbc,    setFilterAbc]    = useState('all');
    const [filterXyz,    setFilterXyz]    = useState('all');
    const [filterAlert,  setFilterAlert]  = useState('all');
    const [data,         setData]         = useState([]);
    const [costSummary,  setCostSummary]  = useState(null);
    const [draftCost,    setDraftCost]    = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [calculating,  setCalculating]  = useState(false);
    const [calcMode,     setCalcMode]     = useState('single'); // 'single' | 'all'
    const [calcProgress, setCalcProgress] = useState(null); // { current, total, name }
    const [error,        setError]        = useState(null);
    const [expandedIds,  setExpandedIds]  = useState(new Set());
    const [configOpen,   setConfigOpen]   = useState(false);
    const [labsOpen,     setLabsOpen]     = useState(false);
    const [sortBy,       setSortBy]       = useState('laboratorio');
    const [sortDir,      setSortDir]      = useState('asc');
    const [page,         setPage]         = useState(1);
    const [pageSize,     setPageSize]     = useState(25);
    const [publishing,   setPublishing]   = useState(false);
    const [publishResult,setPublishResult]= useState(null); // kept for potential future use
    const [filterDraft,       setFilterDraft]       = useState(false);
    const [filterSparse,      setFilterSparse]      = useState(false);
    const [hidingIds,         setHidingIds]         = useState(new Set());
    const [filterChangesOnly, setFilterChangesOnly] = useState(false);
    const [filterHidden,      setFilterHidden]      = useState(false);
    const [hiddenIds,       setHiddenIds]       = useState(new Set());
    const saveHiddenTimer  = useRef(null); // unused, kept for cleanup safety
    const publishTimer     = useRef(null);
    const skipBlurSave     = useRef(false);
    const [publishConfirm, setPublishConfirm] = useState({ open: false, ids: null, count: 0 });
    const [analysisConfig, setAnalysisConfig] = useState({ analysis_days: 180 });

    // Cleanup publish timer on unmount
    useEffect(() => () => clearTimeout(publishTimer.current), []);

    // hiddenIds se carga desde is_hidden en get_stock_analysis al hacer loadData
    const [configChanged,   setConfigChanged]   = useState(false);
    const [inlineDraftEdit, setInlineDraftEdit] = useState(null); // { productId, sucursalId, field:'min'|'max', value, error? }
    const [toast,           setToast]           = useState(null); // { message, type }
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const [historyRow,      setHistoryRow]      = useState(null);
    const [historyLogs,     setHistoryLogs]     = useState([]);
    const [historyLoading,  setHistoryLoading]  = useState(false);
    const [empPhotoMap,     setEmpPhotoMap]     = useState({});
    const loadRef = useRef(0);

    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(() => setToast(null), 4500);
        return () => clearTimeout(t);
    }, [toast]);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user?.email) return;
            supabase.from('employees').select('id,name,photo_url').eq('email', user.email).maybeSingle()
                .then(({ data: emp }) => { if (emp) setCurrentEmployee(emp); });
        });
    }, []);

    const toggleExpand = useCallback((id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true); setData([]); setError(null); setInlineDraftEdit(null); setExpandedIds(new Set());
        try {
            // PostgREST caps at 1000 rows per request — fetch in chunks until exhausted
            const allRows = [];
            const CHUNK = 1000;
            let from = 0;
            let keepFetching = true;
            while (keepFetching) {
                const { data: chunk, error: e1 } = await supabase
                    .rpc('get_stock_analysis', { p_erp_sucursal_id: erpId })
                    .range(from, from + CHUNK - 1);
                if (e1) throw e1;
                allRows.push(...(chunk || []));
                keepFetching = chunk && chunk.length === CHUNK;
                from += CHUNK;
            }
            const [{ data: cost, error: e2 }, { data: draft }, { data: cfg }] = await Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: erpId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: erpId }),
                supabase.from('stock_config').select('analysis_days').eq('id', 1).single(),
            ]);
            if (e2) throw e2;
            if (rid !== loadRef.current) return;
            const mapped = allRows.map(r => ({ ...r, _erp_sucursal_id: erpId }));
            setData(mapped);
            setHiddenIds(new Set(mapped.filter(r => r.is_hidden).map(r => r.erp_product_id)));
            setCostSummary(cost  || null);
            setDraftCost(draft   || null);
            if (cfg) setAnalysisConfig(cfg);
        } catch (e) {
            if (rid === loadRef.current) useToastStore.getState().showToast(ERP_NAMES[erpId] ?? 'MinMax', translateDbError(e.message), 'error');
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); setFilterChangesOnly(false); setFilterDraft(false); setFilterSparse(false); }, [selectedErp, loadData]);

    const fmtCalcError = msg => {
        if (!msg) return 'Error al calcular.';
        if (/timeout|canceling statement/i.test(msg))
            return 'El cálculo tardó demasiado. Intentá recalcular por sucursal en vez de todas a la vez.';
        return `Error al calcular: ${msg}`;
    };

    const handleRecalcular = async () => {
        const wasPublished = hasPublishedData;
        setCalculating(true); setCalcMode('single'); setError(null); setConfigChanged(false);
        try {
            const { data: res, error: e } = await supabase.rpc('calculate_stock_params', { p_erp_sucursal_id: selectedErp });
            if (e) throw e;
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `${(res?.rows ?? 0).toLocaleString()} borradores generados`, 'success');
            await loadData(selectedErp);
            if (wasPublished) { setFilterChangesOnly(true); setFilterDraft(false); }
        } catch (e) { useToastStore.getState().showToast(ERP_NAMES[selectedErp], fmtCalcError(e.message), 'error'); }
        finally { setCalculating(false); }
    };

    const handleRecalcularAll = async () => {
        const wasPublished = hasPublishedData;
        setCalculating(true); setCalcMode('all'); setError(null); setConfigChanged(false);
        const ids = ERP_ORDER;
        let totalRows = 0;
        const failed = [];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            setCalcProgress({ current: i + 1, total: ids.length, name: ERP_NAMES[id] });
            try {
                const { data: res, error: e } = await supabase.rpc('calculate_stock_params', { p_erp_sucursal_id: id });
                if (e) throw e;
                totalRows += res?.rows ?? 0;
            } catch (e) {
                failed.push(ERP_NAMES[id]);
            }
        }
        setCalcProgress(null);
        if (failed.length > 0) {
            useToastStore.getState().showToast('Calcular', `Error en: ${failed.join(', ')}`, 'error');
        } else {
            useToastStore.getState().showToast('Todas las sucursales', `${totalRows.toLocaleString()} borradores generados`, 'success');
        }
        await loadData(selectedErp);
        if (wasPublished) { setFilterChangesOnly(true); setFilterDraft(false); }
        setCalculating(false);
    };

    const handleEditSave = useCallback(() => { loadData(selectedErp); }, [selectedErp, loadData]);

    const hasPublishedData = useMemo(() => data.some(r => r.published_by != null), [data]);

    const zeroOutRow = useCallback(async (row) => {
        if (hasPublishedData && row.draft_status !== 'pending') {
            const { error: e } = await supabase.from('product_stock_params')
                .upsert(
                    { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, min_units: 0, max_units: 0, updated_at: new Date().toISOString() },
                    { onConflict: 'erp_product_id,erp_sucursal_id' }
                );
            if (!e) {
                setData(prev => prev.map(r =>
                    r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                        ? { ...r, effective_min: 0, effective_max: 0 } : r
                ));
            }
            useStaff.getState().appendAuditLog('MINMAX_LIVE_ZERO', String(row.erp_product_id), {
                product: row.product_name, sucursal_id: row._erp_sucursal_id,
            });
        } else {
            const { error: e } = await supabase.from('product_stock_params')
                .upsert(
                    { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, draft_min: 0, draft_max: 0, draft_status: 'pending', updated_at: new Date().toISOString() },
                    { onConflict: 'erp_product_id,erp_sucursal_id' }
                );
            if (!e) {
                setData(prev => prev.map(r =>
                    r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                        ? { ...r, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r
                ));
            }
            useStaff.getState().appendAuditLog('MINMAX_ZERO_OUT', String(row.erp_product_id), {
                product: row.product_name, sucursal_id: row._erp_sucursal_id,
            });
        }
    }, [hasPublishedData]);

    const saveDraftCell = useCallback(async (edit) => {
        if (!edit) return;
        const numVal = edit.value === '' ? null : parseInt(edit.value, 10);
        if (Number.isNaN(numVal) && edit.value !== '') { setInlineDraftEdit(null); return; }
        const targetRow = data.find(r => r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId);
        const rowHasDraft  = targetRow?.draft_status === 'pending';
        const rowIsSparse  = targetRow?.draft_status === 'sparse_data';
        const saveLive = hasPublishedData && !rowHasDraft && !rowIsSparse;

        setInlineDraftEdit(null);
        if (saveLive) {
            const col    = edit.field === 'min' ? 'min_units'    : 'max_units';
            const effCol = edit.field === 'min' ? 'effective_min' : 'effective_max';
            const { error: e } = await supabase.from('product_stock_params')
                .upsert(
                    { erp_product_id: edit.productId, erp_sucursal_id: edit.sucursalId, [col]: numVal, updated_at: new Date().toISOString() },
                    { onConflict: 'erp_product_id,erp_sucursal_id' }
                );
            if (e) {
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', e.message || 'Error al guardar', 'error');
                return;
            }
            setData(prev => prev.map(r =>
                r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId
                    ? { ...r, [effCol]: numVal ?? 0 } : r
            ));
            Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: edit.sucursalId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: edit.sucursalId }),
            ]).then(([{ data: cost }, { data: draft }]) => {
                if (cost)  setCostSummary(cost);
                if (draft) setDraftCost(draft);
            });
            useStaff.getState().appendAuditLog('MINMAX_LIVE_EDIT', String(edit.productId), {
                field: col,
                field_label: edit.field === 'min' ? 'MIN' : 'MAX',
                product: targetRow?.product_name,
                old_value: edit.field === 'min' ? (targetRow?.effective_min ?? 0) : (targetRow?.effective_max ?? 0),
                new_value: numVal,
                sucursal_id: edit.sucursalId,
            });
            warnIfOutrageous(edit.field, numVal, targetRow);
        } else {
            const col = edit.field === 'min' ? 'draft_min' : 'draft_max';
            const { error: e } = await supabase.from('product_stock_params')
                .upsert(
                    { erp_product_id: edit.productId, erp_sucursal_id: edit.sucursalId, [col]: numVal, draft_status: 'pending', updated_at: new Date().toISOString() },
                    { onConflict: 'erp_product_id,erp_sucursal_id' }
                );
            if (e) {
                useToastStore.getState().showToast(targetRow?.product_name || 'Producto', e.message || 'Error al guardar', 'error');
                return;
            }
            setData(prev => prev.map(r =>
                r.erp_product_id === edit.productId && r._erp_sucursal_id === edit.sucursalId
                    ? { ...r, [col]: numVal, draft_status: 'pending' } : r
            ));
            Promise.all([
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: edit.sucursalId }),
                supabase.rpc('get_draft_cost_estimate',    { p_erp_sucursal_id: edit.sucursalId }),
            ]).then(([{ data: cost }, { data: draft }]) => {
                if (cost)  setCostSummary(cost);
                if (draft) setDraftCost(draft);
            });
            useStaff.getState().appendAuditLog('MINMAX_DRAFT_EDIT', String(edit.productId), {
                field: col,
                field_label: edit.field === 'min' ? 'MIN' : 'MAX',
                product: targetRow?.product_name,
                old_value: edit.field === 'min' ? (targetRow?.draft_min ?? targetRow?.effective_min ?? 0) : (targetRow?.draft_max ?? targetRow?.effective_max ?? 0),
                new_value: numVal,
                sucursal_id: edit.sucursalId,
            });
            warnIfOutrageous(edit.field, numVal, targetRow);
        }
    }, [data, hasPublishedData]);

    const unhideProduct = useCallback(async (productId) => {
        await supabase.from('product_stock_params')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .eq('erp_product_id', productId)
            .eq('erp_sucursal_id', selectedErp);
        setHiddenIds(prev => { const n = new Set(prev); n.delete(productId); return n; });
        setData(prev => prev.map(r => r.erp_product_id === productId ? { ...r, is_hidden: false } : r));
        useStaff.getState().appendAuditLog('MINMAX_UNHIDE', String(productId), { sucursal_id: selectedErp });
    }, [selectedErp]);

    const unhideAll = useCallback(async () => {
        const ids = [...hiddenIds];
        if (!ids.length) return;
        await supabase.from('product_stock_params')
            .update({ is_hidden: false, updated_at: new Date().toISOString() })
            .in('erp_product_id', ids)
            .eq('erp_sucursal_id', selectedErp);
        setHiddenIds(new Set());
        setData(prev => prev.map(r => ids.includes(r.erp_product_id) ? { ...r, is_hidden: false } : r));
        setFilterHidden(false);
        useStaff.getState().appendAuditLog('MINMAX_UNHIDE_ALL', 'batch', { count: ids.length, sucursal_id: selectedErp });
    }, [hiddenIds, selectedErp]);

    const resetToCalc = useCallback(async (row) => {
        if (row.calc_min == null && row.calc_max == null) {
            useToastStore.getState().showToast(row.product_name, 'No hay valores calculados. Corre Calcular primero.', 'error');
            return;
        }
        const cMin = row.calc_min ?? 0;
        const cMax = row.calc_max ?? 0;
        const saveLive = hasPublishedData && row.draft_status !== 'pending';
        const upsertData = saveLive
            ? { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, min_units: cMin, max_units: cMax, updated_at: new Date().toISOString() }
            : { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, draft_min: cMin, draft_max: cMax, draft_status: 'pending', updated_at: new Date().toISOString() };
        const { error: e } = await supabase.from('product_stock_params')
            .upsert(upsertData, { onConflict: 'erp_product_id,erp_sucursal_id' });
        if (e) { useToastStore.getState().showToast(row.product_name, `Error al restaurar: ${e.message}`, 'error'); return; }
        setData(prev => prev.map(r => {
            if (r.erp_product_id !== row.erp_product_id || r._erp_sucursal_id !== row._erp_sucursal_id) return r;
            return saveLive
                ? { ...r, effective_min: cMin, effective_max: cMax }
                : { ...r, draft_min: cMin, draft_max: cMax, draft_status: 'pending' };
        }));
        useToastStore.getState().showToast(row.product_name, `Restaurado a MIN ${cMin} / MAX ${cMax} (calculado)`, 'success');
        useStaff.getState().appendAuditLog('MINMAX_RESET_CALC', String(row.erp_product_id), {
            calc_min: cMin, calc_max: cMax, sucursal_id: row._erp_sucursal_id, mode: saveLive ? 'live' : 'draft',
        });
    }, [hasPublishedData]);

    const draftCount   = useMemo(() => data.filter(r => r.draft_status === 'pending').length, [data]);
    const sparseCount  = useMemo(() => data.filter(r => r.draft_status === 'sparse_data').length, [data]);
    const changesCount = useMemo(() => data.filter(r => r.draft_status === 'pending' && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max)).length, [data]);

    const openHistory = useCallback(async (row) => {
        setHistoryRow(row);
        setHistoryLogs([]);
        setHistoryLoading(true);
        const [{ data: logs }, { data: emps }] = await Promise.all([
            supabase.from('audit_logs')
                .select('id,user_name,user_id,action,details,created_at')
                .in('action', ['MINMAX_LIVE_EDIT','MINMAX_DRAFT_EDIT','MINMAX_RESET_CALC','MINMAX_MANUAL_OVERRIDE','MINMAX_ZERO_OUT','MINMAX_LIVE_ZERO'])
                .eq('target_id', String(row.erp_product_id))
                .order('created_at', { ascending: false })
                .limit(80),
            supabase.from('employees').select('name,photo_url'),
        ]);
        const photoMap = {};
        (emps || []).forEach(e => { if (e.name) photoMap[e.name] = e.photo_url; });
        setHistoryLogs(logs || []);
        setEmpPhotoMap(photoMap);
        setHistoryLoading(false);
    }, []);

    const requestPublish = useCallback((ids = null) => {
        const count = ids ? ids.length : draftCount;
        setPublishConfirm({ open: true, ids: ids ?? null, count });
    }, [draftCount]);

    const handlePublish = useCallback(async (productIds = null) => {
        setPublishing(true); setPublishResult(null); setError(null);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const rpcParams = { p_erp_sucursal_id: selectedErp, p_published_by: user?.email ?? null };
            if (productIds) rpcParams.p_erp_product_ids = productIds;
            const { data: res, error: e } = await supabase.rpc('publish_stock_params', rpcParams);
            if (e) throw e;
            useStaff.getState().appendAuditLog('MINMAX_PUBLISH', String(selectedErp), {
                sucursal_id: selectedErp, product_ids: productIds, published: res?.published,
            });
            await loadData(selectedErp);
            const n = res?.published ?? 0;
            const label = productIds ? `${n} producto${n !== 1 ? 's' : ''}` : `${n.toLocaleString()} borradores`;
            useToastStore.getState().showToast(ERP_NAMES[selectedErp], `Publicó ${label} exitosamente`, 'success');
        } catch (e) { useToastStore.getState().showToast('Error al publicar', e.message, 'error'); }
        finally { setPublishing(false); }
    }, [selectedErp, loadData]);

    const startDeferredPublish = useCallback((ids, count) => {
        setPublishConfirm({ open: false, ids: null, count: 0 });
        const label = count === 1 ? 'borrador' : 'borradores';
        setToast({
            message: `Publicando ${count} ${label} en 5 s…`,
            type: 'info',
            action: {
                label: 'Cancelar',
                onClick: () => { clearTimeout(publishTimer.current); setToast(null); },
            },
        });
        publishTimer.current = setTimeout(async () => {
            setToast(null);
            await handlePublish(ids ?? undefined);
        }, 5000);
    }, [handlePublish]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const stats = useMemo(() => Object.fromEntries(
        STAT_CFGS.map(s => [s.key, data.filter(d => d.alert_status === s.key).length])
    ), [data]);

    const lastCalcAt      = useMemo(() => data.find(d => d.calculated_at && !d.is_dead_stock)?.calculated_at ?? null, [data]);
    const lastDraftCalcAt = useMemo(() => data.find(r => r.draft_status === 'pending' && r.draft_calculated_at)?.draft_calculated_at ?? null, [data]);

    const hasActiveFilter = filterAbc !== 'all' || filterXyz !== 'all' || filterAlert !== 'all' || searchTerm !== '';
    const criticalACount  = useMemo(() => data.filter(r => r.abc_class === 'A' && (r.alert_status === 'out_of_stock' || r.alert_status === 'below_min')).length, [data]);
    const isBodega      = selectedErp === 6;
    const neverCalc     = data.length > 0 && data.every(d => d.is_dead_stock || d.alert_status === 'no_data');
    const hasActiveData = data.some(d => !d.is_dead_stock && d.alert_status !== 'no_data');

    const filtered = useMemo(() => {
        if (filterHidden) {
            return data.filter(r => hiddenIds.has(r.erp_product_id));
        }
        const q = searchTerm.toLowerCase();
        return data.filter(r => {
            if (hiddenIds.has(r.erp_product_id))                                           return false;
            if (filterSparse && r.draft_status !== 'sparse_data') return false;
            if (filterDraft && r.draft_status !== 'pending') return false;
            if (filterChangesOnly && !(r.draft_status === 'pending' && (r.draft_min !== r.effective_min || r.draft_max !== r.effective_max))) return false;
            if (filterAbc !== 'all' && (r.draft_abc_class || r.abc_class) !== filterAbc)  return false;
            if (filterXyz !== 'all' && normXyz(r.draft_demand_variability || r.demand_variability) !== filterXyz) return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert)                   return false;
            if (q && !r.product_name?.toLowerCase().includes(q) && !r.laboratorio_nombre?.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [data, filterAbc, filterXyz, filterAlert, searchTerm, filterDraft, filterSparse, filterChangesOnly, hiddenIds, filterHidden]);

    const filteredDraftIds = useMemo(
        () => hasActiveFilter ? filtered.filter(r => r.draft_status === 'pending').map(r => r.erp_product_id) : [],
        [filtered, hasActiveFilter]
    );

    const hideFiltered = useCallback(async () => {
        if (!filtered.length) return;
        const ids = filtered.map(r => r.erp_product_id);
        // upsert en vez de update para que dead-stock products (sin fila en product_stock_params) también queden ocultos
        await supabase.from('product_stock_params')
            .upsert(
                ids.map(id => ({
                    erp_product_id: id,
                    erp_sucursal_id: selectedErp,
                    is_hidden: true,
                    draft_min: 0,
                    draft_max: 0,
                    draft_status: 'pending',
                    updated_at: new Date().toISOString(),
                })),
                { onConflict: 'erp_product_id,erp_sucursal_id' }
            );
        setHiddenIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
        setData(prev => prev.map(r =>
            ids.includes(r.erp_product_id) && r._erp_sucursal_id === selectedErp
                ? { ...r, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r
        ));
        useStaff.getState().appendAuditLog('MINMAX_HIDE_FILTERED', 'batch', { count: ids.length, sucursal_id: selectedErp });
    }, [filtered, selectedErp]);
    const filterLabel = useMemo(() => {
        if (filterAbc !== 'all' && filterXyz === 'all' && filterAlert === 'all' && !searchTerm) return `Clase ${filterAbc}`;
        if (filterAlert !== 'all' && filterAbc === 'all' && filterXyz === 'all' && !searchTerm) return ALERT[filterAlert]?.label ?? filterAlert;
        if (searchTerm && filterAbc === 'all' && filterXyz === 'all' && filterAlert === 'all') return `"${searchTerm}"`;
        return 'Filtrados';
    }, [filterAbc, filterXyz, filterAlert, searchTerm]);

    const handleSort = useCallback((key) => {
        setSortBy(prev => {
            if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir('asc');
            return key;
        });
        setPage(1);
    }, []);

    const sorted = useMemo(() => {
        if (!sortBy) return filtered;
        return [...filtered].sort((a, b) => {
            let av, bv;
            if (sortBy === 'product_name')  { av = a.product_name || ''; bv = b.product_name || ''; }
            else if (sortBy === 'laboratorio') { av = a.laboratorio_nombre || ''; bv = b.laboratorio_nombre || ''; }
            else if (sortBy === 'abc_xyz') {
                av = `${a.draft_abc_class || a.abc_class || 'D'}${normXyz(a.draft_demand_variability || a.demand_variability)}`;
                bv = `${b.draft_abc_class || b.abc_class || 'D'}${normXyz(b.draft_demand_variability || b.demand_variability)}`;
            }
            else if (sortBy === 'current_stock') { av = Number(a.current_stock); bv = Number(b.current_stock); }
            else if (sortBy === 'coverage') {
                av = a.daily_velocity > 0 ? Number(a.current_stock) / Number(a.daily_velocity) : Infinity;
                bv = b.daily_velocity > 0 ? Number(b.current_stock) / Number(b.daily_velocity) : Infinity;
            }
            else if (sortBy === 'effective_min') { av = Number(a.effective_min); bv = Number(b.effective_min); }
            else if (sortBy === 'effective_max') { av = Number(a.effective_max); bv = Number(b.effective_max); }
            else if (sortBy === 'revenue_6m')    { av = Number(a.revenue_6m);    bv = Number(b.revenue_6m);    }
            else if (sortBy === 'ventas')        { av = Number(a.daily_velocity); bv = Number(b.daily_velocity); }
            else return 0;
            if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv, 'es') : bv.localeCompare(av, 'es');
            return sortDir === 'asc' ? av - bv : bv - av;
        });
    }, [filtered, sortBy, sortDir]);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows   = sorted.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => { setPage(1); }, [filterAbc, filterXyz, filterAlert, searchTerm, sortBy, sortDir, selectedErp, filterDraft, filterSparse, filterHidden]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    const COLS = [
        { key: 'product_name',  label: 'Producto',    align: 'left',   sortable: true },
        { key: 'laboratorio',   label: 'Laboratorio', align: 'left',   sortable: true },
        { key: 'abc_xyz',       label: 'Clase',       align: 'center', sortable: true },
        { key: 'effective_min', label: 'MIN',         align: 'center', sortable: true },
        { key: 'effective_max', label: 'MAX',         align: 'center', sortable: true },
        { key: 'presentacion',  label: 'Equiv.',      align: 'center' },
        { key: 'alert_status',  label: 'Estado',      align: 'center' },
        { key: 'acciones',      label: 'Acciones',    align: 'center' },
    ];

    const glass = 'rounded-2xl border border-white/60 backdrop-blur-sm';
    const glassStyle = { background: 'rgba(255,255,255,0.38)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' };

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Config panel ── */}
            {configOpen && config && (
                <ConfigPanel
                    config={config}
                    onSave={cfg => { onConfigChange?.(cfg); setConfigChanged(true); }}
                    onClose={() => setConfigOpen(false)}
                />
            )}

            {/* ── Labs panel ── */}
            {labsOpen && (
                <LabsPanel
                    onClose={() => setLabsOpen(false)}
                    onChanged={() => loadData(selectedErp)}
                />
            )}

            {/* ── Controls row ── */}
            <div className="flex items-center gap-3 flex-wrap">

                {/* LEFT: Cost cards */}
                {loading
                    ? <CardSkeletons isBodega={isBodega} />
                    : costSummary
                        ? <CostCards summary={costSummary} isBodega={isBodega} />
                        : null}
                {!loading && draftCost && <DraftCostCard draftCost={draftCost} />}

                <div className="flex-1" />

                {/* RIGHT: pill — white section + blue Calcular cap as sibling */}
                <div className="flex items-center shrink-0 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.1)] transition-shadow duration-300">

                    {/* White section */}
                    <div className="flex items-center rounded-l-2xl border border-r-0 border-slate-200/70 bg-white/80 backdrop-blur-sm overflow-visible">

                        {/* Branch selector */}
                        <div className="px-2 py-2 overflow-visible" style={{ width: '175px' }}>
                            <LiquidSelect
                                value={String(selectedErp)}
                                onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); setSortBy('laboratorio'); setSortDir('asc'); setFilterDraft(false); setFilterHidden(false); } }}
                                options={erpOptions} icon={Building2} clearable={false} compact
                            />
                        </div>

                        {/* Active ABC/XYZ filter badge + clear */}
                        {(filterAbc !== 'all' || filterXyz !== 'all') && (
                            <>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                <button onClick={() => { setFilterAbc('all'); setFilterXyz('all'); setPage(1); }}
                                    className="mx-2 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-50 border border-blue-200 text-[11px] font-black text-blue-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors shrink-0">
                                    {filterAbc !== 'all' ? filterAbc : '·'}{filterXyz !== 'all' ? filterXyz : ''}
                                    <X size={9} strokeWidth={3} />
                                </button>
                            </>
                        )}

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

                        {/* CSV */}
                        <motion.button onClick={() => exportCsv(filtered, ERP_NAMES[selectedErp], ERP_NAMES[selectedErp])}
                            disabled={data.length === 0 || loading}
                            title="Exportar CSV"
                            {...chipAnim}
                            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 disabled:opacity-30">
                            <Download size={12} /> CSV
                        </motion.button>

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

                        {/* Config */}
                        <motion.button onClick={() => setConfigOpen(o => !o)}
                            title="Configurar parámetros"
                            {...iconAnim}
                            className={`px-3 py-2.5 rounded-xl ${configOpen ? 'text-[#0052CC]' : 'text-slate-400 hover:text-slate-600'}`}>
                            <Settings2 size={13} />
                        </motion.button>

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

                        {/* Labs visibility */}
                        <motion.button onClick={() => setLabsOpen(o => !o)}
                            title="Laboratorios ocultos en MinMax"
                            {...iconAnim}
                            className={`px-3 py-2.5 rounded-xl ${labsOpen ? 'text-[#0052CC]' : 'text-slate-400 hover:text-slate-600'}`}>
                            <FlaskConical size={13} />
                        </motion.button>

                        <div className="h-5 w-px bg-slate-100 shrink-0" />

                        {/* Todas las sucursales */}
                        <motion.button onClick={handleRecalcularAll} disabled={!canManage || calculating || loading}
                            title="Recalcular todas las sucursales y Bodega"
                            {...chipAnim}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[100px] px-3 py-2.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:pointer-events-none">
                            {calculating && calcMode === 'all'
                                ? <><Loader2 size={11} className="animate-spin" /> {calcProgress ? `${calcProgress.name} ${calcProgress.current}/${calcProgress.total}` : 'Calculando…'}</>
                                : <><Layers size={11} /> Todas las sucursales</>}
                        </motion.button>
                    </div>

                    {/* Calcular — blue right cap */}
                    <motion.button onClick={handleRecalcular} disabled={!canManage || calculating || loading}
                        {...ctaAnim}
                        className="self-stretch inline-flex items-center justify-center gap-1.5 min-w-[110px] px-4 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-r-2xl disabled:opacity-60 disabled:pointer-events-none">
                        {calculating && calcMode === 'single'
                            ? <><Loader2 size={12} className="animate-spin" /> Calculando…</>
                            : <><RefreshCw size={12} /> Calcular</>}
                    </motion.button>
                </div>
            </div>

            {/* ── ABC × XYZ Matrix + info strip ── */}
            {!isBodega && (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
                    <AbcXyzMatrix
                        data={data}
                        filterAbc={filterAbc} setFilterAbc={setFilterAbc}
                        filterXyz={filterXyz} setFilterXyz={setFilterXyz}
                        loading={loading}
                    />
                    {config && <div className={`${glass} px-4 py-3 flex flex-col gap-2 text-[10px] text-slate-500 min-w-[200px]`} style={glassStyle}>
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Fórmula actual</span>
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-4">
                                <span className="font-semibold">MAX (objetivo)</span>
                                <span className="font-black text-[#0052CC]">{cycleDays} días</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> MIN (X)</span>
                                <span className="font-black text-emerald-600">{config?.reorder_x_days ?? 7}d</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> MIN (Y)</span>
                                <span className="font-black text-amber-600">{config?.reorder_y_days ?? 10}d</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> MIN (Z)</span>
                                <span className="font-black text-red-500">{config?.reorder_z_days ?? 15}d</span>
                            </div>
                            <div className="h-px bg-slate-100 my-0.5" />
                            <div className="flex items-center justify-between gap-4">
                                <span>Ventana histórica</span>
                                <span className="font-bold text-slate-600">{config?.analysis_days ?? 180}d</span>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1 leading-snug">
                            XYZ: X≤{config?.xyz_x_cv_max ?? 30}% CV · Y≤{config?.xyz_y_cv_max ?? 70}% CV · Z&gt;{config?.xyz_y_cv_max ?? 70}%<br />
                            ABC: A&lt;{config?.abc_a_pct ?? 70}% revenue · B&lt;{config?.abc_b_pct ?? 90}%
                        </p>
                    </div>}
                </div>
            )}


            {configChanged && !calculating && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-blue-50 border border-blue-100 text-[12px] text-blue-700 font-medium">
                    <Settings2 size={13} className="shrink-0 text-blue-500" />
                    <span className="flex-1">Configuración actualizada — recalculá para que los nuevos parámetros surtan efecto.</span>
                    <button onClick={() => { handleRecalcular(); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-lg transition-colors">
                        <RefreshCw size={10} /> Recalcular ahora
                    </button>
                    <button onClick={() => setConfigChanged(false)} className="text-blue-300 hover:text-blue-500"><X size={12} /></button>
                </div>
            )}

            {!loading && criticalACount > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700 font-medium">
                    <AlertTriangle size={14} className="shrink-0 text-red-500" />
                    <span className="flex-1">
                        <strong className="font-black">{criticalACount}</strong> producto{criticalACount !== 1 ? 's' : ''} clase <strong>A</strong> {criticalACount === 1 ? 'está' : 'están'} bajo mínimo o sin stock — alto impacto en revenue.
                    </span>
                    <button onClick={() => { setFilterAbc('A'); setFilterAlert('out_of_stock'); setPage(1); }}
                        className="text-[11px] font-bold text-red-600 hover:text-red-800 underline underline-offset-2 shrink-0">
                        Ver clase A críticos
                    </button>
                </div>
            )}

            {!loading && isBodega && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-violet-50 border border-violet-200 text-[12px] text-violet-800">
                    <Info size={14} className="shrink-0 mt-0.5 text-violet-500" />
                    <span>
                        <strong>Bodega — valores calculados automáticamente.</strong>{' '}
                        MIN y MAX se calculan como la <strong>suma de los MIN/MAX publicados de cada sucursal</strong> y se actualizan solos al publicar cualquier sucursal.
                        Puedes sobreescribirlos manualmente si necesitas ajustar.
                    </span>
                </div>
            )}
            {!loading && neverCalc && (
                <div className={`${glass} py-16 text-center`} style={glassStyle}>
                    <Package size={36} className="opacity-15 mx-auto mb-4 text-slate-500" />
                    <p className="text-[15px] font-bold text-slate-700 mb-2">Sin datos para {ERP_NAMES[selectedErp]}</p>
                    <p className="text-[12px] text-slate-400 mb-6 max-w-sm mx-auto leading-relaxed">
                        {isBodega
                            ? `Haz clic en Recalcular para generar los parámetros MIN/MAX de Bodega basados en la demanda consolidada de todas las sucursales (${config?.analysis_days ?? 180} días).`
                            : `Haz clic en Recalcular para analizar ${config?.analysis_days ?? 180} días de ventas y generar los parámetros MIN/MAX con clasificación ABC×XYZ.`}
                    </p>
                    <button onClick={handleRecalcular} disabled={calculating}
                        className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-bold text-white bg-[#0052CC] rounded-xl shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {calculating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Calcular {ERP_NAMES[selectedErp]}
                    </button>
                </div>
            )}

            {/* ── Unified filter pill + draft pill (above table) ── */}
            {!neverCalc && (
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Status + sparse filters — single pill container */}
                    <div className="flex items-center rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] overflow-hidden">
                        {STAT_CFGS.map((cfg, i) => {
                            const active = filterAlert === cfg.key;
                            return (
                                <React.Fragment key={cfg.key}>
                                    {i > 0 && <div className="h-5 w-px bg-slate-100 shrink-0" />}
                                    <motion.button
                                        {...chipAnim}
                                        onClick={() => setFilterAlert(prev => prev === cfg.key ? 'all' : cfg.key)}
                                        className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold transition-colors duration-150 ${active ? 'bg-slate-100/90 text-slate-700' : 'text-slate-500 hover:bg-slate-50/80 hover:text-slate-700'}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                                        <span className={`tabular-nums font-black ${active ? '' : 'text-slate-700'}`}>{loading ? '–' : stats[cfg.key]}</span>
                                        <span className="opacity-80">{cfg.label}</span>
                                        {active && <X size={9} className="ml-0.5 opacity-60" />}
                                    </motion.button>
                                </React.Fragment>
                            );
                        })}
                        {/* Pocos datos — alongside status chips */}
                        {sparseCount > 0 && !loading && (
                            <>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                <motion.button
                                    {...chipAnim}
                                    onClick={() => { setFilterSparse(f => !f); setFilterDraft(false); setFilterChangesOnly(false); setFilterAlert('all'); }}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold transition-colors duration-150 ${filterSparse ? 'bg-orange-50/80 text-orange-700' : 'text-orange-500 hover:bg-orange-50/60 hover:text-orange-700'}`}
                                    title="Productos con ventas en menos de 3 días distintos — requieren confirmación manual de MIN/MAX">
                                    <AlertTriangle size={9} strokeWidth={2.5} />
                                    <span className="tabular-nums font-black">{sparseCount}</span>
                                    pocos datos
                                    {filterSparse && <X size={9} className="ml-0.5 opacity-60" />}
                                </motion.button>
                            </>
                        )}
                    </div>

                    {/* Ocultar filtrados */}
                    <AnimatePresence>
                    {hasActiveFilter && filtered.length > 0 && (
                        <motion.button
                            key="hide-filtered"
                            initial={{ opacity: 0, scale: 0.88 }}
                            animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_EXPO } }}
                            exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.14, ease: 'easeIn' } }}
                            {...chipAnim}
                            onClick={hideFiltered}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold bg-white/55 backdrop-blur-sm border-white/80 text-slate-500 shadow-[0_2px_8px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/80">
                            <EyeOff size={10} />
                            Ocultar {filterLabel} ({filtered.length})
                        </motion.button>
                    )}
                    </AnimatePresence>

                    {/* Ocultos */}
                    <AnimatePresence>
                    {hiddenIds.size > 0 && (
                        <motion.div
                            key="hidden-pill"
                            initial={{ opacity: 0, scale: 0.88 }}
                            animate={{ opacity: 1, scale: 1, transition: { duration: 0.22, ease: EASE_OUT_EXPO } }}
                            exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.14, ease: 'easeIn' } }}
                            className={`flex items-center rounded-full border text-[11px] font-bold transition-colors duration-200 ${
                                filterHidden
                                    ? 'bg-violet-100/80 backdrop-blur-sm border-violet-300/70 text-violet-700 shadow-[0_3px_14px_rgba(139,92,246,0.22)]'
                                    : 'bg-white/55 backdrop-blur-sm border-white/80 text-slate-500 shadow-[0_2px_8px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.95)]'
                            }`}>
                            <button
                                onClick={() => setFilterHidden(f => !f)}
                                className="flex items-center gap-1.5 px-3 py-1.5 hover:opacity-80 transition-opacity">
                                <Eye size={10} />
                                <span>{hiddenIds.size} oculto{hiddenIds.size !== 1 ? 's' : ''}</span>
                                {filterHidden && <X size={9} className="opacity-60" />}
                            </button>
                            {filterHidden && (
                                <>
                                    <div className="h-3.5 w-px bg-violet-300/60 shrink-0" />
                                    <button
                                        onClick={unhideAll}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-black text-violet-600 hover:text-violet-800 transition-colors whitespace-nowrap">
                                        Mostrar todos
                                    </button>
                                </>
                            )}
                        </motion.div>
                    )}
                    </AnimatePresence>

                    {/* ── Borradores + Publicar pill — only when draftCount > 0 ── */}
                    <AnimatePresence>
                    {draftCount > 0 && !loading && (
                        <motion.div
                            key="draft-pill"
                            initial={{ opacity: 0, scale: 0.9, x: 16 }}
                            animate={{ opacity: 1, scale: 1, x: 0, transition: { duration: 0.3, ease: EASE_OUT_EXPO } }}
                            exit={{ opacity: 0, scale: 0.9, x: 16, transition: { duration: 0.18, ease: 'easeIn' } }}
                            className="ml-auto flex items-center shrink-0 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.1)] transition-shadow duration-300"
                        >
                            <div className="flex items-center rounded-l-2xl border border-r-0 border-slate-200/70 bg-white/80 backdrop-blur-sm overflow-hidden">
                                {/* Count + pulsing dot */}
                                <div className="flex items-center gap-1 px-2.5 py-1.5">
                                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-400" />
                                    </span>
                                    <span className="text-[11px] font-black text-slate-700 tabular-nums">{draftCount}</span>
                                    <span className="text-[11px] text-slate-400">borrador{draftCount !== 1 ? 'es' : ''}</span>
                                </div>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                {/* Solo borradores toggle */}
                                <motion.button
                                    {...chipAnim}
                                    onClick={() => { setFilterDraft(f => !f); setFilterSparse(false); setFilterChangesOnly(false); }}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold ${filterDraft ? 'text-[#0052CC]' : 'text-slate-500 hover:text-slate-700'}`}>
                                    {filterDraft ? <><X size={10} strokeWidth={2.5} /> Ver todos</> : 'Solo borradores'}
                                </motion.button>
                                {/* Solo cambios — only when there is published data with changes */}
                                {hasPublishedData && changesCount > 0 && (
                                    <>
                                        <div className="h-5 w-px bg-slate-100 shrink-0" />
                                        <motion.button
                                            {...chipAnim}
                                            onClick={() => { setFilterChangesOnly(f => !f); setFilterDraft(false); setFilterSparse(false); }}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold ${filterChangesOnly ? 'text-violet-600' : 'text-slate-500 hover:text-slate-700'}`}>
                                            {filterChangesOnly ? <><X size={10} strokeWidth={2.5} /> Ver todos</> : `Solo cambios (${changesCount})`}
                                        </motion.button>
                                    </>
                                )}
                            </div>
                            {/* Publicar — blue right cap */}
                            <AnimatePresence mode="wait">
                            {hasActiveFilter && filteredDraftIds.length > 0 ? (
                                <motion.button
                                    key="pub-filtered"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.14, ease: EASE_OUT_EXPO } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
                                    {...ctaAnim}
                                    onClick={() => requestPublish(filteredDraftIds)} disabled={!canManage || publishing}
                                    className="self-stretch inline-flex items-center justify-center gap-1.5 px-4 text-[11px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-r-2xl disabled:opacity-60 disabled:pointer-events-none">
                                    {publishing ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                                    Publicar {filterLabel} ({filteredDraftIds.length})
                                </motion.button>
                            ) : (
                                <motion.button
                                    key="pub-all"
                                    initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: 0.14, ease: EASE_OUT_EXPO } }} exit={{ opacity: 0, transition: { duration: 0.1 } }}
                                    {...ctaAnim}
                                    onClick={() => requestPublish()} disabled={!canManage || publishing}
                                    className="self-stretch inline-flex items-center justify-center gap-1.5 px-4 text-[11px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-r-2xl disabled:opacity-60 disabled:pointer-events-none">
                                    {publishing ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
                                    Publicar todo ({draftCount})
                                </motion.button>
                            )}
                            </AnimatePresence>
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>
            )}

            {/* ── Table + Pagination ── */}
            {!neverCalc && (
                <>
                <motion.div
                    key={`table-page-${page}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT_EXPO } }}
                >
                <DataTable
                    columns={COLS}
                    sortKey={sortBy}
                    sortDir={sortDir}
                    onSort={handleSort}
                    loading={loading}
                    empty={{
                        icon: Package,
                        message: 'Sin productos con ese filtro',
                        action: { label: 'Quitar filtros', onClick: () => { setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); } },
                    }}
                    minWidth="960px"
                >

                    {pageRows.map((row, rowIdx) => {
                        const isExpanded = expandedIds.has(row.erp_product_id);
                        const alert      = ALERT[row.alert_status] ?? ALERT.ok;
                        const pres       = row.presentations || [];
                        const dead       = row.is_dead_stock;
                        const noHistory  = row.alert_status === 'no_data';
                        const stock      = Number(row.current_stock);
                        const minN       = Number(row.effective_min);
                        const maxN       = Number(row.effective_max);
                        const v30        = Number(row.velocity_30d ?? 0);
                        const v6m        = Number(row.daily_velocity ?? 0);
                        const canExpand  = stock > 0;
                        const hasDraft   = row.draft_status === 'pending';
                        const isSparse   = row.draft_status === 'sparse_data';
                        const limitedData = hasDraft &&
                            row.draft_data_days != null &&
                            row.draft_data_days < (analysisConfig.analysis_days ?? 180);

                        return (
                            <React.Fragment key={row.erp_product_id}>
                                <DataRow
                                    index={rowIdx}
                                    onClick={canExpand ? () => toggleExpand(row.erp_product_id) : undefined}
                                    className={alert.row}
                                >
                                    {/* Producto */}
                                    <DataCell align="left" className="!py-2.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            {/* Product photo */}
                                            <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-slate-50 border border-slate-100 flex items-center justify-center">
                                                {row.foto_url
                                                    ? <img src={row.foto_url} alt="" className="w-full h-full object-contain" />
                                                    : <Package size={16} className="text-slate-300" />}
                                            </div>
                                            <div className={`shrink-0 w-4 h-4 flex items-center justify-center ${!canExpand ? 'opacity-0' : ''}`}>
                                                <ChevronRight size={12} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-[13px] font-medium text-slate-800 truncate leading-tight">{row.product_name || '—'}</span>
                                                    {row.has_manual && <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>}
                                                    {hasDraft && <span className="shrink-0 text-[8px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">BORRADOR</span>}
                                                    {limitedData && (
                                                        <span title={`Solo ${row.draft_data_days} días de historial de compras (ventana: ${analysisConfig.analysis_days} días)`}
                                                            className="shrink-0 text-[8px] font-black text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full cursor-help">
                                                            {row.draft_data_days}d DATOS
                                                        </span>
                                                    )}
                                                    {noHistory && <span className="shrink-0 text-[8px] font-black text-yellow-700 bg-yellow-50 border border-yellow-200 px-1.5 py-0.5 rounded-full">SIN HISTORIAL</span>}
                                                    {isSparse && <span className="shrink-0 text-[8px] font-black text-orange-700 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full" title="Vendió en menos de 3 días distintos — MIN/MAX requiere confirmación manual">POCOS DATOS</span>}
                                                </div>
                                                {/* Stock actual inline */}
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <span className={`text-[11px] font-black tabular-nums ${stock === 0 ? 'text-red-500' : stock < minN ? 'text-orange-500' : 'text-slate-600'}`}>
                                                        {formatUnits(stock, pres)}
                                                    </span>
                                                    {!dead && minN > 0 && stock < minN && (
                                                        <span className="text-[9px] font-bold text-orange-400">↓{(minN - stock).toLocaleString()}</span>
                                                    )}
                                                    {!dead && maxN > 0 && stock > maxN && (
                                                        <span className="text-[9px] font-bold text-blue-400">↑{(stock - maxN).toLocaleString()}</span>
                                                    )}
                                                </div>
                                                {noHistory && (
                                                    <span className="text-[10px] text-yellow-500 italic mt-0.5">Sin ventas en esta sucursal</span>
                                                )}
                                                {isSparse && (
                                                    <span className="text-[10px] text-orange-500 mt-0.5 flex items-center gap-0.5">
                                                        <AlertTriangle size={9} />
                                                        {Number(row.units_sold_6m) >= 10
                                                            ? `Posible compra mayorista: ${Number(row.units_sold_6m).toLocaleString()} uds. en 1–2 días`
                                                            : Number(row.units_sold_6m) > 0
                                                                ? `Rotación mínima: ${Number(row.units_sold_6m).toLocaleString()} uds. en 6 meses`
                                                                : 'Sin ventas registradas'
                                                        } · confirmar MIN/MAX
                                                    </span>
                                                )}
                                                {!dead && !noHistory && !isSparse && (
                                                    <span className="text-[10px] text-slate-600 flex items-center gap-0.5 mt-0.5">
                                                        {v6m.toFixed(2)}/día
                                                        {v30 > 0 && v30 > v6m * 1.1 && <TrendingUp size={9} className="text-emerald-500 ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                        {v30 > 0 && v30 < v6m * 0.9 && <TrendingDown size={9} className="text-red-400 ml-0.5" title={`30d: ${v30.toFixed(2)}/día`} />}
                                                        {Number(row.units_sold_6m) > 0 && <span className="ml-1 text-slate-500">·</span>}
                                                        {Number(row.units_sold_6m) > 0 && <span className="ml-1">{Number(row.units_sold_6m).toLocaleString()} vend.</span>}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </DataCell>

                                    {/* Laboratorio */}
                                    <DataCell align="left" className="!py-2.5">
                                        <span className="text-[11px] text-slate-700 truncate block max-w-[120px]">
                                            {row.laboratorio_nombre || <span className="text-slate-300">—</span>}
                                        </span>
                                    </DataCell>

                                    {/* Clase — show draft badge when no published value yet */}
                                    <DataCell align="center" className="!py-2.5">
                                        {!row.abc_class && hasDraft
                                            ? <AbcXyzBadge abc={row.draft_abc_class} xyz={row.draft_demand_variability} />
                                            : (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <AbcXyzBadge abc={row.abc_class} xyz={row.demand_variability} />
                                                    {hasDraft && row.draft_abc_class && (
                                                        row.draft_abc_class !== row.abc_class ||
                                                        normXyz(row.draft_demand_variability) !== normXyz(row.demand_variability)
                                                    ) && (
                                                        <div className="flex items-center gap-0.5">
                                                            <span className="text-[8px] text-slate-300">→</span>
                                                            <AbcXyzBadge abc={row.draft_abc_class} xyz={row.draft_demand_variability} />
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        }
                                    </DataCell>

                                    {/* MIN — inline edit on click (draft→amber, live→emerald) */}
                                    <DataCell align="center" className="!py-2.5">
                                        {canManage && inlineDraftEdit?.productId === row.erp_product_id && inlineDraftEdit?.field === 'min' ? (
                                            <div className="flex flex-col items-center">
                                                <input autoFocus type="number" min="0"
                                                    value={inlineDraftEdit.value}
                                                    onChange={e => setInlineDraftEdit(p => ({ ...p, value: e.target.value, error: undefined }))}
                                                    onFocus={e => e.target.select()}
                                                    onBlur={() => {
                                                        if (skipBlurSave.current) { skipBlurSave.current = false; return; }
                                                        const err = validateEditForRow(inlineDraftEdit, row);
                                                        if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                        saveDraftCell(inlineDraftEdit);
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Escape') { setInlineDraftEdit(null); return; }
                                                        if (e.key === 'Tab' || e.key === 'ArrowRight') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: String(hasDraft ? (row.draft_max ?? '') : (row.effective_max ?? '')) });
                                                            return;
                                                        }
                                                        if (e.key === 'Enter' || e.key === 'ArrowDown') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            const next = pageRows.slice(rowIdx + 1).find(r => hasDraft ? r.draft_status === 'pending' : !hiddenIds.has(r.erp_product_id));
                                                            if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: String(next.draft_status === 'pending' ? (next.draft_min ?? '') : (next.effective_min ?? '')) });
                                                            else setInlineDraftEdit(null);
                                                            return;
                                                        }
                                                        if (e.key === 'ArrowUp') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            const prev = [...pageRows.slice(0, rowIdx)].reverse().find(r => hasDraft ? r.draft_status === 'pending' : !hiddenIds.has(r.erp_product_id));
                                                            if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: String(prev.draft_status === 'pending' ? (prev.draft_min ?? '') : (prev.effective_min ?? '')) });
                                                            else setInlineDraftEdit(null);
                                                            return;
                                                        }
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                    className={`w-20 text-center text-[13px] font-black rounded-lg px-1 py-1 focus:outline-none border-2 ${hasDraft ? 'text-amber-800 bg-amber-50 border-amber-400' : 'text-emerald-800 bg-emerald-50 border-emerald-400'}`} />
                                                {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && (
                                                    <div className={`text-[9px] font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                        ≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}
                                                    </div>
                                                )}
                                                {(dead || noHistory) && <div className="text-[8px] text-yellow-600 font-semibold mt-0.5">⚠ Sin ventas 6 meses</div>}
                                            </div>
                                        ) : hasDraft ? (
                                            <div className={`flex flex-col items-center ${canManage ? 'cursor-pointer group/min' : ''}`}
                                                onClick={canManage ? e => { e.stopPropagation(); setExpandedIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; }); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: String(row.draft_min ?? '') }); } : undefined}>
                                                <div className={`px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 ${canManage ? 'group-hover/min:border-amber-400 group-hover/min:bg-amber-100' : ''} transition-[border-color,background-color] duration-150`}>
                                                    <span className="text-[13px] font-black tabular-nums text-amber-700">{(row.draft_min ?? 0).toLocaleString()}</span>
                                                </div>
                                                {minN > 0 && <div className="text-[9px] text-slate-600 tabular-nums mt-0.5">{minN.toLocaleString()} act.</div>}
                                            </div>
                                        ) : isSparse ? (
                                            canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/min"
                                                    onClick={e => { e.stopPropagation(); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: minN > 0 ? String(minN) : '' }); }}>
                                                    <div className="px-2.5 py-1 rounded-lg bg-orange-50 border border-dashed border-orange-300 group-hover/min:border-orange-400 group-hover/min:bg-orange-100 transition-[border-color,background-color] duration-150">
                                                        <span className="text-[13px] font-black tabular-nums text-orange-400">{minN > 0 ? minN.toLocaleString() : '—'}</span>
                                                    </div>
                                                    <div className="text-[8px] text-orange-500 font-semibold mt-0.5">⚠ Confirmar</div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <span className="text-[12px] font-semibold tabular-nums text-orange-400">{minN > 0 ? minN.toLocaleString() : '—'}</span>
                                                    <div className="text-[8px] text-orange-500 font-semibold mt-0.5">⚠ Confirmar</div>
                                                </div>
                                            )
                                        ) : (dead || noHistory) ? (
                                            canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/min"
                                                    onClick={e => { e.stopPropagation(); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: '' }); }}>
                                                    <div className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 group-hover/min:border-amber-400 group-hover/min:bg-amber-100 transition-[border-color,background-color] duration-150">
                                                        <span className="text-[13px] font-black tabular-nums text-amber-400">0</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <span className="text-[12px] font-semibold tabular-nums text-slate-400">0</span>
                                                </div>
                                            )
                                        ) : (
                                            hasPublishedData && canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/min"
                                                    onClick={e => { e.stopPropagation(); setExpandedIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; }); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: String(row.effective_min ?? '') }); }}>
                                                    <div className={`px-2.5 py-1 rounded-lg border group-hover/min:border-emerald-400 group-hover/min:bg-emerald-50 transition-[border-color,background-color] duration-150 ${stock < minN ? 'border-orange-200' : 'border-slate-200'}`}>
                                                        <span className={`text-[13px] font-black tabular-nums ${stock < minN ? 'text-orange-600' : 'text-slate-600'}`}>{minN.toLocaleString()}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <div className={`text-[12px] font-semibold tabular-nums ${stock < minN ? 'text-orange-600 font-bold' : 'text-slate-500'}`}>{minN.toLocaleString()}</div>
                                                </div>
                                            )
                                        )}
                                    </DataCell>

                                    {/* MAX — inline edit on click (draft→blue, live→emerald) */}
                                    <DataCell align="center" className="!py-2.5">
                                        {canManage && inlineDraftEdit?.productId === row.erp_product_id && inlineDraftEdit?.field === 'max' ? (
                                            <div className="flex flex-col items-center">
                                                <input autoFocus type="number" min="0"
                                                    value={inlineDraftEdit.value}
                                                    onChange={e => setInlineDraftEdit(p => ({ ...p, value: e.target.value, error: undefined }))}
                                                    onFocus={e => e.target.select()}
                                                    onBlur={() => {
                                                        if (skipBlurSave.current) { skipBlurSave.current = false; return; }
                                                        const errB = validateEditForRow(inlineDraftEdit, row);
                                                        if (errB) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, errB, 'error'); setInlineDraftEdit(null); return; }
                                                        saveDraftCell(inlineDraftEdit);
                                                    }}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Escape') { setInlineDraftEdit(null); return; }
                                                        if (e.key === 'ArrowLeft') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'min', value: String(hasDraft ? (row.draft_min ?? '') : (row.effective_min ?? '')) });
                                                            return;
                                                        }
                                                        if (e.key === 'Enter' || e.key === 'ArrowDown') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            const next = pageRows.slice(rowIdx + 1).find(r => hasDraft ? r.draft_status === 'pending' : !hiddenIds.has(r.erp_product_id));
                                                            if (next) setInlineDraftEdit({ productId: next.erp_product_id, sucursalId: next._erp_sucursal_id, field: 'min', value: String(next.draft_status === 'pending' ? (next.draft_min ?? '') : (next.effective_min ?? '')) });
                                                            else setInlineDraftEdit(null);
                                                            return;
                                                        }
                                                        if (e.key === 'ArrowUp') {
                                                            e.preventDefault();
                                                            const err = validateEditForRow(inlineDraftEdit, row);
                                                            if (err) { skipBlurSave.current = true; useToastStore.getState().showToast(row.product_name, err, 'error'); setInlineDraftEdit(null); return; }
                                                            skipBlurSave.current = true;
                                                            saveDraftCell(inlineDraftEdit);
                                                            const prev = [...pageRows.slice(0, rowIdx)].reverse().find(r => hasDraft ? r.draft_status === 'pending' : !hiddenIds.has(r.erp_product_id));
                                                            if (prev) setInlineDraftEdit({ productId: prev.erp_product_id, sucursalId: prev._erp_sucursal_id, field: 'min', value: String(prev.draft_status === 'pending' ? (prev.draft_min ?? '') : (prev.effective_min ?? '')) });
                                                            else setInlineDraftEdit(null);
                                                            return;
                                                        }
                                                    }}
                                                    onClick={e => e.stopPropagation()}
                                                    className={`w-20 text-center text-[13px] font-black rounded-lg px-1 py-1 focus:outline-none border-2 ${hasDraft ? 'text-blue-800 bg-blue-50 border-blue-400' : 'text-emerald-800 bg-emerald-50 border-emerald-400'}`} />
                                                {sortedPres(pres).length > 0 && inlineDraftEdit.value !== '' && (
                                                    <div className={`text-[9px] font-bold mt-0.5 tabular-nums ${hasDraft ? 'text-blue-700' : 'text-emerald-700'}`}>
                                                        ≈ {formatDominant(parseInt(inlineDraftEdit.value, 10) || 0, pres)}
                                                    </div>
                                                )}
                                                {(dead || noHistory) && <div className="text-[8px] text-yellow-600 font-semibold mt-0.5">⚠ Sin ventas 6 meses</div>}
                                            </div>
                                        ) : hasDraft ? (
                                            <div className={`flex flex-col items-center ${canManage ? 'cursor-pointer group/max' : ''}`}
                                                onClick={canManage ? e => { e.stopPropagation(); setExpandedIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; }); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: String(row.draft_max ?? '') }); } : undefined}>
                                                <div className={`px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 ${canManage ? 'group-hover/max:border-blue-400 group-hover/max:bg-blue-100' : ''} transition-[border-color,background-color] duration-150`}>
                                                    <span className="text-[13px] font-black tabular-nums text-blue-700">{(row.draft_max ?? 0).toLocaleString()}</span>
                                                </div>
                                                {maxN > 0 && <div className="text-[9px] text-slate-600 tabular-nums mt-0.5">{maxN.toLocaleString()} act.</div>}
                                            </div>
                                        ) : isSparse ? (
                                            canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/max"
                                                    onClick={e => { e.stopPropagation(); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: maxN > 0 ? String(maxN) : '' }); }}>
                                                    <div className="px-2.5 py-1 rounded-lg bg-orange-50 border border-dashed border-orange-300 group-hover/max:border-orange-400 group-hover/max:bg-orange-100 transition-[border-color,background-color] duration-150">
                                                        <span className="text-[13px] font-black tabular-nums text-orange-400">{maxN > 0 ? maxN.toLocaleString() : '—'}</span>
                                                    </div>
                                                    <div className="text-[8px] text-orange-500 font-semibold mt-0.5">⚠ Confirmar</div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <span className="text-[12px] font-semibold tabular-nums text-orange-400">{maxN > 0 ? maxN.toLocaleString() : '—'}</span>
                                                    <div className="text-[8px] text-orange-500 font-semibold mt-0.5">⚠ Confirmar</div>
                                                </div>
                                            )
                                        ) : (dead || noHistory) ? (
                                            canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/max"
                                                    onClick={e => { e.stopPropagation(); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: '' }); }}>
                                                    <div className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 group-hover/max:border-blue-400 group-hover/max:bg-blue-100 transition-[border-color,background-color] duration-150">
                                                        <span className="text-[13px] font-black tabular-nums text-blue-400">0</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <span className="text-[12px] font-semibold tabular-nums text-slate-400">0</span>
                                                </div>
                                            )
                                        ) : (
                                            hasPublishedData && canManage ? (
                                                <div className="flex flex-col items-center cursor-pointer group/max"
                                                    onClick={e => { e.stopPropagation(); setExpandedIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; }); if (isBodega) useToastStore.getState().showToast('Bodega', 'MIN/MAX se calculan como Σ sucursales. Puedes sobreescribirlo manualmente.', 'info'); setInlineDraftEdit({ productId: row.erp_product_id, sucursalId: row._erp_sucursal_id, field: 'max', value: String(row.effective_max ?? '') }); }}>
                                                    <div className={`px-2.5 py-1 rounded-lg border group-hover/max:border-emerald-400 group-hover/max:bg-emerald-50 transition-[border-color,background-color] duration-150 ${stock > maxN && maxN > 0 ? 'border-blue-200' : 'border-slate-200'}`}>
                                                        <span className={`text-[13px] font-black tabular-nums ${stock > maxN && maxN > 0 ? 'text-blue-600' : 'text-slate-600'}`}>{maxN.toLocaleString()}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <div className={`text-[12px] font-semibold tabular-nums ${stock > maxN ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>{maxN.toLocaleString()}</div>
                                                </div>
                                            )
                                        )}
                                    </DataCell>

                                    {/* Equiv. — presentación calculada de MIN / MAX */}
                                    <DataCell align="center" className="!py-2.5">
                                        {dead
                                            ? <span className="text-slate-200 text-xs">—</span>
                                            : (() => {
                                                const dispMin = hasDraft ? (row.draft_min ?? 0) : minN;
                                                const dispMax = hasDraft ? (row.draft_max ?? 0) : maxN;
                                                const hasPres = sortedPres(pres).length > 0;
                                                return (
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <span className={`text-[10px] font-bold tabular-nums ${hasPres ? 'text-amber-600' : 'text-slate-400'}`}>
                                                            {formatDominant(dispMin, pres)}
                                                        </span>
                                                        <span className={`text-[10px] font-bold tabular-nums ${hasPres ? 'text-blue-600' : 'text-slate-400'}`}>
                                                            {formatDominant(dispMax, pres)}
                                                        </span>
                                                    </div>
                                                );
                                            })()
                                        }
                                    </DataCell>

                                    {/* Estado */}
                                    <DataCell align="center" className="!py-2.5">
                                        <div className="flex flex-col items-center gap-0.5">
                                            <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border ${alert.pill}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                                {alert.label}
                                            </span>
                                            {!dead && (row.alert_status === 'out_of_stock' || row.alert_status === 'below_min') && maxN > 0 && (
                                                <span className="text-[8px] font-bold text-slate-400 tabular-nums">
                                                    Pedir {Math.max(0, maxN - stock).toLocaleString()}u
                                                </span>
                                            )}
                                        </div>
                                    </DataCell>

                                    {/* Acciones */}
                                    <DataCell align="center" className="!py-2.5">
                                        <div className="flex items-center justify-center gap-1">
                                            {/* Mostrar / Ocultar según modo */}
                                            {filterHidden ? (
                                                <motion.button onClick={async e => { e.stopPropagation(); await unhideProduct(row.erp_product_id); }}
                                                    title="Mostrar producto"
                                                    {...iconAnim}
                                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-violet-400 hover:text-violet-600 hover:bg-violet-50">
                                                    <Eye size={13} />
                                                </motion.button>
                                            ) : (
                                                <motion.button onClick={async e => {
                                                    e.stopPropagation();
                                                    setHidingIds(prev => { const n = new Set(prev); n.add(row.erp_product_id); return n; });
                                                    await supabase.from('product_stock_params')
                                                        .upsert(
                                                            { erp_product_id: row.erp_product_id, erp_sucursal_id: row._erp_sucursal_id, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending', updated_at: new Date().toISOString() },
                                                            { onConflict: 'erp_product_id,erp_sucursal_id' }
                                                        );
                                                    setHidingIds(prev => { const n = new Set(prev); n.delete(row.erp_product_id); return n; });
                                                    setHiddenIds(prev => { const n = new Set(prev); n.add(row.erp_product_id); return n; });
                                                    setData(prev => prev.map(r => r.erp_product_id === row.erp_product_id && r._erp_sucursal_id === row._erp_sucursal_id
                                                        ? { ...r, is_hidden: true, draft_min: 0, draft_max: 0, draft_status: 'pending' } : r));
                                                    useStaff.getState().appendAuditLog('MINMAX_HIDE', String(row.erp_product_id), { product: row.product_name, sucursal_id: row._erp_sucursal_id });
                                                }}
                                                    disabled={hidingIds.has(row.erp_product_id)}
                                                    title="Ocultar producto (pone MIN/MAX en 0 y excluye de recálculos)"
                                                    {...iconAnim}
                                                    className="w-7 h-7 flex items-center justify-center rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 disabled:pointer-events-none">
                                                    {hidingIds.has(row.erp_product_id)
                                                        ? <Loader2 size={12} className="animate-spin text-rose-400" />
                                                        : <EyeOff size={12} />}
                                                </motion.button>
                                            )}
                                            {/* Poner en 0 */}
                                            {!dead && !noHistory && canManage && (
                                                <motion.button onClick={e => { e.stopPropagation(); zeroOutRow(row); }} title={hasPublishedData && !hasDraft ? 'Poner MIN/MAX en 0 (en vivo)' : 'Crear borrador 0 / 0 (pone en 0 sin publicar)'}
                                                    {...iconAnim}
                                                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600">
                                                    <XCircle size={14} />
                                                </motion.button>
                                            )}
                                            {/* Restaurar a calculado */}
                                            {canManage && row.calc_min != null && (
                                                <motion.button
                                                    onClick={e => { e.stopPropagation(); resetToCalc(row); }}
                                                    title={`Restaurar a valores calculados (MIN ${row.calc_min} / MAX ${row.calc_max})`}
                                                    {...iconAnim}
                                                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700 transition-colors">
                                                    <RotateCcw size={12} />
                                                </motion.button>
                                            )}
                                            {/* Historial */}
                                            <motion.button
                                                onClick={e => { e.stopPropagation(); openHistory(row); }}
                                                title="Ver historial de cambios MIN/MAX"
                                                {...iconAnim}
                                                className="w-7 h-7 flex items-center justify-center rounded-lg text-blue-400 hover:text-[#0052CC] hover:bg-blue-50 transition-colors">
                                                <History size={12} />
                                            </motion.button>
                                            {/* Publicar borrador */}
                                            {hasDraft && canManage && (
                                                <motion.button onClick={e => { e.stopPropagation(); requestPublish([row.erp_product_id]); }}
                                                    disabled={publishing}
                                                    {...chipAnim}
                                                    className="text-[9px] font-bold text-[#0052CC] hover:text-white hover:bg-[#0052CC] bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg disabled:opacity-50">
                                                    {publishing ? <Loader2 size={9} className="animate-spin" /> : 'Publicar'}
                                                </motion.button>
                                            )}
                                        </div>
                                    </DataCell>
                                </DataRow>

                                {isExpanded && canExpand && (
                                    <tr>
                                        <td colSpan={COLS.length} className="p-0">
                                            <ExpandedPanel row={row} cycleDays={cycleDays} />
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </DataTable>
                </motion.div>

                {!loading && sorted.length > 0 && (
                    <TablePagination
                        pageSize={pageSize}
                        onPageSizeChange={size => { setPageSize(size); setPage(1); }}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        total={data.length}
                        unit="productos"
                        filteredTotal={sorted.length < data.length ? sorted.length : undefined}
                    />
                )}
                </>
            )}

            {/* ── Toast notification (portal → fuera de backdrop-filter, siempre en viewport) ── */}
            {toast && createPortal(
                <div className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-3 px-4 py-3 rounded-xl text-white shadow-2xl text-[13px] font-semibold animate-in slide-in-from-bottom-2 ${toast.type === 'error' ? 'bg-red-600' : 'bg-[#0052CC]'}`}>
                    {currentEmployee?.photo_url
                        ? <img src={currentEmployee.photo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-white/40" />
                        : <Info size={15} className="shrink-0" />}
                    <span>{toast.message}</span>
                    {toast.action && (
                        <button onClick={toast.action.onClick}
                            className="ml-1 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/35 text-[11px] font-bold transition-colors shrink-0">
                            {toast.action.label}
                        </button>
                    )}
                    <button onClick={() => setToast(null)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0">
                        <X size={12} />
                    </button>
                </div>,
                document.body
            )}

            {/* ── Historial MIN/MAX ── */}
            {historyRow && createPortal(
                <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4" onClick={() => setHistoryRow(null)}>
                    {/* Overlay */}
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    {/* Card */}
                    <div className="relative z-10 w-full max-w-md max-h-[82vh] flex flex-col rounded-3xl border border-white/70 shadow-[0_32px_80px_rgba(0,0,0,0.18)] overflow-hidden"
                        style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(40px) saturate(200%)' }}
                        onClick={e => e.stopPropagation()}>

                        {/* Header */}
                        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100/80 shrink-0">
                            {/* Product photo */}
                            <div className="w-12 h-12 rounded-2xl bg-white border border-slate-100 shadow-sm overflow-hidden shrink-0 flex items-center justify-center">
                                {historyRow.foto_url
                                    ? <img src={historyRow.foto_url} alt="" className="w-full h-full object-contain" />
                                    : <Package size={22} className="text-slate-300" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-black text-slate-800 truncate leading-tight">{historyRow.product_name}</p>
                                <p className="text-[10px] text-slate-400 font-medium mt-0.5">{ERP_NAMES[historyRow._erp_sucursal_id]} · Historial MIN/MAX</p>
                            </div>
                            <button onClick={() => setHistoryRow(null)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                                <X size={14} />
                            </button>
                        </div>

                        {/* List */}
                        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
                            {historyLoading && (
                                <div className="flex justify-center py-10">
                                    <Loader2 size={22} className="animate-spin text-slate-300" />
                                </div>
                            )}
                            {!historyLoading && historyLogs.length === 0 && (
                                <div className="flex flex-col items-center gap-2 py-10">
                                    <History size={28} className="text-slate-200" />
                                    <p className="text-[12px] text-slate-400">Sin cambios registrados aún</p>
                                </div>
                            )}
                            {!historyLoading && historyLogs.map(log => {
                                const d = log.details || {};
                                const empPhoto = empPhotoMap[log.user_name];
                                const sucName = ERP_NAMES[d.sucursal_id] || '';
                                const isReset = log.action === 'MINMAX_RESET_CALC';
                                const isZero  = log.action === 'MINMAX_ZERO_OUT' || log.action === 'MINMAX_LIVE_ZERO';
                                const fieldLabel = d.field_label || (d.field?.includes('min') ? 'MIN' : d.field?.includes('max') ? 'MAX' : d.field || '');
                                const dt = new Date(log.created_at);
                                const dateStr = dt.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
                                const timeStr = dt.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
                                return (
                                    <div key={log.id} className="flex items-start gap-3 bg-white/70 border border-white/80 rounded-2xl px-3.5 py-3 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
                                        {/* Employee avatar */}
                                        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center mt-0.5">
                                            {empPhoto
                                                ? <img src={empPhoto} alt="" className="w-full h-full object-cover" />
                                                : <span className="text-[10px] font-black text-slate-400">{log.user_name?.charAt(0)?.toUpperCase() || '?'}</span>}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                                                <span className="text-[11px] font-bold text-slate-700 truncate">{log.user_name || 'Sistema'}</span>
                                                <span className="text-[9px] text-slate-400 shrink-0 tabular-nums">{dateStr} · {timeStr}</span>
                                            </div>
                                            {isReset ? (
                                                <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                                                    Restaurado a calculado — MIN {d.calc_min ?? '?'} / MAX {d.calc_max ?? '?'}
                                                </p>
                                            ) : isZero ? (
                                                <p className="text-[11px] text-red-600 font-semibold mt-0.5">Puesto en cero (MIN 0 / MAX 0)</p>
                                            ) : (
                                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${fieldLabel === 'MIN' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{fieldLabel}</span>
                                                    {d.old_value != null && (
                                                        <><span className="text-[11px] font-semibold text-slate-500">{d.old_value}</span>
                                                        <span className="text-[10px] text-slate-300">→</span></>
                                                    )}
                                                    <span className="text-[11px] font-black text-slate-800">{d.new_value ?? d.value ?? '?'}</span>
                                                    {sucName && <span className="text-[9px] text-slate-400 ml-1">{sucName}</span>}
                                                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ml-auto ${log.action === 'MINMAX_LIVE_EDIT' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                                        {log.action === 'MINMAX_LIVE_EDIT' ? 'EN VIVO' : 'BORRADOR'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Confirm publish modal ── */}
            <ConfirmModal
                isOpen={publishConfirm.open}
                onClose={() => setPublishConfirm({ open: false, ids: null, count: 0 })}
                onConfirm={() => startDeferredPublish(publishConfirm.ids, publishConfirm.count)}
                title={`¿Publicar ${publishConfirm.count} borrador${publishConfirm.count !== 1 ? 'es' : ''}?`}
                message={`Se aplicarán los valores MIN/MAX en ${ERP_NAMES[selectedErp]}. Tendrás 5 segundos para cancelar.`}
                confirmText="Publicar"
                cancelText="Cancelar"
                isDestructive={false}
            />
        </div>
    );
}
