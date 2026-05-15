import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    AlertTriangle, Calendar, CalendarClock, Loader2, Package, RefreshCw,
    Building2, X, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4',
    5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER  = [1, 2, 3, 4, 5, 7, 6];
const PAGE_SIZES = [25, 50, 100];

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

function relativeTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2)  return 'ahora mismo';
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `hace ${hrs}h`;
    return new Date(iso).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' });
}

function ExpiryCell({ fecha }) {
    if (!fecha) return <span className="text-slate-300 text-xs">—</span>;
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

function SmartPagination({ page, total, onChange }) {
    if (total <= 1) return null;
    const buildPages = () => {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        const left  = Math.max(2, page - 1);
        const right = Math.min(total - 1, page + 1);
        if (left > 2) pages.push('…');
        for (let i = left; i <= right; i++) pages.push(i);
        if (right < total - 1) pages.push('…');
        pages.push(total);
        return pages;
    };
    return (
        <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                <ChevronLeft size={12} strokeWidth={2.5} /> Ant.
            </button>
            <div className="flex items-center gap-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <span key={`e${i}`} className="w-6 text-center text-slate-300 text-[12px] font-bold select-none">·</span>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-full text-[12px] font-black transition-all duration-200 ${
                                p === page
                                    ? 'bg-[#007AFF] text-white shadow-md shadow-blue-200 scale-110'
                                    : 'text-slate-500 hover:bg-white hover:border hover:border-slate-200 hover:shadow-sm hover:text-slate-800'
                            }`}>{p}</button>
                )}
            </div>
            <button disabled={page >= total} onClick={() => onChange(page + 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                Sig. <ChevronRight size={12} strokeWidth={2.5} />
            </button>
        </div>
    );
}

function SortTh({ field, label, sortField, sortDir, onSort, className = '' }) {
    const active = sortField === field;
    return (
        <th onClick={() => onSort(field)}
            className={`px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest cursor-pointer select-none transition-colors whitespace-nowrap ${
                active ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-600'
            } ${className}`}>
            <span className="flex items-center gap-1">
                {label}
                <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-30'}`}>
                    {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </span>
            </span>
        </th>
    );
}

export default function TabInventario({ searchTerm = '' }) {
    const [selectedErp,    setSelectedErp]    = useState(null);
    const [filterVencidos,  setFilterVencidos]  = useState(false);
    const [filterSixMonths, setFilterSixMonths] = useState(false);
    const [filterLab,       setFilterLab]       = useState(null);
    const [filterCat,      setFilterCat]      = useState(null);
    const [groups,         setGroups]         = useState([]);
    const [total,          setTotal]          = useState(0);
    const [loading,        setLoading]        = useState(false);
    const [page,           setPage]           = useState(1);
    const [pageSize,       setPageSize]       = useState(25);
    const [sortField,      setSortField]      = useState('descripcion');
    const [sortDir,        setSortDir]        = useState('asc');
    const [syncLog,        setSyncLog]        = useState([]);
    const [labMap,         setLabMap]         = useState({});
    const [labOptions,     setLabOptions]     = useState([]);
    const [catOptions,     setCatOptions]     = useState([]);
    const [expiredTotal,    setExpiredTotal]    = useState(0);
    const [sixMonthsTotal,  setSixMonthsTotal]  = useState(0);
    const [expandedKey,    setExpandedKey]    = useState(null);
    const [expandedData,   setExpandedData]   = useState({});
    const [expandLoading,  setExpandLoading]  = useState(new Set());

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

    useEffect(() => { setPage(1); }, [selectedErp, filterVencidos, filterSixMonths, filterLab, filterCat, searchTerm, pageSize, sortField]);

    const loadInventory = useCallback(async (erpId, fVenc, fSix, labId, catId, q, pg, ps, sf, sd) => {
        setLoading(true);
        setExpandedKey(null);
        try {
            const [{ data, error }, smResult] = await Promise.all([
                supabase.rpc('inventory_grouped', {
                    p_erp_id:    erpId,
                    p_vencidos:  fVenc,
                    p_proximos:  fSix,
                    p_lab_id:    labId,
                    p_categoria: catId,
                    p_search:    q.trim() || null,
                    p_sort:      sf,
                    p_sort_dir:  sd,
                    p_limit:     ps,
                    p_offset:    (pg - 1) * ps,
                }),
                supabase.rpc('inventory_grouped', {
                    p_erp_id:    erpId,
                    p_proximos:  true,
                    p_lab_id:    labId,
                    p_categoria: catId,
                    p_search:    q.trim() || null,
                    p_limit:     1,
                    p_offset:    0,
                }),
            ]);
            if (error) throw error;
            setSixMonthsTotal(smResult.data?.[0]?.total ? Number(smResult.data[0].total) : 0);
            if (error) throw error;

            setGroups(data || []);
            setTotal(data?.length ? Number(data[0].total) : 0);

            const ids = [...new Set((data || []).map(r => r.erp_product_id).filter(Boolean))];
            if (ids.length) {
                const { data: prods } = await supabase
                    .from('products')
                    .select('id, laboratorios(nombre)')
                    .in('id', ids);
                const map = {};
                (prods || []).forEach(p => { map[p.id] = p.laboratorios?.nombre ?? null; });
                setLabMap(map);
            } else {
                setLabMap({});
            }

            const today = new Date().toISOString().split('T')[0];
            let cq = supabase
                .from('inventory')
                .select('*', { count: 'exact', head: true })
                .eq('is_vencidos', false)
                .lt('fecha_vencimiento', today);
            if (erpId !== null) cq = cq.eq('erp_sucursal_id', erpId);
            const { count: ec } = await cq;
            setExpiredTotal(ec ?? 0);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const t = setTimeout(() =>
            loadInventory(selectedErp, filterVencidos, filterSixMonths, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir), 200);
        return () => clearTimeout(t);
    }, [selectedErp, filterVencidos, filterSixMonths, filterLab, filterCat, searchTerm, page, pageSize, sortField, sortDir, loadInventory]);

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
            const { data } = await supabase
                .from('inventory')
                .select('presentacion, detalle, lote, fecha_vencimiento, cantidad')
                .eq('erp_sucursal_id', erpId)
                .eq('erp_product_id', productId)
                .eq('is_vencidos', false)
                .order('presentacion')
                .order('lote');
            setExpandedData(prev => ({ ...prev, [key]: data || [] }));
        } finally {
            setExpandLoading(prev => { const s = new Set(prev); s.delete(key); return s; });
        }
    }, [expandedKey, expandedData]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const colCount   = selectedErp === null ? 7 : 6;

    const lastSync = (() => {
        const logs = syncLog.filter(l =>
            l.is_vencidos === false && l.success &&
            (selectedErp === null || l.erp_sucursal_id === selectedErp)
        );
        if (!logs.length) return null;
        return logs.sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0]?.synced_at;
    })();

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
                            <Package size={15} className="text-[#007AFF]" />
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
                        onClick={() => { setFilterVencidos(v => !v); setFilterSixMonths(false); }}
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
                        onClick={() => { setFilterSixMonths(v => !v); setFilterVencidos(false); }}
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

                    {lastSync && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 self-center">
                            <RefreshCw size={9} />
                            {relativeTime(lastSync)}
                        </span>
                    )}
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
                                        compact
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
                                            compact
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
                                            compact
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
            {loading ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="min-w-full">
                        <tbody>
                            {Array.from({ length: Math.min(pageSize, 8) }).map((_, i) => (
                                <tr key={i} className="border-b border-slate-50 last:border-0">
                                    <td className="px-4 py-3"><div className="h-3 w-48 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-16 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 text-right"><div className="h-3 w-10 rounded-full bg-slate-100 animate-pulse ml-auto" /></td>
                                    <td className="px-4 py-3 hidden sm:table-cell"><div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : total === 0 ? (
                <div className="rounded-2xl border border-black/[0.07] bg-white shadow-sm py-20 text-center text-slate-400">
                    <Package size={32} className="opacity-30 mx-auto mb-3" />
                    <p className="text-sm">No se encontraron productos</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                    {selectedErp === null && (
                                        <SortTh field="sucursal" label="Sucursal" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    )}
                                    <SortTh field="descripcion" label="Producto" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell whitespace-nowrap">Presentación</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell whitespace-nowrap">Lote</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell whitespace-nowrap">Laboratorio</th>
                                    <SortTh field="unidades" label="Und." sortField={sortField} sortDir={sortDir} onSort={handleSort} className="text-right" />
                                    <SortTh field="vence" label="Vence" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {groups.map((group) => {
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
                                            <tr
                                                onClick={() => handleExpand(group.erp_sucursal_id, group.erp_product_id)}
                                                className={`cursor-pointer transition-colors ${
                                                    isExpanded ? 'bg-blue-50/50' :
                                                    hasExpired ? 'bg-red-50/40 hover:bg-red-50/60' :
                                                    isSoon     ? 'bg-amber-50/30 hover:bg-amber-50/50' :
                                                    isSixMo    ? 'bg-orange-50/20 hover:bg-orange-50/40' :
                                                    'hover:bg-slate-50/70'
                                                }`}>

                                                {selectedErp === null && (
                                                    <td className="px-4 py-2.5 whitespace-nowrap">
                                                        <span className="text-[11px] font-bold text-[#007AFF] bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                                                            {ERP_NAMES[group.erp_sucursal_id] ?? `S${group.erp_sucursal_id}`}
                                                        </span>
                                                    </td>
                                                )}

                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <ChevronDown size={12} strokeWidth={2.5}
                                                            className={`text-slate-300 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#007AFF]' : ''}`} />
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
                                                </td>

                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    {pres.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {pres.map(p => (
                                                                <span key={p} className="text-[10px] font-bold text-slate-500 bg-slate-100/80 border border-slate-200/60 px-2 py-0.5 rounded-full">
                                                                    {p}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : <span className="text-slate-300 text-xs">—</span>}
                                                </td>

                                                <td className="px-4 py-2.5 hidden lg:table-cell">
                                                    <span className={`text-[11px] font-mono ${numLotes > 1 ? 'text-slate-400 italic' : 'text-slate-500'}`}>
                                                        {loteDisplay}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-2.5 hidden lg:table-cell">
                                                    <span className="text-[11px] text-slate-500">
                                                        {lab || <span className="text-slate-200">—</span>}
                                                    </span>
                                                </td>

                                                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                                    <span className={`text-sm font-semibold tabular-nums ${
                                                        units === 0   ? 'text-slate-300' :
                                                        hasExpired    ? 'text-red-600'   : 'text-slate-700'
                                                    }`}>
                                                        {units.toLocaleString()}
                                                    </span>
                                                    <span className="text-[9px] text-slate-300 ml-0.5">und</span>
                                                </td>

                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <ExpiryCell fecha={group.earliest_venc} />
                                                </td>
                                            </tr>

                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={colCount} className="p-0 border-b border-blue-100/60">
                                                        <div className="bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 px-10 py-3">
                                                            {expandLoading.has(key) ? (
                                                                <div className="flex items-center gap-2 text-slate-400 py-2">
                                                                    <Loader2 size={14} className="animate-spin" />
                                                                    <span className="text-xs">Cargando...</span>
                                                                </div>
                                                            ) : (expandedData[key] || []).length === 0 ? (
                                                                <p className="text-xs text-slate-400 py-2">Sin datos</p>
                                                            ) : (
                                                                <table className="w-full">
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
                                                                        {(expandedData[key] || []).map((row, i) => {
                                                                            const factor   = parseFactor(row.detalle);
                                                                            const rowUnits = (row.cantidad || 0) * factor;
                                                                            return (
                                                                                <tr key={i} className="border-t border-slate-100/60">
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
                                                                                        <span className={`text-[12px] font-bold tabular-nums ${rowUnits === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                                                                                            {rowUnits.toLocaleString()}
                                                                                        </span>
                                                                                        <span className="text-[9px] text-slate-300 ml-0.5">und</span>
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                    </tbody>
                                                                </table>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Pagination ── */}
            {!loading && total > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {PAGE_SIZES.map(size => (
                            <button key={size}
                                onClick={() => { setPageSize(size); setPage(1); }}
                                className={`px-3 h-7 rounded-full text-[10px] font-bold transition-all border ${
                                    pageSize === size
                                        ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                                }`}>
                                {size}
                            </button>
                        ))}
                    </div>
                    <SmartPagination page={page} total={totalPages} onChange={setPage} />
                    <span className="text-[10px] text-slate-400 font-semibold w-[80px] text-right">
                        {total.toLocaleString()} grupos
                    </span>
                </div>
            )}
        </div>
    );
}
