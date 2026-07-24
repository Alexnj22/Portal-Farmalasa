import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { Loader2, Package, X, AlertTriangle, ArrowRight } from 'lucide-react';
import { tokenMatch } from '../../utils/searchUtils';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { ERP_NAMES as ERP_NAMES_FULL, ERP_ORDER } from './tabminmax/constants';

const ERP_SHORT = { 1: 'S.1', 2: 'S.2', 3: 'S.3', 4: 'S.4', 5: 'LaP.', 6: 'Bod.', 7: 'S.5' };

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

const COLS = [
    { key: 'product_name', label: 'Producto', align: 'left', sortable: true },
    ...ERP_ORDER.map(id => ({ key: String(id), label: ERP_SHORT[id], align: 'center' })),
];

function NetCell({ b }) {
    if (!b) return <div className="text-content-3 text-[10px] text-center">—</div>;
    const dot   = ALERT_DOT[b.alr] ?? 'bg-content-3';
    const pedir = (b.alr === 'out_of_stock' || b.alr === 'below_min') && b.max > 0
        ? Math.max(0, b.max - b.stk) : null;
    return (
        <div className="flex flex-col items-center justify-center gap-0">
            <div className="flex items-center gap-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <span className={`text-[11px] font-bold tabular-nums ml-0.5 ${
                    b.stk === 0 ? 'text-danger' : b.alr === 'below_min' ? 'text-orange-600' : 'text-content-2'
                }`}>{b.stk.toLocaleString()}</span>
            </div>
            {pedir !== null && (
                <span className="text-[8px] font-semibold text-danger tabular-nums">P:{pedir.toLocaleString()}</span>
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
    const [sortKey,     setSortKey]     = useState('product_name');
    const [sortDir,     setSortDir]     = useState('asc');
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(25);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                // Patrón C (mejora M2): 1 sola llamada agregada a JSON en vez de
                // ~5 chunks de .range() — PostgREST re-ejecutaba la función COMPLETA
                // por cada chunk (limit/offset aplica sobre el resultado, no la fuente).
                const { data, error: e } = await supabase.rpc('get_network_summary_json');
                if (e) throw e;
                if (!cancelled) setData(data || []);
            } catch (e) {
                if (!cancelled) setError(e.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const alertCounts = useMemo(() => {
        const c = { out_of_stock: 0, below_min: 0, approaching: 0, overstocked: 0 };
        for (const row of data)
            for (const b of Object.values(row.branches || {}))
                if (c[b.alr] !== undefined) c[b.alr]++;
        return c;
    }, [data]);

    const filtered = useMemo(() => {
        return data.filter(r => {
            if (!showAll && r.alert_severity === 0) return false;
            if (filterAbc !== 'all' && r.abc_class !== filterAbc) return false;
            if (filterAlert !== 'all') {
                const bs = Object.values(r.branches || {});
                if (!bs.some(b => b.alr === filterAlert)) return false;
            }
            if (searchTerm.trim() && !tokenMatch(searchTerm, r.product_name)) return false;
            return true;
        });
    }, [data, showAll, filterAbc, filterAlert, searchTerm]);

    const sorted = useMemo(() => {
        if (sortKey !== 'product_name') return filtered;
        return [...filtered].sort((a, b) =>
            sortDir === 'asc'
                ? (a.product_name || '').localeCompare(b.product_name || '', 'es')
                : (b.product_name || '').localeCompare(a.product_name || '', 'es')
        );
    }, [filtered, sortKey, sortDir]);

    const handleSort = useCallback((key) => {
        setSortKey(prev => {
            if (prev === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir('asc');
            return key;
        });
        setPage(1);
    }, []);

    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const pageRows   = sorted.slice((page - 1) * pageSize, page * pageSize);
    useEffect(() => { setPage(1); }, [filterAbc, filterAlert, showAll, searchTerm, sortKey, sortDir]);

    const transferOps = useMemo(() => {
        const ops = [];
        for (const row of data) {
            const bs = row.branches || {};
            const needers = Object.entries(bs)
                .filter(([, b]) => b.alr === 'out_of_stock' || b.alr === 'below_min')
                .map(([id, b]) => ({ id: Number(id), pedir: b.max > 0 ? Math.max(0, b.max - b.stk) : 0 }))
                .filter(n => n.pedir > 0);
            const suppliers = Object.entries(bs)
                .filter(([id, b]) => b.alr === 'overstocked' && Number(id) !== 6)
                .map(([id, b]) => ({ id: Number(id), excess: b.stk - b.max }))
                .filter(s => s.excess > 0);
            if (needers.length > 0 && suppliers.length > 0) {
                const totalPedir = needers.reduce((s, n) => s + n.pedir, 0);
                const totalExcess = suppliers.reduce((s, sup) => s + sup.excess, 0);
                ops.push({ ...row, needers, suppliers, totalPedir, totalExcess });
            }
        }
        return ops.sort((a, b) => b.totalPedir - a.totalPedir).slice(0, 15);
    }, [data]);

    const isDirty = filterAbc !== 'all' || filterAlert !== 'all';

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Oportunidades de traslado ── */}
            {!loading && transferOps.length > 0 && (
                <div className="rounded-2xl border border-warning/60 bg-warning/50 backdrop-blur-sm p-4 flex flex-col gap-3"
                    style={{ boxShadow: '0 4px 20px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)' }}>
                    <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase tracking-widest text-warning">Oportunidades de traslado</span>
                        <span className="text-[9px] text-warning font-semibold">— {transferOps.length} producto{transferOps.length !== 1 ? 's' : ''} con exceso disponible</span>
                    </div>
                    <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                        {transferOps.map(item => (
                            <div key={item.erp_product_id} className="flex items-center gap-2 text-[11px] min-w-0">
                                <span className="font-medium text-content-2 flex-1 truncate min-w-0 leading-tight">{item.product_name}</span>
                                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                    {item.suppliers.map(s => (
                                        <span key={s.id} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-black tabular-nums">
                                            {ERP_SHORT[s.id]} +{s.excess}
                                        </span>
                                    ))}
                                    <ArrowRight size={10} className="text-content-3 shrink-0" />
                                    {item.needers.map(n => (
                                        <span key={n.id} className="px-1.5 py-0.5 bg-danger/10 text-red-700 rounded text-[9px] font-black tabular-nums">
                                            {ERP_SHORT[n.id]} -{n.pedir}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Filter pill + actions ── */}
            <div className="flex items-center gap-2.5 flex-wrap">

                {/* Filter pill: ABC | Alert | Clear */}
                <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-surface-card backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0">
                    {/* ABC */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5">
                        {['all','A','B','C','D'].map(cls => (
                            <button key={cls} onClick={() => { setFilterAbc(cls); setPage(1); }}
                                className={`px-2.5 py-1 rounded-[10px] text-[11px] font-black transition-all duration-150 ${filterAbc === cls ? 'bg-brand text-white shadow-sm' : 'text-content-3 hover:text-content-2'}`}>
                                {cls === 'all' ? 'ABC' : cls}
                            </button>
                        ))}
                    </div>

                    <div className="h-5 w-px bg-surface-card-hover shrink-0" />

                    {/* Alert */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5">
                        {(['all', ...Object.keys(ALERT_LABELS)]).map(key => {
                            const cnt = key === 'all' ? null : (alertCounts[key] || 0);
                            if (cnt === 0) return null;
                            return (
                                <button key={key} onClick={() => { setFilterAlert(key); setPage(1); }}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-[10px] text-[11px] font-black transition-all ${filterAlert === key ? 'bg-brand text-white shadow-sm' : 'text-content-3 hover:text-content-2'}`}>
                                    {key !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${ALERT_DOT[key]}`} />}
                                    {key === 'all' ? 'Todos' : ALERT_LABELS[key]}
                                    {cnt !== null && <span className="tabular-nums">{cnt}</span>}
                                </button>
                            );
                        })}
                    </div>

                    {isDirty && (
                        <>
                            <div className="h-5 w-px bg-surface-card-hover shrink-0" />
                            <button onClick={() => { setFilterAbc('all'); setFilterAlert('all'); setPage(1); }}
                                className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-danger/10 hover:bg-red-500 text-danger hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                                <X size={11} strokeWidth={3} />
                            </button>
                        </>
                    )}
                </div>

                <div className="flex-1" />

                {!loading && (
                    <span className="text-[11px] text-content-3">
                        <strong className="text-content-2">{sorted.length.toLocaleString()}</strong>
                        {!showAll && <span> de {data.length.toLocaleString()}</span>} productos
                    </span>
                )}

                <button onClick={() => { setShowAll(s => !s); setPage(1); }}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all ${
                        showAll ? 'bg-slate-800 text-white border-slate-800' : 'bg-surface-card border-slate-200 text-content-3 hover:border-slate-300'
                    }`}>
                    {showAll ? 'Solo alertas' : 'Ver todos'}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-[12px] text-danger font-semibold">
                    <AlertTriangle size={14} /> {error}
                </div>
            )}

            {/* ── Tabla ── */}
            <DataTable
                columns={COLS}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loading}
                empty={{
                    icon: Package,
                    message: showAll ? 'Sin productos con parámetros calculados' : 'Sin alertas activas en ninguna sucursal',
                    ...((!showAll) ? { action: { label: 'Ver todos los productos', onClick: () => setShowAll(true) } } : {}),
                }}
                minWidth="700px"
            >
                {pageRows.map((row, i) => {
                    const bs     = row.branches || {};
                    const maxSev = Math.max(...Object.values(bs).map(b => SEVERITY[b.alr] ?? 0), 0);
                    const rowTint = maxSev >= 4 ? 'bg-danger/40' : maxSev >= 3 ? 'bg-orange-50/30' : '';
                    return (
                        <DataRow key={row.erp_product_id} index={i} className={rowTint}>
                            <DataCell align="left" className="!py-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {row.abc_class && (
                                        <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                            row.abc_class === 'A' ? 'bg-success/10 text-emerald-700 border-success/30' :
                                            row.abc_class === 'B' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                            row.abc_class === 'C' ? 'bg-warning/10 text-amber-700 border-warning/30' :
                                                                    'bg-surface-card-hover text-content-3 border-slate-200'
                                        }`}>{row.abc_class}</span>
                                    )}
                                    <span className="text-[12px] font-medium text-content truncate">{row.product_name}</span>
                                </div>
                            </DataCell>
                            {ERP_ORDER.map(id => (
                                <DataCell key={id} align="center" className="!py-2">
                                    <NetCell b={bs[String(id)]} />
                                </DataCell>
                            ))}
                        </DataRow>
                    );
                })}
            </DataTable>

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
        </div>
    );
}
