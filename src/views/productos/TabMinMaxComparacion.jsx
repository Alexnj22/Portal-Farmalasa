import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { GitCompare, Building2 } from 'lucide-react';
import { supabase }              from '../../supabaseClient';
import { DataTable, DataCell }   from '../../components/common/DataTable';
import TablePagination           from '../../components/common/TablePagination';
import LiquidSelect              from '../../components/common/LiquidSelect';

// ── Sucursales (igual que TabMinMax) ──────────────────────────────────────────
const ERP_NAMES = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 7: 'Salud 5' };
const ERP_ORDER = [5, 1, 2, 3, 4, 7];
const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

const normXyz = v => (v === 'X' || v === 'Y' || v === 'Z') ? v : 'Z';
const fmtN    = n  => n == null ? null : Number(n).toLocaleString();

function DeltaCell({ portal, erp }) {
    if (portal == null || erp == null)
        return <span className="text-slate-200 text-[11px]">—</span>;
    const d = Number(portal) - Number(erp);
    if (!isFinite(d))
        return <span className="text-slate-300 text-[11px]">—</span>;
    if (d === 0)
        return <span className="text-[11px] font-bold font-mono text-slate-400">=</span>;
    return (
        <span className={`text-[11px] font-bold font-mono tabular-nums ${d > 0 ? 'text-blue-600' : 'text-red-500'}`}>
            {d > 0 ? '+' : ''}{Number(d).toLocaleString()}
        </span>
    );
}

const COLS = [
    { key: 'product_name', label: 'Producto',    align: 'left',   sortable: true },
    { key: 'laboratorio',  label: 'Laboratorio', align: 'left',   sortable: true },
    { key: 'clase',        label: 'Clase',       align: 'center', sortable: true },
    { key: 'portal_min',   label: 'MIN Portal',  align: 'center', sortable: true },
    { key: 'erp_min',      label: 'MIN ERP',     align: 'center', sortable: true },
    { key: 'delta_min',    label: 'Δ MIN',       align: 'center', sortable: true },
    { key: 'portal_max',   label: 'MAX Portal',  align: 'center', sortable: true },
    { key: 'erp_max',      label: 'MAX ERP',     align: 'center', sortable: true },
    { key: 'delta_max',    label: 'Δ MAX',       align: 'center', sortable: true },
];

const FILTER_OPTS = [
    { key: 'all',    label: 'Todos'        },
    { key: 'diff',   label: 'Diferencias'  },
    { key: 'higher', label: 'Portal > ERP' },
    { key: 'lower',  label: 'Portal < ERP' },
    { key: 'equal',  label: 'Iguales'      },
];

export default function TabMinMaxComparacion({ searchTerm = '' }) {
    const [selectedErp, setSelectedErp] = useState(5);
    const [mode,        setMode]        = useState('draft');
    const [filterMode,  setFilterMode]  = useState('all');
    const [data,        setData]        = useState([]);
    const [loading,     setLoading]     = useState(false);
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(50);
    const [sortKey,     setSortKey]     = useState('delta_max');
    const [sortDir,     setSortDir]     = useState('desc');

    const load = useCallback(async () => {
        setLoading(true);
        const { data: rows } = await supabase.rpc('get_minmax_comparison', {
            p_erp_sucursal_id: selectedErp,
        });
        setData(rows || []);
        setLoading(false);
    }, [selectedErp]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [searchTerm, filterMode, mode, selectedErp]);

    const getPortalMin = useCallback(r => mode === 'draft' ? r.draft_min : r.pub_min, [mode]);
    const getPortalMax = useCallback(r => mode === 'draft' ? r.draft_max : r.pub_max, [mode]);
    const getDeltaMin  = useCallback(r => {
        const p = mode === 'draft' ? r.draft_min : r.pub_min;
        return p != null && r.erp_min != null ? Number(p) - Number(r.erp_min) : null;
    }, [mode]);
    const getDeltaMax  = useCallback(r => {
        const p = mode === 'draft' ? r.draft_max : r.pub_max;
        return p != null && r.erp_max != null ? Number(p) - Number(r.erp_max) : null;
    }, [mode]);

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
                const dm = getDeltaMin(r), dx = getDeltaMax(r);
                if (filterMode === 'diff')   return dm !== 0 || dx !== 0;
                if (filterMode === 'higher') return (dm != null && dm > 0) || (dx != null && dx > 0);
                if (filterMode === 'lower')  return (dm != null && dm < 0) || (dx != null && dx < 0);
                if (filterMode === 'equal')  return dm === 0 && dx === 0;
                return true;
            });
        }

        return [...rows].sort((a, b) => {
            let av, bv;
            if      (sortKey === 'product_name') { av = a.product_name || ''; bv = b.product_name || ''; }
            else if (sortKey === 'laboratorio')  { av = a.laboratorio  || ''; bv = b.laboratorio  || ''; }
            else if (sortKey === 'clase') {
                av = (a.abc_class || '') + normXyz(a.demand_variability);
                bv = (b.abc_class || '') + normXyz(b.demand_variability);
            }
            else if (sortKey === 'portal_min') { av = getPortalMin(a) ?? -1; bv = getPortalMin(b) ?? -1; }
            else if (sortKey === 'portal_max') { av = getPortalMax(a) ?? -1; bv = getPortalMax(b) ?? -1; }
            else if (sortKey === 'erp_min')    { av = a.erp_min ?? -1;       bv = b.erp_min ?? -1;       }
            else if (sortKey === 'erp_max')    { av = a.erp_max ?? -1;       bv = b.erp_max ?? -1;       }
            else if (sortKey === 'delta_min')  { av = getDeltaMin(a) ?? -Infinity; bv = getDeltaMin(b) ?? -Infinity; }
            else if (sortKey === 'delta_max')  { av = getDeltaMax(a) ?? -Infinity; bv = getDeltaMax(b) ?? -Infinity; }
            else                               { av = 0; bv = 0; }
            const cmp = typeof av === 'string' ? av.localeCompare(bv, 'es') : (Number(av) - Number(bv));
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [data, searchTerm, filterMode, mode, sortKey, sortDir, getDeltaMin, getDeltaMax, getPortalMin, getPortalMax]);

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
            const dm = getDeltaMin(r), dx = getDeltaMax(r);
            if ((dm != null && dm !== 0) || (dx != null && dx !== 0)) diff++;
            if ((dm != null && dm > 0) || (dx != null && dx > 0)) higher++;
            if ((dm != null && dm < 0) || (dx != null && dx < 0)) lower++;
            if (dm === 0 && dx === 0) equal++;
        }
        return { all: base.length, diff, higher, lower, equal };
    }, [data, searchTerm, getDeltaMin, getDeltaMax]);

    const handleSort = key => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
        setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paged      = filtered.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="flex flex-col gap-4 px-4 pt-4 pb-2">

            {/* ── Controls ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-3 flex-wrap">

                {/* Izquierda: pill de filtros estándar */}
                <div className="inline-flex items-center rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm overflow-hidden px-1 py-1 gap-0.5">

                    {/* Toggle Borrador / Publicado */}
                    {[{ key: 'draft', label: 'Borrador' }, { key: 'published', label: 'Publicado' }].map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => { setMode(key); setPage(1); }}
                            className={`px-3 py-1 text-[11px] font-semibold rounded-xl transition-all duration-150 whitespace-nowrap ${
                                mode === key
                                    ? 'bg-[#0052CC] text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            {label}
                        </button>
                    ))}

                    {/* Divisor */}
                    <div className="h-5 w-px bg-slate-100 mx-1 shrink-0" />

                    {/* Chips de filtro */}
                    {FILTER_OPTS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => { setFilterMode(key); setPage(1); }}
                            className={`px-2.5 py-1 text-[11px] font-semibold rounded-xl transition-all duration-150 whitespace-nowrap ${
                                filterMode === key
                                    ? 'bg-[#0052CC]/10 text-[#0052CC]'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            {label} <span className="opacity-60">({counts[key] ?? 0})</span>
                        </button>
                    ))}
                </div>

                {/* Derecha: selector de sucursal */}
                <div className="inline-flex items-center rounded-2xl bg-white/80 border border-slate-200/70 shadow-sm px-2 py-1.5 ml-auto">
                    <LiquidSelect
                        value={String(selectedErp)}
                        onChange={v => v && setSelectedErp(Number(v))}
                        options={erpOptions}
                        icon={Building2}
                        clearable={false}
                        compact
                    />
                </div>
            </div>

            {/* ── Tabla ─────────────────────────────────────────────────────── */}
            <DataTable
                columns={COLS}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loading}
                empty={{ icon: GitCompare, message: 'Sin productos para comparar' }}
                minWidth="880px"
            >
                {paged.map(r => {
                    const portalMin = getPortalMin(r);
                    const portalMax = getPortalMax(r);
                    const abc = r.abc_class || '—';
                    const xyz = normXyz(r.demand_variability);
                    return (
                        <tr key={r.erp_product_id} className="hover:bg-white/40 transition-colors duration-100">
                            <DataCell align="left" className="!py-2.5">
                                <span className="text-[13px] font-semibold text-slate-700 leading-tight">{r.product_name}</span>
                            </DataCell>
                            <DataCell align="left" className="!py-2.5">
                                <span className="text-[11px] text-slate-400">{r.laboratorio || '—'}</span>
                            </DataCell>
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[11px] font-black text-slate-600 tracking-wide">{abc}{xyz}</span>
                            </DataCell>

                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] font-bold tabular-nums text-amber-700">
                                    {portalMin != null ? fmtN(portalMin) : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] tabular-nums text-slate-500">
                                    {r.erp_min != null ? fmtN(r.erp_min) : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            <DataCell align="center" className="!py-2.5">
                                <DeltaCell portal={portalMin} erp={r.erp_min} />
                            </DataCell>

                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] font-bold tabular-nums text-blue-700">
                                    {portalMax != null ? fmtN(portalMax) : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
                            <DataCell align="center" className="!py-2.5">
                                <span className="text-[12px] tabular-nums text-slate-500">
                                    {r.erp_max != null ? fmtN(r.erp_max) : <span className="text-slate-300">—</span>}
                                </span>
                            </DataCell>
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
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={sz => { setPageSize(sz); setPage(1); }}
            />
        </div>
    );
}
