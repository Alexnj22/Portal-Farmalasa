import React, { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, Package, ChevronDown, ChevronRight, Calendar, Users, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import LiquidSelect from '../components/common/LiquidSelect';
import { supabase }    from '../supabaseClient';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const TABS = [
    { key: 'facturas',  label: 'Facturas'  },
    { key: 'productos', label: 'Productos' },
];

const FACTURA_COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'   },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'   },
    { key: 'estado',    label: 'Estado',     align: 'center', hideBelow: 'md' },
    { key: 'items',     label: 'Ítems',      align: 'center' },
    { key: 'subtotal',  label: 'Subtotal',   align: 'right',  hideBelow: 'md' },
    { key: 'iva',       label: 'IVA',        align: 'right',  hideBelow: 'lg' },
    { key: 'total',     label: 'Total',      align: 'right'  },
    { key: 'expand',    label: '',           align: 'center' },
];

const PRODUCTO_COLS = [
    { key: 'id',        label: 'Producto ID',  align: 'center' },
    { key: 'primera',   label: '1ª Compra',    align: 'center' },
    { key: 'ultima',    label: 'Última',       align: 'center' },
    { key: 'dias',      label: 'Días datos',   align: 'center', hideBelow: 'md' },
    { key: 'facturas',  label: 'Facturas',     align: 'center' },
    { key: 'unidades',  label: 'Unidades',     align: 'right',  hideBelow: 'md' },
    { key: 'avg_cost',  label: 'Costo prom.',  align: 'right'  },
    { key: 'last_cost', label: 'Costo actual', align: 'right'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n) =>
    `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) =>
    parseFloat(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

function defaultRange() {
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 29);
    const iso = (d) => d.toISOString().split('T')[0];
    return { start: iso(start), end: iso(end) };
}

// ── ItemsExpand ───────────────────────────────────────────────────────────────

function ItemsExpand({ receiptId }) {
    const [items,   setItems]   = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        supabase
            .from('purchase_receipt_items')
            .select('linea_num, erp_product_id, descripcion, cantidad, precio_unitario, total_linea, lote, fecha_vencimiento')
            .eq('receipt_id', receiptId)
            .order('linea_num')
            .then(({ data }) => {
                if (!cancelled) { setItems(data || []); setLoading(false); }
            });
        return () => { cancelled = true; };
    }, [receiptId]);

    if (loading) return (
        <div className="px-6 py-4 text-[11px] text-slate-400 animate-pulse">Cargando ítems…</div>
    );
    if (!items?.length) return (
        <div className="px-6 py-4 text-[11px] text-slate-400">Sin ítems registrados.</div>
    );

    return (
        <div className="px-4 py-3">
            <div className="overflow-x-auto rounded-xl border border-slate-200/60 bg-white/60">
                <table className="w-full text-[11px]">
                    <thead>
                        <tr className="border-b border-slate-200/60 bg-slate-50/60">
                            <th className="text-left px-3 py-2 font-semibold text-slate-500">#</th>
                            <th className="text-left px-3 py-2 font-semibold text-slate-500">ID Producto</th>
                            <th className="text-left px-3 py-2 font-semibold text-slate-500">Descripción</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-500">Cant.</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500">P. Unit.</th>
                            <th className="text-right px-3 py-2 font-semibold text-slate-500">Total línea</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-500 hidden md:table-cell">Lote</th>
                            <th className="text-center px-3 py-2 font-semibold text-slate-500 hidden md:table-cell">Vencimiento</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/70">
                        {items.map((it) => {
                            const lote = it.lote && it.lote !== 'GENERICO' ? it.lote : null;
                            return (
                                <tr key={it.linea_num} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-3 py-2 text-slate-400 tabular-nums">{it.linea_num}</td>
                                    <td className="px-3 py-2 text-slate-500 tabular-nums font-mono">{it.erp_product_id ?? '—'}</td>
                                    <td className="px-3 py-2 text-slate-700 font-medium">{it.descripcion || '—'}</td>
                                    <td className="px-3 py-2 text-center text-slate-700 tabular-nums">{fmtNum(it.cantidad)}</td>
                                    <td className="px-3 py-2 text-right text-slate-700 tabular-nums">{fmt$(it.precio_unitario)}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-800 tabular-nums">{fmt$(it.total_linea)}</td>
                                    <td className="px-3 py-2 text-center text-slate-500 hidden md:table-cell">
                                        {lote
                                            ? <span className="bg-violet-50 text-violet-700 text-[10px] font-bold px-2 py-0.5 rounded-full">{lote}</span>
                                            : <span className="text-slate-300">—</span>
                                        }
                                    </td>
                                    <td className="px-3 py-2 text-center text-slate-500 hidden md:table-cell">
                                        {fmtDate(it.fecha_vencimiento)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── TabFacturas ───────────────────────────────────────────────────────────────

function TabFacturas({ dateStart, dateEnd, supplierId, sinProveedor, searchTerm }) {
    const [rows,      setRows]      = useState([]);
    const [loading,   setLoading]   = useState(false);
    const [page,      setPage]      = useState(1);
    const [total,     setTotal]     = useState(0);
    const [expandedId, setExpandedId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setExpandedId(null);
        const from = (page - 1) * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        let q = supabase
            .from('purchase_receipts')
            .select('id, erp_purchase_id, fecha, proveedor, estado, subtotal, iva, total, supplier_id, suppliers(nombre), purchase_receipt_items(id)', { count: 'exact' })
            .order('fecha', { ascending: false })
            .order('id',    { ascending: false })
            .range(from, to);

        if (dateStart) q = q.gte('fecha', dateStart);
        if (dateEnd)   q = q.lte('fecha', dateEnd);
        if (sinProveedor) q = q.is('supplier_id', null);
        else if (supplierId) q = q.eq('supplier_id', supplierId);
        if (searchTerm) {
            const term = searchTerm.trim();
            q = q.or(`proveedor.ilike.%${term}%`);
        }

        const { data, count } = await q;
        setRows(data || []);
        setTotal(count || 0);
        setLoading(false);
    }, [dateStart, dateEnd, supplierId, sinProveedor, searchTerm, page]);

    // Reset page when filters change
    useEffect(() => { setPage(1); }, [dateStart, dateEnd, supplierId, sinProveedor, searchTerm]);
    useEffect(() => { load(); }, [load]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const provName = (row) =>
        row.suppliers?.nombre || row.proveedor || '—';

    const estadoBadge = (estado) => {
        if (!estado || estado === 'VIGENTE')
            return <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Vigente</span>;
        return <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">{estado}</span>;
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Summary line */}
            <div className="text-[11px] text-slate-500 font-medium px-1">
                {loading ? 'Cargando…' : `${total.toLocaleString()} factura${total !== 1 ? 's' : ''}`}
            </div>

            <DataTable columns={FACTURA_COLS} loading={loading} empty={{ icon: ShoppingCart, message: 'Sin facturas en el período.' }}>
                {rows.map((row, i) => (
                    <React.Fragment key={row.id}>
                        <DataRow index={i} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                            <DataCell>
                                <span className="font-semibold text-slate-700 tabular-nums">{fmtDate(row.fecha)}</span>
                            </DataCell>
                            <DataCell>
                                <div className="flex items-center gap-1.5">
                                    {!row.supplier_id && (
                                        <AlertTriangle size={12} className="text-amber-500 shrink-0" title="Proveedor no linkeado — verificar en ERP" />
                                    )}
                                    <span className="text-slate-800 font-medium text-[12px]">{provName(row)}</span>
                                    {!row.supplier_id && (
                                        <span className="text-[9px] font-mono text-slate-400">#{row.erp_purchase_id}</span>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">{estadoBadge(row.estado)}</DataCell>
                            <DataCell align="center">
                                <span className="tabular-nums text-slate-600">{row.purchase_receipt_items?.length ?? '—'}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="tabular-nums text-slate-600 text-[11px]">{fmt$(row.subtotal)}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="lg">
                                <span className="tabular-nums text-slate-500 text-[11px]">{fmt$(row.iva)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-slate-800">{fmt$(row.total)}</span>
                            </DataCell>
                            <DataCell align="center">
                                <button className="text-slate-400 hover:text-[#0052CC] transition-colors p-1 rounded-lg hover:bg-blue-50">
                                    {expandedId === row.id
                                        ? <ChevronDown size={14} strokeWidth={2.5} />
                                        : <ChevronRight size={14} strokeWidth={2.5} />
                                    }
                                </button>
                            </DataCell>
                        </DataRow>
                        {expandedId === row.id && (
                            <tr>
                                <td colSpan={FACTURA_COLS.length} className="p-0">
                                    <ItemsExpand receiptId={row.id} />
                                </td>
                            </tr>
                        )}
                    </React.Fragment>
                ))}
            </DataTable>

            {totalPages > 1 && (
                <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
            )}
        </div>
    );
}

// ── TabProductos ──────────────────────────────────────────────────────────────

function TabProductos({ searchTerm }) {
    const [rows,    setRows]    = useState([]);
    const [loading, setLoading] = useState(false);
    const [page,    setPage]    = useState(1);
    const [total,   setTotal]   = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        const from = (page - 1) * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        let q = supabase
            .from('product_purchase_summary')
            .select('erp_product_id, first_purchase_date, last_purchase_date, days_since_first_purchase, total_receipts, total_units_received, avg_cost, latest_cost, distinct_suppliers', { count: 'exact' })
            .order('last_purchase_date', { ascending: false })
            .range(from, to);

        if (searchTerm) {
            const term = searchTerm.trim();
            if (!isNaN(Number(term))) q = q.eq('erp_product_id', Number(term));
        }

        const { data, count } = await q;
        setRows(data || []);
        setTotal(count || 0);
        setLoading(false);
    }, [searchTerm, page]);

    useEffect(() => { setPage(1); }, [searchTerm]);
    useEffect(() => { load(); }, [load]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="flex flex-col gap-4">
            <div className="text-[11px] text-slate-500 font-medium px-1">
                {loading ? 'Cargando…' : `${total.toLocaleString()} producto${total !== 1 ? 's' : ''} con historial`}
            </div>

            <DataTable columns={PRODUCTO_COLS} loading={loading} empty={{ icon: Package, message: 'Sin productos con historial de compras.' }}>
                {rows.map((row, i) => (
                    <DataRow key={row.erp_product_id} index={i}>
                        <DataCell align="center">
                            <span className="font-mono text-[11px] text-slate-600 tabular-nums">{row.erp_product_id}</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-slate-600 text-[11px]">{fmtDate(row.first_purchase_date)}</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-slate-700 font-medium text-[11px]">{fmtDate(row.last_purchase_date)}</span>
                        </DataCell>
                        <DataCell align="center" hideBelow="md">
                            <span className="tabular-nums text-sky-600 font-bold text-[11px]">{row.days_since_first_purchase ?? '—'}d</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-slate-600">{row.total_receipts}</span>
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="tabular-nums text-slate-600 text-[11px]">{fmtNum(row.total_units_received)}</span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="tabular-nums text-slate-700 text-[11px]">{fmt$(row.avg_cost)}</span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="tabular-nums font-bold text-slate-800 text-[11px]">{fmt$(row.latest_cost)}</span>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {totalPages > 1 && (
                <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
            )}
        </div>
    );
}

// ── ComprasView ───────────────────────────────────────────────────────────────

export default function ComprasView() {
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab    = searchParams.get('tab');
    const activeTab = TABS.some(t => t.key === rawTab) ? rawTab : 'facturas';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [search, setSearch] = useState('');

    const range = defaultRange();
    const [dateStart, setDateStart] = useState(range.start);
    const [dateEnd,   setDateEnd]   = useState(range.end);

    const [suppliers,     setSuppliers]     = useState([]);
    const [supplierId,    setSupplierId]    = useState('');
    const [sinProveedor,  setSinProveedor]  = useState(false);
    const [unlinkedCount, setUnlinkedCount] = useState(0);

    // Load supplier list + global unlinked count once
    useEffect(() => {
        supabase.from('suppliers').select('id, nombre').order('nombre')
            .then(({ data }) => setSuppliers(data || []));
        supabase.from('purchase_receipts').select('id', { count: 'exact', head: true }).is('supplier_id', null)
            .then(({ count }) => setUnlinkedCount(count || 0));
    }, []);

    const filtersContent = (
        <div className="flex flex-col gap-2">
            {/* Aviso global: facturas sin proveedor */}
            {unlinkedCount > 0 && (
                <button
                    onClick={() => { setSinProveedor(v => !v); setSupplierId(''); }}
                    className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] font-semibold border transition-colors w-fit ${
                        sinProveedor
                            ? 'bg-amber-100 border-amber-300 text-amber-800'
                            : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                    }`}
                >
                    <AlertTriangle size={12} className="text-amber-500" />
                    {unlinkedCount} factura{unlinkedCount !== 1 ? 's' : ''} sin proveedor linkeado — verificar en ERP
                    <span className="ml-1 text-[10px] font-bold underline">{sinProveedor ? 'Ver todas' : 'Filtrar'}</span>
                </button>
            )}

            <div className="flex items-center gap-3 rounded-2xl bg-white/80 border border-slate-200/70 px-4 py-2 flex-wrap">
                {/* Date start */}
                <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <input
                        type="date"
                        value={dateStart}
                        onChange={e => setDateStart(e.target.value)}
                        className="text-[16px] font-semibold text-slate-700 bg-transparent border-none outline-none cursor-pointer"
                    />
                </div>

                <div className="h-5 w-px bg-slate-100" />

                {/* Date end */}
                <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <input
                        type="date"
                        value={dateEnd}
                        onChange={e => setDateEnd(e.target.value)}
                        className="text-[16px] font-semibold text-slate-700 bg-transparent border-none outline-none cursor-pointer"
                    />
                </div>

                {activeTab === 'facturas' && (
                    <>
                        <div className="h-5 w-px bg-slate-100" />
                        {/* Supplier filter */}
                        <div className="flex items-center gap-1.5">
                            <Users size={12} className="text-slate-400" />
                            <div className="w-[180px]">
                                <LiquidSelect
                                    value={sinProveedor ? '' : supplierId}
                                    onChange={val => { setSupplierId(val); setSinProveedor(false); }}
                                    disabled={sinProveedor}
                                    options={suppliers.map(s => ({ value: s.id, label: s.nombre }))}
                                    placeholder="Todos los proveedores"
                                    compact
                                    bare
                                />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <>
            <ViewTabBar
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                searchValue={search}
                onSearchChange={setSearch}
                showSearch
            />

            <GlassViewLayout icon={ShoppingCart} title="Compras (Bodega)" filtersContent={filtersContent}>
                {activeTab === 'facturas' && (
                    <TabFacturas
                        dateStart={dateStart}
                        dateEnd={dateEnd}
                        supplierId={supplierId || null}
                        sinProveedor={sinProveedor}
                        searchTerm={search}
                    />
                )}
                {activeTab === 'productos' && (
                    <TabProductos searchTerm={search} />
                )}
            </GlassViewLayout>
        </>
    );
}
