import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth }         from '../../context/AuthContext';
import { supabase }        from '../../supabaseClient';
import { DataTable, DataCell } from '../../components/common/DataTable';
import TablePagination     from '../../components/common/TablePagination';
import LiquidSelect        from '../../components/common/LiquidSelect';

const normXyz = v => (v === 'X' || v === 'Y' || v === 'Z') ? v : 'Z';

function DeltaCell({ portal, erp }) {
    if (portal == null || erp == null)
        return <span className="text-slate-200 text-[11px]">—</span>;
    const d = portal - erp;
    if (d === 0)
        return <span className="text-[11px] font-bold font-mono text-slate-400">=</span>;
    return (
        <span className={`text-[11px] font-bold font-mono tabular-nums ${d > 0 ? 'text-blue-600' : 'text-red-500'}`}>
            {d > 0 ? '+' : ''}{d.toLocaleString()}
        </span>
    );
}

const COLS = [
    { key: 'product_name',  label: 'Producto',    align: 'left',   sortable: true },
    { key: 'laboratorio',   label: 'Laboratorio', align: 'left',   sortable: true },
    { key: 'clase',         label: 'Clase',       align: 'center', sortable: true },
    { key: 'portal_min',    label: 'MIN Portal',  align: 'center', sortable: true },
    { key: 'erp_min',       label: 'MIN ERP',     align: 'center', sortable: true },
    { key: 'delta_min',     label: 'Δ MIN',       align: 'center', sortable: true },
    { key: 'portal_max',    label: 'MAX Portal',  align: 'center', sortable: true },
    { key: 'erp_max',       label: 'MAX ERP',     align: 'center', sortable: true },
    { key: 'delta_max',     label: 'Δ MAX',       align: 'center', sortable: true },
];

const FILTER_OPTS = [
    { key: 'all',    label: 'Todos' },
    { key: 'diff',   label: 'Diferencias' },
    { key: 'higher', label: 'Portal > ERP' },
    { key: 'lower',  label: 'Portal < ERP' },
    { key: 'equal',  label: 'Iguales' },
];

export default function TabMinMaxComparacion({ searchTerm = '' }) {
    const { branches } = useAuth();

    const branchOptions = useMemo(() =>
        (branches || [])
            .filter(b => b.erp_sucursal_id && b.erp_sucursal_id !== 6)
            .map(b => ({ value: String(b.erp_sucursal_id), label: b.name })),
        [branches]
    );

    const [selectedErp,  setSelectedErp]  = useState(null);
    const [mode,         setMode]         = useState('draft');   // 'draft' | 'published'
    const [filterMode,   setFilterMode]   = useState('all');
    const [data,         setData]         = useState([]);
    const [loading,      setLoading]      = useState(false);
    const [page,         setPage]         = useState(1);
    const [pageSize,     setPageSize]     = useState(50);
    const [sortField,    setSortField]    = useState('delta_max');
    const [sortDir,      setSortDir]      = useState('desc');

    useEffect(() => {
        if (!selectedErp && branchOptions.length > 0)
            setSelectedErp(Number(branchOptions[0].value));
    }, [branchOptions, selectedErp]);

    const load = useCallback(async () => {
        if (!selectedErp) return;
        setLoading(true);
        const { data: rows } = await supabase.rpc('get_minmax_comparison', {
            p_erp_sucursal_id: selectedErp,
        });
        setData(rows || []);
        setLoading(false);
    }, [selectedErp]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [searchTerm, filterMode, mode, selectedErp]);

    const pMin = r => mode === 'draft' ? r.draft_min : r.pub_min;
    const pMax = r => mode === 'draft' ? r.draft_max : r.pub_max;
    const dMin = r => { const p = pMin(r); return p != null && r.erp_min != null ? p - r.erp_min : null; };
    const dMax = r => { const p = pMax(r); return p != null && r.erp_max != null ? p - r.erp_max : null; };

    const filtered = useMemo(() => {
        let rows = data;

        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter(r =>
                (r.product_name || '').toLowerCase().includes(q) ||
                (r.laboratorio  || '').toLowerCase().includes(q)
            );
        }

        if (filterMode !== 'all') {
            rows = rows.filter(r => {
                const dm = dMin(r), dx = dMax(r);
                if (filterMode === 'diff')   return dm !== 0 || dx !== 0;
                if (filterMode === 'higher') return (dm != null && dm > 0) || (dx != null && dx > 0);
                if (filterMode === 'lower')  return (dm != null && dm < 0) || (dx != null && dx < 0);
                if (filterMode === 'equal')  return dm === 0 && dx === 0;
                return true;
            });
        }

        return [...rows].sort((a, b) => {
            let av, bv;
            if      (sortField === 'product_name')  { av = a.product_name || ''; bv = b.product_name || ''; }
            else if (sortField === 'laboratorio')   { av = a.laboratorio  || ''; bv = b.laboratorio  || ''; }
            else if (sortField === 'clase') {
                av = (a.abc_class || '') + normXyz(a.demand_variability);
                bv = (b.abc_class || '') + normXyz(b.demand_variability);
            }
            else if (sortField === 'portal_min')  { av = pMin(a) ?? -1; bv = pMin(b) ?? -1; }
            else if (sortField === 'portal_max')  { av = pMax(a) ?? -1; bv = pMax(b) ?? -1; }
            else if (sortField === 'erp_min')     { av = a.erp_min ?? -1; bv = b.erp_min ?? -1; }
            else if (sortField === 'erp_max')     { av = a.erp_max ?? -1; bv = b.erp_max ?? -1; }
            else if (sortField === 'delta_min')   { av = dMin(a) ?? -Infinity; bv = dMin(b) ?? -Infinity; }
            else if (sortField === 'delta_max')   { av = dMax(a) ?? -Infinity; bv = dMax(b) ?? -Infinity; }
            else                                  { av = 0; bv = 0; }
            const cmp = typeof av === 'string' ? av.localeCompare(bv, 'es') : (av - bv);
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [data, searchTerm, filterMode, mode, sortField, sortDir]);

    // Counts for filter chips (over full filtered-by-search set, ignoring current filterMode)
    const counts = useMemo(() => {
        let base = data;
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            base = base.filter(r =>
                (r.product_name || '').toLowerCase().includes(q) ||
                (r.laboratorio  || '').toLowerCase().includes(q)
            );
        }
        let diff = 0, higher = 0, lower = 0, equal = 0;
        for (const r of base) {
            const dm = dMin(r), dx = dMax(r);
            const hasDiff = (dm != null && dm !== 0) || (dx != null && dx !== 0);
            if (hasDiff) diff++;
            if ((dm != null && dm > 0) || (dx != null && dx > 0)) higher++;
            if ((dm != null && dm < 0) || (dx != null && dx < 0)) lower++;
            if (dm === 0 && dx === 0) equal++;
        }
        return { all: base.length, diff, higher, lower, equal };
    }, [data, searchTerm, mode]);

    const handleSort = key => {
        if (sortField === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(key); setSortDir('desc'); }
        setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paged      = filtered.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="flex flex-col gap-4 px-4 pt-4 pb-2">
            {/* ── Controls ──────────────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">

                {/* Sucursal */}
                <div className="inline-flex items-center rounded-2xl bg-white/80 border border-slate-200/70 px-3 py-1.5 shadow-sm">
                    <LiquidSelect
                        options={branchOptions}
                        value={selectedErp != null ? String(selectedErp) : ''}
                        onChange={v => v && setSelectedErp(Number(v))}
                        placeholder="Sucursal..."
                    />
                </div>

                {/* Borrador / Publicado */}
                <div className="inline-flex rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm overflow-hidden">
                    {[{ key: 'draft', label: 'Borrador' }, { key: 'published', label: 'Publicado' }].map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => { setMode(key); setPage(1); }}
                            className={`px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-150 ${
                                mode === key
                                    ? 'bg-[#0052CC] text-white'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Filtros */}
                <div className="inline-flex items-center rounded-2xl bg-white/80 border border-slate-200/70 px-3 py-1.5 gap-1.5 shadow-sm">
                    {FILTER_OPTS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => { setFilterMode(key); setPage(1); }}
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg transition-all duration-150 ${
                                filterMode === key
                                    ? 'bg-[#0052CC]/10 text-[#0052CC]'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            {label}
                            {' '}
                            <span className="opacity-60">
                                ({counts[key] ?? 0})
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Tabla ─────────────────────────────────────────────────────── */}
            <DataTable
                cols={COLS}
                sortField={sortField}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loading}
                empty={!loading && filtered.length === 0}
                minWidth="880px"
            >
                {paged.map(r => {
                    const portalMin = pMin(r);
                    const portalMax = pMax(r);
                    const deltaMin  = dMin(r);
                    const deltaMax  = dMax(r);
                    const abc = r.abc_class || '—';
                    const xyz = normXyz(r.demand_variability);
                    return (
                        <tr key={r.erp_product_id} className="group hover:bg-white/40 transition-colors duration-100">
                            <DataCell align="left" className="!py-2.5">
                                <span className="text-[13px] font-semibold text-slate-700 leading-tight">{r.product_name}</span>
                            </DataCell>
                            <DataCell align="left" className="!py-2.5">
                                <span className="text-[11px] text-slate-400">{r.laboratorio || '—'}</span>
                            </DataCell>
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[11px] font-black text-slate-600 tracking-wide">{abc}{xyz}</span>
                            </DataCell>

                            {/* MIN Portal */}
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] font-bold tabular-nums text-amber-700">
                                    {portalMin != null ? portalMin.toLocaleString() : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            {/* MIN ERP */}
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] tabular-nums text-slate-500">
                                    {r.erp_min != null ? r.erp_min.toLocaleString() : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            {/* Δ MIN */}
                            <DataCell align="center" className="!py-2.5">
                                <DeltaCell portal={portalMin} erp={r.erp_min} />
                            </DataCell>

                            {/* MAX Portal */}
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] font-bold tabular-nums text-blue-700">
                                    {portalMax != null ? portalMax.toLocaleString() : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            {/* MAX ERP */}
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] tabular-nums text-slate-500">
                                    {r.erp_max != null ? r.erp_max.toLocaleString() : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            {/* Δ MAX */}
                            <DataCell align="center" className="!py-2.5">
                                <DeltaCell portal={portalMax} erp={r.erp_max} />
                            </DataCell>
                        </tr>
                    );
                })}
            </DataTable>

            <TablePagination
                page={page}
                totalPages={totalPages}
                pageSize={pageSize}
                totalRows={filtered.length}
                onPage={setPage}
                onPageSize={sz => { setPageSize(sz); setPage(1); }}
            />
        </div>
    );
}
