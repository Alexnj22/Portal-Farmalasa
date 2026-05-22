import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, Loader2,
    Building2, BarChart2, Package, X, Download,
    CheckCircle2, Edit3, Check, Info, RotateCcw, ChevronRight,
    DollarSign, TrendingUp, TrendingDown, Layers,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ───────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const ALERT = {
    out_of_stock: { label: 'Sin stock',       pill: 'bg-red-100 text-red-700 border-red-200',           dot: 'bg-red-500',     left: 'border-l-red-500',    row: 'bg-red-50/40'     },
    below_min:    { label: 'Bajo mínimo',     pill: 'bg-orange-100 text-orange-700 border-orange-200',  dot: 'bg-orange-500',  left: 'border-l-orange-400', row: 'bg-orange-50/20'  },
    approaching:  { label: 'Próx. mínimo',    pill: 'bg-amber-100 text-amber-700 border-amber-200',     dot: 'bg-amber-400',   left: 'border-l-amber-300',  row: ''                 },
    ok:           { label: 'OK',              pill: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', left: 'border-l-emerald-400', row: ''               },
    overstocked:  { label: 'Exceso',          pill: 'bg-blue-100 text-blue-700 border-blue-200',         dot: 'bg-blue-400',    left: 'border-l-blue-400',   row: 'bg-blue-50/10'   },
    dead_stock:   { label: 'Sin movimiento',  pill: 'bg-slate-100 text-slate-500 border-slate-200',      dot: 'bg-slate-300',   left: 'border-l-slate-200',  row: 'bg-slate-50/60'  },
};

const STAT_CFGS = [
    { key: 'out_of_stock', label: 'Sin stock',      dot: 'bg-red-500',     active: 'bg-red-50 border-red-300 text-red-700'        },
    { key: 'below_min',    label: 'Bajo mínimo',    dot: 'bg-orange-500',  active: 'bg-orange-50 border-orange-300 text-orange-700' },
    { key: 'approaching',  label: 'Próx. mínimo',   dot: 'bg-amber-400',   active: 'bg-amber-50 border-amber-300 text-amber-700'   },
    { key: 'ok',           label: 'OK',              dot: 'bg-emerald-500', active: 'bg-emerald-50 border-emerald-300 text-emerald-700' },
    { key: 'overstocked',  label: 'Exceso',          dot: 'bg-blue-400',    active: 'bg-blue-50 border-blue-300 text-blue-700'     },
    { key: 'dead_stock',   label: 'Sin movimiento',  dot: 'bg-slate-300',   active: 'bg-slate-100 border-slate-300 text-slate-600' },
];

const ABC_CFG = {
    A: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'Clase A — top 70% ingresos' },
    B: { bg: 'bg-blue-50 text-blue-700 border-blue-200',          title: 'Clase B — siguiente 20%'    },
    C: { bg: 'bg-amber-50 text-amber-700 border-amber-200',       title: 'Clase C — restante 10%'     },
    D: { bg: 'bg-slate-50 text-slate-400 border-slate-200',       title: 'Sin ventas en 6 meses'      },
};

const VAR_CFG = {
    stable:   { label: 'Estable',  cls: 'text-emerald-600' },
    moderate: { label: 'Moderada', cls: 'text-amber-600'   },
    erratic:  { label: 'Errática', cls: 'text-red-500'     },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sortedPres(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}

// Full breakdown: "1 CAJA + 5 BLISTER + 2 und" — used for current stock
function formatUnits(units, presentations) {
    const n = Number(units);
    if (n === 0) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) {
            parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`);
            rem %= factor;
        }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n.toLocaleString()} und`;
}

// Dominant presentation rounded UP — used for MIN/MAX (ordering unit)
function formatDominant(units, presentations) {
    const n = Number(units);
    if (!n) return '0';
    const pres = sortedPres(presentations);
    if (!pres.length) return `${n.toLocaleString()} und`;
    const { tipo, factor } = pres[0];
    return `${Math.ceil(n / factor)} ${tipo.trim()}`;
}

// Returns [{tipo, factor, qty, base}] for the expand panel
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
    const h = ['Producto','Clase','Estado','Variab.','Stock actual','MIN (und)','MAX (und)','Ventas 6m','Ingresos 6m'];
    const lines = rows.map(r => [
        `"${(r.product_name||'').replace(/"/g,'""')}"`,
        r.abc_class,
        ALERT[r.alert_status]?.label || r.alert_status,
        VAR_CFG[r.demand_variability]?.label || '',
        r.current_stock, r.effective_min, r.effective_max,
        r.units_sold_6m,
        Number(r.revenue_6m).toFixed(2),
    ].join(','));
    const blob = new Blob([[h.join(','),...lines].join('\n')], { type:'text/csv;charset=utf-8;' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `minmax_${name}_${new Date().toISOString().slice(0,10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
}

// ─── Cost summary cards ───────────────────────────────────────────────────────

function CostCards({ summary, isBodega }) {
    const total   = Number(summary.total_cost)  || 0;
    const useful  = Number(summary.useful_cost) || 0;
    const excess  = Number(summary.excess_cost) || 0;
    const dead    = Number(summary.dead_cost)   || 0;
    const covPct  = Number(summary.coverage_pct) || 0;
    const costedPct = Number(summary.costed_pct) || 0;

    // Bar widths (proportional to total)
    const usefulPct = total > 0 ? (useful / total) * 100 : 0;
    const excessPct = total > 0 ? (excess / total) * 100 : 0;
    const deadPct   = total > 0 ? (dead   / total) * 100 : 0;

    const CARDS = [
        {
            label: 'Total retenido',
            value: fmtMoney(total),
            sub:   `${costedPct}% productos con costo`,
            icon:  DollarSign,
            iconCls: 'text-slate-500',
            cardCls: 'border-slate-200 bg-white',
            valCls:  'text-slate-800',
        },
        ...(!isBodega ? [
            {
                label: 'Inventario útil',
                value: fmtMoney(useful),
                sub:   `${covPct}% del total · dentro de MIN/MAX`,
                icon:  TrendingUp,
                iconCls: 'text-emerald-500',
                cardCls: 'border-emerald-200 bg-emerald-50/60',
                valCls:  'text-emerald-700',
            },
            {
                label: 'Capital excedente',
                value: fmtMoney(excess),
                sub:   `${total > 0 ? ((excess/total)*100).toFixed(1) : 0}% del total · por encima del MAX`,
                icon:  TrendingDown,
                iconCls: 'text-orange-500',
                cardCls: 'border-orange-200 bg-orange-50/50',
                valCls:  'text-orange-700',
            },
        ] : []),
        {
            label: 'Sin movimiento',
            value: fmtMoney(dead),
            sub:   `${total > 0 ? ((dead/total)*100).toFixed(1) : 0}% del total · sin historial de ventas`,
            icon:  Layers,
            iconCls: 'text-slate-400',
            cardCls: 'border-slate-200 bg-slate-50/60',
            valCls:  'text-slate-600',
        },
    ];

    return (
        <div className="flex flex-col gap-2">
            {/* Cards row */}
            <div className={`grid gap-3 ${isBodega ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
                {CARDS.map(({ label, value, sub, icon: Icon, iconCls, cardCls, valCls }) => (
                    <div key={label} className={`rounded-2xl border px-4 py-3 flex flex-col gap-1 ${cardCls}`}>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
                            <Icon size={14} className={`shrink-0 ${iconCls}`} />
                        </div>
                        <div className={`text-[22px] font-black tabular-nums leading-none ${valCls}`}>{value}</div>
                        <div className="text-[9px] text-slate-400 leading-tight">{sub}</div>
                    </div>
                ))}
            </div>

            {/* Breakdown bar — só para sucursales con MIN/MAX */}
            {!isBodega && total > 0 && (
                <div className="flex flex-col gap-1">
                    <div className="flex h-2 rounded-full overflow-hidden bg-slate-100 gap-px">
                        <div className="bg-emerald-400 transition-all"   style={{ width: `${usefulPct.toFixed(2)}%` }} />
                        <div className="bg-orange-400/80 transition-all" style={{ width: `${excessPct.toFixed(2)}%` }} />
                        <div className="bg-slate-300 transition-all"     style={{ width: `${deadPct.toFixed(2)}%`  }} />
                    </div>
                    <div className="flex items-center gap-4 text-[9px] text-slate-400 flex-wrap">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Útil {covPct}%</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400/80 inline-block" /> Exceso {(excessPct).toFixed(1)}%</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> Sin mov. {(deadPct).toFixed(1)}%</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Expanded breakdown panel ─────────────────────────────────────────────────

function ExpandedPanel({ row }) {
    const pres        = row.presentations || [];
    const stock       = Number(row.current_stock);
    const minN        = Number(row.effective_min);
    const maxN        = Number(row.effective_max);
    const breakdown   = getBreakdown(stock, pres);
    const hasDominant = sortedPres(pres).length > 0;

    return (
        <div className="mx-4 mb-2 rounded-xl border border-slate-100 bg-slate-50/70 overflow-hidden">
            {/* Breakdown tiers — or empty state when no stock */}
            {breakdown.length > 0 ? (
                <div className="divide-y divide-slate-100">
                    {breakdown.map(({ tipo, factor, qty, base }, i) => {
                        const pct = stock > 0 ? (base / stock) * 100 : 0;
                        return (
                            <div key={i} className="grid items-center px-4 py-2.5"
                                style={{ gridTemplateColumns: '120px 1fr 72px 64px' }}>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[12px] font-bold text-slate-700">{tipo}</span>
                                    {factor > 1 && (
                                        <span className="text-[9px] font-mono text-slate-400 bg-slate-200/60 px-1 rounded">×{factor}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2.5 pr-4">
                                    <div className="flex-1 h-[5px] bg-slate-200 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-400/70 rounded-full transition-all"
                                            style={{ width: `${pct.toFixed(1)}%` }} />
                                    </div>
                                    <span className="text-[14px] font-black text-slate-800 tabular-nums shrink-0 w-8 text-right">{qty}</span>
                                </div>
                                <div className="text-right text-[10px] text-slate-500 tabular-nums font-mono">
                                    {base.toLocaleString()} und
                                </div>
                                <div className="text-right text-[10px] text-slate-400 tabular-nums">
                                    {pct.toFixed(0)}%
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-slate-400 italic">
                    <Package size={13} className="shrink-0 text-slate-300" />
                    Sin existencias en inventario actualmente
                </div>
            )}

            {/* MIN / MAX reference */}
            {!row.is_dead_stock && minN > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-200/60 bg-white/50 flex items-center gap-5 flex-wrap">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Referencia pedido</span>
                    <span className="flex items-center gap-1.5 text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                        <span className="text-slate-500 font-semibold">MIN</span>
                        <span className="font-black text-orange-600">
                            {hasDominant ? formatDominant(minN, pres) : `${minN.toLocaleString()} und`}
                        </span>
                        {hasDominant && <span className="text-slate-400 text-[10px]">({minN.toLocaleString()} und)</span>}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px]">
                        <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                        <span className="text-slate-500 font-semibold">MAX</span>
                        <span className="font-black text-blue-600">
                            {hasDominant ? formatDominant(maxN, pres) : `${maxN.toLocaleString()} und`}
                        </span>
                        {hasDominant && <span className="text-slate-400 text-[10px]">({maxN.toLocaleString()} und)</span>}
                    </span>
                </div>
            )}
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
        if (!clearManual && newMin !== null && newMax !== null && newMax <= newMin) {
            setErr('MAX debe ser mayor al MIN'); return;
        }
        setSaving(true);
        try {
            const { error } = await supabase
                .from('product_stock_params')
                .update({ manual_min: newMin, manual_max: newMax, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            onSave();
        } catch (e) { setErr(e.message); setSaving(false); }
    };

    const pres   = row.presentations || [];
    const abc    = ABC_CFG[row.abc_class] ?? ABC_CFG.D;
    const varCfg = VAR_CFG[row.demand_variability];
    const alert  = ALERT[row.alert_status] ?? ALERT.ok;

    return (
        <div className={`border-l-4 ${alert.left} bg-blue-50/40 border-b border-blue-100`}>
            {/* Main row grid */}
            <div className="grid items-center px-4 py-2"
                style={{ gridTemplateColumns: '1fr 52px 76px 100px 105px 105px 88px 56px' }}>

                {/* Product */}
                <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-semibold text-slate-800 truncate">{row.product_name || '—'}</span>
                        {row.has_manual && (
                            <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>
                        )}
                    </div>
                    <span className="text-[10px] text-slate-400">{Number(row.daily_velocity||0).toFixed(1)} und/día</span>
                    <StockBar current={row.current_stock} min={parseInt(mn)||row.effective_min} max={parseInt(mx)||row.effective_max} />
                </div>

                {/* ABC */}
                <div className="flex justify-center">
                    <span title={abc.title} className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${abc.bg}`}>{row.abc_class}</span>
                </div>

                {/* Variab */}
                <div className="text-center">
                    {varCfg
                        ? <span className={`text-[10px] font-semibold ${varCfg.cls}`}>{varCfg.label} <span className="text-slate-300 font-mono">({Number(row.cv||0).toFixed(0)}%)</span></span>
                        : <span className="text-slate-200 text-xs">—</span>}
                </div>

                {/* Stock actual */}
                <div className="text-right">
                    <span className={`text-[12px] font-bold tabular-nums ${Number(row.current_stock)===0?'text-red-500':'text-slate-700'}`}>
                        {formatUnits(row.current_stock, pres)}
                    </span>
                    <div className="text-[9px] text-slate-400">{Number(row.current_stock).toLocaleString()} und</div>
                </div>

                {/* MIN input */}
                <div className="px-1.5">
                    <input ref={mnRef} type="number" min="0" value={mn}
                        onChange={e => { setMn(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.effective_min)}
                        className="w-full text-right text-[12px] font-bold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-300 focus:border-orange-400"
                    />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">und</div>
                </div>

                {/* MAX input */}
                <div className="px-1.5">
                    <input type="number" min="0" value={mx}
                        onChange={e => { setMx(e.target.value); setErr(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
                        placeholder={String(row.effective_max)}
                        className="w-full text-right text-[12px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-400"
                    />
                    <div className="text-[9px] text-slate-400 text-right mt-0.5">und</div>
                </div>

                {/* Save / Cancel */}
                <div className="flex items-center justify-center gap-1.5">
                    <button onClick={() => save()} disabled={saving}
                        className="h-7 px-3 rounded-lg text-[11px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 flex items-center gap-1">
                        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Guardar
                    </button>
                    <button onClick={onCancel} disabled={saving}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                        <X size={13} />
                    </button>
                </div>

                {/* Restablecer */}
                <div className="flex justify-end">
                    {row.has_manual && (
                        <button onClick={() => save(true)} disabled={saving} title="Restablecer valores calculados"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-orange-500 hover:bg-orange-50 transition-colors">
                            <RotateCcw size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Error */}
            {err && (
                <div className="px-4 pb-2 text-[11px] font-semibold text-red-500">{err}</div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabMinMax({ searchTerm = '' }) {
    const [selectedErp,  setSelectedErp]  = useState(5); // La Popular primero
    const [filterAbc,    setFilterAbc]    = useState('all');
    const [filterAlert,  setFilterAlert]  = useState('all');
    const [data,         setData]         = useState([]);
    const [costSummary,  setCostSummary]  = useState(null);
    const [loading,      setLoading]      = useState(false);
    const [calculating,  setCalculating]  = useState(false);
    const [calcResult,   setCalcResult]   = useState(null);
    const [error,        setError]        = useState(null);
    const [editId,       setEditId]       = useState(null);
    const [expandedIds,  setExpandedIds]  = useState(new Set());
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
            // both queries in parallel — .range(0,9999) bypasses PostgREST 1000-row cap
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
        setCalculating(true); setCalcResult(null); setError(null);
        try {
            const { data: res, error: e } = await supabase
                .rpc('calculate_stock_params', { p_erp_sucursal_id: selectedErp });
            if (e) throw e;
            setCalcResult(res);
            await loadData(selectedErp);
        } catch (e) { setError(e.message); }
        finally { setCalculating(false); }
    };

    const handleEditSave = useCallback(() => {
        setEditId(null);
        loadData(selectedErp);
    }, [selectedErp, loadData]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const stats = useMemo(() => Object.fromEntries(
        STAT_CFGS.map(s => [s.key, data.filter(d => d.alert_status === s.key).length])
    ), [data]);

    const lastCalcAt    = useMemo(() => data.find(d => d.calculated_at)?.calculated_at ?? null, [data]);
    const isBodega      = selectedErp === 6;
    const neverCalc     = !isBodega && data.length > 0 && data.every(d => d.is_dead_stock);
    const hasActiveData = data.some(d => !d.is_dead_stock);

    const filtered = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return data.filter(r => {
            if (filterAbc   !== 'all' && r.abc_class    !== filterAbc)   return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert) return false;
            if (q && !r.product_name?.toLowerCase().includes(q))        return false;
            return true;
        });
    }, [data, filterAbc, filterAlert, searchTerm]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Top bar ── */}
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="overflow-visible" style={{ width: '175px' }}>
                    <LiquidSelect
                        value={String(selectedErp)}
                        onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterAlert('all'); } }}
                        options={erpOptions} icon={Building2} clearable={false} compact
                    />
                </div>

                {/* ABC pills */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80">
                    {['all','A','B','C','D'].map(cls => (
                        <button key={cls} onClick={() => setFilterAbc(cls)}
                            className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-black transition-all duration-150 ${
                                filterAbc === cls ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                            }`}>
                            {cls === 'all' ? 'Todos' : cls}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {lastCalcAt && !loading && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <RefreshCw size={9} /> {relativeTime(lastCalcAt)}
                    </span>
                )}
                {data.length > 0 && !loading && (
                    <button onClick={() => exportCsv(filtered, ERP_NAMES[selectedErp])}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 border border-slate-200 bg-white rounded-xl hover:border-slate-300 hover:shadow-sm transition-all">
                        <Download size={11} /> CSV
                    </button>
                )}
                {!isBodega && (
                    <button onClick={handleRecalcular} disabled={calculating || loading}
                        className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-200/60 transition-all disabled:opacity-60">
                        {calculating ? <><Loader2 size={13} className="animate-spin" /> Calculando…</> : <><RefreshCw size={13} /> Recalcular</>}
                    </button>
                )}
            </div>

            {/* ── Alert stat chips ── */}
            <div className="flex items-center gap-2 flex-wrap">
                {STAT_CFGS.map(cfg => {
                    const active = filterAlert === cfg.key;
                    return (
                        <button key={cfg.key}
                            onClick={() => setFilterAlert(prev => prev === cfg.key ? 'all' : cfg.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                                active
                                    ? `${cfg.active} shadow-sm`
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-sm'
                            }`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                            <span className={`tabular-nums font-black ${active ? '' : 'text-slate-700'}`}>
                                {loading ? '–' : stats[cfg.key]}
                            </span>
                            <span className="opacity-80">{cfg.label}</span>
                            {active && <X size={9} className="ml-0.5 opacity-60" />}
                        </button>
                    );
                })}
            </div>

            {/* ── Cost summary cards ── */}
            {!loading && costSummary && (
                <CostCards summary={costSummary} isBodega={isBodega} />
            )}

            {/* ── Formula info strip ── */}
            {!isBodega && hasActiveData && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-400">
                    <Info size={10} className="shrink-0 text-slate-300" />
                    <span>
                        <span className="text-slate-500 font-bold">MIN</span> = traslado 3d + seguridad ·
                        <span className="text-slate-500 font-bold"> MAX</span> = MIN + ciclo 4d ·
                        Estable <span className="text-slate-500">5/9d</span> · Moderado <span className="text-slate-500">7/11d</span> · Errático <span className="text-slate-500">10/14d</span>
                    </span>
                </div>
            )}

            {/* ── Banners ── */}
            {calcResult?.ok && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700 font-semibold">
                    <CheckCircle2 size={14} />
                    Cálculo completado — {calcResult.rows?.toLocaleString()} productos actualizados en {ERP_NAMES[selectedErp]}
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
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span><strong>Bodega</strong> no tiene ventas directas — Min/Max basado en traslados es Fase 2. Se muestra el inventario actual como referencia.</span>
                </div>
            )}
            {!loading && neverCalc && (
                <div className="rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white py-16 text-center">
                    <BarChart2 size={36} className="opacity-15 mx-auto mb-4 text-slate-500" />
                    <p className="text-[15px] font-bold text-slate-700 mb-2">Sin datos para {ERP_NAMES[selectedErp]}</p>
                    <p className="text-[12px] text-slate-400 mb-6 max-w-sm mx-auto leading-relaxed">
                        Haz clic en <strong>Recalcular</strong> para analizar 6 meses de ventas y generar automáticamente los parámetros MIN/MAX con clasificación ABC.
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
                <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">

                    {/* Header */}
                    <div className="grid text-[9px] font-black uppercase tracking-widest text-slate-400 pl-5 pr-4 py-2.5 border-b border-slate-100 bg-slate-50/80"
                        style={{ gridTemplateColumns: '1fr 52px 76px 100px 105px 105px 88px 56px' }}>
                        <span>Producto</span>
                        <span className="text-center">Clase</span>
                        <span className="text-center">Variabilidad</span>
                        <span className="text-right">Stock actual</span>
                        <span className="text-right pr-2">
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> MIN
                            </span>
                        </span>
                        <span className="text-right pr-2">
                            <span className="inline-flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> MAX
                            </span>
                        </span>
                        <span className="text-center">Estado</span>
                        <span className="text-right">Ventas 6m</span>
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
                            <button onClick={() => { setFilterAbc('all'); setFilterAlert('all'); }}
                                className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">
                                Quitar filtros
                            </button>
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
                                const varCfg     = VAR_CFG[row.demand_variability];
                                const pres       = row.presentations || [];
                                const dead       = row.is_dead_stock;
                                const stock      = Number(row.current_stock);
                                const minN       = Number(row.effective_min);
                                const maxN       = Number(row.effective_max);
                                const canExpand  = !dead || stock > 0;
                                const isExpanded = expandedIds.has(row.erp_product_id);

                                return (
                                    <React.Fragment key={`${row.erp_product_id}_${i}`}>
                                        {/* Whole row is clickable */}
                                        <div
                                            className={`border-l-4 ${alert.left} ${alert.row} border-b border-slate-50 transition-all ${canExpand ? 'cursor-pointer hover:brightness-[0.97]' : 'hover:brightness-[0.98]'}`}
                                            onClick={() => canExpand && toggleExpand(row.erp_product_id)}
                                        >
                                            <div className="grid items-center pr-4 pl-1 py-2.5"
                                                style={{ gridTemplateColumns: '1fr 52px 76px 100px 105px 105px 88px 56px' }}>

                                                {/* Product + chevron indicator */}
                                                <div className="min-w-0 pr-3 flex items-start gap-1">
                                                    <div className={`mt-[3px] shrink-0 w-4 h-4 flex items-center justify-center ${!canExpand ? 'opacity-0' : ''}`}>
                                                        <ChevronRight size={12}
                                                            className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span className="text-[13px] font-medium text-slate-800 truncate leading-tight">
                                                                {row.product_name || '—'}
                                                            </span>
                                                            {row.has_manual && (
                                                                <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">MANUAL</span>
                                                            )}
                                                        </div>
                                                        {!dead && (
                                                            <span className="text-[10px] text-slate-400">
                                                                {Number(row.daily_velocity||0).toFixed(1)} und/día
                                                            </span>
                                                        )}
                                                        {!dead && <StockBar current={stock} min={minN} max={maxN} />}
                                                    </div>
                                                </div>

                                                {/* ABC */}
                                                <div className="flex justify-center">
                                                    <span title={abc.title}
                                                        className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${abc.bg}`}>
                                                        {row.abc_class}
                                                    </span>
                                                </div>

                                                {/* Variab */}
                                                <div className="text-center">
                                                    {!dead && varCfg
                                                        ? <span className={`text-[10px] font-semibold ${varCfg.cls}`}>
                                                            {varCfg.label}
                                                            <span className="text-slate-300 ml-1 font-mono">({Number(row.cv||0).toFixed(0)}%)</span>
                                                          </span>
                                                        : <span className="text-slate-200 text-xs">—</span>}
                                                </div>

                                                {/* Stock actual */}
                                                <div className="text-right">
                                                    <div className={`text-[13px] font-bold tabular-nums leading-tight ${
                                                        stock === 0 ? 'text-red-500' : stock < minN ? 'text-orange-600' : 'text-slate-700'
                                                    }`}>
                                                        {stock === 0 ? '0' : formatUnits(stock, pres)}
                                                    </div>
                                                    {!dead && stock > 0 && (
                                                        <div className="text-[9px] text-slate-400">{stock.toLocaleString()} und</div>
                                                    )}
                                                </div>

                                                {/* MIN — dominant presentation, rounded UP */}
                                                <div className="text-right">
                                                    {dead
                                                        ? <span className="text-slate-200 text-xs">—</span>
                                                        : <>
                                                            <div className={`text-[12px] font-semibold tabular-nums ${
                                                                stock < minN ? 'text-orange-600 font-bold' : 'text-slate-500'
                                                            }`}>
                                                                {formatDominant(minN, pres)}
                                                            </div>
                                                            <div className="text-[9px] text-slate-400">{minN.toLocaleString()} und</div>
                                                          </>
                                                    }
                                                </div>

                                                {/* MAX — dominant presentation, rounded UP */}
                                                <div className="text-right">
                                                    {dead
                                                        ? <span className="text-slate-200 text-xs">—</span>
                                                        : <>
                                                            <div className={`text-[12px] font-semibold tabular-nums ${
                                                                stock > maxN ? 'text-blue-600 font-bold' : 'text-slate-500'
                                                            }`}>
                                                                {formatDominant(maxN, pres)}
                                                            </div>
                                                            <div className="text-[9px] text-slate-400">{maxN.toLocaleString()} und</div>
                                                          </>
                                                    }
                                                </div>

                                                {/* Alert */}
                                                <div className="flex justify-center">
                                                    <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border ${alert.pill}`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                                        {alert.label}
                                                    </span>
                                                </div>

                                                {/* Ventas + edit */}
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <div className="text-right">
                                                        <div className="text-[11px] font-semibold tabular-nums text-slate-500">
                                                            {Number(row.units_sold_6m||0).toLocaleString()}
                                                        </div>
                                                        {!dead && (
                                                            <div className="text-[9px] text-slate-400">
                                                                ${Number(row.revenue_6m||0).toLocaleString('en-US',{maximumFractionDigits:0})}
                                                            </div>
                                                        )}
                                                    </div>
                                                    {!dead && (
                                                        <button
                                                            onClick={e => { e.stopPropagation(); setEditId(row.erp_product_id); }}
                                                            title="Ajustar MIN/MAX"
                                                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-[#0052CC] hover:bg-blue-50 transition-colors shrink-0">
                                                            <Edit3 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {isExpanded && canExpand && <ExpandedPanel row={row} />}
                                    </React.Fragment>
                                );
                            })}
                        </div>
                    )}

                    {/* Footer */}
                    {!loading && filtered.length > 0 && (
                        <div className="pl-5 pr-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                            <span>{filtered.length.toLocaleString()} productos</span>
                            <span className="text-slate-300">
                                {(filterAlert !== 'all' || filterAbc !== 'all' || searchTerm)
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
