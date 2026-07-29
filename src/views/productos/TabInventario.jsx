import React, { useState, useEffect, useCallback, useRef } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { supabase } from '../../supabaseClient';
import {
    AlertTriangle, Calendar, CalendarClock, Loader2, Package, PackageX,
    Building2, X, ChevronLeft, ChevronRight, ChevronDown, DollarSign,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import StatCard from '../../components/common/StatCard';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { normSearch } from '../../utils/searchUtils';
import {
    fetchInventorySyncLog, fetchProductCategories, fetchAllVencidosInventory,
    fetchExpiredInventoryCount, fetchInventoryDetail,
} from '../../data/inventarioTab';
import { fetchLaboratoriosBasic } from '../../data/laboratorios';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4',
    5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER  = [1, 2, 3, 4, 5, 7, 6];
// Guarda el NOMBRE de la variante, no tres clases (2026-07-28, D3.5).
const ERP_VARIANTE = {
    1: 'neutral',
    2: 'neutral',
    3: 'success',
    4: 'neutral',
    5: 'danger',
    6: 'warning',
    7: 'neutral',
};

function parseFactor(detalle) {
    if (!detalle) return 1;
    const m = detalle.match(/[Xx](\d+)/);
    return m ? parseInt(m[1], 10) : 1;
}

function expiryInfo(fecha) {
    if (!fecha) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.ceil((new Date(fecha) - today) / 86400000);
    return { days, expired: days < 0 };
}

function ExpiryCell({ fecha }) {
    if (!fecha) return <span className="text-content-3 text-xs">—</span>;
    const info = expiryInfo(fecha);
    if (!info) return null;
    if (info.expired) return (
        <Badge variant="danger" icon={AlertTriangle} uppercase={false}>{fecha}</Badge>
    );
    if (info.days <= 30) return (
        <span className="inline-flex items-center gap-1 text-caption font-semibold text-warning-text bg-warning/10 border border-warning/30 px-2 py-0.5 rounded-full whitespace-nowrap">
            <Calendar size={9} /> {fecha} <span className="opacity-70">{info.days}d</span>
        </span>
    );
    if (info.days <= 90)  return <span className="text-xs font-semibold text-warning whitespace-nowrap">{fecha}</span>;
    if (info.days <= 180) return (
        <Badge variant="chart-4" icon={Calendar} uppercase={false}>{fecha}</Badge>
    );
    return <span className="text-xs text-content-3 whitespace-nowrap">{fecha}</span>;
}

export default function TabInventario({ searchTerm = '' }) {
    const [selectedErp,      setSelectedErp]      = useState(null);
    const [filterVencidos,   setFilterVencidos]   = useState(false);
    const [filterSixMonths,  setFilterSixMonths]  = useState(false);
    const [filterAreaVenc,   setFilterAreaVenc]   = useState(false);
    const [filterLab,        setFilterLab]        = useState(null);
    const [filterCat,        setFilterCat]        = useState(null);
    const [groups,           setGroups]           = useState([]);
    const [total,            setTotal]            = useState(0);
    const [loading,          setLoading]          = useState(false);
    const [page,             setPage]             = useState(1);
    const [pageSize,         setPageSize]         = useState(25);
    const [sortField,        setSortField]        = useState('laboratorio');
    const [sortDir,          setSortDir]          = useState('asc');
    const [syncLog,          setSyncLog]          = useState([]);
    const [labOptions,       setLabOptions]       = useState([]);
    const [catOptions,       setCatOptions]       = useState([]);
    const [expiredTotal,     setExpiredTotal]     = useState(0);
    const [sixMonthsTotal,   setSixMonthsTotal]   = useState(0);
    const [inversionTotal,   setInversionTotal]   = useState(0);
    const [expandedKey,      setExpandedKey]      = useState(null);
    const [expandedData,     setExpandedData]     = useState({});
    const [expandedVencidos, setExpandedVencidos] = useState({});
    const [expandLoading,    setExpandLoading]    = useState(new Set());
    const [loadError,        setLoadError]        = useState(null);
    const [vencidosMap,      setVencidosMap]      = useState({});
    const loadRef = useRef(0);
    const isBodega = selectedErp === 6;

    useEffect(() => {
        fetchInventorySyncLog()
            .then(({ data }) => setSyncLog(data || []));
        fetchLaboratoriosBasic()
            .then(({ data }) => setLabOptions((data || []).map(l => ({ value: String(l.id), label: l.nombre }))));
        fetchProductCategories()
            .then(({ data }) => setCatOptions((data || []).map(r => ({ value: r.nombre, label: r.nombre }))));
    }, []);

    useEffect(() => {
        let cancelled = false;
        fetchAllVencidosInventory(selectedErp).then((data) => {
            if (cancelled) return;
            const map = {};
            for (const row of (data || [])) {
                const key = `${row.erp_sucursal_id}_${row.erp_product_id}`;
                const factor = parseFactor(row.detalle);
                map[key] = (map[key] || 0) + (row.cantidad || 0) * factor;
            }
            setVencidosMap(map);
        });
        return () => { cancelled = true; };
    }, [selectedErp]);

    useEffect(() => { setPage(1); }, [selectedErp, filterVencidos, filterSixMonths, filterAreaVenc, filterLab, filterCat, searchTerm, pageSize, sortField]);

    // El área de vencidos solo existe en bodega — al salir de bodega se apaga el filtro
    useEffect(() => { if (!isBodega) setFilterAreaVenc(false); }, [isBodega]);

    const loadInventory = useCallback(async (erpId, fVenc, fSix, fArea, labId, catId, q, pg, ps, sf, sd) => {
        const rid = ++loadRef.current;
        setLoading(true);
        setLoadError(null);
        setExpandedKey(null);
        try {
            const [{ data, error }, smResult, invResult] = await Promise.all([
                supabase.rpc('inventory_grouped', {
                    p_erp_id:         erpId,
                    p_vencidos:       fVenc,
                    p_proximos:       fSix,
                    p_area_vencidos:  fArea,
                    p_lab_id:    labId,
                    p_categoria: catId,
                    p_search:    normSearch(q) || null,
                    p_sort:      sf,
                    p_sort_dir:  sd,
                    p_limit:     ps,
                    p_offset:    (pg - 1) * ps,
                }),
                supabase.rpc('inventory_proximos_count', {
                    p_erp_id:    erpId,
                    p_lab_id:    labId,
                    p_categoria: catId,
                    p_search:    normSearch(q) || null,
                }),
                supabase.rpc('inventory_inversion', {
                    p_erp_id:    erpId,
                    p_lab_id:    labId,
                    p_categoria: catId,
                    p_search:    normSearch(q) || null,
                }),
            ]);
            if (rid !== loadRef.current) return;
            if (error) throw error;
            setSixMonthsTotal(smResult.data != null ? Number(smResult.data) : 0);
            setInversionTotal(invResult.data != null ? Number(invResult.data) : 0);

            setGroups(data || []);
            setTotal(data?.length ? Number(data[0].total) : 0);

            const today = new Date().toISOString().split('T')[0];
            const { count: ec } = await fetchExpiredInventoryCount(erpId, today);
            if (rid !== loadRef.current) return;
            setExpiredTotal(ec ?? 0);
        } catch (e) {
            if (rid !== loadRef.current) return;
            console.error(e);
            setLoadError(e?.message || 'Error al cargar inventario');
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const t = setTimeout(() =>
            loadInventory(selectedErp, filterVencidos, filterSixMonths, filterAreaVenc, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir), 50);
        return () => clearTimeout(t);
    }, [selectedErp, filterVencidos, filterSixMonths, filterAreaVenc, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir, loadInventory]);

    const handleSort = useCallback((field) => {
        if (field === sortField) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
    }, [sortField]);

    const handleExpand = useCallback(async (erpId, productId) => {
        const key = `${erpId}_${productId}`;
        if (expandedKey === key) { setExpandedKey(null); return; }
        setExpandedKey(key);
        if (expandedData[key]) return;

        setExpandLoading(prev => new Set([...prev, key]));
        try {
            const [{ data }, { data: vData }] = await Promise.all([
                fetchInventoryDetail(erpId, productId, false),
                fetchInventoryDetail(erpId, productId, true),
            ]);
            setExpandedData(prev => ({ ...prev, [key]: data || [] }));
            setExpandedVencidos(prev => ({ ...prev, [key]: vData || [] }));
        } finally {
            setExpandLoading(prev => { const s = new Set(prev); s.delete(key); return s; });
        }
    }, [expandedKey, expandedData]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const colCount   = selectedErp === null ? 7 : 6;
    const tableColumns = [
        ...(selectedErp === null ? [{ key: 'sucursal',     label: 'Sucursal',    sortable: true }] : []),
        { key: 'laboratorio',  label: 'Laboratorio',       sortable: true, hideBelow: 'lg' },
        { key: 'descripcion',  label: 'Producto',          sortable: true },
        { key: 'presentacion', label: 'Presentación',      hideBelow: 'md' },
        { key: 'lote',         label: 'Lote',              hideBelow: 'lg' },
        { key: 'unidades',     label: 'Und.',              sortable: true, align: 'right' },
        { key: 'vence',        label: 'Vence',             hideBelow: 'sm' },
    ];

    const erpOptions = ERP_ORDER.map(id => {
        const log = syncLog.find(l => l.erp_sucursal_id === id && !l.is_vencidos && l.success);
        return {
            value: String(id),
            label: ERP_NAMES[id],
            sublabel: log?.items_count != null ? log.items_count.toLocaleString() + ' items' : undefined,
        };
    });

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Stats + filter pill ── */}
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">

                    <div data-surface="card" className="flex items-center gap-3 pl-3 pr-4 py-3 min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-chart-1/10">
                            <Package size={15} className="text-brand-text" />
                        </div>
                        <div className="text-left">
                            <div className="text-title-lg font-black leading-none tabular-nums text-content-2">
                                {loading ? <span className="text-content-3">–</span> : total.toLocaleString()}
                            </div>
                            <div className="text-caption font-bold text-content-2">Productos</div>
                            <div className="text-micro text-content-3">
                                {selectedErp !== null ? ERP_NAMES[selectedErp] : 'todas las sucursales'}
                            </div>
                        </div>
                    </div>

                    {/* §16.x — estas cuatro eran la MISMA tarjeta escrita a mano,
                        cuatro veces seguidas en el mismo bloque. `StatCard` ya la
                        tenía, incluida la × al estar activa. */}
                    <StatCard
                        icon={AlertTriangle} iconBg={filterVencidos ? 'bg-surface-card' : 'bg-danger/10'} iconCls="text-danger"
                        label="Vencidos" sub="por fecha"
                        value={loading ? '–' : expiredTotal.toLocaleString()} valueCls="text-danger"
                        active={filterVencidos}
                        activeBg="bg-danger/10 border-danger/40 shadow-md"
                        onClick={() => { setFilterVencidos(v => !v); setFilterSixMonths(false); setFilterAreaVenc(false); }}
                    />

                    <StatCard
                        icon={CalendarClock} iconBg={filterSixMonths ? 'bg-surface-card' : 'bg-chart-4/10'} iconCls="text-chart-4-text"
                        label="Próx. a vencer" sub="en 6 meses"
                        value={loading ? '–' : sixMonthsTotal.toLocaleString()} valueCls="text-chart-4-text"
                        active={filterSixMonths}
                        activeBg="bg-chart-4/10 border-chart-4/40 shadow-md"
                        onClick={() => { setFilterSixMonths(v => !v); setFilterVencidos(false); setFilterAreaVenc(false); }}
                    />

                    {isBodega && (
                        <StatCard
                            icon={PackageX} iconBg={filterAreaVenc ? 'bg-surface-card' : 'bg-danger/10'} iconCls="text-danger-text"
                            label="Área vencidos" sub="ubicación bodega"
                            value={loading ? '–' : Object.keys(vencidosMap).length.toLocaleString()} valueCls="text-danger-text"
                            active={filterAreaVenc}
                            activeBg="bg-danger/10 border-danger/50 shadow-md"
                            onClick={() => { setFilterAreaVenc(v => !v); setFilterVencidos(false); setFilterSixMonths(false); }}
                        />
                    )}

                    <StatCard
                        icon={DollarSign} iconBg="bg-success/10" iconCls="text-success"
                        label="Inversión" sub="costo sin IVA"
                        value={loading ? '–' : `$${inversionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        valueCls="text-success-text"
                    />

                </div>

                {/* `ml-auto`: sin él la barra se queda pegada a la izquierda
                    cuando las tarjetas envuelven a otra línea (§17 la quiere a
                    la derecha). Mismo caso que TabMinMax y TabCatalogo. */}
                {/* §17 — píldora escrita a mano, y encima `hidden lg:flex`:
                    bajo 1024px esta pestaña no tenía NINGÚN filtro. `FilterBar`
                    colapsa a hoja inferior en vez de desaparecer. */}
                <FilterBar
                    className="ml-auto"
                    onClear={() => { setSelectedErp(null); setFilterLab(null); setFilterCat(null); }}
                    activeCount={[selectedErp !== null, filterLab !== null, filterCat !== null].filter(Boolean).length}
                >
                    <FilterBar.Section active={selectedErp !== null} onClear={() => setSelectedErp(null)} label="sucursal">
                        <div className="w-[175px]">
                            <LiquidSelect
                                value={selectedErp !== null ? String(selectedErp) : ''}
                                onChange={v => setSelectedErp(v ? parseInt(v) : null)}
                                options={erpOptions}
                                placeholder="Todas las sucursales"
                                icon={Building2}
                                clearable={false} compact bare
                            />
                        </div>
                    </FilterBar.Section>

                    {labOptions.length > 0 && (
                        <FilterBar.Section active={filterLab !== null} onClear={() => setFilterLab(null)} label="laboratorio">
                            <div className="w-[175px]">
                                <LiquidSelect
                                    value={filterLab !== null ? String(filterLab) : ''}
                                    onChange={v => setFilterLab(v ? parseInt(v) : null)}
                                    options={labOptions}
                                    placeholder="Laboratorio"
                                    clearable={false} compact bare
                                />
                            </div>
                        </FilterBar.Section>
                    )}

                    {catOptions.length > 0 && (
                        <FilterBar.Section active={filterCat !== null} onClear={() => setFilterCat(null)} label="categoría">
                            <div className="w-[155px]">
                                <LiquidSelect
                                    value={filterCat || ''}
                                    onChange={v => setFilterCat(v || null)}
                                    options={catOptions}
                                    placeholder="Categoría"
                                    clearable={false} compact bare
                                />
                            </div>
                        </FilterBar.Section>
                    )}
                </FilterBar>
            </div>

            {/* ── Table ── */}
            {loadError ? (
                <div className="rounded-2xl border border-danger/30 bg-danger/10 shadow-sm py-16 text-center">
                    <AlertTriangle size={28} className="opacity-40 mx-auto mb-3 text-danger" />
                    <p className="text-sm font-semibold text-danger mb-1">Error al cargar inventario</p>
                    <p className="text-label text-danger mb-4">{loadError}</p>
                    <Button variant="destructive" onClick={() => loadInventory(selectedErp, filterVencidos, filterSixMonths, filterAreaVenc, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir)}>Reintentar</Button>
                </div>
            ) : (
                <DataTable
                    columns={tableColumns}
                    sortKey={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    loading={loading}
                    skeletonRows={Math.min(pageSize, 8)}
                    empty={{ icon: Package, message: 'No se encontraron productos' }}
                    minWidth="700px"
                >
                    {groups.map((group, i) => {
                        const key        = `${group.erp_sucursal_id}_${group.erp_product_id}`;
                        const isExpanded = expandedKey === key;
                        const lab        = group.laboratorio ?? null;
                        const numLotes   = Number(group.num_lotes);
                        const loteDisplay = numLotes === 0 ? '—'
                            : numLotes === 1 ? (group.lote_sample || '—')
                            : 'VARIOS';
                        const pres  = group.presentaciones || [];
                        const units = Number(group.total_unidades);
                        const info       = group.earliest_venc ? expiryInfo(group.earliest_venc) : null;
                        const hasExpired = info?.expired;
                        const isSoon     = info && !info.expired && info.days <= 30;
                        const isSixMo    = info && !info.expired && info.days > 30 && info.days <= 180;

                        return (
                            <React.Fragment key={key}>
                                <DataRow
                                    index={i}
                                    onClick={() => handleExpand(group.erp_sucursal_id, group.erp_product_id)}
                                    className={
                                        isExpanded ? 'bg-chart-1/10' :
                                        hasExpired ? 'bg-danger/10' :
                                        isSoon     ? 'bg-warning/10' :
                                        isSixMo    ? 'bg-chart-4/10' : ''
                                    }
                                >
                                    {selectedErp === null && (
                                        <DataCell className="whitespace-nowrap">
                                            <Badge variant={ERP_VARIANTE[group.erp_sucursal_id] ?? 'neutral'} size="sm" uppercase={false}>{ERP_NAMES[group.erp_sucursal_id] ?? `S${group.erp_sucursal_id}`}
                                            </Badge>
                                        </DataCell>
                                    )}

                                    <DataCell hideBelow="lg">
                                        <span className="text-label text-content-3">
                                            {lab || <span className="text-content-3">—</span>}
                                        </span>
                                    </DataCell>

                                    <DataCell>
                                        <div className="flex items-center gap-2">
                                            <ChevronDown size={12} strokeWidth={2.5}
                                                className={`text-content-3 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-brand-text' : ''}`} />
                                            <div className="min-w-0">
                                                <span className="text-body font-medium text-content line-clamp-2 leading-tight">
                                                    {group.descripcion || '—'}
                                                </span>
                                                {group.es_antibiotico && (
                                                    <Badge variant="chart-4" size="sm" uppercase={false} className="mt-0.5">Bajo Receta</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </DataCell>

                                    <DataCell hideBelow="md">
                                        {pres.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {pres.map(p => (
                                                    <Badge key={p} uppercase={false}>{p}</Badge>
                                                ))}
                                            </div>
                                        ) : <span className="text-content-3 text-xs">—</span>}
                                    </DataCell>

                                    <DataCell hideBelow="lg">
                                        <span className="text-label font-mono text-content-3">
                                            {loteDisplay}
                                        </span>
                                    </DataCell>

                                    <DataCell align="right" className="whitespace-nowrap">
                                        <span className={`text-sm font-semibold tabular-nums ${
                                            units === 0 ? 'text-content-3' :
                                            hasExpired  ? 'text-danger'   : 'text-content-2'
                                        }`}>
                                            {units.toLocaleString()}
                                        </span>
                                        <span className="text-micro text-content-3 ml-0.5">und</span>
                                        {(() => {
                                            const vUnits = vencidosMap[`${group.erp_sucursal_id}_${group.erp_product_id}`] || 0;
                                            if (!vUnits) return null;
                                            return (
                                                <span className="ml-1.5 text-caption font-bold text-danger-text tabular-nums">
                                                    / {vUnits.toLocaleString()} V
                                                </span>
                                            );
                                        })()}
                                    </DataCell>

                                    <DataCell hideBelow="sm">
                                        <ExpiryCell fecha={group.earliest_venc} />
                                    </DataCell>
                                </DataRow>

                                {isExpanded && (
                                    <tr>
                                        <td colSpan={colCount} className="p-0 border-b border-chart-1/30">
                                            <div className="bg-gradient-to-br from-chart-1/10 via-[var(--row-expand-sheen)] to-divider px-10 py-3">
                                                {expandLoading.has(key) ? (
                                                    <div className="flex items-center gap-2 text-content-3 py-2">
                                                        <Loader2 size={14} className="animate-spin" />
                                                        <span className="text-xs">Cargando...</span>
                                                    </div>
                                                ) : (expandedData[key] || []).length === 0 && (expandedVencidos[key] || []).length === 0 ? (
                                                    <p className="text-xs text-content-3 py-2">Sin datos</p>
                                                ) : (
                                                    <>
                                                        {/* Regular inventory */}
                                                        {(expandedData[key] || []).length > 0 && (
                                                            <table className="w-full">
                                                                {(expandedVencidos[key] || []).length > 0 && <caption className="text-left text-micro font-black uppercase tracking-widest text-chart-1-text pb-1.5">Inventario regular</caption>}
                                                                <thead>
                                                                    <tr>
                                                                        {['Presentación', 'Lote', 'Vence', 'Cant.', 'Unidades'].map(h => (
                                                                            <th key={h}
                                                                                className={`pb-2 text-micro font-black uppercase tracking-widest text-content-3 pr-6 last:pr-0 ${
                                                                                    h === 'Cant.' || h === 'Unidades' ? 'text-right' : 'text-left'
                                                                                }`}>
                                                                                {h}
                                                                            </th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(expandedData[key] || []).map((row, j) => {
                                                                        const factor   = parseFactor(row.detalle);
                                                                        const rowUnits = (row.cantidad || 0) * factor;
                                                                        return (
                                                                            <tr key={j} className="border-t border-divider">
                                                                                <td className="py-1.5 pr-6">
                                                                                    <span className="text-body-sm font-semibold text-content-2">
                                                                                        {row.presentacion || '—'}
                                                                                    </span>
                                                                                    {row.detalle && (
                                                                                        <span className="text-caption text-content-3 font-mono ml-1.5">
                                                                                            {row.detalle}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-label font-mono text-content-3">
                                                                                    {row.lote || '—'}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6">
                                                                                    <ExpiryCell fecha={row.fecha_vencimiento} />
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-right text-body-sm font-semibold text-content-2 tabular-nums">
                                                                                    {(row.cantidad || 0).toLocaleString()}
                                                                                </td>
                                                                                <td className="py-1.5 text-right">
                                                                                    <span className={`text-body-sm font-bold tabular-nums ${rowUnits === 0 ? 'text-content-3' : 'text-content-2'}`}>
                                                                                        {rowUnits.toLocaleString()}
                                                                                    </span>
                                                                                    <span className="text-micro text-content-3 ml-0.5">und</span>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        )}

                                                        {/* Vencidos section */}
                                                        {(expandedVencidos[key] || []).length > 0 && (
                                                            <table className="w-full mt-3">
                                                                <caption className="text-left text-micro font-black uppercase tracking-widest text-danger-text pb-1.5">
                                                                    Ubicación vencidos
                                                                </caption>
                                                                <thead>
                                                                    <tr>
                                                                        {['Presentación', 'Lote', 'Vence', 'Cant.', 'Unidades'].map(h => (
                                                                            <th key={h}
                                                                                className={`pb-2 text-micro font-black uppercase tracking-widest text-danger-text pr-6 last:pr-0 ${
                                                                                    h === 'Cant.' || h === 'Unidades' ? 'text-right' : 'text-left'
                                                                                }`}>
                                                                                {h}
                                                                            </th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {(expandedVencidos[key] || []).map((row, j) => {
                                                                        const factor   = parseFactor(row.detalle);
                                                                        const rowUnits = (row.cantidad || 0) * factor;
                                                                        return (
                                                                            <tr key={j} className="border-t border-danger/20">
                                                                                <td className="py-1.5 pr-6">
                                                                                    <span className="text-body-sm font-semibold text-danger-text">
                                                                                        {row.presentacion || '—'}
                                                                                    </span>
                                                                                    {row.detalle && (
                                                                                        <span className="text-caption text-danger-text font-mono ml-1.5">
                                                                                            {row.detalle}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-label font-mono text-danger-text">
                                                                                    {row.lote || '—'}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6">
                                                                                    <ExpiryCell fecha={row.fecha_vencimiento} />
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-right text-body-sm font-semibold text-danger-text tabular-nums">
                                                                                    {(row.cantidad || 0).toLocaleString()}
                                                                                </td>
                                                                                <td className="py-1.5 text-right">
                                                                                    <span className={`text-body-sm font-bold tabular-nums ${rowUnits === 0 ? 'text-content-3' : 'text-danger-text'}`}>
                                                                                        {rowUnits.toLocaleString()}
                                                                                    </span>
                                                                                    <span className="text-micro text-danger-text ml-0.5">und</span>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        );
                    })}
                </DataTable>
            )}

            {/* ── Pagination ── */}
            {!loading && total > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={total}
                    unit="grupos"
                />
            )}
        </div>
    );
}
