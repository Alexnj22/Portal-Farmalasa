import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Badge from '../components/common/Badge';
import { SkeletonText } from '../components/common/StateViews';
import { ShoppingCart, Package, ChevronDown, ChevronRight, Users, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar      from '../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import Button from '../components/common/Button';
import FilterBar from '../components/common/FilterBar';
import {
    fetchPurchaseReceiptItems, fetchPurchaseReceiptsPage, fetchProductPurchaseSummaryPage,
    fetchSuppliersBasic, fetchUnlinkedPurchaseReceiptsCount,
} from '../data/compras';
import { formatMoney, formatQty } from '../utils/formatNumber';
import { useAuth } from '../context/AuthContext';
import ExpedienteMovil from '../components/common/ExpedienteMovil';
import { useExpedienteMovil } from '../components/common/usarExpediente';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
// «Facturas de Sala» estuvo acá como tercera pestaña durante unas horas
// (v2.487.0) y salió a vista propia el mismo día, `/facturas-sala`: contesta
// otra pregunta —qué tomó cada sala y si terminó cargada— con su propio período
// y su propio permiso. Compras contesta qué compró Bodega y a qué costo.
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

const fmt$ = (n) => formatMoney(n || 0);
const fmtNum = (n) => formatQty(n || 0, { decimalesMax: 2 });
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

function ItemsExpand({ receiptId, comoPanel = false }) {
    const { hasPermission } = useAuth();
    const canVerMontos = hasPermission('compras_ver_montos');
    const [items,   setItems]   = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetchPurchaseReceiptItems(receiptId)
            .then(({ data }) => {
                if (!cancelled) { setItems(data || []); setLoading(false); }
            });
        return () => { cancelled = true; };
    }, [receiptId]);

    if (loading) return (
        <div className="px-6 py-4"><SkeletonText lines={3} /></div>
    );
    if (!items?.length) return (
        <div className="px-6 py-4 text-label text-content-3">Sin ítems registrados.</div>
    );

    // ── En el teléfono, una lista y no una tabla ───────────────────────────
    // Ocho columnas (#, id, descripción, cantidad, unitario, total, lote y
    // vencimiento) piden ~700px. Dentro de un expediente que ya ocupa la
    // pantalla entera, deslizar de lado para leer un ítem es exactamente lo que
    // el expediente venía a sacar — el usuario lo dijo así: «sigue en modo
    // tabla, no es adaptado a móvil». Cada ítem pasa a ser un bloque con la
    // descripción arriba y el total de línea a la derecha, que es el par por el
    // que se abre el detalle de una compra.
    if (comoPanel) return (
        <div className="flex flex-col px-3 py-2">
            {items.map((it) => {
                const lote = it.lote && it.lote !== 'GENERICO' ? it.lote : null;
                return (
                    <div key={it.linea_num} className="py-2.5 border-b border-divider last:border-b-0">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 text-body-sm font-bold text-content">
                                {it.descripcion || `Producto ${it.erp_product_id}`}
                            </span>
                            {canVerMontos && (
                                <span className="shrink-0 text-body font-black tabular-nums text-content">
                                    {fmt$(it.total_linea)}
                                </span>
                            )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-caption text-content-3">
                            <span className="tabular-nums">{formatQty(it.cantidad)} u.</span>
                            {canVerMontos && <span className="tabular-nums">× {fmt$(it.precio_unitario)}</span>}
                            {lote && <span>lote {lote}</span>}
                            {it.fecha_vencimiento && <span className="tabular-nums">vence {it.fecha_vencimiento}</span>}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // Encabezado y celda se filtran con la MISMA condición: filtrar uno solo
    // deja las columnas corridas bajo títulos que no les corresponden. Con
    // `DataTable` esa condición vive UNA vez acá y otra en la fila, en vez de
    // repetirse en un `<th>` y un `<td>` que nadie garantiza que sigan juntos.
    const COLS = [
        { key: 'linea',  label: '#' },
        { key: 'id',     label: 'ID Producto' },
        { key: 'desc',   label: 'Descripción' },
        { key: 'cant',   label: 'Cant.', align: 'center' },
        ...(canVerMontos ? [
            { key: 'unit',  label: 'P. Unit.',    align: 'right' },
            { key: 'total', label: 'Total línea', align: 'right' },
        ] : []),
        { key: 'lote',   label: 'Lote',        align: 'center', hideBelow: 'md' },
        { key: 'vence',  label: 'Vencimiento', align: 'center', hideBelow: 'md' },
    ];

    return (
        <div className="px-4 py-3">
            {/* `movil={false}` con su motivo: en el teléfono esta rama NO se
                dibuja. `ExpedienteMovil` monta el mismo componente con
                `comoPanel`, que sale arriba en bloques —es el diseño que pidió
                el usuario: «sigue en modo tabla, no es adaptado a móvil»— así que
                el modo ficha de `DataTable` acá sería una tercera forma de lo
                mismo, compitiendo con la que él aprobó. */}
            <DataTable columns={COLS} movil={false} minWidth="700px">
                {items.map((it, i) => {
                    const lote = it.lote && it.lote !== 'GENERICO' ? it.lote : null;
                    return (
                        <DataRow key={it.linea_num} index={i}>
                            <DataCell className="text-content-3 tabular-nums">{it.linea_num}</DataCell>
                            <DataCell className="text-content-3 tabular-nums font-mono">{it.erp_product_id ?? '—'}</DataCell>
                            <DataCell className="text-content-2 font-medium">{it.descripcion || '—'}</DataCell>
                            <DataCell align="center" className="text-content-2 tabular-nums">{fmtNum(it.cantidad)}</DataCell>
                            {canVerMontos && <DataCell align="right" className="text-content-2 tabular-nums">{fmt$(it.precio_unitario)}</DataCell>}
                            {canVerMontos && <DataCell align="right" className="font-semibold text-content tabular-nums">{fmt$(it.total_linea)}</DataCell>}
                            <DataCell align="center" hideBelow="md" className="text-content-3">
                                {lote
                                    ? <Badge variant="chart-3" uppercase={false}>{lote}</Badge>
                                    : <span className="text-content-3">—</span>
                                }
                            </DataCell>
                            <DataCell align="center" hideBelow="md" className="text-content-3">
                                {fmtDate(it.fecha_vencimiento)}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}

// ── TabFacturas ───────────────────────────────────────────────────────────────

function TabFacturas({
    dateStart, setDateStart, dateEnd, setDateEnd,
    suppliers, supplierId, setSupplierId, sinProveedor, setSinProveedor,
    unlinkedCount, searchTerm,
}) {
    const { hasPermission } = useAuth();
    // Canon 2026-08-03: en Compras el monto es una columna más — el historial
    // (fecha, proveedor, estado, ítems) se lee igual sin ver cuánto costó.
    const canVerMontos = hasPermission('compras_ver_montos');
    const cols = useMemo(
        () => (canVerMontos ? FACTURA_COLS : FACTURA_COLS.filter(c => !['subtotal', 'iva', 'total'].includes(c.key))),
        [canVerMontos]);
    const [rows,      setRows]      = useState([]);
    const [loading,   setLoading]   = useState(false);
    const [page,      setPage]      = useState(1);
    const [total,     setTotal]     = useState(0);
    const [expandedId, setExpandedId] = useState(null);
    // El detalle de la factura vive en un `<tr colSpan>` hermano, que en el
    // teléfono no se pinta: `DataTable` ahí dibuja fichas. Va al expediente.
    const { enTelefono, abierto } = useExpedienteMovil(rows, expandedId);

    const load = useCallback(async () => {
        setLoading(true);
        setExpandedId(null);
        const from = (page - 1) * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        const { data, count } = await fetchPurchaseReceiptsPage({ from, to, dateStart, dateEnd, sinProveedor, supplierId, searchTerm });
        setRows(data || []);
        setTotal(count || 0);
        setLoading(false);
    }, [dateStart, dateEnd, supplierId, sinProveedor, searchTerm, page]);

    // Reset page when filters change
    useEffect(() => { setPage(1); }, [dateStart, dateEnd, supplierId, sinProveedor, searchTerm]); // eslint-disable-line react-hooks/set-state-in-effect
    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar filtros

    const totalPages = Math.ceil(total / PAGE_SIZE);

    const provName = (row) =>
        row.suppliers?.nombre || row.proveedor || '—';

    const estadoBadge = (estado) => {
        if (!estado || estado === 'VIGENTE')
            return <Badge variant="success" uppercase={false}>Vigente</Badge>;
        return <Badge variant="danger" uppercase={false}>{estado}</Badge>;
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Aviso global: facturas sin proveedor */}
            {unlinkedCount > 0 && (
                <Button
                    size="sm"
                    tone="warning"
                    icon={AlertTriangle}
                    onClick={() => { setSinProveedor(v => !v); setSupplierId(''); }}
                >
                    {unlinkedCount} factura{unlinkedCount !== 1 ? 's' : ''} sin proveedor vinculado
                    <span className="ml-1 text-caption font-bold underline">{sinProveedor ? 'Ver todas' : 'Filtrar'}</span>
                </Button>
            )}

            {/* Filter pill — vive en el body, no en el header (regla §17 DESIGN.md) */}
            <div className="flex justify-end">
                <FilterBar
                    onClear={() => { setSupplierId(''); setSinProveedor(false); }}
                    activeCount={[supplierId, sinProveedor].filter(Boolean).length}
                >
                    {/* 3 · tiempo — esta vista no tiene ámbito ni entidad antes */}
                    <FilterBar.Section>
                        <LiquidDatePicker compact shortcuts value={dateStart} onChange={setDateStart} />
                    </FilterBar.Section>

                    <FilterBar.Section>
                        <LiquidDatePicker compact shortcuts value={dateEnd} onChange={setDateEnd} />
                    </FilterBar.Section>

                    {/* 2 · entidad */}
                    <FilterBar.Section active={!!supplierId} onClear={() => setSupplierId('')} label="proveedor">
                        <Users size={12} className="text-content-3 shrink-0" />
                        <div className="w-[180px]">
                            <LiquidSelect
                                value={sinProveedor ? '' : supplierId}
                                onChange={val => { setSupplierId(val); setSinProveedor(false); }}
                                disabled={sinProveedor}
                                options={suppliers.map(s => ({ value: s.id, label: s.nombre }))}
                                placeholder="Todos los proveedores"
                                compact bare
                            />
                        </div>
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {/* Summary line */}
            <div className="text-label text-content-3 font-medium px-1">
                {loading ? 'Cargando…' : `${total.toLocaleString()} factura${total !== 1 ? 's' : ''}`}
            </div>

            <DataTable columns={cols} loading={loading} /* La inferencia toma la primera columna como identidad, y acá esa
                   es la fecha: la ficha decía «05/08/2026 · $2.00 · JOSE…». A una
                   lista de compras se entra buscando a QUIÉN se le compró. */
                movil={{ usarAccionDeFila: true, identidad: 'proveedor', ancla: 'total' }}
                empty={{ icon: ShoppingCart, message: 'Sin facturas en el período' }}>
                {rows.map((row, i) => (
                    <React.Fragment key={row.id}>
                        <DataRow index={i} aria-expanded={expandedId === row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
                            <DataCell>
                                <span className="font-semibold text-content-2 tabular-nums">{fmtDate(row.fecha)}</span>
                            </DataCell>
                            <DataCell>
                                <div className="flex items-center gap-1.5">
                                    {!row.supplier_id && (
                                        <AlertTriangle size={12} className="text-warning shrink-0" title="Proveedor sin vincular" />
                                    )}
                                    <span className="text-content font-medium text-body-sm">{provName(row)}</span>
                                    {!row.supplier_id && (
                                        <span className="text-micro font-mono text-content-3">#{row.erp_purchase_id}</span>
                                    )}
                                </div>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">{estadoBadge(row.estado)}</DataCell>
                            <DataCell align="center">
                                <span className="tabular-nums text-content-2">{row.purchase_receipt_items?.length ?? '—'}</span>
                            </DataCell>
                            {canVerMontos && (
                                <>
                                    <DataCell align="right" hideBelow="md">
                                        <span className="tabular-nums text-content-2 text-label">{fmt$(row.subtotal)}</span>
                                    </DataCell>
                                    <DataCell align="right" hideBelow="lg">
                                        <span className="tabular-nums text-content-3 text-label">{fmt$(row.iva)}</span>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="tabular-nums font-bold text-content">{fmt$(row.total)}</span>
                                    </DataCell>
                                </>
                            )}
                            <DataCell align="center">
                                {/* Era un `<button>` SIN onClick: recibía el foco, se anunciaba
                                    como botón y no hacía nada al pulsar Enter. Ahora es lo que
                                    siempre fue —el indicador de la fila— y quien abre es la
                                    fila, que ya responde al teclado. */}
                                <span aria-hidden="true" className="inline-flex text-content-3 group-hover:text-brand-text transition-colors p-1 rounded-lg">
                                    {expandedId === row.id
                                        ? <ChevronDown size={14} strokeWidth={2.5} />
                                        : <ChevronRight size={14} strokeWidth={2.5} />
                                    }
                                </span>
                            </DataCell>
                        </DataRow>
                        {expandedId === row.id && !enTelefono && (
                            <tr>
                                <td colSpan={cols.length} className="p-0">
                                    <ItemsExpand receiptId={row.id} />
                                </td>
                            </tr>
                        )}
                    </React.Fragment>
                ))}
            </DataTable>

            {/* El detalle de la factura, a pantalla completa en el teléfono. */}
            <ExpedienteMovil
                abierto={abierto}
                onClose={() => setExpandedId(null)}
                titulo={abierto?.proveedor || 'Factura de compra'}
                subtitulo={abierto?.fecha}
            >
                {(row) => <ItemsExpand receiptId={row.id} comoPanel />}
            </ExpedienteMovil>

            {totalPages > 1 && (
                <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} pageSize={PAGE_SIZE} />
            )}
        </div>
    );
}

// ── TabProductos ──────────────────────────────────────────────────────────────

function TabProductos({ searchTerm }) {
    const { hasPermission } = useAuth();
    const canVerMontos = hasPermission('compras_ver_montos');
    const cols = useMemo(
        () => (canVerMontos ? PRODUCTO_COLS : PRODUCTO_COLS.filter(c => !['avg_cost', 'last_cost'].includes(c.key))),
        [canVerMontos]);
    const [rows,    setRows]    = useState([]);
    const [loading, setLoading] = useState(false);
    const [page,    setPage]    = useState(1);
    const [total,   setTotal]   = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        const from = (page - 1) * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        const { data, count } = await fetchProductPurchaseSummaryPage(from, to, searchTerm);
        setRows(data || []);
        setTotal(count || 0);
        setLoading(false);
    }, [searchTerm, page]);

    useEffect(() => { setPage(1); }, [searchTerm]); // eslint-disable-line react-hooks/set-state-in-effect -- resetea paginación al cambiar búsqueda
    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar filtros

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className="flex flex-col gap-4">
            <div className="text-label text-content-3 font-medium px-1">
                {loading ? 'Cargando…' : `${total.toLocaleString()} producto${total !== 1 ? 's' : ''} con historial`}
            </div>

            <DataTable columns={cols} loading={loading} empty={{ icon: Package, message: 'Sin productos con historial de compras' }}>
                {rows.map((row, i) => (
                    <DataRow key={row.erp_product_id} index={i}>
                        <DataCell align="center">
                            <span className="font-mono text-label text-content-2 tabular-nums">{row.erp_product_id}</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-content-2 text-label">{fmtDate(row.first_purchase_date)}</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-content-2 font-medium text-label">{fmtDate(row.last_purchase_date)}</span>
                        </DataCell>
                        <DataCell align="center" hideBelow="md">
                            <span className="tabular-nums text-warning-text font-bold text-label">{row.days_since_first_purchase ?? '—'}d</span>
                        </DataCell>
                        <DataCell align="center">
                            <span className="tabular-nums text-content-2">{row.total_receipts}</span>
                        </DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="tabular-nums text-content-2 text-label">{fmtNum(row.total_units_received)}</span>
                        </DataCell>
                        {canVerMontos && (
                            <>
                                <DataCell align="right">
                                    <span className="tabular-nums text-content-2 text-label">{fmt$(row.avg_cost)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="tabular-nums font-bold text-content text-label">{fmt$(row.latest_cost)}</span>
                                </DataCell>
                            </>
                        )}
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
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab    = searchParams.get('tab');
    // Mismo patrón que el resto del portal: la pestaña por defecto es la primera
    // PERMITIDA, no `facturas` fijo.
    const allowedTabs = TABS.filter(t => hasPermission(`compras_tab_${t.key}`));
    const activeTab = allowedTabs.some(t => t.key === rawTab)
        ? rawTab
        : (allowedTabs[0]?.key ?? 'facturas');
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
        fetchSuppliersBasic()
            .then(({ data, error }) => {
                if (error) { console.error('fetchSuppliersBasic:', error.message); return; }
                setSuppliers(data || []);
            });
        fetchUnlinkedPurchaseReceiptsCount()
            .then(({ count }) => setUnlinkedCount(count || 0));
    }, []);

    // filtersContent es SOLO tabs+búsqueda — una sola fila de header, igual
    // que FacturasCompraView/LaboratoriosView/PedidosView. El pill de fecha/
    // proveedor y el aviso de "sin proveedor" viven en el body, junto a la
    // tabla (regla §17 DESIGN.md — antes vivían aquí, hallazgo de la
    // auditoría UI/UX del menú, ver TabFacturas).
    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={search}
            onSearchChange={setSearch}
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={ShoppingCart} title="Compras (Bodega)" filtersContent={filtersContent}>
            {activeTab === 'facturas' && (
                <TabFacturas
                    dateStart={dateStart} setDateStart={setDateStart}
                    dateEnd={dateEnd} setDateEnd={setDateEnd}
                    suppliers={suppliers}
                    supplierId={supplierId || null} setSupplierId={setSupplierId}
                    sinProveedor={sinProveedor} setSinProveedor={setSinProveedor}
                    unlinkedCount={unlinkedCount}
                    searchTerm={search}
                />
            )}
            {activeTab === 'productos' && (
                <TabProductos searchTerm={search} />
            )}
        </GlassViewLayout>
    );
}
