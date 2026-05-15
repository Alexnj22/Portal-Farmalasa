import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { AlertTriangle, Calendar, Loader2, Package, RefreshCw, Boxes, Building2, X } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4',
    5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [1, 2, 3, 4, 5, 7, 6];

function expiryInfo(fecha) {
    if (!fecha) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((new Date(fecha) - today) / 86400000);
    return { days, expired: days < 0 };
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
    if (info.days <= 90) return <span className="text-xs text-amber-600 whitespace-nowrap">{fecha}</span>;
    return <span className="text-xs text-slate-400 whitespace-nowrap">{fecha}</span>;
}

export default function TabInventario({ searchTerm = '' }) {
    const [selectedErp, setSelectedErp] = useState(null);
    const [showVencidos, setShowVencidos] = useState(false);
    const [items, setItems]              = useState([]);
    const [loading, setLoading]          = useState(false);
    const [syncLog, setSyncLog]          = useState([]);

    useEffect(() => { loadInventory(); }, [selectedErp, showVencidos]);

    useEffect(() => {
        supabase.from('inventory_sync_log')
            .select('erp_sucursal_id, is_vencidos, synced_at, success, items_count')
            .order('synced_at', { ascending: false })
            .limit(30)
            .then(({ data }) => setSyncLog(data || []));
    }, []);

    const loadInventory = async () => {
        setLoading(true);
        try {
            let q = supabase
                .from('inventory')
                .select('erp_sucursal_id, is_vencidos, descripcion, presentacion, detalle, lote, fecha_vencimiento, cantidad')
                .eq('is_vencidos', showVencidos)
                .order('descripcion')
                .limit(6000);
            if (selectedErp !== null) q = q.eq('erp_sucursal_id', selectedErp);
            const { data, error } = await q;
            if (error) throw error;
            setItems(data || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const filtered = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return items;
        return items.filter(i =>
            i.descripcion?.toLowerCase().includes(q) ||
            i.presentacion?.toLowerCase().includes(q) ||
            i.lote?.toLowerCase().includes(q)
        );
    }, [items, searchTerm]);

    const totalUnits   = filtered.reduce((s, i) => s + (i.cantidad || 0), 0);
    const expiredCount = filtered.filter(i => i.fecha_vencimiento && expiryInfo(i.fecha_vencimiento)?.expired).length;

    const lastSync = useMemo(() => {
        const logs = syncLog.filter(l =>
            l.is_vencidos === showVencidos &&
            l.success &&
            (selectedErp === null || l.erp_sucursal_id === selectedErp)
        );
        if (!logs.length) return null;
        return logs.sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0]?.synced_at;
    }, [syncLog, selectedErp, showVencidos]);

    // LiquidSelect options for sucursal
    const erpOptions = ERP_ORDER.map(id => {
        const log = syncLog.find(l => l.erp_sucursal_id === id && l.is_vencidos === showVencidos && l.success);
        return {
            value: String(id),
            label: ERP_NAMES[id],
            sublabel: log?.items_count != null ? log.items_count.toLocaleString() + ' items' : undefined,
        };
    });

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Stats + filter pill row ── */}
            <div className="flex items-start gap-3 flex-wrap">

                {/* Stat cards */}
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">

                    {/* Productos */}
                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50">
                            <Package size={15} className="text-[#007AFF]" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                                {loading ? <span className="text-slate-200">–</span> : filtered.length.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Productos</div>
                            <div className="text-[9px] text-slate-400">
                                {selectedErp !== null ? ERP_NAMES[selectedErp] : 'todas las sucursales'}
                            </div>
                        </div>
                    </div>

                    {/* Unidades */}
                    <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50">
                            <Boxes size={15} className="text-emerald-500" />
                        </div>
                        <div className="text-left">
                            <div className="text-[22px] font-black leading-none tabular-nums text-emerald-600">
                                {loading ? <span className="text-slate-200">–</span> : totalUnits.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600">Unidades</div>
                            <div className="text-[9px] text-slate-400">
                                {showVencidos ? 'vencidas en stock' : 'en stock'}
                            </div>
                        </div>
                    </div>

                    {/* Vencidos — solo cuando hay */}
                    {!loading && expiredCount > 0 && (
                        <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-red-100 bg-red-50/50 min-w-[130px]">
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-red-100">
                                <AlertTriangle size={15} className="text-red-500" />
                            </div>
                            <div className="text-left">
                                <div className="text-[22px] font-black leading-none tabular-nums text-red-600">
                                    {expiredCount.toLocaleString()}
                                </div>
                                <div className="text-[10px] font-bold text-slate-600">Vencidos</div>
                                <div className="text-[9px] text-slate-400">en esta vista</div>
                            </div>
                        </div>
                    )}

                    {/* Last sync */}
                    {lastSync && (
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 self-center">
                            <RefreshCw size={9} />
                            {new Date(lastSync).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}{' '}
                            {new Date(lastSync).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>

                {/* Filter pill */}
                <div className="hidden lg:flex group items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">

                    {/* Sucursal */}
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: '180px' }}>
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
                            <button onClick={() => setSelectedErp(null)} title="Ver todas"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Normal / Vencidos toggle */}
                    <div className="flex items-center gap-0.5 px-2.5 py-2">
                        {[
                            { v: false, label: 'Normal',   active: 'bg-emerald-100 text-emerald-700 shadow-sm' },
                            { v: true,  label: 'Vencidos', active: 'bg-red-100 text-red-700 shadow-sm'         },
                        ].map(({ v, label, active }) => (
                            <button key={label} onClick={() => setShowVencidos(v)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                    showVencidos === v ? active : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Table ── */}
            {loading ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="min-w-full">
                        <tbody>
                            {Array.from({ length: 8 }).map((_, i) => (
                                <tr key={i} className="border-b border-slate-50 last:border-0">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="space-y-1.5">
                                                <div className="h-3 w-48 rounded-full bg-slate-100 animate-pulse" />
                                                <div className="h-2.5 w-28 rounded-full bg-slate-100 animate-pulse" />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 text-right"><div className="h-3 w-10 rounded-full bg-slate-100 animate-pulse ml-auto" /></td>
                                    <td className="px-4 py-3 hidden sm:table-cell"><div className="h-5 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-black/[0.07] bg-white shadow-sm py-20 text-center text-slate-400">
                    <Package size={32} className="opacity-30 mx-auto mb-3" />
                    <p className="text-sm">
                        {items.length === 0
                            ? 'Sin datos de inventario — ejecuta una sincronización primero'
                            : 'No se encontraron productos con esa búsqueda'}
                    </p>
                </div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-left">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                    {selectedErp === null && (
                                        <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">
                                            Sucursal
                                        </th>
                                    )}
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Producto</th>
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Presentación</th>
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell">Lote</th>
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right whitespace-nowrap">Cant.</th>
                                    <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden sm:table-cell">Vence</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((item, i) => {
                                    const inf        = item.fecha_vencimiento ? expiryInfo(item.fecha_vencimiento) : null;
                                    const isExpired  = inf?.expired;
                                    const isSoon     = inf && !inf.expired && inf.days <= 30;
                                    return (
                                        <tr key={i} className={`transition-colors ${
                                            isExpired ? 'bg-red-50/40 hover:bg-red-50/60' :
                                            isSoon    ? 'bg-amber-50/30 hover:bg-amber-50/50' :
                                            'hover:bg-slate-50/70'
                                        }`}>
                                            {selectedErp === null && (
                                                <td className="px-4 py-2.5 whitespace-nowrap">
                                                    <span className="text-[11px] font-bold text-[#007AFF] bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">
                                                        {ERP_NAMES[item.erp_sucursal_id] ?? `S${item.erp_sucursal_id}`}
                                                    </span>
                                                </td>
                                            )}
                                            <td className="px-4 py-2.5 max-w-[200px]">
                                                <span className="text-[13px] font-medium text-slate-800 line-clamp-2 leading-tight" title={item.descripcion}>
                                                    {item.descripcion || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 hidden md:table-cell">
                                                <span className="text-xs text-slate-500">{item.presentacion || '—'}</span>
                                            </td>
                                            <td className="px-4 py-2.5 hidden lg:table-cell">
                                                <span className="text-[11px] text-slate-400 font-mono">
                                                    {[item.lote, item.detalle].filter(Boolean).join(' · ') || '—'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                                <span className={`text-sm font-semibold ${
                                                    item.cantidad === 0 ? 'text-slate-300' :
                                                    isExpired ? 'text-red-600' :
                                                    'text-slate-700'
                                                }`}>
                                                    {item.cantidad?.toLocaleString() ?? 0}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 hidden sm:table-cell">
                                                <ExpiryCell fecha={item.fecha_vencimiento} />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
