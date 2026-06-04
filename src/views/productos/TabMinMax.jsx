import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, Loader2,
    Building2, Package, X, Download,
    CheckCircle2, Edit3, Check, Info, RotateCcw, ChevronRight,
    DollarSign, TrendingUp, TrendingDown, Layers, Settings2, Save,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const ALERT = {
    out_of_stock: { label: 'Sin stock',     pill: 'bg-red-100 text-red-700 border-red-200',           dot: 'bg-red-500',     left: 'border-l-red-500',    row: 'bg-red-50/40'    },
    below_min:    { label: 'Bajo mínimo',   pill: 'bg-orange-100 text-orange-700 border-orange-200',  dot: 'bg-orange-500',  left: 'border-l-orange-400', row: 'bg-orange-50/20' },
    approaching:  { label: 'Próx. mínimo',  pill: 'bg-amber-100 text-amber-700 border-amber-200',     dot: 'bg-amber-400',   left: 'border-l-amber-300',  row: ''                },
    ok:           { label: 'OK',            pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', left: 'border-l-emerald-400', row: ''              },
    overstocked:  { label: 'Exceso',        pill: 'bg-blue-100 text-blue-700 border-blue-200',         dot: 'bg-blue-400',    left: 'border-l-blue-400',   row: 'bg-blue-50/10'  },
    dead_stock:   { label: 'Sin movimiento',pill: 'bg-slate-100 text-slate-500 border-slate-200',      dot: 'bg-slate-300',   left: 'border-l-slate-200',  row: 'bg-slate-50/60' },
};

const STAT_CFGS = [
    { key: 'out_of_stock', label: 'Sin stock',      dot: 'bg-red-500',     active: 'bg-red-50 border-red-300 text-red-700'          },
    { key: 'below_min',    label: 'Bajo mínimo',    dot: 'bg-orange-500',  active: 'bg-orange-50 border-orange-300 text-orange-700'  },
    { key: 'approaching',  label: 'Próx. mínimo',   dot: 'bg-amber-400',   active: 'bg-amber-50 border-amber-300 text-amber-700'    },
    { key: 'ok',           label: 'OK',              dot: 'bg-emerald-500', active: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
    { key: 'overstocked',  label: 'Exceso',          dot: 'bg-blue-400',    active: 'bg-blue-50 border-blue-300 text-blue-700'       },
    { key: 'dead_stock',   label: 'Sin movimiento',  dot: 'bg-slate-300',   active: 'bg-slate-100 border-slate-300 text-slate-600'   },
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

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1000)}k`;
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

function exportCsv(rows, name) {
    const h = ['Producto','ABC','XYZ','Estado','Stock actual','Cobertura (días)','MIN (und)','MAX (und)','Ventas período','Ingresos período'];
    const lines = rows.map(r => [
        `"${(r.product_name||'').replace(/"/g,'""')}"`,
        r.abc_class,
        normXyz(r.demand_variability),
        ALERT[r.alert_status]?.label || r.alert_status,
        r.current_stock,
        r.daily_velocity > 0 ? (r.current_stock / r.daily_velocity).toFixed(1) : '—',
        r.effective_min, r.effective_max,
        r.units_sold_6m,
        Number(r.revenue_6m).toFixed(2),
    ].join(','));
    const blob = new Blob([[h.join(','),...lines].join('\n')], { type:'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `minmax_${name}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
}

// ─── ABC × XYZ Matrix ────────────────────────────────────────────────────────

function AbcXyzMatrix({ data, filterAbc, setFilterAbc, filterXyz, setFilterXyz }) {
    const XYZ_KEYS = ['X', 'Y', 'Z'];
    const ABC_KEYS = ['A', 'B', 'C', 'D'];

    const matrix = useMemo(() => {
        const m = {};
        for (const abc of ABC_KEYS)
            for (const xyz of XYZ_KEYS)
                m[`${abc}${xyz}`] = 0;
        for (const r of data) {
            const abc = r.abc_class || 'D';
            const xyz = normXyz(r.demand_variability);
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

    return (
        <div className="rounded-2xl border border-white/60 backdrop-blur-sm p-4 flex flex-col gap-3"
            style={{ background: 'rgba(255,255,255,0.38)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Matriz ABC × XYZ</span>
                {(filterAbc !== 'all' || filterXyz !== 'all') && (
                    <button onClick={() => { setFilterAbc('all'); setFilterXyz('all'); }}
                        className="text-[9px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-0.5">
                        <X size={9} /> limpiar
                    </button>
                )}
            </div>

            {/* Grid */}
            <div className="grid gap-px" style={{ gridTemplateColumns: '28px repeat(3, 1fr)' }}>
                {/* Header row: XYZ */}
                <div />
                {XYZ_KEYS.map(xyz => (
                    <button key={xyz} onClick={() => setFilterXyz(p => p === xyz ? 'all' : xyz)}
                        className={`py-1 rounded-lg text-[10px] font-black text-center transition-all ${filterXyz === xyz ? 'ring-2 ring-offset-1' : 'hover:opacity-80'}`}
                        style={{ color: xyzColors[xyz], ringColor: xyzColors[xyz], background: filterXyz === xyz ? `${xyzColors[xyz]}18` : 'transparent' }}>
                        {xyz}
                    </button>
                ))}

                {/* Data rows */}
                {ABC_KEYS.map(abc => (
                    <React.Fragment key={abc}>
                        {/* ABC label */}
                        <button onClick={() => setFilterAbc(p => p === abc ? 'all' : abc)}
                            className={`py-1.5 rounded-lg text-[10px] font-black text-center transition-all ${filterAbc === abc ? 'ring-2 ring-offset-1' : 'hover:opacity-80'}`}
                            style={{ color: abcColors[abc], background: filterAbc === abc ? `${abcColors[abc]}18` : 'transparent' }}>
                            {abc}
                        </button>
                        {/* Cells */}
                        {XYZ_KEYS.map(xyz => {
                            const count = matrix[`${abc}${xyz}`];
                            const isActive = filterAbc === abc && filterXyz === xyz;
                            const intensity = count > 0 ? Math.max(0.08, (count / maxCell) * 0.35) : 0;
                            return (
                                <button key={xyz} onClick={() => toggle(abc, xyz)}
                                    className={`relative py-2 rounded-xl text-center transition-all hover:scale-[1.04] ${count === 0 ? 'opacity-30 cursor-default' : 'cursor-pointer'} ${isActive ? 'ring-2 ring-offset-1 ring-slate-400' : ''}`}
                                    style={{ background: count > 0 ? `rgba(${abc === 'A' ? '16,185,129' : abc === 'B' ? '59,130,246' : abc === 'C' ? '245,158,11' : '148,163,184'},${intensity})` : 'rgba(0,0,0,0.02)' }}
                                    disabled={count === 0}>
                                    <span className="text-[13px] font-black text-slate-700 tabular-nums">{count || '—'}</span>
                                </button>
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>

            {/* XYZ legend */}
            <div className="flex items-center gap-3 flex-wrap border-t border-slate-100/60 pt-2.5">
                {XYZ_KEYS.map(xyz => (
                    <span key={xyz} className="flex items-center gap-1 text-[9px]">
                        <span className="w-2 h-2 rounded-full" style={{ background: xyzColors[xyz] }} />
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
    const total   = Number(summary.total_cost)  || 0;
    const useful  = Number(summary.useful_cost) || 0;
    const excess  = Number(summary.excess_cost) || 0;
    const dead    = Number(summary.dead_cost)   || 0;
    const covPct  = Number(summary.coverage_pct) || 0;
    const costedPct = Number(summary.costed_pct) || 0;
    const usefulPct = total > 0 ? (useful / total) * 100 : 0;
    const excessPct = total > 0 ? (excess / total) * 100 : 0;
    const deadPct   = total > 0 ? (dead   / total) * 100 : 0;

    const CARDS = [
        { label: 'Total retenido',   value: fmtMoney(total),  sub: `${costedPct}% productos con costo`,              icon: DollarSign,  iconCls: 'text-slate-500',  cardCls: 'border-slate-200/60 bg-white/50',    valCls: 'text-slate-800'   },
        ...(!isBodega ? [
            { label: 'Inventario útil',  value: fmtMoney(useful), sub: `${covPct}% del total · dentro de MIN/MAX`,       icon: TrendingUp,  iconCls: 'text-emerald-500', cardCls: 'border-emerald-200/60 bg-emerald-50/50', valCls: 'text-emerald-700' },
            { label: 'Capital excedente',value: fmtMoney(excess), sub: `${(excessPct).toFixed(1)}% del total · sobre MAX`, icon: TrendingDown,iconCls: 'text-orange-500', cardCls: 'border-orange-200/60 bg-orange-50/40',  valCls: 'text-orange-700'  },
        ] : []),
        { label: 'Sin movimiento',   value: fmtMoney(dead),   sub: `${(deadPct).toFixed(1)}% del total`,             icon: Layers,      iconCls: 'text-slate-400',   cardCls: 'border-slate-200/60 bg-slate-50/50',  valCls: 'text-slate-600'   },
    ];

    return (
        <div className="flex flex-col gap-2">
            <div className={`grid gap-2 ${isBodega ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
                {CARDS.map(({ label, value, sub, icon: Icon, iconCls, cardCls, valCls }) => (
                    <div key={label} className={`rounded-2xl border backdrop-blur-sm px-4 py-3 flex flex-col gap-1 ${cardCls}`}
                        style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.8)' }}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                            <Icon size={13} className={`shrink-0 ${iconCls}`} />
                        </div>
                        <div className={`text-[20px] font-black tabular-nums leading-none ${valCls}`}>{value}</div>
                        <div className="text-[9px] text-slate-400 leading-tight">{sub}</div>
                    </div>
                ))}
            </div>
            {!isBodega && total > 0 && (
                <div className="flex flex-col gap-1">
                    <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100 gap-px">
                        <div className="bg-emerald-400 transition-all"   style={{ width: `${usefulPct.toFixed(2)}%` }} />
                        <div className="bg-orange-400/80 transition-all" style={{ width: `${excessPct.toFixed(2)}%` }} />
                        <div className="bg-slate-300 transition-all"     style={{ width: `${deadPct.toFixed(2)}%`   }} />
                    </div>
                    <div className="flex items-center gap-4 text-[9px] text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Útil {covPct}%</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400/80 inline-block" /> Exceso {excessPct.toFixed(1)}%</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> Sin mov. {deadPct.toFixed(1)}%</span>
                    </div>
                </div>
            )}
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
    return `${Math.ceil(n / factor)} ${tipo.trim()}`;
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

// ─── Expanded breakdown panel ─────────────────────────────────────────────────

function ExpandedPanel({ row, cycleDays }) {
    const pres        = row.presentations || [];
    const stock       = Number(row.current_stock);
    const minN        = Number(row.effective_min);
    const maxN        = Number(row.effective_max);
    const breakdown   = getBreakdown(stock, pres);
    const hasDominant = sortedPres(pres).length > 0;
    const coverDays   = row.daily_velocity > 0 ? (stock / row.daily_velocity).toFixed(1) : null;

    return (
        <div className="mx-4 mb-2 rounded-xl border border-slate-100 overflow-hidden"
            style={{ background: 'rgba(248,250,252,0.8)' }}>
            {breakdown.length > 0 ? (
                <div className="divide-y divide-slate-100">
                    {breakdown.map(({ tipo, factor, qty, base }, i) => {
                        const pct = stock > 0 ? (base / stock) * 100 : 0;
                        return (
                            <div key={i} className="grid items-center px-4 py-2.5"
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
            ) : (
                <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-slate-400 italic">
                    <Package size={13} className="shrink-0 text-slate-300" /> Sin existencias actualmente
                </div>
            )}

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
                </div>
            )}
        </div>
    );
}

// ─── Inline edit row ──────────────────────────────────────────────────────────

function EditRow({ row, onSave, onCancel }) {
    const [mn, setMn]         = useState(String(row.effective_min ?? ''));
    const [mx, setMx]         = useState(String(row.effective_max ?? ''));
    const [saving, setSaving] = useState(false);
    const [err, setErr]       = useState('');
    const mnRef = useRef();
    useEffect(() => { mnRef.current?.select(); }, []);

    const save = async (clearManual = false) => {
        const newMin = clearManual ? null : (mn === '' ? null : parseInt(mn, 10));
        const newMax = clearManual ? null : (mx === '' ? null : parseInt(mx, 10));
        if (!clearManual && newMin !== null && newMax !== null && newMax <= newMin) { setErr('MAX debe ser mayor al MIN'); return; }
        setSaving(true);
        try {
            const { error } = await supabase.from('product_stock_params')
                .update({ manual_min: newMin, manual_max: newMax, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            onSave();
        } catch (e) { setErr(e.message); setSaving(false); }
    };

    const alert = ALERT[row.alert_status] ?? ALERT.ok;
    const pres  = row.presentations || [];

    return (
        <div className={`border-l-4 ${alert.left} bg-blue-50/40 border-b border-blue-100`}>
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
        const min = Number(form.reorder_x_days);
        if (Number(form.cycle_days) < 1) { setErr('El ciclo debe ser ≥ 1 día'); return; }
        if (Number(form.abc_a_pct) >= Number(form.abc_b_pct)) { setErr('El umbral A debe ser menor que el B'); return; }
        if (Number(form.xyz_x_cv_max) >= Number(form.xyz_y_cv_max)) { setErr('El CV máximo de X debe ser menor que el de Y'); return; }
        setSaving(true); setErr('');
        const payload = {
            cycle_days:     Number(form.cycle_days),
            reorder_x_days: Number(form.reorder_x_days),
            reorder_y_days: Number(form.reorder_y_days),
            reorder_z_days: Number(form.reorder_z_days),
            xyz_x_cv_max:   Number(form.xyz_x_cv_max),
            xyz_y_cv_max:   Number(form.xyz_y_cv_max),
            abc_a_pct:      Number(form.abc_a_pct),
            abc_b_pct:      Number(form.abc_b_pct),
            analysis_days:  Number(form.analysis_days),
            updated_at:     new Date().toISOString(),
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

    const Field = ({ label, k, unit, min = 0, step = 1 }) => (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-600 font-medium flex-1">{label}</span>
            <div className="flex items-center gap-1.5">
                <input type="number" min={min} step={step} value={form[k]}
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabMinMax({ searchTerm = '', config, onConfigChange }) {
    const cycleDays = config?.cycle_days ?? 45;

    const [selectedErp,  setSelectedErp]  = useState(5);
    const [filterAbc,    setFilterAbc]    = useState('all');
    const [filterXyz,    setFilterXyz]    = useState('all');
    const [filterAlert,  setFilterAlert]  = useState('all');
    const [data,         setData]         = useState([]);
    const [costSummary,  setCostSummary]  = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [calculating,  setCalculating]  = useState(false);
    const [calcMode,     setCalcMode]     = useState('single'); // 'single' | 'all'
    const [calcResult,   setCalcResult]   = useState(null);
    const [error,        setError]        = useState(null);
    const [editId,       setEditId]       = useState(null);
    const [expandedIds,  setExpandedIds]  = useState(new Set());
    const [configOpen,   setConfigOpen]   = useState(false);
    const loadRef = useRef(0);

    const toggleExpand = useCallback((id) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);

    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true); setError(null); setEditId(null); setExpandedIds(new Set());
        try {
            const [{ data: rows, error: e1 }, { data: cost, error: e2 }] = await Promise.all([
                supabase.rpc('get_stock_analysis', { p_erp_sucursal_id: erpId }).range(0, 9999),
                supabase.rpc('get_inventory_cost_summary', { p_erp_sucursal_id: erpId }),
            ]);
            if (e1) throw e1;
            if (e2) throw e2;
            if (rid !== loadRef.current) return;
            setData((rows || []).map(r => ({ ...r, _erp_sucursal_id: erpId })));
            setCostSummary(cost || null);
        } catch (e) {
            if (rid === loadRef.current) setError(e.message);
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); }, [selectedErp, loadData]);

    const handleRecalcular = async () => {
        setCalculating(true); setCalcMode('single'); setCalcResult(null); setError(null);
        try {
            const { data: res, error: e } = await supabase.rpc('calculate_stock_params', { p_erp_sucursal_id: selectedErp });
            if (e) throw e;
            setCalcResult({ ...res, mode: 'single' });
            await loadData(selectedErp);
        } catch (e) { setError(e.message); }
        finally { setCalculating(false); }
    };

    const handleRecalcularAll = async () => {
        setCalculating(true); setCalcMode('all'); setCalcResult(null); setError(null);
        try {
            const { data: res, error: e } = await supabase.rpc('calculate_stock_params');
            if (e) throw e;
            setCalcResult({ ...res, mode: 'all' });
            await loadData(selectedErp);
        } catch (e) { setError(e.message); }
        finally { setCalculating(false); }
    };

    const handleEditSave = useCallback(() => { setEditId(null); loadData(selectedErp); }, [selectedErp, loadData]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const stats = useMemo(() => Object.fromEntries(
        STAT_CFGS.map(s => [s.key, data.filter(d => d.alert_status === s.key).length])
    ), [data]);

    const lastCalcAt    = useMemo(() => data.find(d => d.calculated_at)?.calculated_at ?? null, [data]);
    const isBodega      = selectedErp === 6;
    const neverCalc     = data.length > 0 && data.every(d => d.is_dead_stock);
    const hasActiveData = data.some(d => !d.is_dead_stock);

    const filtered = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return data.filter(r => {
            if (filterAbc   !== 'all' && r.abc_class    !== filterAbc)       return false;
            if (filterXyz   !== 'all' && normXyz(r.demand_variability) !== filterXyz) return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert)     return false;
            if (q && !r.product_name?.toLowerCase().includes(q))             return false;
            return true;
        });
    }, [data, filterAbc, filterXyz, filterAlert, searchTerm]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    const glass = 'rounded-2xl border border-white/60 backdrop-blur-sm';
    const glassStyle = { background: 'rgba(255,255,255,0.38)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' };

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Config panel ── */}
            {configOpen && config && (
                <ConfigPanel
                    config={config}
                    onSave={cfg => { onConfigChange?.(cfg); }}
                    onClose={() => setConfigOpen(false)}
                />
            )}

            {/* ── Top bar ── */}
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="overflow-visible" style={{ width: '175px' }}>
                    <LiquidSelect
                        value={String(selectedErp)}
                        onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); } }}
                        options={erpOptions} icon={Building2} clearable={false} compact
                    />
                </div>

                {/* ABC pills */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80">
                    {['all','A','B','C','D'].map(cls => (
                        <button key={cls} onClick={() => setFilterAbc(cls)}
                            className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-black transition-all duration-150 ${filterAbc === cls ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            {cls === 'all' ? 'Todos' : cls}
                        </button>
                    ))}
                </div>

                {/* XYZ pills */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80">
                    {['all','X','Y','Z'].map(cls => (
                        <button key={cls} onClick={() => setFilterXyz(cls)}
                            className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-black transition-all duration-150 ${filterXyz === cls ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            {cls === 'all' ? 'XYZ' : cls}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {lastCalcAt && !loading && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <RefreshCw size={9} /> {relativeTime(lastCalcAt)}
                    </span>
                )}

                {/* Ciclo badge */}
                <span className="text-[10px] font-bold text-[#0052CC] bg-blue-50 border border-blue-200/70 px-2.5 py-1 rounded-full">
                    Ciclo {cycleDays}d
                </span>

                {data.length > 0 && !loading && (
                    <button onClick={() => exportCsv(filtered, ERP_NAMES[selectedErp])}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 border border-slate-200 bg-white/80 rounded-xl hover:border-slate-300 hover:shadow-sm transition-all">
                        <Download size={11} /> CSV
                    </button>
                )}

                {/* Config button */}
                <button onClick={() => setConfigOpen(o => !o)}
                    className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-all ${configOpen ? 'bg-[#0052CC] text-white border-[#0052CC] shadow-sm' : 'text-slate-500 border-slate-200 bg-white/80 hover:border-slate-300 hover:shadow-sm'}`}
                    title="Configurar parámetros">
                    <Settings2 size={14} />
                </button>

                {/* Recalcular todas las sucursales + bodega */}
                <button onClick={handleRecalcularAll} disabled={calculating || loading}
                    title="Recalcula todas las sucursales y Bodega en un solo paso"
                    className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-slate-600 border border-slate-200 bg-white/80 hover:border-slate-300 hover:shadow-sm rounded-xl transition-all disabled:opacity-50">
                    {calculating && calcMode === 'all'
                        ? <><Loader2 size={12} className="animate-spin" /> Calculando…</>
                        : <><Layers size={12} /> Todas</>}
                </button>

                {/* Recalcular sucursal actual */}
                <button onClick={handleRecalcular} disabled={calculating || loading}
                    className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-200/60 transition-all disabled:opacity-60">
                    {calculating && calcMode === 'single'
                        ? <><Loader2 size={13} className="animate-spin" /> Calculando…</>
                        : <><RefreshCw size={13} /> Recalcular</>}
                </button>
            </div>

            {/* ── Alert stat chips ── */}
            <div className="flex items-center gap-2 flex-wrap">
                {STAT_CFGS.map(cfg => {
                    const active = filterAlert === cfg.key;
                    return (
                        <button key={cfg.key}
                            onClick={() => setFilterAlert(prev => prev === cfg.key ? 'all' : cfg.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${active ? `${cfg.active} shadow-sm` : 'bg-white/80 border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-sm'}`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                            <span className={`tabular-nums font-black ${active ? '' : 'text-slate-700'}`}>{loading ? '–' : stats[cfg.key]}</span>
                            <span className="opacity-80">{cfg.label}</span>
                            {active && <X size={9} className="ml-0.5 opacity-60" />}
                        </button>
                    );
                })}
            </div>

            {/* ── Cost summary cards ── */}
            {!loading && costSummary && <CostCards summary={costSummary} isBodega={isBodega} />}

            {/* ── ABC × XYZ Matrix + info strip ── */}
            {!loading && data.length > 0 && !isBodega && hasActiveData && (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 items-start">
                    <AbcXyzMatrix
                        data={data}
                        filterAbc={filterAbc} setFilterAbc={setFilterAbc}
                        filterXyz={filterXyz} setFilterXyz={setFilterXyz}
                    />
                    <div className={`${glass} px-4 py-3 flex flex-col gap-2 text-[10px] text-slate-500 min-w-[200px]`} style={glassStyle}>
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
                    </div>
                </div>
            )}

            {/* ── Banners ── */}
            {calcResult?.ok && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700 font-semibold">
                    <CheckCircle2 size={14} />
                    {calcResult.mode === 'all'
                        ? `Cálculo completado — ${calcResult.rows?.toLocaleString()} productos actualizados en todas las sucursales + Bodega`
                        : `Cálculo completado — ${calcResult.rows?.toLocaleString()} productos actualizados en ${ERP_NAMES[selectedErp]}`}
                    <button onClick={() => setCalcResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600"><X size={12} /></button>
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
                    <AlertTriangle size={14} /> {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                </div>
            )}
            {!loading && isBodega && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-[12px] text-blue-800">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Bodega</strong> — MIN/MAX calculado a partir de la demanda consolidada de todas las sucursales. La velocidad de Bodega = suma de ventas diarias de todas las tiendas.</span>
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

            {/* ── Table ── */}
            {!neverCalc && (
                <div className={`${glass} shadow-sm overflow-hidden`} style={{ ...glassStyle, background: 'rgba(255,255,255,0.55)' }}>

                    {/* Header */}
                    <div className="grid text-[9px] font-black uppercase tracking-widest text-slate-400 pl-5 pr-4 py-2.5 border-b border-white/60 bg-white/40"
                        style={{ gridTemplateColumns: '1fr 68px 100px 100px 105px 105px 88px' }}>
                        <span>Producto</span>
                        <span className="text-center">Clase</span>
                        <span className="text-right">Cobertura</span>
                        <span className="text-right">Stock actual</span>
                        <span className="text-right pr-2"><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> MIN</span></span>
                        <span className="text-right pr-2"><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> MAX</span></span>
                        <span className="text-center">Estado</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center gap-2.5 py-24 text-slate-400">
                            <Loader2 size={20} className="animate-spin" />
                            <span className="text-[13px]">Cargando análisis de {ERP_NAMES[selectedErp]}…</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-20 text-center">
                            <Package size={30} className="opacity-15 mx-auto mb-3 text-slate-400" />
                            <p className="text-[13px] text-slate-400 font-medium">Sin productos con ese filtro</p>
                            <button onClick={() => { setFilterAbc('all'); setFilterXyz('all'); setFilterAlert('all'); }}
                                className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">Quitar filtros</button>
                        </div>
                    ) : (
                        <div>
                            {filtered.map((row, i) => {
                                const isEditing = editId === row.erp_product_id;
                                if (isEditing) return (
                                    <EditRow key={`${row.erp_product_id}_edit`} row={row}
                                        onSave={handleEditSave} onCancel={() => setEditId(null)} />
                                );

                                const alert      = ALERT[row.alert_status] ?? ALERT.ok;
                                const abc        = ABC_CFG[row.abc_class]  ?? ABC_CFG.D;
                                const pres       = row.presentations || [];
                                const dead       = row.is_dead_stock;
                                const stock      = Number(row.current_stock);
                                const minN       = Number(row.effective_min);
                                const maxN       = Number(row.effective_max);
                                const canExpand  = !dead || stock > 0;
                                const isExpanded = expandedIds.has(row.erp_product_id);

                                return (
                                    <React.Fragment key={`${row.erp_product_id}_${i}`}>
                                        <div
                                            className={`border-l-4 ${alert.left} ${alert.row} border-b border-white/40 transition-all ${canExpand ? 'cursor-pointer hover:brightness-[0.97]' : ''}`}
                                            onClick={() => canExpand && toggleExpand(row.erp_product_id)}
                                        >
                                            <div className="grid items-center pr-4 pl-1 py-2.5"
                                                style={{ gridTemplateColumns: '1fr 68px 100px 100px 105px 105px 88px' }}>

                                                {/* Product */}
                                                <div className="min-w-0 pr-3 flex items-start gap-1">
                                                    <div className={`mt-[3px] shrink-0 w-4 h-4 flex items-center justify-center ${!canExpand ? 'opacity-0' : ''}`}>
                                                        <ChevronRight size={12} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span className="text-[13px] font-medium text-slate-800 truncate leading-tight">{row.product_name || '—'}</span>
                                                            {row.has_manual && <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>}
                                                        </div>
                                                        {!dead && <span className="text-[10px] text-slate-400">{Number(row.daily_velocity||0).toFixed(1)} und/día</span>}
                                                        {!dead && <StockBar current={stock} min={minN} max={maxN} />}
                                                    </div>
                                                </div>

                                                {/* Combined ABC×XYZ badge */}
                                                <div className="flex justify-center">
                                                    <AbcXyzBadge abc={row.abc_class} xyz={row.demand_variability} />
                                                </div>

                                                {/* Coverage */}
                                                <div className="flex justify-end">
                                                    {!dead
                                                        ? <CoverageBar current={stock} velocity={row.daily_velocity} cycleDays={cycleDays} />
                                                        : <span className="text-slate-200 text-xs">—</span>}
                                                </div>

                                                {/* Stock actual */}
                                                <div className="text-right">
                                                    <div className={`text-[13px] font-bold tabular-nums leading-tight ${stock === 0 ? 'text-red-500' : stock < minN ? 'text-orange-600' : 'text-slate-700'}`}>
                                                        {stock === 0 ? '0' : formatUnits(stock, pres)}
                                                    </div>
                                                    {!dead && stock > 0 && <div className="text-[9px] text-slate-400">{stock.toLocaleString()} und</div>}
                                                </div>

                                                {/* MIN */}
                                                <div className="text-right">
                                                    {dead ? <span className="text-slate-200 text-xs">—</span> : <>
                                                        <div className={`text-[12px] font-semibold tabular-nums ${stock < minN ? 'text-orange-600 font-bold' : 'text-slate-500'}`}>{formatDominant(minN, pres)}</div>
                                                        <div className="text-[9px] text-slate-400">{minN.toLocaleString()} und</div>
                                                    </>}
                                                </div>

                                                {/* MAX */}
                                                <div className="text-right">
                                                    {dead ? <span className="text-slate-200 text-xs">—</span> : <>
                                                        <div className={`text-[12px] font-semibold tabular-nums ${stock > maxN ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>{formatDominant(maxN, pres)}</div>
                                                        <div className="text-[9px] text-slate-400">{maxN.toLocaleString()} und</div>
                                                    </>}
                                                </div>

                                                {/* Alert + edit */}
                                                <div className="flex items-center justify-center gap-1">
                                                    <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border ${alert.pill}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                                        {alert.label}
                                                    </span>
                                                    {!dead && (
                                                        <button onClick={e => { e.stopPropagation(); setEditId(row.erp_product_id); }} title="Ajustar MIN/MAX"
                                                            className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-[#0052CC] hover:bg-blue-50 transition-colors shrink-0">
                                                            <Edit3 size={11} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {isExpanded && canExpand && <ExpandedPanel row={row} cycleDays={cycleDays} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}

                    {/* Footer */}
                    {!loading && filtered.length > 0 && (
                        <div className="pl-5 pr-4 py-2.5 border-t border-white/50 bg-white/30 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                            <span>{filtered.length.toLocaleString()} productos</span>
                            <span className="text-slate-300">
                                {(filterAlert !== 'all' || filterAbc !== 'all' || filterXyz !== 'all' || searchTerm)
                                    ? `filtrado de ${data.length.toLocaleString()} · ${ERP_NAMES[selectedErp]}`
                                    : ERP_NAMES[selectedErp]}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
