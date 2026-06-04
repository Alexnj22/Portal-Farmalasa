import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { Loader2, Package, X, AlertTriangle } from 'lucide-react';

const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];
const ERP_SHORT = { 1: 'S.1', 2: 'S.2', 3: 'S.3', 4: 'S.4', 5: 'LaP.', 6: 'Bod.', 7: 'S.5' };
const ERP_NAMES_FULL = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };

const ALERT_DOT = {
    out_of_stock: 'bg-red-500',
    below_min:    'bg-orange-500',
    approaching:  'bg-amber-400',
    ok:           'bg-emerald-500',
    overstocked:  'bg-blue-400',
};
const ALERT_LABELS = {
    out_of_stock: 'Sin stock',
    below_min:    'Bajo MIN',
    approaching:  'Próx. MIN',
    ok:           'OK',
    overstocked:  'Exceso',
};
const SEVERITY = { out_of_stock: 4, below_min: 3, approaching: 1, overstocked: 1, ok: 0 };

function NetCell({ b }) {
    if (!b) return <div className="h-full flex items-center justify-center text-slate-200 text-[10px]">—</div>;
    const dot   = ALERT_DOT[b.alr] ?? 'bg-slate-300';
    const pedir = (b.alr === 'out_of_stock' || b.alr === 'below_min') && b.max > 0
        ? Math.max(0, b.max - b.stk) : null;
    return (
        <div className="flex flex-col items-center justify-center gap-0 py-2">
            <div className="flex items-center gap-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <span className={`text-[11px] font-bold tabular-nums ml-0.5 ${
                    b.stk === 0 ? 'text-red-500' : b.alr === 'below_min' ? 'text-orange-600' : 'text-slate-700'
                }`}>{b.stk.toLocaleString()}</span>
            </div>
            {pedir !== null && (
                <span className="text-[8px] font-semibold text-red-400 tabular-nums">P:{pedir.toLocaleString()}</span>
            )}
        </div>
    );
}

export default function TabMinMaxNetwork({ searchTerm = '' }) {
    const [data,        setData]        = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [filterAlert, setFilterAlert] = useState('all');
    const [filterAbc,   setFilterAbc]   = useState('all');
    const [showAll,     setShowAll]     = useState(false);
    const [error,       setError]       = useState(null);

    useEffect(() => {
        setLoading(true); setError(null);
        supabase.rpc('get_network_summary').range(0, 9999)
            .then(({ data: rows, error: e }) => {
                if (e) setError(e.message);
                else setData(rows || []);
            })
            .finally(() => setLoading(false));
    }, []);

    const alertCounts = useMemo(() => {
        const c = { out_of_stock: 0, below_min: 0, approaching: 0, overstocked: 0 };
        for (const row of data)
            for (const b of Object.values(row.branches || {}))
                if (c[b.alr] !== undefined) c[b.alr]++;
        return c;
    }, [data]);

    const filtered = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return data.filter(r => {
            if (!showAll && r.alert_severity === 0) return false;
            if (filterAbc !== 'all' && r.abc_class !== filterAbc) return false;
            if (filterAlert !== 'all') {
                const bs = Object.values(r.branches || {});
                if (!bs.some(b => b.alr === filterAlert)) return false;
            }
            if (q && !r.product_name?.toLowerCase().includes(q)) return false;
            return true;
        });
    }, [data, showAll, filterAbc, filterAlert, searchTerm]);

    const glass = 'rounded-2xl border border-white/60 backdrop-blur-sm';
    const glassStyle = { background: 'rgba(255,255,255,0.55)', boxShadow: '0 4px 20px rgba(0,82,204,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' };
    const GRID = '1fr repeat(7, 72px)';

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Controles ── */}
            <div className="flex items-center gap-2.5 flex-wrap">
                {/* ABC */}
                <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80">
                    {['all','A','B','C','D'].map(cls => (
                        <button key={cls} onClick={() => setFilterAbc(cls)}
                            className={`px-2.5 py-1.5 rounded-[10px] text-[11px] font-black transition-all ${filterAbc === cls ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                            {cls === 'all' ? 'ABC' : cls}
                        </button>
                    ))}
                </div>

                {/* Alert chips */}
                {Object.entries(ALERT_LABELS).map(([key, label]) => {
                    const cnt    = alertCounts[key] || 0;
                    const active = filterAlert === key;
                    if (!cnt && !active) return null;
                    return (
                        <button key={key} onClick={() => setFilterAlert(a => a === key ? 'all' : key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                                active ? 'bg-orange-50 border-orange-300 text-orange-700 shadow-sm' : 'bg-white/80 border-slate-200 text-slate-600 hover:border-slate-300 hover:shadow-sm'
                            }`}>
                            <span className={`w-2 h-2 rounded-full ${ALERT_DOT[key]}`} />
                            <span className="tabular-nums font-black">{cnt}</span>
                            <span className="opacity-80">{label}</span>
                            {active && <X size={9} />}
                        </button>
                    );
                })}

                <div className="flex-1" />

                {!loading && (
                    <span className="text-[11px] text-slate-400">
                        <strong className="text-slate-600">{filtered.length.toLocaleString()}</strong>
                        {!showAll && <span> de {data.length.toLocaleString()}</span>} productos
                    </span>
                )}

                <button onClick={() => setShowAll(s => !s)}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all ${
                        showAll ? 'bg-slate-800 text-white border-slate-800' : 'bg-white/80 border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
                    {showAll ? 'Solo alertas' : 'Ver todos'}
                </button>
            </div>

            {/* ── Tabla ── */}
            <div className={`${glass} shadow-sm overflow-x-auto`} style={glassStyle}>

                {/* Header */}
                <div className="grid text-[9px] font-black uppercase tracking-widest text-slate-400 pl-4 pr-3 py-2.5 border-b border-white/60 bg-white/40 min-w-[700px]"
                    style={{ gridTemplateColumns: GRID }}>
                    <span>Producto</span>
                    {ERP_ORDER.map(id => (
                        <span key={id} className="text-center">{ERP_SHORT[id]}</span>
                    ))}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center gap-2.5 py-24 text-slate-400">
                        <Loader2 size={20} className="animate-spin" />
                        <span className="text-[13px]">Cargando red completa…</span>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 py-16 justify-center text-red-500 text-[12px]">
                        <AlertTriangle size={14} />{error}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="py-20 text-center">
                        <Package size={30} className="opacity-15 mx-auto mb-3 text-slate-400" />
                        <p className="text-[13px] text-slate-400 font-medium">
                            {showAll ? 'Sin productos con parámetros calculados' : 'Sin alertas activas en ninguna sucursal'}
                        </p>
                        {!showAll && (
                            <button onClick={() => setShowAll(true)}
                                className="mt-3 text-[11px] text-blue-500 hover:text-blue-700 font-bold">
                                Ver todos los productos
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="min-w-[700px]">
                        {filtered.map(row => {
                            const bs     = row.branches || {};
                            const maxSev = Math.max(...Object.values(bs).map(b => SEVERITY[b.alr] ?? 0), 0);
                            const rowTint = maxSev >= 4 ? 'bg-red-50/30' : maxSev >= 3 ? 'bg-orange-50/20' : '';
                            return (
                                <div key={row.erp_product_id}
                                    className={`grid items-center pl-4 pr-3 border-b border-white/40 transition-colors hover:bg-white/30 ${rowTint}`}
                                    style={{ gridTemplateColumns: GRID }}>
                                    <div className="py-2 pr-2 flex items-center gap-1.5 min-w-0">
                                        {row.abc_class && (
                                            <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                                row.abc_class === 'A' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                row.abc_class === 'B' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                row.abc_class === 'C' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                                        'bg-slate-50 text-slate-400 border-slate-200'
                                            }`}>{row.abc_class}</span>
                                        )}
                                        <span className="text-[12px] font-medium text-slate-800 truncate leading-tight">
                                            {row.product_name}
                                        </span>
                                    </div>
                                    {ERP_ORDER.map(id => (
                                        <NetCell key={id} b={bs[String(id)]} />
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Footer */}
                {!loading && filtered.length > 0 && (
                    <div className="pl-4 pr-3 py-2 border-t border-white/50 bg-white/30 text-[9px] text-slate-400 font-semibold overflow-x-auto min-w-[700px]">
                        <div className="grid" style={{ gridTemplateColumns: GRID }}>
                            <span>{filtered.length.toLocaleString()} productos{!showAll && <span className="text-slate-300 ml-1">(con alertas)</span>}</span>
                            {ERP_ORDER.map(id => (
                                <span key={id} className="text-center text-[8px]">{ERP_NAMES_FULL[id]}</span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
