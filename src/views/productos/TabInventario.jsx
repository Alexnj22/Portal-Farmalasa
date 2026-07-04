import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import {
    AlertTriangle, Calendar, CalendarClock, Loader2, Package, PackageX,
    Building2, X, ChevronLeft, ChevronRight, ChevronDown, DollarSign,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { normSearch } from '../../utils/searchUtils';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4',
    5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER  = [1, 2, 3, 4, 5, 7, 6];
const ERP_COLORS = {
    1: 'text-blue-600 bg-blue-50 border-blue-100',
    2: 'text-violet-600 bg-violet-50 border-violet-100',
    3: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    4: 'text-sky-600 bg-sky-50 border-sky-100',
    5: 'text-rose-600 bg-rose-50 border-rose-100',
    6: 'text-amber-700 bg-amber-50 border-amber-100',
    7: 'text-indigo-600 bg-indigo-50 border-indigo-100',
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
    if (!fecha) return <span className="text-slate-400 text-xs">—</span>;
    const info = expiryInfo(fecha);
    if (!info) return null;
    if (info.expired) return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full whitespace-nowrap">
            <AlertTriangle size={9} /> {fecha}
        </span>
    );
    if (info.days <= 30) return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full whitespace-nowrap">
            <Calendar size={9} /> {fecha} <span className="opacity-70">{info.days}d</span>
        </span>
    );
    if (info.days <= 90)  return <span className="text-xs font-semibold text-amber-600 whitespace-nowrap">{fecha}</span>;
    if (info.days <= 180) return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-400 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-full whitespace-nowrap">
            <Calendar size={9} /> {fecha}
        </span>
    );
    return <span className="text-xs text-slate-400 whitespace-nowrap">{fecha}</span>;
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
    const [sortField,        setSortField]        = useState('descripcion');
    const [sortDir,          setSortDir]          = useState('asc');
    const [syncLog,          setSyncLog]          = useState([]);
    const [labMap,           setLabMap]           = useState({});
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
        supabase.from('inventory_sync_log')
            .select('erp_sucursal_id, is_vencidos, synced_at, success, items_count')
            .order('synced_at', { ascending: false })
            .limit(30)
            .then(({ data }) => setSyncLog(data || []));
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabOptions((data || []).map(l => ({ value: String(l.id), label: l.nombre }))));
        supabase.from('product_categories').select('nombre').order('nombre')
            .then(({ data }) => setCatOptions((data || []).map(r => ({ value: r.nombre, label: r.nombre }))));
    }, []);

    useEffect(() => {
        let q = supabase
            .from('inventory')
            .select('erp_sucursal_id, erp_product_id, cantidad, detalle')
            .eq('is_vencidos', true);
        if (selectedErp !== null) q = q.eq('erp_sucursal_id', selectedErp);
        q.then(({ data }) => {
            const map = {};
            for (const row of (data || [])) {
                const key = `${row.erp_sucursal_id}_${row.erp_product_id}`;
                const factor = parseFactor(row.detalle);
                map[key] = (map[key] || 0) + (row.cantidad || 0) * factor;
            }
            setVencidosMap(map);
        });
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

            const ids = [...new Set((data || []).map(r => r.erp_product_id).filter(Boolean))];
            if (ids.length) {
                const [{ data: prods }, { count: ec }] = await Promise.all([
                    supabase.from('products').select('id, laboratorios(nombre)').in('id', ids),
                    (() => {
                        const today = new Date().toISOString().split('T')[0];
                        let cq = supabase.from('inventory')
                            .select('*', { count: 'exact', head: true })
                            .eq('is_vencidos', false).lt('fecha_vencimiento', today);
                        if (erpId !== null) cq = cq.eq('erp_sucursal_id', erpId);
                        return cq;
                    })(),
                ]);
                if (rid !== loadRef.current) return;
                const map = {};
                (prods || []).forEach(p => { map[p.id] = p.laboratorios?.nombre ?? null; });
                setLabMap(map);
                setExpiredTotal(ec ?? 0);
            } else {
                const today = new Date().toISOString().split('T')[0];
                let cq = supabase.from('inventory')
                    .select('*', { count: 'exact', head: true })
                    .eq('is_vencidos', false).lt('fecha_vencimiento', today);
                if (erpId !== null) cq = cq.eq('erp_sucursal_id', erpId);
                const { count: ec } = await cq;
                if (rid !== loadRef.current) return;
                setLabMap({});
                setExpiredTotal(ec ?? 0);
            }
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
                supabase.from('inventory')
                    .select('presentacion, detalle, lote, fecha_vencimiento, cantidad')
                    .eq('erp_sucursal_id', erpId)
                    .eq('erp_product_id', productId)
                    .eq('is_vencidos', false)
                    .order('presentacion').order('lote'),
                supabase.from('inventory')
                    .select('presentacion, detalle, lote, fecha_vencimiento, cantidad')
                    .eq('erp_sucursal_id', erpId)
                    .eq('erp_product_id', productId)
                    .eq('is_vencidos', true)
                    .order('presentacion').order('lote'),
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
        { key: 'descripcion',  label: 'Producto',          sortable: true },
        { key: 'presentacion', label: 'Presentación',      hideBelow: 'md' },
        { key: 'lote',         label: 'Lote',              hideBelow: 'lg' },
        { key: 'laboratorio',  label: 'Laboratorio',       hideBelow: 'lg' },
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
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">

                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50">
                            <Package size={15} className="text-[#0052CC]" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                                {loading ? <span className="text-slate-200">–</span> : total.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Productos</div>
                            <div className="text-[9px] text-slate-400">
                                {selectedErp !== null ? ERP_NAMES[selectedErp] : 'todas las sucursales'}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => { setFilterVencidos(v => !v); setFilterSixMonths(false); setFilterAreaVenc(false); }}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${
                            filterVencidos
                                ? 'bg-red-50 border-red-300 shadow-md shadow-red-100/80 -translate-y-px'
                                : 'bg-white border-slate-100 hover:border-red-200 hover:bg-red-50/40'
                        }`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${filterVencidos ? 'bg-white' : 'bg-red-50'}`}>
                            <AlertTriangle size={15} className="text-red-500" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-red-600">
                                {loading ? <span className="text-slate-200">–</span> : expiredTotal.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Vencidos</div>
                            <div className="text-[9px] text-slate-400">por fecha</div>
                        </div>
                        {filterVencidos && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>

                    <button
                        onClick={() => { setFilterSixMonths(v => !v); setFilterVencidos(false); setFilterAreaVenc(false); }}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${
                            filterSixMonths
                                ? 'bg-orange-50 border-orange-300 shadow-md shadow-orange-100/80 -translate-y-px'
                                : 'bg-white border-slate-100 hover:border-orange-200 hover:bg-orange-50/40'
                        }`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${filterSixMonths ? 'bg-white' : 'bg-orange-50'}`}>
                            <CalendarClock size={15} className="text-orange-500" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-orange-500">
                                {loading ? <span className="text-slate-200">–</span> : sixMonthsTotal.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Próx. a vencer</div>
                            <div className="text-[9px] text-slate-400">en 6 meses</div>
                        </div>
                        {filterSixMonths && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>

                    {isBodega && (
                        <button
                            onClick={() => { setFilterAreaVenc(v => !v); setFilterVencidos(false); setFilterSixMonths(false); }}
                            className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] ${
                                filterAreaVenc
                                    ? 'bg-rose-50 border-rose-300 shadow-md shadow-rose-100/80 -translate-y-px'
                                    : 'bg-white border-slate-100 hover:border-rose-200 hover:bg-rose-50/40'
                            }`}>
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${filterAreaVenc ? 'bg-white' : 'bg-rose-50'}`}>
                                <PackageX size={15} className="text-rose-500" />
                            </div>
                            <div className="text-left">
                                <div className="text-[22px] font-black leading-none tabular-nums text-rose-600">
                                    {loading ? <span className="text-slate-200">–</span> : Object.keys(vencidosMap).length.toLocaleString()}
                                </div>
                                <div className="text-[10px] font-bold text-slate-600">Área vencidos</div>
                                <div className="text-[9px] text-slate-400">ubicación bodega</div>
                            </div>
                            {filterAreaVenc && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                        </button>
                    )}

                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50">
                            <DollarSign size={15} className="text-emerald-600" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-emerald-700">
                                {loading
                                    ? <span className="text-slate-200">–</span>
                                    : `$${inversionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                }
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Inversión</div>
                            <div className="text-[9px] text-slate-400">costo sin IVA</div>
                        </div>
                    </div>

                </div>

                {(() => {
                    const anyFilter = selectedErp !== null || filterLab !== null || filterCat !== null;
                    return (
                        <div className="hidden lg:flex group items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">

                            {/* Sucursal */}
                            <div className="flex items-center">
                                <div className="px-2 py-2 overflow-visible" style={{ width: '175px' }}>
                                    <LiquidSelect
                                        value={selectedErp !== null ? String(selectedErp) : ''}
                                        onChange={v => setSelectedErp(v ? parseInt(v) : null)}
                                        options={erpOptions}
                                        placeholder="Todas las sucursales"
                                        icon={Building2}
                                        clearable={false}
                                        compact
                                        bare
                                    />
                                </div>
                                {selectedErp !== null && (
                                    <button onClick={() => setSelectedErp(null)}
                                        className="w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                        <X size={9} strokeWidth={3} />
                                    </button>
                                )}
                            </div>

                            {labOptions.length > 0 && <>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                <div className="flex items-center">
                                    <div className="px-2 py-2 overflow-visible" style={{ width: '175px' }}>
                                        <LiquidSelect
                                            value={filterLab !== null ? String(filterLab) : ''}
                                            onChange={v => setFilterLab(v ? parseInt(v) : null)}
                                            options={labOptions}
                                            placeholder="Laboratorio"
                                            clearable={false}
                                            compact
                                            bare
                                        />
                                    </div>
                                    {filterLab !== null && (
                                        <button onClick={() => setFilterLab(null)}
                                            className="w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                            <X size={9} strokeWidth={3} />
                                        </button>
                                    )}
                                </div>
                            </>}

                            {catOptions.length > 0 && <>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                <div className="flex items-center">
                                    <div className="px-2 py-2 overflow-visible" style={{ width: '155px' }}>
                                        <LiquidSelect
                                            value={filterCat || ''}
                                            onChange={v => setFilterCat(v || null)}
                                            options={catOptions}
                                            placeholder="Categoría"
                                            clearable={false}
                                            compact
                                            bare
                                        />
                                    </div>
                                    {filterCat !== null && (
                                        <button onClick={() => setFilterCat(null)}
                                            className="w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                            <X size={9} strokeWidth={3} />
                                        </button>
                                    )}
                                </div>
                            </>}

                            {anyFilter && <>
                                <div className="h-5 w-px bg-slate-100 shrink-0" />
                                <button
                                    onClick={() => { setSelectedErp(null); setFilterLab(null); setFilterCat(null); }}
                                    className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all shrink-0">
                                    <X size={11} strokeWidth={3} />
                                </button>
                            </>}
                        </div>
                    );
                })()}
            </div>

            {/* ── Table ── */}
            {loadError ? (
                <div className="rounded-2xl border border-red-100 bg-red-50 shadow-sm py-16 text-center">
                    <AlertTriangle size={28} className="opacity-40 mx-auto mb-3 text-red-400" />
                    <p className="text-sm font-semibold text-red-600 mb-1">Error al cargar inventario</p>
                    <p className="text-[11px] text-red-400 mb-4">{loadError}</p>
                    <button onClick={() => loadInventory(selectedErp, filterVencidos, filterSixMonths, filterAreaVenc, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir)}
                        className="px-5 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors">
                        Reintentar
                    </button>
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
                        const lab        = labMap[group.erp_product_id] ?? null;
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
                                        isExpanded ? 'bg-blue-50/50' :
                                        hasExpired ? 'bg-red-50/40' :
                                        isSoon     ? 'bg-amber-50/30' :
                                        isSixMo    ? 'bg-orange-50/20' : ''
                                    }
                                >
                                    {selectedErp === null && (
                                        <DataCell className="whitespace-nowrap">
                                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${ERP_COLORS[group.erp_sucursal_id] ?? 'text-slate-600 bg-slate-50 border-slate-200'}`}>
                                                {ERP_NAMES[group.erp_sucursal_id] ?? `S${group.erp_sucursal_id}`}
                                            </span>
                                        </DataCell>
                                    )}

                                    <DataCell>
                                        <div className="flex items-center gap-2">
                                            <ChevronDown size={12} strokeWidth={2.5}
                                                className={`text-slate-400 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#0052CC]' : ''}`} />
                                            <div className="min-w-0">
                                                <span className="text-[13px] font-medium text-slate-800 line-clamp-2 leading-tight">
                                                    {group.descripcion || '—'}
                                                </span>
                                                {group.es_antibiotico && (
                                                    <span className="mt-0.5 inline-flex text-[9px] font-bold text-orange-600 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">
                                                        ANTIBIÓTICO
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </DataCell>

                                    <DataCell hideBelow="md">
                                        {pres.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {pres.map(p => (
                                                    <span key={p} className="text-[10px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200/60 px-2 py-0.5 rounded-full">
                                                        {p}
                                                    </span>
                                                ))}
                                            </div>
                                        ) : <span className="text-slate-400 text-xs">—</span>}
                                    </DataCell>

                                    <DataCell hideBelow="lg">
                                        <span className={`text-[11px] font-mono ${numLotes > 1 ? 'text-slate-400 italic' : 'text-slate-500'}`}>
                                            {loteDisplay}
                                        </span>
                                    </DataCell>

                                    <DataCell hideBelow="lg">
                                        <span className="text-[11px] text-slate-500">
                                            {lab || <span className="text-slate-400">—</span>}
                                        </span>
                                    </DataCell>

                                    <DataCell align="right" className="whitespace-nowrap">
                                        <span className={`text-sm font-semibold tabular-nums ${
                                            units === 0 ? 'text-slate-400' :
                                            hasExpired  ? 'text-red-600'   : 'text-slate-700'
                                        }`}>
                                            {units.toLocaleString()}
                                        </span>
                                        <span className="text-[9px] text-slate-500 ml-0.5">und</span>
                                        {(() => {
                                            const vUnits = vencidosMap[`${group.erp_sucursal_id}_${group.erp_product_id}`] || 0;
                                            if (!vUnits) return null;
                                            return (
                                                <span className="ml-1.5 text-[10px] font-bold text-rose-600 tabular-nums">
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
                                        <td colSpan={colCount} className="p-0 border-b border-blue-100/60">
                                            <div className="bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 px-10 py-3">
                                                {expandLoading.has(key) ? (
                                                    <div className="flex items-center gap-2 text-slate-400 py-2">
                                                        <Loader2 size={14} className="animate-spin" />
                                                        <span className="text-xs">Cargando...</span>
                                                    </div>
                                                ) : (expandedData[key] || []).length === 0 && (expandedVencidos[key] || []).length === 0 ? (
                                                    <p className="text-xs text-slate-400 py-2">Sin datos</p>
                                                ) : (
                                                    <>
                                                        {/* Regular inventory */}
                                                        {(expandedData[key] || []).length > 0 && (
                                                            <table className="w-full">
                                                                {(expandedVencidos[key] || []).length > 0 && <caption className="text-left text-[9px] font-black uppercase tracking-widest text-blue-400 pb-1.5">Inventario regular</caption>}
                                                                <thead>
                                                                    <tr>
                                                                        {['Presentación', 'Lote', 'Vence', 'Cant.', 'Unidades'].map(h => (
                                                                            <th key={h}
                                                                                className={`pb-2 text-[9px] font-black uppercase tracking-widest text-slate-400 pr-6 last:pr-0 ${
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
                                                                            <tr key={j} className="border-t border-slate-100/60">
                                                                                <td className="py-1.5 pr-6">
                                                                                    <span className="text-[12px] font-semibold text-slate-700">
                                                                                        {row.presentacion || '—'}
                                                                                    </span>
                                                                                    {row.detalle && (
                                                                                        <span className="text-[10px] text-slate-400 font-mono ml-1.5">
                                                                                            {row.detalle}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-[11px] font-mono text-slate-500">
                                                                                    {row.lote || '—'}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6">
                                                                                    <ExpiryCell fecha={row.fecha_vencimiento} />
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-right text-[12px] font-semibold text-slate-600 tabular-nums">
                                                                                    {(row.cantidad || 0).toLocaleString()}
                                                                                </td>
                                                                                <td className="py-1.5 text-right">
                                                                                    <span className={`text-[12px] font-bold tabular-nums ${rowUnits === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
                                                                                        {rowUnits.toLocaleString()}
                                                                                    </span>
                                                                                    <span className="text-[9px] text-slate-500 ml-0.5">und</span>
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
                                                                <caption className="text-left text-[9px] font-black uppercase tracking-widest text-rose-500 pb-1.5">
                                                                    Ubicación vencidos
                                                                </caption>
                                                                <thead>
                                                                    <tr>
                                                                        {['Presentación', 'Lote', 'Vence', 'Cant.', 'Unidades'].map(h => (
                                                                            <th key={h}
                                                                                className={`pb-2 text-[9px] font-black uppercase tracking-widest text-rose-400 pr-6 last:pr-0 ${
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
                                                                            <tr key={j} className="border-t border-rose-100/60">
                                                                                <td className="py-1.5 pr-6">
                                                                                    <span className="text-[12px] font-semibold text-rose-700">
                                                                                        {row.presentacion || '—'}
                                                                                    </span>
                                                                                    {row.detalle && (
                                                                                        <span className="text-[10px] text-rose-500 font-mono ml-1.5">
                                                                                            {row.detalle}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-[11px] font-mono text-rose-600">
                                                                                    {row.lote || '—'}
                                                                                </td>
                                                                                <td className="py-1.5 pr-6">
                                                                                    <ExpiryCell fecha={row.fecha_vencimiento} />
                                                                                </td>
                                                                                <td className="py-1.5 pr-6 text-right text-[12px] font-semibold text-rose-600 tabular-nums">
                                                                                    {(row.cantidad || 0).toLocaleString()}
                                                                                </td>
                                                                                <td className="py-1.5 text-right">
                                                                                    <span className={`text-[12px] font-bold tabular-nums ${rowUnits === 0 ? 'text-slate-400' : 'text-rose-600'}`}>
                                                                                        {rowUnits.toLocaleString()}
                                                                                    </span>
                                                                                    <span className="text-[9px] text-rose-500 ml-0.5">und</span>
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
