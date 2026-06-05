import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { Loader2, Package, X, AlertTriangle } from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';

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

const COLS = [
    { key: 'product_name', label: 'Producto', align: 'left', sortable: true },
    ...ERP_ORDER.map(id => ({ key: String(id), label: ERP_SHORT[id], align: 'center' })),
];

function NetCell({ b }) {
    if (!b) return <div className="text-slate-200 text-[10px] text-center">—</div>;
    const dot   = ALERT_DOT[b.alr] ?? 'bg-slate-300';
    const pedir = (b.alr === 'out_of_stock' || b.alr === 'below_min') && b.max > 0
        ? Math.max(0, b.max - b.stk) : null;
    return (
        <div className="flex flex-col items-center justify-center gap-0">
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
    const [sortKey,     setSortKey]     = useState('product_name');
    const [sortDir,     setSortDir]     = useState('asc');
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(25);

    useEffect(() => {
        let cancelled = false;
        setLoading(true); setError(null);
        (async () => {
            try {
                const allRows = [];
                const CHUNK = 1000;
                let from = 0;
                let keepFetching = true;
                while (keepFetching) {
                    const { data: chunk, error: e } = await supabase
                        .rpc('get_network_summary')
                        .range(from, from + CHUNK - 1);
                    if (e) throw e;
                    allRows.push(...(chunk || []));
                    keepFetching = chunk && chunk.length === CHUNK;
                    from += CHUNK;
                }
                if (!cancelled) setData(allRows);
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

    const isDirty = filterAbc !== 'all' || filterAlert !== 'all';

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Filter pill + actions ── */}
            <div className="flex items-center gap-2.5 flex-wrap">

                {/* Filter pill: ABC | Alert | Clear */}
                <div className="flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0">
                    {/* ABC */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5">
                        {['all','A','B','C','D'].map(cls => (
                            <button key={cls} onClick={() => { setFilterAbc(cls); setPage(1); }}
                                className={`px-2.5 py-1 rounded-[10px] text-[11px] font-black transition-all duration-150 ${filterAbc === cls ? 'bg-[#0052CC] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                                {cls === 'all' ? 'ABC' : cls}
                            </button>
                        ))}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Alert */}
                    <div className="flex items-center gap-0.5 px-2 py-1.5">
                        {(['all', ...Object.keys(ALERT_LABELS)]).map(key => {
                            const cnt = key === 'all' ? null : (alertCounts[key] || 0);
                            if (cnt === 0) return null;
                            return (
                                <button key={key} onClick={() => { setFilterAlert(key); setPage(1); }}
                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-[10px] text-[11px] font-black transition-all ${filterAlert === key ? 'bg-[#0052CC] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                                    {key !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${ALERT_DOT[key]}`} />}
                                    {key === 'all' ? 'Todos' : ALERT_LABELS[key]}
                                    {cnt !== null && <span className="tabular-nums">{cnt}</span>}
                                </button>
                            );
                        })}
                    </div>

                    {isDirty && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button onClick={() => { setFilterAbc('all'); setFilterAlert('all'); setPage(1); }}
                                className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                                <X size={11} strokeWidth={3} />
                            </button>
                        </>
                    )}
                </div>

                <div className="flex-1" />

                {!loading && (
                    <span className="text-[11px] text-slate-400">
                        <strong className="text-slate-600">{sorted.length.toLocaleString()}</strong>
                        {!showAll && <span> de {data.length.toLocaleString()}</span>} productos
                    </span>
                )}

                <button onClick={() => { setShowAll(s => !s); setPage(1); }}
                    className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border transition-all ${
                        showAll ? 'bg-slate-800 text-white border-slate-800' : 'bg-white/80 border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}>
                    {showAll ? 'Solo alertas' : 'Ver todos'}
                </button>
            </div>

            {error && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-600 font-semibold">
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
                    const rowTint = maxSev >= 4 ? 'bg-red-50/40 border-l-4 border-l-red-400' : maxSev >= 3 ? 'bg-orange-50/30 border-l-4 border-l-orange-400' : '';
                    return (
                        <DataRow key={row.erp_product_id} index={i} className={rowTint}>
                            <DataCell align="left" className="!py-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    {row.abc_class && (
                                        <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded-md border ${
                                            row.abc_class === 'A' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                            row.abc_class === 'B' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                            row.abc_class === 'C' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                                    'bg-slate-50 text-slate-400 border-slate-200'
                                        }`}>{row.abc_class}</span>
                                    )}
                                    <span className="text-[12px] font-medium text-slate-800 truncate">{row.product_name}</span>
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
