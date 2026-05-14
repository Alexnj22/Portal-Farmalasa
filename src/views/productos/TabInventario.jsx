import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { AlertTriangle, Calendar, Loader2, Package, RefreshCw } from 'lucide-react';

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
    const [items, setItems]             = useState([]);
    const [loading, setLoading]         = useState(false);
    const [syncLog, setSyncLog]         = useState([]);

    useEffect(() => {
        loadInventory();
    }, [selectedErp, showVencidos]);

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

    const totalUnits  = filtered.reduce((s, i) => s + (i.cantidad || 0), 0);
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

    return (
        <div className="h-full flex flex-col">

            {/* Filter bar */}
            <div className="flex-shrink-0 px-5 pt-4 pb-3 flex items-center gap-2 flex-wrap border-b border-slate-100">
                {/* Branch pills */}
                <button
                    onClick={() => setSelectedErp(null)}
                    className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-all border ${
                        selectedErp === null
                            ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm'
                            : 'bg-white/70 text-slate-600 border-slate-200 hover:border-[#007AFF]/40 hover:text-slate-800'
                    }`}>
                    Todas
                </button>
                {ERP_ORDER.map(erpId => {
                    const log = syncLog.find(l => l.erp_sucursal_id === erpId && l.is_vencidos === showVencidos && l.success);
                    return (
                        <button key={erpId}
                            onClick={() => setSelectedErp(selectedErp === erpId ? null : erpId)}
                            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-all border ${
                                selectedErp === erpId
                                    ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm'
                                    : 'bg-white/70 text-slate-600 border-slate-200 hover:border-[#007AFF]/40 hover:text-slate-800'
                            }`}>
                            {ERP_NAMES[erpId]}
                            {log?.items_count != null && (
                                <span className={`text-[10px] ${selectedErp === erpId ? 'text-white/70' : 'text-slate-400'}`}>
                                    {log.items_count.toLocaleString()}
                                </span>
                            )}
                        </button>
                    );
                })}

                {/* Vencidos toggle */}
                <div className="ml-auto flex items-center bg-white/70 border border-slate-200 rounded-full p-0.5 gap-0.5 flex-shrink-0">
                    <button onClick={() => setShowVencidos(false)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                            !showVencidos ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}>
                        Normal
                    </button>
                    <button onClick={() => setShowVencidos(true)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                            showVencidos ? 'bg-red-100 text-red-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}>
                        Vencidos
                    </button>
                </div>
            </div>

            {/* Stats row */}
            {!loading && filtered.length > 0 && (
                <div className="flex-shrink-0 px-5 py-2.5 flex items-center gap-4 border-b border-slate-100 flex-wrap">
                    <span className="text-xs text-slate-500">
                        <strong className="text-slate-700">{filtered.length.toLocaleString()}</strong> productos
                    </span>
                    <span className="text-xs text-slate-500">
                        <strong className="text-slate-700">{totalUnits.toLocaleString()}</strong> unidades
                    </span>
                    {expiredCount > 0 && (
                        <span className="text-xs font-bold text-red-600 flex items-center gap-1">
                            <AlertTriangle size={11} /> {expiredCount} vencido{expiredCount !== 1 ? 's' : ''}
                        </span>
                    )}
                    {showVencidos && (
                        <span className="text-[11px] text-red-500 bg-red-50 border border-red-100 px-2.5 py-0.5 rounded-full font-semibold">
                            Mostrando productos vencidos
                        </span>
                    )}
                    {lastSync && (
                        <span className="ml-auto text-[10px] text-slate-400 flex items-center gap-1 flex-shrink-0">
                            <RefreshCw size={9} />
                            {new Date(lastSync).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}{' '}
                            {new Date(lastSync).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={24} className="animate-spin text-[#007AFF]" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Package size={32} className="mb-3 opacity-40" />
                        <p className="text-sm">
                            {items.length === 0
                                ? 'Sin datos de inventario — ejecuta una sincronización primero'
                                : 'No se encontraron productos con esa búsqueda'}
                        </p>
                    </div>
                ) : (
                    <table className="w-full text-left">
                        <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-50 border-b border-slate-200">
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
                                const inf = item.fecha_vencimiento ? expiryInfo(item.fecha_vencimiento) : null;
                                const isExpired = inf?.expired;
                                const isSoon    = inf && !inf.expired && inf.days <= 30;
                                return (
                                    <tr key={i} className={`transition-colors ${
                                        isExpired ? 'bg-red-50/40 hover:bg-red-50/60' :
                                        isSoon    ? 'bg-amber-50/30 hover:bg-amber-50/50' :
                                        'hover:bg-blue-50/30'
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
                )}
            </div>
        </div>
    );
}
