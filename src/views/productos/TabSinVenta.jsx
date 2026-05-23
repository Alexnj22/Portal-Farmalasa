import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Loader2, Building2, Package, AlertTriangle, X, DollarSign } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const SUC_COLORS = {
    1: 'bg-blue-50 text-blue-700 border-blue-200',
    2: 'bg-violet-50 text-violet-700 border-violet-200',
    3: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    4: 'bg-amber-50 text-amber-700 border-amber-200',
    5: 'bg-rose-50 text-rose-700 border-rose-200',
    7: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    6: 'bg-slate-50 text-slate-600 border-slate-200',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1000)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabSinVenta({ searchTerm = '' }) {
    const [selectedErp, setSelectedErp] = useState(5);
    const [filterMode,  setFilterMode]  = useState('con_stock');
    const [data,        setData]        = useState([]);
    const [loading,     setLoading]     = useState(false);
    const [error,       setError]       = useState(null);
    const loadRef = useRef(0);

    const loadData = useCallback(async (erpId) => {
        const rid = ++loadRef.current;
        setLoading(true); setError(null);
        try {
            const { data: rows, error: e } = await supabase
                .rpc('get_no_sales_products', { p_erp_sucursal_id: erpId })
                .range(0, 9999);
            if (e) throw e;
            if (rid !== loadRef.current) return;
            setData(rows || []);
        } catch (e) {
            if (rid === loadRef.current) setError(e.message);
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(selectedErp); }, [selectedErp, loadData]);

    // ── Derived ──────────────────────────────────────────────────────────────
    const counts = useMemo(() => ({
        total:         data.length,
        con_stock:     data.filter(r => Number(r.current_stock) > 0).length,
        otras_suc:     data.filter(r => (r.sold_in || []).length > 0).length,
        sin_historial: data.filter(r => (r.sold_in || []).length === 0).length,
    }), [data]);

    // total cost only for rows with stock (rows without stock have cost_value = 0)
    const totalRetainedCost = useMemo(() =>
        data.reduce((acc, r) => acc + Number(r.cost_value || 0), 0)
    , [data]);

    const filtered = useMemo(() => {
        let rows = data;
        if      (filterMode === 'con_stock')     rows = rows.filter(r => Number(r.current_stock) > 0);
        else if (filterMode === 'otras_suc')     rows = rows.filter(r => (r.sold_in || []).length > 0);
        else if (filterMode === 'sin_historial') rows = rows.filter(r => (r.sold_in || []).length === 0);
        const q = searchTerm.toLowerCase();
        if (q) rows = rows.filter(r => r.product_name?.toLowerCase().includes(q));
        return rows;
    }, [data, filterMode, searchTerm]);

    const filteredCost = useMemo(() =>
        filtered.reduce((acc, r) => acc + Number(r.cost_value || 0), 0)
    , [filtered]);

    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    const FILTERS = [
        { key: 'con_stock',     label: 'Con inventario',   count: counts.con_stock,
          active: 'bg-orange-50 border-orange-300 text-orange-700', dot: 'bg-orange-400' },
        { key: 'otras_suc',     label: 'Vendido en otras', count: counts.otras_suc,
          active: 'bg-blue-50 border-blue-300 text-blue-700',       dot: 'bg-blue-400'   },
        { key: 'sin_historial', label: 'Sin historial',    count: counts.sin_historial,
          active: 'bg-slate-100 border-slate-300 text-slate-600',   dot: 'bg-slate-400'  },
        { key: 'todos',         label: 'Todos',            count: counts.total,
          active: 'bg-white border-slate-300 text-slate-700',       dot: 'bg-slate-300'  },
    ];

    const COLS = '1fr 110px 120px 1fr';

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Top bar ── */}
            <div className="flex items-center gap-2.5 flex-wrap">
                <div className="overflow-visible" style={{ width: '175px' }}>
                    <LiquidSelect
                        value={String(selectedErp)}
                        onChange={v => { if (v) { setSelectedErp(Number(v)); setFilterMode('con_stock'); } }}
                        options={erpOptions} icon={Building2} clearable={false} compact
                    />
                </div>
            </div>

            {/* ── Filter chips ── */}
            <div className="flex items-center gap-2 flex-wrap">
                {FILTERS.map(f => {
                    const active = filterMode === f.key;
                    return (
                        <button key={f.key} onClick={() => setFilterMode(f.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                                active ? `${f.active} shadow-sm` : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                            }`}>
                            <span className={`w-2 h-2 rounded-full shrink-0 ${f.dot}`} />
                            <span className={`tabular-nums font-black ${active ? '' : 'text-slate-700'}`}>
                                {loading ? '–' : f.count.toLocaleString()}
                            </span>
                            <span className="opacity-80">{f.label}</span>
                            {active && <X size={9} className="ml-0.5 opacity-60" />}
                        </button>
                    );
                })}
            </div>

            {/* ── Cost summary banner ── */}
            {!loading && totalRetainedCost > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-orange-50 border border-orange-200">
                    <DollarSign size={14} className="text-orange-400 shrink-0" />
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-[20px] font-black text-orange-700 tabular-nums">
                            {fmtMoney(totalRetainedCost)}
                        </span>
                        <span className="text-[11px] text-orange-500 font-semibold">
                            retenidos en inventario sin mover en {ERP_NAMES[selectedErp]}
                        </span>
                    </div>
                    {filterMode !== 'todos' && filteredCost !== totalRetainedCost && filteredCost > 0 && (
                        <span className="ml-auto text-[10px] text-orange-400 font-semibold shrink-0">
                            {fmtMoney(filteredCost)} en filtro actual
                        </span>
                    )}
                </div>
            )}

            {/* ── Context note ── */}
            {!loading && counts.total > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-400">
                    <Package size={10} className="shrink-0 text-slate-300" />
                    Productos sin ninguna venta en <span className="text-slate-500 font-bold mx-1">{ERP_NAMES[selectedErp]}</span>
                    en los últimos 6 meses ·
                    <span className="text-orange-600 font-bold ml-1">{counts.con_stock}</span> con inventario retenido ·
                    <span className="text-blue-600 font-bold ml-1">{counts.otras_suc}</span> vendidos en otras sucursales
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
                    <AlertTriangle size={14} /> {error}
                    <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
                </div>
            )}

            {/* ── Table ── */}
            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">

                {/* Header */}
                <div className="grid text-[9px] font-black uppercase tracking-widest text-slate-400 pl-5 pr-4 py-2.5 border-b border-slate-100 bg-slate-50/80"
                    style={{ gridTemplateColumns: COLS }}>
                    <span>Producto</span>
                    <span className="text-right">Stock aquí</span>
                    <span className="text-right pr-4">Costo retenido</span>
                    <span className="pl-4">Vendido en (últimos 6m)</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center gap-2.5 py-24 text-slate-400">
                        <Loader2 size={20} className="animate-spin" />
                        <span className="text-[13px]">Cargando productos sin venta en {ERP_NAMES[selectedErp]}…</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <Package size={30} className="opacity-15 mx-auto mb-3 text-slate-400" />
                        <p className="text-[13px] text-slate-400 font-medium">
                            {data.length === 0
                                ? `¡Todos los productos tienen ventas en ${ERP_NAMES[selectedErp]}!`
                                : 'Sin productos con ese filtro'}
                        </p>
                        {data.length > 0 && filterMode !== 'todos' && (
                            <button onClick={() => setFilterMode('todos')}
                                className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">
                                Ver todos
                            </button>
                        )}
                    </div>
                ) : (
                    <div>
                        {filtered.map((row) => {
                            const stock      = Number(row.current_stock);
                            const cost       = Number(row.cost_value || 0);
                            const soldIn     = row.sold_in || [];
                            const hasStock   = stock > 0;
                            const noHistory  = soldIn.length === 0;

                            return (
                                <div key={row.erp_product_id}
                                    className={`grid items-center pl-5 pr-4 py-2.5 border-b border-slate-50 transition-colors ${
                                        hasStock
                                            ? 'bg-orange-50/30 border-l-2 border-l-orange-300'
                                            : 'border-l-2 border-l-transparent'
                                    }`}
                                    style={{ gridTemplateColumns: COLS }}>

                                    {/* Product */}
                                    <div className="min-w-0 pr-4">
                                        <span className="text-[13px] font-medium text-slate-800 block truncate leading-tight">
                                            {row.product_name || '—'}
                                        </span>
                                    </div>

                                    {/* Stock aquí */}
                                    <div className="text-right">
                                        {hasStock ? (
                                            <>
                                                <span className="text-[13px] font-bold text-orange-600 tabular-nums">
                                                    {stock.toLocaleString()}
                                                </span>
                                                <span className="text-[10px] text-orange-400 ml-1">und</span>
                                            </>
                                        ) : (
                                            <span className="text-[11px] text-slate-200">—</span>
                                        )}
                                    </div>

                                    {/* Costo retenido */}
                                    <div className="text-right pr-4">
                                        {cost > 0 ? (
                                            <span className="text-[12px] font-bold text-orange-700 tabular-nums">
                                                {fmtMoney(cost)}
                                            </span>
                                        ) : (
                                            <span className="text-[11px] text-slate-200">—</span>
                                        )}
                                    </div>

                                    {/* Vendido en */}
                                    <div className="pl-4 flex items-center gap-1.5 flex-wrap">
                                        {noHistory ? (
                                            <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full italic">
                                                Sin historial
                                            </span>
                                        ) : soldIn.map(s => (
                                            <span key={s.esid}
                                                title={`$${Number(s.rev).toLocaleString('en-US', { maximumFractionDigits: 0 })} en ingresos`}
                                                className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-default ${SUC_COLORS[s.esid] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                                {ERP_NAMES[s.esid] || `Suc.${s.esid}`}
                                                <span className="opacity-50 font-normal">·</span>
                                                <span className="tabular-nums opacity-80">
                                                    {Number(s.units).toLocaleString()}
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Footer */}
                {!loading && filtered.length > 0 && (
                    <div className="pl-5 pr-4 py-2.5 border-t border-slate-100 bg-slate-50/60 text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                        <span>{filtered.length.toLocaleString()} productos</span>
                        <span className="text-slate-500 font-bold">
                            {filteredCost > 0 ? fmtMoney(filteredCost) : ''}
                            {filterMode !== 'todos' && <span className="text-slate-300 font-normal ml-2">de {data.length.toLocaleString()} total · {fmtMoney(totalRetainedCost)}</span>}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
