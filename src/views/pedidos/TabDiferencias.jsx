import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, CalendarDays, TrendingDown, Package, Building2,
    AlertTriangle, X, ChevronRight, ChevronDown,
} from 'lucide-react';

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};

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
        blue:   'bg-blue-50    border-blue-100   text-blue-700',
        amber:  'bg-amber-50   border-amber-100  text-amber-700',
        red:    'bg-red-50     border-red-100    text-red-600',
        slate:  'bg-slate-50   border-slate-100  text-slate-700',
    }[color];
    return (
        <div className={`rounded-xl border px-4 py-2.5 ${cls}`}>
            <div className="text-xl font-black tabular-nums leading-none">{value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5 opacity-80">{label}</div>
            {sub && <div className="text-[10px] opacity-60 mt-0.5">{sub}</div>}
        </div>
    );
}

export default function TabDiferencias({ searchTerm = '' }) {
    const [loading,   setLoading]   = useState(false);
    const [data,      setData]      = useState(null);
    const [desde,     setDesde]     = useState('');
    const [hasta,     setHasta]     = useState('');
    const [viewMode,  setViewMode]  = useState('sucursal'); // 'sucursal' | 'producto' | 'detalle'
    const [expandedSuc, setExpandedSuc] = useState(null);

    const loadStats = useCallback(async (d, h) => {
        setLoading(true);
        setData(null);
        const { data: result, error } = await supabase.rpc('get_pedido_diferencias_stats', {
            p_desde: d ? `${d}T00:00:00Z` : null,
            p_hasta: h ? `${h}T23:59:59Z` : null,
        });
        if (!error) setData(result);
        setLoading(false);
    }, []);

    useEffect(() => { loadStats(desde, hasta); }, [desde, hasta, loadStats]);

    const totales       = data?.totales       ?? null;
    const porSucursal   = data?.por_sucursal  ?? [];
    const porProducto   = data?.por_producto  ?? [];
    const detalle       = data?.detalle       ?? [];

    // Search filter for detalle
    const filteredDetalle = detalle.filter(r => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase();
        return (r.product_name || '').toLowerCase().includes(q)
            || String(r.pedido_numero).includes(q);
    });

    const filteredProducto = porProducto.filter(r => {
        if (!searchTerm.trim()) return true;
        return (r.product_name || '').toLowerCase().includes(searchTerm.toLowerCase());
    });

    return (
        <div className="space-y-3 p-4">

            {/* Date filters */}
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

            {/* Summary stat cards */}
            {totales && (
                <div className="flex flex-wrap gap-2">
                    <StatCard label="Pedidos afectados" value={totales.pedidos_afectados ?? 0} color="blue" />
                    <StatCard label="Ítems con diferencia" value={totales.items_afectados ?? 0} color="amber" />
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
                    {/* View toggle */}
                    <div className="flex items-center gap-1.5">
                        {[
                            { key: 'sucursal', label: 'Por sucursal',  icon: Building2   },
                            { key: 'producto', label: 'Por producto',  icon: Package     },
                            { key: 'detalle',  label: 'Detalle',       icon: AlertTriangle },
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

                    {/* ── Por sucursal ────────────────────────────────── */}
                    {viewMode === 'sucursal' && (
                        <div className={`${GLASS} overflow-hidden`}>
                            <table className="w-full text-[12px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/80">
                                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sucursal</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Pedidos</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Ítems</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Asignado</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Recibido</th>
                                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide w-32">Diferencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {porSucursal.map((row, i) => {
                                        const pct = pctDiff(row.packs_asignados, row.packs_recibidos);
                                        return (
                                            <tr key={row.erp_sucursal_id} className={i % 2 === 1 ? 'bg-slate-50/40' : ''}>
                                                <td className="px-4 py-2.5 font-medium text-slate-700">
                                                    {ERP_NAMES[row.erp_sucursal_id] ?? `Suc ${row.erp_sucursal_id}`}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.pedidos_con_diferencia}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.items_con_diferencia}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.packs_asignados}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.packs_recibidos}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="space-y-0.5">
                                                        <DiffBar pct={pct} />
                                                        <p className="text-[10px] text-right text-amber-600 font-semibold tabular-nums">
                                                            −{row.packs_faltantes} pk
                                                        </p>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Por producto ─────────────────────────────────── */}
                    {viewMode === 'producto' && (
                        <div className={`${GLASS} overflow-hidden`}>
                            <table className="w-full text-[12px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/80">
                                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Producto</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Veces</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Asignado</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Recibido</th>
                                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide w-32">Diferencia</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredProducto.map((row, i) => {
                                        const pct = pctDiff(row.packs_asignados, row.packs_recibidos);
                                        return (
                                            <tr key={row.erp_product_id} className={i % 2 === 1 ? 'bg-slate-50/40' : ''}>
                                                <td className="px-4 py-2.5">
                                                    <p className="font-medium text-slate-700 leading-snug">{row.product_name}</p>
                                                    <p className="text-[10px] text-slate-400">{row.presentacion_tipo ?? '—'}</p>
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.veces_con_diferencia}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.packs_asignados}
                                                </td>
                                                <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                    {row.packs_recibidos}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="space-y-0.5">
                                                        <DiffBar pct={pct} />
                                                        <p className="text-[10px] text-right text-amber-600 font-semibold tabular-nums">
                                                            −{row.packs_faltantes} pk
                                                        </p>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Detalle ──────────────────────────────────────── */}
                    {viewMode === 'detalle' && (
                        <div className={`${GLASS} overflow-hidden`}>
                            <table className="w-full text-[12px]">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50/80">
                                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Producto</th>
                                        <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Pedido</th>
                                        <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Sucursal</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Asig.</th>
                                        <th className="text-center px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Recib.</th>
                                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Nota</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredDetalle.map((row, i) => (
                                        <tr key={i} className={i % 2 === 1 ? 'bg-slate-50/40' : ''}>
                                            <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[180px]">
                                                <p className="truncate">{row.product_name}</p>
                                                <p className="text-[10px] text-slate-400">{fmtDate(row.received_at)}</p>
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                                                #{row.pedido_numero}
                                            </td>
                                            <td className="px-3 py-2.5 text-slate-600 text-[11px]">
                                                {ERP_NAMES[row.erp_sucursal_id] ?? `Suc ${row.erp_sucursal_id}`}
                                            </td>
                                            <td className="px-3 py-2.5 text-center tabular-nums text-slate-600">
                                                {row.cantidad_asignada}
                                            </td>
                                            <td className="px-3 py-2.5 text-center tabular-nums font-bold text-amber-600">
                                                {row.cantidad_recibida}
                                                <span className="text-[9px] text-slate-400 font-normal ml-0.5">
                                                    (−{row.diferencia})
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-[11px] text-slate-400 max-w-[200px]">
                                                <span className="truncate block">{row.nota_diferencia || '—'}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredDetalle.length === 0 && (
                                <p className="text-center text-[12px] text-slate-300 py-6">Sin resultados.</p>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
