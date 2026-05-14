import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Search, X, RefreshCw, Package, AlertTriangle, Calendar,
    Loader2, ChevronDown, ChevronUp,
} from 'lucide-react';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4',
    5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [1, 2, 3, 4, 5, 7, 6];

function expiryInfo(fecha) {
    if (!fecha) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(fecha);
    const days = Math.ceil((exp - today) / 86400000);
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

function BranchBlock({ erpId, items, defaultOpen }) {
    const [open, setOpen] = useState(defaultOpen);
    const units = items.reduce((s, i) => s + (i.cantidad || 0), 0);
    const expired = items.filter(i => i.fecha_vencimiento && expiryInfo(i.fecha_vencimiento)?.expired).length;
    const soon = items.filter(i => {
        const inf = i.fecha_vencimiento && expiryInfo(i.fecha_vencimiento);
        return inf && !inf.expired && inf.days <= 30;
    }).length;

    return (
        <div className="bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl overflow-hidden">
            {/* Branch header */}
            <button
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/50 transition-colors text-left"
            >
                <span className="text-sm font-bold text-slate-800 flex-1">{ERP_NAMES[erpId] || `Sucursal ${erpId}`}</span>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{items.length.toLocaleString()} productos</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500 font-semibold">{units.toLocaleString()} uds</span>
                    {expired > 0 && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
                            {expired} vencido{expired !== 1 ? 's' : ''}
                        </span>
                    )}
                    {soon > 0 && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
                            {soon} por vencer
                        </span>
                    )}
                </div>
                {open ? <ChevronUp size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />}
            </button>

            {/* Table */}
            {open && (
                <div className="overflow-x-auto">
                    {/* Header */}
                    <div className="grid grid-cols-[2fr_1fr_1.2fr_60px_100px] gap-2 px-4 py-2 bg-slate-50/80 border-t border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <span>Producto</span>
                        <span>Presentación</span>
                        <span>Lote / Detalle</span>
                        <span className="text-right">Cant.</span>
                        <span className="text-center">Vence</span>
                    </div>
                    {/* Rows */}
                    {items.map((item, i) => {
                        const inf = item.fecha_vencimiento ? expiryInfo(item.fecha_vencimiento) : null;
                        const isExpired = inf?.expired;
                        const isSoon = inf && !inf.expired && inf.days <= 30;
                        return (
                            <div key={i}
                                className={`grid grid-cols-[2fr_1fr_1.2fr_60px_100px] gap-2 px-4 py-2.5 border-t border-slate-50 last:border-0 transition-colors
                                    ${isExpired ? 'bg-red-50/50' : isSoon ? 'bg-amber-50/30' : ''}`}>
                                <span className="text-xs font-medium text-slate-800 truncate leading-tight" title={item.descripcion}>{item.descripcion || '—'}</span>
                                <span className="text-xs text-slate-500 truncate">{item.presentacion || '—'}</span>
                                <span className="text-xs text-slate-400 truncate font-mono text-[11px]">
                                    {[item.lote, item.detalle].filter(Boolean).join(' · ') || '—'}
                                </span>
                                <span className={`text-xs font-semibold text-right ${item.cantidad === 0 ? 'text-slate-300' : isExpired ? 'text-red-600' : 'text-slate-700'}`}>
                                    {item.cantidad}
                                </span>
                                <div className="flex justify-center items-center">
                                    <ExpiryCell fecha={item.fecha_vencimiento} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default function TabInventario() {
    const [selectedErp, setSelectedErp] = useState(null);
    const [showVencidos, setShowVencidos] = useState(false);
    const [query, setQuery]             = useState('');
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
        if (!query.trim()) return items;
        const q = query.toLowerCase();
        return items.filter(i =>
            i.descripcion?.toLowerCase().includes(q) ||
            i.presentacion?.toLowerCase().includes(q) ||
            i.lote?.toLowerCase().includes(q)
        );
    }, [items, query]);

    const grouped = useMemo(() => {
        const g = {};
        filtered.forEach(item => {
            const key = item.erp_sucursal_id;
            if (!g[key]) g[key] = [];
            g[key].push(item);
        });
        return g;
    }, [filtered]);

    const totalUnits = filtered.reduce((s, i) => s + (i.cantidad || 0), 0);
    const expiredCount = filtered.filter(i => i.fecha_vencimiento && expiryInfo(i.fecha_vencimiento)?.expired).length;

    const lastSyncForSelected = useMemo(() => {
        const logs = syncLog.filter(l => l.is_vencidos === showVencidos && (selectedErp === null || l.erp_sucursal_id === selectedErp));
        if (!logs.length) return null;
        return logs.sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))[0]?.synced_at;
    }, [syncLog, selectedErp, showVencidos]);

    return (
        <div className="h-full flex flex-col">
            {/* Branch pills + mode toggle */}
            <div className="flex-shrink-0 px-5 pt-4 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => setSelectedErp(null)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all border
                            ${selectedErp === null ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm' : 'bg-white/70 text-slate-600 border-white/80 hover:border-[#007AFF]/30'}`}>
                        Todas
                    </button>
                    {ERP_ORDER.map(erpId => {
                        const log = syncLog.find(l => l.erp_sucursal_id === erpId && l.is_vencidos === showVencidos && l.success);
                        return (
                            <button key={erpId}
                                onClick={() => setSelectedErp(selectedErp === erpId ? null : erpId)}
                                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all border
                                    ${selectedErp === erpId ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm' : 'bg-white/70 text-slate-600 border-white/80 hover:border-[#007AFF]/30'}`}>
                                {ERP_NAMES[erpId]}
                                {log?.items_count != null && (
                                    <span className={`text-[10px] ${selectedErp === erpId ? 'text-white/70' : 'text-slate-400'}`}>{log.items_count.toLocaleString()}</span>
                                )}
                            </button>
                        );
                    })}
                    {/* Vencidos toggle */}
                    <div className="ml-auto flex items-center bg-white/70 border border-white/80 rounded-full p-0.5 gap-0.5">
                        <button onClick={() => setShowVencidos(false)}
                            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${!showVencidos ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400 hover:text-slate-600'}`}>
                            Normal
                        </button>
                        <button onClick={() => setShowVencidos(true)}
                            className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${showVencidos ? 'bg-red-100 text-red-700' : 'text-slate-400 hover:text-slate-600'}`}>
                            Vencidos
                        </button>
                    </div>
                </div>
            </div>

            {/* Search + sync info */}
            <div className="flex-shrink-0 px-5 pb-3 flex items-center gap-3">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Buscar producto, lote..."
                        className="w-full pl-8 pr-8 py-2 bg-white/70 border border-white/80 rounded-xl text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 transition-all"
                    />
                    {query && (
                        <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            <X size={12} />
                        </button>
                    )}
                </div>
                {lastSyncForSelected ? (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 whitespace-nowrap flex-shrink-0">
                        <RefreshCw size={9} />
                        {new Date(lastSyncForSelected).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}{' '}
                        {new Date(lastSyncForSelected).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                ) : (
                    <span className="text-[10px] text-slate-300 whitespace-nowrap flex-shrink-0">Sin sincronizar</span>
                )}
            </div>

            {/* Summary stats */}
            {!loading && filtered.length > 0 && (
                <div className="flex-shrink-0 px-5 pb-3 flex items-center gap-4 flex-wrap">
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
                        <span className="text-xs text-red-500 bg-red-50 border border-red-100 px-2.5 py-0.5 rounded-full font-semibold">
                            Mostrando productos vencidos
                        </span>
                    )}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={24} className="animate-spin text-[#007AFF]" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <Package size={32} className="mb-3 opacity-40" />
                        <p className="text-sm">
                            {items.length === 0 ? 'Sin datos de inventario — ejecuta una sincronización primero' : 'No se encontraron productos con esa búsqueda'}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {ERP_ORDER.filter(erpId => grouped[erpId]?.length > 0).map(erpId => (
                            <BranchBlock
                                key={erpId}
                                erpId={erpId}
                                items={grouped[erpId]}
                                defaultOpen={selectedErp !== null || Object.keys(grouped).length === 1}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
