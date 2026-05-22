import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../supabaseClient';
import {
    RefreshCw, AlertTriangle, TrendingDown, TrendingUp, Loader2,
    Building2, BarChart2, Package, X, Download,
    PackageX, CheckCircle2, Edit3, Check, Info,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
// La Popular, Salud 1-4, Salud 5, Bodega
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const ALERT_CFG = {
    out_of_stock: { label: 'Sin stock',      bg: 'bg-red-100 text-red-700 border-red-200',         dot: 'bg-red-500',     icon: AlertTriangle },
    below_min:    { label: 'Bajo mínimo',    bg: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500',  icon: TrendingDown  },
    approaching:  { label: 'Próx. mínimo',   bg: 'bg-amber-100 text-amber-700 border-amber-200',    dot: 'bg-amber-400',   icon: TrendingDown  },
    dead_stock:   { label: 'Sin movimiento', bg: 'bg-slate-100 text-slate-600 border-slate-200',    dot: 'bg-slate-400',   icon: PackageX      },
    overstocked:  { label: 'Exceso',         bg: 'bg-blue-100 text-blue-700 border-blue-200',       dot: 'bg-blue-400',    icon: TrendingUp    },
    ok:           { label: 'OK',             bg: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2  },
};

const ABC_CFG = {
    A: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'Clase A — top 70% ingresos' },
    B: { bg: 'bg-blue-50 text-blue-700 border-blue-200',          title: 'Clase B — siguiente 20%' },
    C: { bg: 'bg-amber-50 text-amber-700 border-amber-200',        title: 'Clase C — restante 10%' },
    D: { bg: 'bg-slate-50 text-slate-500 border-slate-200',        title: 'Sin ventas en 6 meses' },
};

const VAR_CFG = {
    stable:   { label: 'Estable',  bg: 'text-emerald-600' },
    moderate: { label: 'Moderada', bg: 'text-amber-600'   },
    erratic:  { label: 'Errática', bg: 'text-red-500'     },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUnits(units, presentations) {
    const n = Number(units);
    if (n === 0) return '0 und';

    const pres = [...new Map(
        (presentations || []).map(p => [p.factor, p])
    ).values()]
        .filter(p => p.factor > 1)
        .sort((a, b) => b.factor - a.factor);

    if (pres.length === 0) return `${n.toLocaleString()} und`;

    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) {
            const count = Math.floor(rem / factor);
            parts.push(`${count} ${tipo.trim()}`);
            rem -= count * factor;
        }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n.toLocaleString()} und`;
}

function relativeTime(iso) {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2)  return 'hace un momento';
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `hace ${hrs}h`;
    return new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function exportCsv(rows, erpName) {
    const headers = ['Producto','Clase','Alerta','Variabilidad','Stock','MIN','MAX','Vendidas 6m','Ingresos 6m'];
    const lines = rows.map(r => [
        `"${(r.product_name || '').replace(/"/g, '""')}"`,
        r.abc_class,
        ALERT_CFG[r.alert_status]?.label || r.alert_status,
        VAR_CFG[r.demand_variability]?.label || '',
        r.current_stock,
        r.effective_min,
        r.effective_max,
        r.units_sold_6m,
        Number(r.revenue_6m).toFixed(2),
    ].join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `stock_minmax_${erpName}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ count, label, sub, color, active, onClick }) {
    return (
        <button onClick={onClick}
            className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[110px] text-left ${
                active
                    ? `${color.activeBg} shadow-md -translate-y-px`
                    : `bg-white border-slate-100 hover:border-slate-200 hover:shadow-sm`
            }`}>
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${color.dot}`} />
            <div>
                <div className={`text-[22px] font-black leading-none tabular-nums ${color.text}`}>{count}</div>
                <div className="text-[10px] font-bold text-slate-600 mt-0.5">{label}</div>
                {sub && <div className="text-[9px] text-slate-400">{sub}</div>}
            </div>
            {active && <X size={10} className="text-slate-400 ml-auto shrink-0" />}
        </button>
    );
}

// ─── Manual Override Modal ─────────────────────────────────────────────────

function OverrideModal({ row, onSave, onClose }) {
    const [minVal, setMinVal] = useState(row.effective_min ?? '');
    const [maxVal, setMaxVal] = useState(row.effective_max ?? '');
    const [saving, setSaving] = useState(false);
    const [err, setErr]       = useState('');

    const handleSave = async () => {
        const mn = minVal === '' ? null : parseInt(minVal);
        const mx = maxVal === '' ? null : parseInt(maxVal);
        if (mn !== null && mx !== null && mx <= mn) { setErr('El MAX debe ser mayor al MIN'); return; }
        setSaving(true);
        try {
            const { error } = await supabase
                .from('product_stock_params')
                .update({ manual_min: mn, manual_max: mx, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            onSave();
        } catch (e) { setErr(e.message); }
        finally { setSaving(false); }
    };

    const handleClear = async () => {
        setSaving(true);
        try {
            const { error } = await supabase
                .from('product_stock_params')
                .update({ manual_min: null, manual_max: null, updated_at: new Date().toISOString() })
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id);
            if (error) throw error;
            onSave();
        } catch (e) { setErr(e.message); }
        finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
                <div className="mb-4">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ajuste manual</p>
                    <p className="text-[15px] font-bold text-slate-800 leading-tight">{row.product_name}</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                        Calculado: MIN={Number(row.effective_min||0).toLocaleString()} / MAX={Number(row.effective_max||0).toLocaleString()} und
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-4">
                    {[['MIN', minVal, setMinVal], ['MAX', maxVal, setMaxVal]].map(([label, val, set]) => (
                        <div key={label}>
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{label} (und)</label>
                            <input
                                type="number" min="0" value={val}
                                onChange={e => set(e.target.value)}
                                placeholder="Auto"
                                className="mt-1 w-full px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                            />
                        </div>
                    ))}
                </div>
                {err && <p className="text-[11px] text-red-500 font-semibold mb-3">{err}</p>}
                <div className="flex gap-2">
                    {row.has_manual && (
                        <button onClick={handleClear} disabled={saving}
                            className="px-3 py-2 text-[11px] font-bold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                            Restablecer
                        </button>
                    )}
                    <button onClick={onClose} disabled={saving}
                        className="flex-1 py-2 text-[12px] font-bold text-slate-500 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors disabled:opacity-50">
                        Cancelar
                    </button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5">
                        {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabMinMax({ searchTerm = '' }) {
    const [selectedErp,   setSelectedErp]   = useState(1);
    const [filterAbc,     setFilterAbc]     = useState('all');
    const [filterAlert,   setFilterAlert]   = useState('all');
    const [data,          setData]          = useState([]);
    const [loading,       setLoading]       = useState(false);
    const [calculating,   setCalculating]   = useState(false);
    const [calcResult,    setCalcResult]    = useState(null);
    const [error,         setError]         = useState(null);
    const [editingRow,    setEditingRow]     = useState(null);
    const loadRef = useRef(0);

    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true);
        setError(null);
        try {
            const { data: rows, error: e } = await supabase
                .rpc('get_stock_analysis', { p_erp_sucursal_id: erpId });
            if (e) throw e;
            if (rid !== loadRef.current) return;
            setData((rows || []).map(r => ({ ...r, _erp_sucursal_id: erpId })));
        } catch (e) {
            if (rid === loadRef.current) setError(e.message);
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); }, [selectedErp, loadData]);

    const handleRecalcular = async () => {
        setCalculating(true);
        setCalcResult(null);
        setError(null);
        try {
            const { data: res, error: e } = await supabase
                .rpc('calculate_stock_params', { p_erp_sucursal_id: selectedErp });
            if (e) throw e;
            setCalcResult(res);
            await loadData(selectedErp);
        } catch (e) {
            setError(e.message);
        } finally {
            setCalculating(false);
        }
    };

    const handleOverrideSave = useCallback(async () => {
        setEditingRow(null);
        await loadData(selectedErp);
    }, [selectedErp, loadData]);

    // ── Stats ────────────────────────────────────────────────────────────────
    const stats = useMemo(() => ({
        out_of_stock: data.filter(d => d.alert_status === 'out_of_stock').length,
        below_min:    data.filter(d => d.alert_status === 'below_min').length,
        approaching:  data.filter(d => d.alert_status === 'approaching').length,
        ok:           data.filter(d => d.alert_status === 'ok').length,
        overstocked:  data.filter(d => d.alert_status === 'overstocked').length,
        dead_stock:   data.filter(d => d.alert_status === 'dead_stock').length,
    }), [data]);

    const lastCalcAt = useMemo(() =>
        data.find(d => d.calculated_at)?.calculated_at ?? null, [data]);

    const isBodega        = selectedErp === 6;
    const neverCalculated = !isBodega && data.length > 0 && data.every(d => d.is_dead_stock);

    // ── Filter ───────────────────────────────────────────────────────────────
    const filtered = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return data.filter(r => {
            if (filterAbc   !== 'all' && r.abc_class    !== filterAbc)   return false;
            if (filterAlert !== 'all' && r.alert_status !== filterAlert) return false;
            if (q && !r.product_name?.toLowerCase().includes(q))        return false;
            return true;
        });
    }, [data, filterAbc, filterAlert, searchTerm]);

    // ── ERP select options ───────────────────────────────────────────────────
    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // ─── Render ──────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Top bar ── */}
            <div className="flex items-center gap-3 flex-wrap">

                {/* Sucursal selector */}
                <div className="overflow-visible" style={{ width: '175px' }}>
                    <LiquidSelect
                        value={String(selectedErp)}
                        onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterAbc('all'); setFilterAlert('all'); } }}
                        options={erpOptions}
                        icon={Building2}
                        clearable={false}
                        compact
                    />
                </div>

                {/* ABC filter */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100/80">
                    {['all','A','B','C','D'].map(cls => (
                        <button key={cls} onClick={() => setFilterAbc(cls)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all ${
                                filterAbc === cls
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}>
                            {cls === 'all' ? 'Todos' : `Clase ${cls}`}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {lastCalcAt && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <RefreshCw size={9} /> {relativeTime(lastCalcAt)}
                    </span>
                )}

                {/* Export */}
                {data.length > 0 && !loading && (
                    <button onClick={() => exportCsv(filtered.length ? filtered : data, ERP_NAMES[selectedErp])}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-slate-600 border border-slate-200 bg-white rounded-xl hover:border-slate-300 hover:shadow-sm transition-all">
                        <Download size={11} /> CSV
                    </button>
                )}

                {/* Recalcular */}
                {!isBodega && (
                    <button
                        onClick={handleRecalcular}
                        disabled={calculating || loading}
                        className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-bold text-white bg-[#0052CC] hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-200 transition-all disabled:opacity-60">
                        {calculating
                            ? <><Loader2 size={13} className="animate-spin" /> Calculando…</>
                            : <><RefreshCw size={13} /> Recalcular</>
                        }
                    </button>
                )}
            </div>

            {/* ── Formula info ── */}
            {!isBodega && !neverCalculated && data.some(d => !d.is_dead_stock) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-400">
                    <Info size={11} className="shrink-0 text-slate-300" />
                    <span>
                        <strong className="text-slate-500">MIN</strong> = traslado (3d) + seguridad (2–7d) &nbsp;·&nbsp;
                        <strong className="text-slate-500">MAX</strong> = MIN + ciclo de pedido (4d) &nbsp;·&nbsp;
                        Estable: MIN ~5d / MAX ~9d &nbsp;·&nbsp; Moderado: ~7d / ~11d &nbsp;·&nbsp; Errático: ~10d / ~14d
                    </span>
                </div>
            )}

            {/* ── Stat cards ── */}
            <div className="flex items-start gap-2.5 flex-wrap">
                {[
                    { key: 'out_of_stock', label: 'Sin stock',      sub: 'agotados',      dot: 'bg-red-500',     text: 'text-red-600',     activeBg: 'bg-red-50 border-red-200' },
                    { key: 'below_min',    label: 'Bajo mínimo',    sub: 'críticos',       dot: 'bg-orange-500',  text: 'text-orange-600',  activeBg: 'bg-orange-50 border-orange-200' },
                    { key: 'approaching',  label: 'Próx. mínimo',   sub: '< 25% sobre min',dot: 'bg-amber-400',   text: 'text-amber-600',   activeBg: 'bg-amber-50 border-amber-200' },
                    { key: 'ok',           label: 'OK',             sub: 'nivel correcto', dot: 'bg-emerald-500', text: 'text-emerald-600', activeBg: 'bg-emerald-50 border-emerald-200' },
                    { key: 'overstocked',  label: 'Exceso',         sub: 'sobre máximo',   dot: 'bg-blue-400',    text: 'text-blue-600',    activeBg: 'bg-blue-50 border-blue-200' },
                    { key: 'dead_stock',   label: 'Sin movimiento', sub: '0 ventas 6m',    dot: 'bg-slate-400',   text: 'text-slate-600',   activeBg: 'bg-slate-100 border-slate-300' },
                ].map(cfg => (
                    <StatCard
                        key={cfg.key}
                        count={loading ? '–' : stats[cfg.key]}
                        label={cfg.label}
                        sub={cfg.sub}
                        color={cfg}
                        active={filterAlert === cfg.key}
                        onClick={() => setFilterAlert(prev => prev === cfg.key ? 'all' : cfg.key)}
                    />
                ))}
            </div>

            {/* ── Calc result banner ── */}
            {calcResult?.ok && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-700 font-semibold">
                    <CheckCircle2 size={14} />
                    Cálculo completado — {calcResult.rows?.toLocaleString()} productos actualizados
                    <button onClick={() => setCalcResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600">
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
                    <AlertTriangle size={14} />
                    {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                </div>
            )}

            {/* ── Bodega info banner ── */}
            {!loading && isBodega && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
                    <Info size={14} className="shrink-0 mt-0.5" />
                    <span>
                        <strong>Bodega</strong> no tiene ventas directas — el cálculo de Min/Max por traslados a sucursales es <strong>Fase 2</strong>.
                        Aquí se muestra el inventario actual de bodega para referencia.
                    </span>
                </div>
            )}

            {/* ── Never calculated state ── */}
            {!loading && neverCalculated && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 py-14 text-center">
                    <BarChart2 size={32} className="opacity-20 mx-auto mb-3 text-slate-500" />
                    <p className="text-[14px] font-bold text-slate-600 mb-1">Sin datos calculados para {ERP_NAMES[selectedErp]}</p>
                    <p className="text-[12px] text-slate-400 mb-5 max-w-xs mx-auto">
                        Haz clic en <strong>Recalcular</strong> para analizar 6 meses de ventas y
                        generar los parámetros MIN/MAX automáticamente.
                    </p>
                    <button onClick={handleRecalcular} disabled={calculating}
                        className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-bold text-white bg-[#0052CC] rounded-xl shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-60">
                        {calculating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        Calcular ahora
                    </button>
                </div>
            )}

            {/* ── Table ── */}
            {!neverCalculated && (
                <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                    {/* Table header */}
                    <div className="grid gap-0 text-[9px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5 border-b border-slate-100 bg-slate-50/70"
                        style={{ gridTemplateColumns: '1fr 60px 80px 110px 110px 110px 90px 70px' }}>
                        <span>Producto</span>
                        <span className="text-center">Clase</span>
                        <span className="text-center">Variab.</span>
                        <span className="text-right">Stock actual</span>
                        <span className="text-right">Mínimo</span>
                        <span className="text-right">Máximo</span>
                        <span className="text-center">Estado</span>
                        <span className="text-right">Vtas 6m</span>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
                            <Loader2 size={18} className="animate-spin" />
                            <span className="text-sm">Cargando análisis…</span>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="py-16 text-center">
                            <Package size={28} className="opacity-20 mx-auto mb-2 text-slate-400" />
                            <p className="text-sm text-slate-400 font-medium">Sin resultados</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {filtered.map((row, i) => {
                                const alert  = ALERT_CFG[row.alert_status] ?? ALERT_CFG.ok;
                                const abc    = ABC_CFG[row.abc_class]      ?? ABC_CFG.D;
                                const varCfg = VAR_CFG[row.demand_variability];
                                const pres   = row.presentations || [];
                                const stockFmt = formatUnits(row.current_stock, pres);
                                const minFmt   = row.is_dead_stock ? '—' : formatUnits(row.effective_min, pres);
                                const maxFmt   = row.is_dead_stock ? '—' : formatUnits(row.effective_max, pres);

                                return (
                                    <div key={`${row.erp_product_id}_${i}`}
                                        className={`grid gap-0 items-center px-4 py-2.5 transition-colors hover:bg-slate-50/60 ${
                                            row.alert_status === 'out_of_stock' ? 'bg-red-50/30' :
                                            row.alert_status === 'below_min'    ? 'bg-orange-50/20' :
                                            row.alert_status === 'dead_stock'   ? 'bg-slate-50/40' : ''
                                        }`}
                                        style={{ gridTemplateColumns: '1fr 60px 80px 110px 110px 110px 90px 70px' }}>

                                        {/* Product name */}
                                        <div className="min-w-0 pr-3">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[13px] font-medium text-slate-800 truncate leading-tight">
                                                    {row.product_name || '—'}
                                                </span>
                                                {row.has_manual && (
                                                    <span className="shrink-0 text-[8px] font-black text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">
                                                        MANUAL
                                                    </span>
                                                )}
                                            </div>
                                            {!row.is_dead_stock && (
                                                <span className="text-[10px] text-slate-400">
                                                    {Number(row.daily_velocity || 0).toFixed(1)} und/día
                                                </span>
                                            )}
                                        </div>

                                        {/* ABC class */}
                                        <div className="flex justify-center">
                                            <span title={abc.title}
                                                className={`text-[11px] font-black px-2 py-0.5 rounded-full border ${abc.bg}`}>
                                                {row.abc_class}
                                            </span>
                                        </div>

                                        {/* Variabilidad */}
                                        <div className="text-center">
                                            {!row.is_dead_stock && varCfg ? (
                                                <span className={`text-[10px] font-semibold ${varCfg.bg}`}>
                                                    {varCfg.label}
                                                    <span className="text-slate-300 ml-1 font-mono">({Number(row.cv || 0).toFixed(0)}%)</span>
                                                </span>
                                            ) : <span className="text-slate-200 text-xs">—</span>}
                                        </div>

                                        {/* Stock actual */}
                                        <div className="text-right">
                                            <span className={`text-[12px] font-bold tabular-nums ${
                                                Number(row.current_stock) === 0 ? 'text-red-500' : 'text-slate-700'
                                            }`}>
                                                {stockFmt}
                                            </span>
                                        </div>

                                        {/* MIN */}
                                        <div className="text-right">
                                            <span className={`text-[12px] font-semibold tabular-nums ${
                                                row.is_dead_stock ? 'text-slate-200' :
                                                Number(row.current_stock) < Number(row.effective_min) ? 'text-orange-600' : 'text-slate-500'
                                            }`}>
                                                {minFmt}
                                            </span>
                                        </div>

                                        {/* MAX */}
                                        <div className="text-right">
                                            <span className={`text-[12px] font-semibold tabular-nums ${
                                                row.is_dead_stock ? 'text-slate-200' : 'text-slate-500'
                                            }`}>
                                                {maxFmt}
                                            </span>
                                        </div>

                                        {/* Alert badge */}
                                        <div className="flex justify-center">
                                            <span className={`inline-flex items-center gap-1 text-[9px] font-black px-2 py-1 rounded-full border ${alert.bg}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${alert.dot}`} />
                                                {alert.label}
                                            </span>
                                        </div>

                                        {/* Ventas 6m + edit */}
                                        <div className="flex items-center justify-end gap-1.5">
                                            <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                                                {Number(row.units_sold_6m || 0).toLocaleString()}
                                            </span>
                                            {!row.is_dead_stock && (
                                                <button
                                                    onClick={() => setEditingRow(row)}
                                                    title="Ajuste manual"
                                                    className="w-6 h-6 flex items-center justify-center rounded-full text-slate-300 hover:text-[#0052CC] hover:bg-blue-50 transition-colors">
                                                    <Edit3 size={11} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Footer */}
                    {!loading && filtered.length > 0 && (
                        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                            <span>{filtered.length.toLocaleString()} productos</span>
                            <span>
                                {filterAlert !== 'all' || filterAbc !== 'all' || searchTerm
                                    ? `filtrado de ${data.length.toLocaleString()}`
                                    : `${ERP_NAMES[selectedErp]}`}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ── Manual override modal ── */}
            {editingRow && createPortal(
                <OverrideModal
                    row={editingRow}
                    onSave={handleOverrideSave}
                    onClose={() => setEditingRow(null)}
                />,
                document.body
            )}
        </div>
    );
}
