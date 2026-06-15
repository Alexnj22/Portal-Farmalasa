import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, CalendarDays, TrendingDown, Package, Building2,
    AlertTriangle, X, CheckCircle2, Check,
} from 'lucide-react';
import { DataTable, DataRow } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { ERP_NAMES } from '../../constants/erp';

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

function pctDiff(asignado, recibido) {
    if (!asignado) return 0;
    return Math.round(((asignado - recibido) / asignado) * 100);
}

function DiffBar({ pct }) {
    const color = pct >= 50 ? 'bg-red-500' : pct >= 20 ? 'bg-amber-400' : 'bg-yellow-300';
    return (
        <div className="flex items-center gap-1.5">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-bold text-slate-500 tabular-nums w-8 text-right">{pct}%</span>
        </div>
    );
}

function StatCard({ label, value, sub, color }) {
    const cls = {
        blue:  'bg-blue-50    border-blue-100   text-blue-700',
        amber: 'bg-amber-50   border-amber-100  text-amber-700',
        red:   'bg-red-50     border-red-100    text-red-600',
        slate: 'bg-slate-50   border-slate-100  text-slate-700',
    }[color];
    return (
        <div className={`rounded-xl border px-4 py-2.5 ${cls}`}>
            <div className="text-xl font-black tabular-nums leading-none">{value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</div>
            {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
        </div>
    );
}

function clientSort(rows, key, dir) {
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a[key], bv = b[key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number') return (av - bv) * mul;
        return String(av).localeCompare(String(bv), 'es') * mul;
    });
}

const SUC_COLS = [
    { key: 'erp_sucursal_id',        label: 'Sucursal',      align: 'left'   },
    { key: 'pedidos_con_diferencia',  label: 'Pedidos',       align: 'center' },
    { key: 'items_con_diferencia',    label: 'Ítems',         align: 'center' },
    { key: 'packs_asignados',         label: 'Asignado',      align: 'center' },
    { key: 'packs_recibidos',         label: 'Recibido',      align: 'center' },
    { key: 'packs_faltantes',         label: '% diferencia',  align: 'right', className: 'w-36' },
];

const PROD_COLS = [
    { key: 'product_name',           label: 'Producto',      align: 'left',   sortable: true },
    { key: 'veces_con_diferencia',   label: 'Veces',         align: 'center', sortable: true },
    { key: 'packs_asignados',        label: 'Asignado',      align: 'center', sortable: true },
    { key: 'packs_recibidos',        label: 'Recibido',      align: 'center', sortable: true },
    { key: 'packs_faltantes',        label: '% diferencia',  align: 'right',  sortable: true, className: 'w-36' },
];

const DET_COLS = [
    { key: 'product_name',      label: 'Producto',  align: 'left',   sortable: true },
    { key: 'pedido_numero',     label: 'Pedido',    align: 'center', sortable: true },
    { key: 'erp_sucursal_id',   label: 'Sucursal',  align: 'left',   hideBelow: 'sm' },
    { key: 'cantidad_asignada', label: 'Asig.',     align: 'center', sortable: true },
    { key: 'cantidad_recibida', label: 'Recib.',    align: 'center', sortable: true },
    { key: 'nota_diferencia',   label: 'Nota',      align: 'left',   hideBelow: 'md' },
    { key: 'resuelta_at',       label: 'Estado',    align: 'center', className: 'w-28' },
];

export default function TabDiferencias({ searchTerm = '' }) {
    const { user } = useAuth();
    const [loading,        setLoading]        = useState(false);
    const [data,           setData]           = useState(null);
    const [desde,          setDesde]          = useState('');
    const [hasta,          setHasta]          = useState('');
    const [resolving,      setResolving]      = useState(null);
    const [hideResueltas,  setHideResueltas]  = useState(true);
    const [viewMode, setViewMode] = useState('sucursal');

    const [prodSortKey,  setProdSortKey]  = useState('packs_faltantes');
    const [prodSortDir,  setProdSortDir]  = useState('desc');
    const [prodPage,     setProdPage]     = useState(1);
    const [prodPageSize, setProdPageSize] = useState(25);

    const [detSortKey,   setDetSortKey]   = useState('received_at');
    const [detSortDir,   setDetSortDir]   = useState('desc');
    const [detPage,      setDetPage]      = useState(1);
    const [detPageSize,  setDetPageSize]  = useState(25);

    const loadStats = useCallback(async (d, h) => {
        setLoading(true);
        setData(null);
        const { data: result } = await supabase.rpc('get_pedido_diferencias_stats', {
            p_desde: d ? `${d}T00:00:00-06:00` : null,
            p_hasta: h ? `${h}T23:59:59-06:00` : null,
        });
        setData(result ?? null);
        setLoading(false);
    }, []);

    useEffect(() => { loadStats(desde, hasta); }, [desde, hasta, loadStats]);

    const handleResolver = useCallback(async (pedidoItemId) => {
        setResolving(pedidoItemId);
        const { error } = await supabase
            .from('pedido_items')
            .update({ resuelta_at: new Date().toISOString(), resuelta_por: user?.id ?? null })
            .eq('id', pedidoItemId);
        if (!error) {
            const now = new Date().toISOString();
            setData(prev => prev ? {
                ...prev,
                detalle: (prev.detalle ?? []).map(d =>
                    d.pedido_item_id === pedidoItemId ? { ...d, resuelta_at: now } : d
                ),
            } : prev);
        }
        setResolving(null);
    }, [user]);

    useEffect(() => { setProdPage(1); setDetPage(1); }, [viewMode, searchTerm]);

    const totales     = data?.totales      ?? null;
    const porSucursal = data?.por_sucursal ?? [];
    const porProducto = data?.por_producto ?? [];
    const detalle     = data?.detalle      ?? [];

    const handleProdSort = useCallback((key) => {
        setProdSortKey(prev => {
            if (prev === key) { setProdSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setProdSortDir('desc'); return key;
        });
        setProdPage(1);
    }, []);

    const handleDetSort = useCallback((key) => {
        setDetSortKey(prev => {
            if (prev === key) { setDetSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setDetSortDir('desc'); return key;
        });
        setDetPage(1);
    }, []);

    const prodSorted = useMemo(() => {
        let rows = porProducto;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter(r => (r.product_name || '').toLowerCase().includes(q));
        }
        return clientSort(rows, prodSortKey, prodSortDir);
    }, [porProducto, searchTerm, prodSortKey, prodSortDir]);

    const prodTotalPages = Math.max(1, Math.ceil(prodSorted.length / prodPageSize));
    const prodRows       = prodSorted.slice((prodPage - 1) * prodPageSize, prodPage * prodPageSize);

    const detSorted = useMemo(() => {
        let rows = detalle;
        if (hideResueltas) rows = rows.filter(r => !r.resuelta_at);
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter(r =>
                (r.product_name || '').toLowerCase().includes(q) ||
                String(r.pedido_numero).includes(q)
            );
        }
        return clientSort(rows, detSortKey, detSortDir);
    }, [detalle, searchTerm, detSortKey, detSortDir, hideResueltas]);

    const detTotalPages = Math.max(1, Math.ceil(detSorted.length / detPageSize));
    const detRows       = detSorted.slice((detPage - 1) * detPageSize, detPage * detPageSize);

    return (
        <div className="space-y-3 p-4">

            {/* Filtro de fechas */}
            <div className={`${GLASS} px-4 py-3 flex items-center gap-3 flex-wrap`}>
                <CalendarDays size={14} className="text-slate-400 shrink-0" />
                <span className="text-[12px] text-slate-500 font-medium">Período:</span>
                <input
                    type="date" value={desde} onChange={e => setDesde(e.target.value)}
                    className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400"
                />
                <span className="text-[11px] text-slate-400">—</span>
                <input
                    type="date" value={hasta} onChange={e => setHasta(e.target.value)}
                    className="text-[12px] border border-slate-200 rounded-lg px-2.5 py-1 bg-white text-slate-700 focus:outline-none focus:border-blue-400"
                />
                {(desde || hasta) && (
                    <button
                        onClick={() => { setDesde(''); setHasta(''); }}
                        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                    >
                        <X size={11} /> Limpiar
                    </button>
                )}
                {loading && <Loader2 size={14} className="text-slate-400 animate-spin ml-auto" />}
            </div>

            {/* Stat cards */}
            {totales && (
                <div className="flex flex-wrap gap-2">
                    <StatCard label="Pedidos afectados"    value={totales.pedidos_afectados ?? 0}    color="blue" />
                    <StatCard label="Ítems con diferencia" value={totales.items_afectados ?? 0}      color="amber" />
                    <StatCard
                        label="Packs faltantes"
                        value={totales.total_packs_faltantes ?? 0}
                        sub={`de ${totales.total_packs_asignados ?? 0} asignados`}
                        color="red"
                    />
                    <StatCard
                        label="% diferencia"
                        value={`${pctDiff(totales.total_packs_asignados, totales.total_packs_recibidos)}%`}
                        color="slate"
                    />
                </div>
            )}

            {!loading && totales && totales.items_afectados === 0 && (
                <div className="flex flex-col items-center py-12 gap-2 text-slate-300">
                    <TrendingDown size={32} className="opacity-40" />
                    <p className="text-[13px] text-slate-400">Sin diferencias en el período seleccionado.</p>
                </div>
            )}

            {!loading && totales && totales.items_afectados > 0 && (
                <>
                    {/* Toggle de vista */}
                    <div className="flex items-center gap-1.5">
                        {[
                            { key: 'sucursal', label: 'Por sucursal', icon: Building2    },
                            { key: 'producto', label: 'Por producto', icon: Package      },
                            { key: 'detalle',  label: 'Detalle',      icon: AlertTriangle },
                        ].map(v => (
                            <button
                                key={v.key}
                                onClick={() => setViewMode(v.key)}
                                className={`flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full border font-medium transition-colors ${
                                    viewMode === v.key
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                }`}
                            >
                                <v.icon size={11} />
                                {v.label}
                            </button>
                        ))}
                    </div>

                    {/* ── Por sucursal ─────────────────────────────── */}
                    {viewMode === 'sucursal' && (
                        <DataTable
                            columns={SUC_COLS}
                            loading={false}
                            empty={{ icon: Building2, message: 'Sin datos' }}
                            minWidth="520px"
                        >
                            {porSucursal.map((row, i) => {
                                const pct = pctDiff(row.packs_asignados, row.packs_recibidos);
                                return (
                                    <DataRow key={row.erp_sucursal_id} index={i}>
                                        <td className="px-4 py-3 text-[13px] font-semibold text-slate-700">
                                            {ERP_NAMES[row.erp_sucursal_id] ?? `Suc ${row.erp_sucursal_id}`}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                            {row.pedidos_con_diferencia}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                            {row.items_con_diferencia}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                            {row.packs_asignados}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                            {row.packs_recibidos}
                                        </td>
                                        <td className="px-4 py-3 min-w-[140px]">
                                            <div className="space-y-0.5">
                                                <DiffBar pct={pct} />
                                                <p className="text-[10px] text-right text-amber-600 font-semibold tabular-nums">
                                                    −{row.packs_faltantes} pk
                                                </p>
                                            </div>
                                        </td>
                                    </DataRow>
                                );
                            })}
                        </DataTable>
                    )}

                    {/* ── Por producto ─────────────────────────────── */}
                    {viewMode === 'producto' && (
                        <>
                            <DataTable
                                columns={PROD_COLS}
                                sortKey={prodSortKey}
                                sortDir={prodSortDir}
                                onSort={handleProdSort}
                                loading={false}
                                empty={{ icon: Package, message: searchTerm ? `Sin resultados para "${searchTerm}"` : 'Sin datos' }}
                                minWidth="520px"
                            >
                                {prodRows.map((row, i) => {
                                    const pct = pctDiff(row.packs_asignados, row.packs_recibidos);
                                    return (
                                        <DataRow key={row.erp_product_id} index={i}>
                                            <td className="px-4 py-3">
                                                <p className="text-[13px] font-semibold text-slate-800">{row.product_name}</p>
                                                {row.presentacion_tipo && (
                                                    <p className="text-[10px] text-slate-400">{row.presentacion_tipo}</p>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                                {row.veces_con_diferencia}
                                            </td>
                                            <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                                {row.packs_asignados}
                                            </td>
                                            <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                                {row.packs_recibidos}
                                            </td>
                                            <td className="px-4 py-3 min-w-[140px]">
                                                <div className="space-y-0.5">
                                                    <DiffBar pct={pct} />
                                                    <p className="text-[10px] text-right text-amber-600 font-semibold tabular-nums">
                                                        −{row.packs_faltantes} pk
                                                    </p>
                                                </div>
                                            </td>
                                        </DataRow>
                                    );
                                })}
                            </DataTable>
                            {prodSorted.length > prodPageSize && (
                                <TablePagination
                                    pageSize={prodPageSize}
                                    onPageSizeChange={v => { setProdPageSize(v); setProdPage(1); }}
                                    page={prodPage}
                                    totalPages={prodTotalPages}
                                    onPageChange={setProdPage}
                                    total={prodSorted.length}
                                />
                            )}
                        </>
                    )}

                    {/* ── Detalle ─────────────────────────────────── */}
                    {viewMode === 'detalle' && (
                        <>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => setHideResueltas(v => !v)}
                                    className={`flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full border font-medium transition-colors ${
                                        hideResueltas
                                            ? 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300'
                                            : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                    }`}
                                >
                                    <CheckCircle2 size={11} />
                                    {hideResueltas ? 'Mostrar resueltas' : 'Ocultar resueltas'}
                                </button>
                                {!hideResueltas && detalle.filter(d => d.resuelta_at).length > 0 && (
                                    <span className="text-[10px] text-slate-400">
                                        {detalle.filter(d => d.resuelta_at).length} resueltas
                                    </span>
                                )}
                            </div>
                            <DataTable
                                columns={DET_COLS}
                                sortKey={detSortKey}
                                sortDir={detSortDir}
                                onSort={handleDetSort}
                                loading={false}
                                empty={{ icon: AlertTriangle, message: searchTerm ? `Sin resultados para "${searchTerm}"` : 'Sin diferencias' }}
                                minWidth="600px"
                            >
                                {detRows.map((row, i) => (
                                    <DataRow key={row.pedido_item_id ?? i} index={i}>
                                        <td className="px-4 py-3">
                                            <p className="text-[13px] font-semibold text-slate-800 leading-snug">{row.product_name}</p>
                                            <p className="text-[10px] text-slate-400">{fmtDate(row.received_at)}</p>
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[12px] font-medium text-slate-600">
                                            #{row.pedido_numero}
                                        </td>
                                        <td className="px-4 py-3 text-[12px] text-slate-600 hidden sm:table-cell">
                                            {ERP_NAMES[row.erp_sucursal_id] ?? `Suc ${row.erp_sucursal_id}`}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-[13px] text-slate-600">
                                            {row.cantidad_asignada}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="text-[13px] font-bold tabular-nums text-amber-600">
                                                {row.cantidad_recibida}
                                            </span>
                                            <span className="text-[10px] text-slate-400 ml-0.5">
                                                (−{row.diferencia})
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-[11px] text-slate-400 hidden md:table-cell max-w-[200px]">
                                            <span className="truncate block">{row.nota_diferencia || '—'}</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {row.resuelta_at ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                    <Check size={9} /> Resuelta
                                                </span>
                                            ) : row.pedido_item_id ? (
                                                <button
                                                    onClick={() => handleResolver(row.pedido_item_id)}
                                                    disabled={resolving === row.pedido_item_id}
                                                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-500 bg-white border border-slate-200 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50"
                                                >
                                                    {resolving === row.pedido_item_id
                                                        ? <Loader2 size={9} className="animate-spin" />
                                                        : <CheckCircle2 size={9} />}
                                                    Resolver
                                                </button>
                                            ) : <span className="text-slate-200">—</span>}
                                        </td>
                                    </DataRow>
                                ))}
                            </DataTable>
                            {detSorted.length > detPageSize && (
                                <TablePagination
                                    pageSize={detPageSize}
                                    onPageSizeChange={v => { setDetPageSize(v); setDetPage(1); }}
                                    page={detPage}
                                    totalPages={detTotalPages}
                                    onPageChange={setDetPage}
                                    total={detSorted.length}
                                />
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}
