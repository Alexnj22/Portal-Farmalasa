import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
    Loader2, Building2, ClipboardList, CheckCircle2,
    Package, AlertTriangle, Info, Clock,
    TriangleAlert, TrendingUp,
    Printer, Check, Globe, X,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { printPerSucursal, buildPedidoCodigo, fefoProject } from '../../utils/pedidoPrint';
import { ERP_NAMES, SUCURSALES } from '../../constants/erp';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtSyncedAt(iso) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-SV', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

function fmtTimeSince(iso) {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
    if (d === 0) return 'hoy';
    if (d === 1) return 'ayer';
    if (d < 14)  return `hace ${d}d`;
    if (d < 60)  return `hace ${Math.floor(d / 7)}sem`;
    return `hace ${Math.floor(d / 30)}m`;
}

const SIN_BODEGA_COLS = [
    { key: 'product_name',    label: 'Producto',    align: 'left',  sortable: true },
    { key: 'laboratorio',     label: 'Laboratorio', align: 'left',  sortable: true },
    { key: 'sucursales',      label: 'Solicitan',   align: 'left'                  },
    { key: 'total_necesidad', label: 'Total',       align: 'center', sortable: true, hideBelow: 'sm' },
    { key: 'total_ventas_6m', label: 'Ventas 6m',  align: 'center', sortable: true, hideBelow: 'sm' },
];

const GLASS = 'rounded-2xl border border-slate-200/60 bg-white/60 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.07)]';

const SUC_ANIM_CSS = `
@keyframes suc-pop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.09); }
  70%  { transform: scale(0.96); }
  100% { transform: scale(1); }
}
.suc-pop { animation: suc-pop 0.28s cubic-bezier(0.22,1,0.36,1) both; }
`;

// ── Main component ───────────────────────────────────────────────────────────
export default function TabGenerar({ searchTerm = '' }) {
    const { user } = useAuth();

    const [selected,     setSelected]     = useState(new Set());
    const [globalMode,   setGlobalMode]   = useState(false);
    const [minmaxSource, setMinmaxSource] = useState('erp');

    const [confirming, setConfirming] = useState(false);
    const [confirmed,  setConfirmed]  = useState(null);
    const [error,      setError]      = useState(null);
    const [syncedAt,   setSyncedAt]   = useState(null);

    const [dashStats,   setDashStats]   = useState([]);
    const [dashLoading, setDashLoading] = useState(true);

    const [sinBodega,     setSinBodega]     = useState([]);
    const [sinBodegaLoad, setSinBodegaLoad] = useState(false);
    const [sinSortKey,    setSinSortKey]    = useState('total_necesidad');
    const [sinSortDir,    setSinSortDir]    = useState('desc');
    const [sinPage,       setSinPage]       = useState(1);
    const [sinPageSize,   setSinPageSize]   = useState(25);

    const [employees, setEmployees] = useState([]);

    // ── Synced-at ──────────────────────────────────────────────
    useEffect(() => {
        supabase.from('erp_minmax').select('synced_at')
            .order('synced_at', { ascending: false }).limit(1).single()
            .then(({ data }) => setSyncedAt(data?.synced_at ?? null));
    }, []);

    // ── Dashboard stats — reactivo al selector MIN/MAX ─────────
    useEffect(() => {
        setDashLoading(true);
        supabase.rpc('get_pedido_sucursal_stats', {
            p_sucursal_ids:      SUCURSALES,
            p_use_portal_minmax: minmaxSource === 'portal',
        }).then(({ data }) => { setDashStats(data || []); setDashLoading(false); });
    }, [minmaxSource]);

    // ── Empleados (para trazabilidad en handleGenerarDirecto) ──
    useEffect(() => {
        supabase.from('employees')
            .select('id, name')
            .eq('status', 'ACTIVO')
            .order('name')
            .then(({ data }) => setEmployees(data || []));
    }, []);

    // ── Sin-bodega — load all once for client-side sort/filter ─
    useEffect(() => {
        setSinBodegaLoad(true);
        supabase.rpc('get_pedido_sin_bodega', {
            p_sucursal_ids: SUCURSALES,
            p_limit:        9999,
            p_offset:       0,
        }).then(({ data }) => { setSinBodega(data || []); setSinBodegaLoad(false); });
    }, []);

    const refreshStats = useCallback(() => {
        setDashLoading(true);
        supabase.rpc('get_pedido_sucursal_stats', {
            p_sucursal_ids:      SUCURSALES,
            p_use_portal_minmax: minmaxSource === 'portal',
        }).then(({ data }) => { setDashStats(data || []); setDashLoading(false); });
        setSinBodegaLoad(true);
        supabase.rpc('get_pedido_sin_bodega', {
            p_sucursal_ids: SUCURSALES,
            p_limit:        9999,
            p_offset:       0,
        }).then(({ data }) => { setSinBodega(data || []); setSinBodegaLoad(false); });
    }, [minmaxSource]);

    // ── Sucursal toggle ────────────────────────────────────────
    const toggleSuc = useCallback((id) => {
        setSelected(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    }, []);

    const toggleAll = useCallback(() => {
        setSelected(prev => prev.size === SUCURSALES.length ? new Set() : new Set(SUCURSALES));
    }, []);

    // ── Generar directo: calcula + confirma final + imprime ────
    const handleGenerarDirecto = useCallback(async () => {
        if (selected.size === 0) return;
        setConfirming(true); setError(null); setConfirmed(null);
        try {
            const rpcParams = globalMode
                ? { p_sucursal_ids: SUCURSALES, p_target_ids: [...selected], p_use_portal_minmax: minmaxSource === 'portal' }
                : { p_sucursal_ids: [...selected], p_use_portal_minmax: minmaxSource === 'portal' };
            const { data, error: rpcErr } = await supabase
                .rpc('get_pedido_preview', rpcParams)
                .range(0, 49999);
            if (rpcErr) throw rpcErr;
            const rows = data || [];
            if (rows.length === 0) {
                setError('Las sucursales seleccionadas están abastecidas — no hay nada que pedir.');
                return;
            }
            const pItems = rows.map(row => ({
                erp_sucursal_id:       row.erp_sucursal_id,
                erp_product_id:        row.erp_product_id,
                erp_presentacion_id:   row.erp_presentacion_id,
                cantidad_asignada:     row.cantidad_asignada,
                sin_stock:             row.sin_stock,
                revision_minmax:       row.revision_minmax,
                stock_packs_snapshot:  Number(row.stock_packs),
                max_qty_snapshot:      row.max_qty,
                min_qty_snapshot:      row.min_qty,
                urgencia_pct_snapshot: row.urgencia_pct,
                lotes_asignados:       fefoProject(row.lotes_bodega, row.cantidad_asignada),
            }));
            const esEmpleado = employees.some(e => e.id === user?.id);
            const { data: pedidoId, error: confErr } = await supabase.rpc('confirm_pedido', {
                p_created_by:     user?.id ?? null,
                p_notes:          null,
                p_items:          pItems,
                p_responsable_id: esEmpleado ? user.id : null,
                p_revisado_por:   null,
                p_sucursal_ids:   [...selected],
            });
            if (confErr) throw confErr;
            const { data: ped } = await supabase
                .from('pedidos').select('numero').eq('id', pedidoId).single();
            useStaff.getState().appendAuditLog('GENERAR_PEDIDO', pedidoId, {
                sucursales:  [...selected],
                items_count: pItems.length,
                numero:      ped?.numero,
                directo:     true,
            });

            const map = {};
            for (const row of rows) {
                const s = row.erp_sucursal_id;
                if (!map[s]) map[s] = { normal: [], revision: [], sinStock: [] };
                if (row.sin_stock)            map[s].sinStock.push(row);
                else if (row.revision_minmax) map[s].revision.push(row);
                else                          map[s].normal.push(row);
            }
            const sucIds     = SUCURSALES.filter(id => map[id]);
            const meta       = { responsable: user?.name ?? null, revisor: null, generadoPor: user?.name ?? null };
            const codigoFn   = buildPedidoCodigo(ped?.numero, new Date(), sucIds.length);
            const codigosMap = {};
            for (const id of sucIds) codigosMap[id] = codigoFn(id);

            supabase.rpc('init_pedido_sucursal_codigos', {
                p_pedido_id: pedidoId,
                p_codigos:   sucIds.map(id => ({ erp_sucursal_id: id, codigo: codigosMap[id] })),
            }).then(() => {}).catch(() => {});

            printPerSucursal(map, sucIds, r => r.cantidad_asignada, codigoFn, meta);
            setConfirmed({
                id: pedidoId, numero: ped?.numero,
                frozenGrouped: map, frozenSucIds: sucIds, codigosMap, printMeta: meta,
            });
            setSelected(new Set());
            refreshStats();
        } catch (e) {
            setError(e.message);
        } finally {
            setConfirming(false);
        }
    }, [selected, globalMode, minmaxSource, employees, user, refreshStats]);

    // ── Derived maps ───────────────────────────────────────────
    const statMap = useMemo(() => {
        const m = {};
        for (const s of dashStats) m[s.erp_sucursal_id] = s;
        return m;
    }, [dashStats]);

    // urgLevel: 'high' ≥65% depleción · 'mid' ≥40% · 'low' <40% · 'none' sin datos
    const getUrgLevel = (stat) => {
        const pct = stat?.avg_urgencia_pct;
        if (pct == null) return 'none';
        if (pct >= 65) return 'high';
        if (pct >= 40) return 'mid';
        return 'low';
    };

    // ── Sin-bodega — client-side filter + sort + paginate ─────
    const sinFiltered = useMemo(() => {
        let rows = sinBodega;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            rows = rows.filter(r =>
                r.product_name?.toLowerCase().includes(q) ||
                r.laboratorio?.toLowerCase().includes(q)
            );
        }
        const dir = sinSortDir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            if (sinSortKey === 'product_name' || sinSortKey === 'laboratorio') {
                return (a[sinSortKey] || '').localeCompare(b[sinSortKey] || '', 'es') * dir;
            }
            return (Number(a[sinSortKey] || 0) - Number(b[sinSortKey] || 0)) * dir;
        });
    }, [sinBodega, searchTerm, sinSortKey, sinSortDir]);

    const sinTotalPages     = Math.max(1, Math.ceil(sinFiltered.length / sinPageSize));
    const filteredSinBodega = sinFiltered.slice((sinPage - 1) * sinPageSize, sinPage * sinPageSize);

    useEffect(() => { setSinPage(1); }, [searchTerm, sinSortKey, sinSortDir]);

    const handleSinSort = useCallback((key) => {
        setSinSortKey(prev => {
            if (prev === key) { setSinSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSinSortDir('asc'); return key;
        });
        setSinPage(1);
    }, []);

    // ── Dashboard screen ────────────────────────────────────────
    return (
        <div className="space-y-5 p-4">

            {/* ── Pedido generado — banner de éxito ──────────── */}
            {confirmed && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 size={18} className="text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-[180px]">
                        <p className="font-semibold text-emerald-700 text-[14px]">Pedido #{confirmed.numero} confirmado e impreso</p>
                        <p className="text-[11px] text-emerald-600/70">Si el diálogo de impresión no apareció, usa Reimprimir. Puedes verlo en Historial.</p>
                    </div>
                    <button
                        onClick={() => printPerSucursal(
                            confirmed.frozenGrouped, confirmed.frozenSucIds,
                            r => r.cantidad_asignada,
                            (id) => confirmed.codigosMap?.[id],
                            confirmed.printMeta,
                        )}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-emerald-300 text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                        <Printer size={12} /> Reimprimir
                    </button>
                    <button onClick={() => setConfirmed(null)}
                        className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-600 transition-colors">
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* ── Sucursal selector ──────────────────────────── */}
            <div className={GLASS + ' p-4'}>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-slate-700 text-[15px]">Selecciona las sucursales a reponer</h3>
                    <div className="flex items-center gap-3">
                        {syncedAt && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400">
                                <Clock size={11} />
                                Min/Max: {fmtSyncedAt(syncedAt)}
                            </span>
                        )}
                        <button onClick={toggleAll}
                            className="text-[12px] text-blue-600 hover:text-blue-700 font-medium transition-colors">
                            {selected.size === SUCURSALES.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                        </button>
                    </div>
                </div>
                <p className="text-[11px] text-slate-400 mb-2 flex items-center gap-1">
                    <Info size={11} />
                    Elige las sucursales a reponer y genera el pedido directamente.
                </p>

                {/* Modos: globalMode + fuente MIN/MAX */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                    <button
                        onClick={() => setGlobalMode(v => !v)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 text-[11px] font-semibold transition-all ${
                            globalMode
                                ? 'bg-indigo-600 border-indigo-500 text-white shadow-sm'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'
                        }`}
                    >
                        <Globe size={12} />
                        Distribución global de bodega
                        {globalMode && <Check size={11} />}
                    </button>

                    {/* Selector fuente MIN/MAX — liquid glass */}
                    <div className="relative inline-flex items-stretch rounded-xl p-[3px] bg-white/60 border border-white/80 backdrop-blur-md shadow-[0_2px_12px_rgba(0,82,204,0.10),inset_0_1px_0_rgba(255,255,255,0.7)]">
                        <span
                            aria-hidden
                            className={`absolute top-[3px] bottom-[3px] rounded-[9px] transition-all duration-200 ease-out pointer-events-none ${
                                minmaxSource === 'erp'
                                    ? 'left-[3px] right-[calc(50%+1.5px)] bg-white/90 shadow-[0_1px_4px_rgba(0,0,0,0.10)] border border-white/60'
                                    : 'left-[calc(50%+1.5px)] right-[3px] bg-[#0052CC]/90 shadow-[0_1px_6px_rgba(0,82,204,0.30)] border border-blue-400/40'
                            }`}
                        />
                        <button
                            onClick={() => setMinmaxSource('erp')}
                            className={`relative z-10 px-3 py-1.5 text-[11px] font-semibold rounded-[9px] transition-colors duration-150 select-none ${
                                minmaxSource === 'erp' ? 'text-slate-800' : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            MIN/MAX ERP
                        </button>
                        <button
                            onClick={() => setMinmaxSource('portal')}
                            className={`relative z-10 px-3 py-1.5 text-[11px] font-semibold rounded-[9px] transition-colors duration-150 select-none ${
                                minmaxSource === 'portal' ? 'text-white' : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            MIN/MAX Portal
                        </button>
                    </div>
                </div>

                {minmaxSource === 'portal' && (
                    <p className="text-[10px] text-blue-600 mb-2 flex items-center gap-1">
                        <Info size={10} />
                        Usando los MIN/MAX definidos en el Portal. Productos sin valores publicados no aparecerán en el pedido.
                    </p>
                )}
                {globalMode && (
                    <p className="text-[10px] text-indigo-600 mb-2 flex items-center gap-1">
                        <Info size={10} />
                        La bodega se distribuye considerando las necesidades de TODAS las sucursales, pero el pedido solo incluye las marcadas.
                    </p>
                )}

                {/* ── Sucursal cards — liquid glass ──────────── */}
                <style>{SUC_ANIM_CSS}</style>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                    {SUCURSALES.map((id) => {
                        const stat     = statMap[id];
                        const isOn     = selected.has(id);
                        const urgLevel = getUrgLevel(stat);
                        const urgPct   = stat?.avg_urgencia_pct ?? null;

                        // Card background + border by urgency (only when not selected)
                        const cardCls = isOn
                            ? 'suc-pop border-blue-300/80 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,82,204,0.45),0_8px_24px_rgba(0,82,204,0.30),inset_0_1px_0_rgba(255,255,255,0.50),inset_0_-1px_0_rgba(0,82,204,0.20)] ring-2 ring-blue-400/30 ring-offset-1'
                            : urgLevel === 'high'
                                ? 'bg-gradient-to-b from-red-50/90 to-white/50 border-red-200/80 backdrop-blur-sm hover:border-red-300 hover:shadow-[0_8px_24px_rgba(239,68,68,0.18)] transition-all duration-200'
                                : urgLevel === 'mid'
                                    ? 'bg-gradient-to-b from-amber-50/90 to-white/50 border-amber-200/80 backdrop-blur-sm hover:border-amber-300 hover:shadow-[0_8px_24px_rgba(245,158,11,0.18)] transition-all duration-200'
                                    : urgLevel === 'low'
                                        ? 'bg-gradient-to-b from-emerald-50/60 to-white/40 border-emerald-200/60 backdrop-blur-sm hover:border-emerald-300 hover:shadow-[0_8px_24px_rgba(16,185,129,0.12)] transition-all duration-200'
                                        : 'bg-gradient-to-b from-slate-50/60 to-white/40 border-slate-200/60 backdrop-blur-sm hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200';

                        // Urgency % badge colors
                        const urgBadgeCls = urgLevel === 'high'
                            ? 'bg-red-100 text-red-600 border-red-200/80'
                            : urgLevel === 'mid'
                                ? 'bg-amber-100 text-amber-700 border-amber-200/80'
                                : 'bg-emerald-100 text-emerald-700 border-emerald-200/80';

                        return (
                            <button
                                key={id}
                                onClick={() => toggleSuc(id)}
                                style={isOn ? {
                                    background: 'linear-gradient(160deg, rgba(0,102,255,0.22) 0%, rgba(0,82,204,0.14) 50%, rgba(0,60,160,0.18) 100%)',
                                } : {}}
                                className={`relative flex flex-col items-center gap-1 rounded-2xl px-3 py-4 border text-center group overflow-hidden ${cardCls}`}
                            >
                                {/* Top highlight — glass shimmer, más brillante al seleccionar */}
                                <span className={`absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent ${isOn ? 'via-white/90' : 'via-white/70'} to-transparent pointer-events-none`} />
                                {/* Selected: capa de luz difusa en la parte superior */}
                                {isOn && (
                                    <>
                                        <span className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-white/30 to-transparent pointer-events-none rounded-t-2xl" />
                                        <span className="absolute inset-x-3 top-px h-6 bg-gradient-to-b from-white/20 to-transparent pointer-events-none blur-[2px]" />
                                    </>
                                )}

                                {/* Urgency % badge — top-left */}
                                {!isOn && stat && !dashLoading && urgPct != null && urgPct > 0 && (
                                    <span className={`absolute top-2 left-2 min-w-[28px] h-4 px-1 rounded-full flex items-center justify-center text-[8px] font-black leading-none border ${urgBadgeCls}`}>
                                        {urgPct}%
                                    </span>
                                )}

                                {/* Checkmark — top-right when selected */}
                                {isOn && (
                                    <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-white/25 border border-white/40 flex items-center justify-center">
                                        <CheckCircle2 size={10} className="text-white" />
                                    </span>
                                )}

                                <Building2
                                    size={20}
                                    className={isOn ? 'text-white/80 relative z-10 mt-1' : 'text-slate-400 group-hover:text-slate-600 transition-colors relative z-10 mt-1'}
                                />
                                <span className={`text-[12px] font-bold leading-tight relative z-10 ${isOn ? 'text-white drop-shadow-sm' : 'text-slate-800'}`}>
                                    {ERP_NAMES[id]}
                                </span>

                                {stat && !dashLoading ? (
                                    <>
                                        <div className="flex items-center gap-1.5 mt-0.5 relative z-10">
                                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                isOn ? 'bg-white/15 text-emerald-200 border border-white/20' : 'bg-emerald-100 text-emerald-700'
                                            }`}>
                                                <span className="text-[8px]">✓</span>
                                                {(stat.con_bodega_productos ?? 0)}
                                            </span>
                                            <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                isOn ? 'bg-white/15 text-red-200 border border-white/20' : 'bg-red-100 text-red-600'
                                            }`}>
                                                <span className="text-[8px]">✗</span>
                                                {(stat.sin_bodega_productos ?? 0)}
                                            </span>
                                        </div>
                                        {/* Último pedido */}
                                        {(() => {
                                            const label = fmtTimeSince(stat.last_pedido_at);
                                            if (!label) return (
                                                <span className={`text-[9px] relative z-10 ${isOn ? 'text-white/40' : 'text-slate-300'}`}>sin pedidos</span>
                                            );
                                            const days = stat.last_pedido_at
                                                ? Math.floor((Date.now() - new Date(stat.last_pedido_at)) / 86_400_000)
                                                : 999;
                                            const timeCls = isOn
                                                ? 'text-white/60'
                                                : days <= 7  ? 'text-emerald-500'
                                                : days <= 14 ? 'text-amber-500'
                                                : 'text-red-400';
                                            return (
                                                <span className={`text-[9px] font-medium relative z-10 ${timeCls}`}>
                                                    {label}
                                                </span>
                                            );
                                        })()}
                                    </>
                                ) : (
                                    <div className="h-6 w-14 rounded-lg bg-slate-100 animate-pulse mt-0.5" />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* ── Generar button ─────────────────────────── */}
                <div className="mt-4 flex flex-col items-center gap-2">
                    <button
                        onClick={handleGenerarDirecto}
                        disabled={confirming || selected.size === 0}
                        className={`flex items-center gap-2.5 px-10 py-3.5 rounded-2xl font-bold text-[15px] transition-all duration-200 ${
                            selected.size === 0
                                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-[0_4px_20px_rgba(5,150,105,0.25)] hover:shadow-[0_8px_28px_rgba(5,150,105,0.35)] hover:-translate-y-0.5 active:scale-[0.98]'
                        }`}
                    >
                        {confirming ? <Loader2 size={18} className="animate-spin" /> : <ClipboardList size={18} />}
                        {confirming
                            ? 'Confirmando e imprimiendo…'
                            : `Generar y confirmar${selected.size > 0 ? ` (${selected.size} sucursal${selected.size > 1 ? 'es' : ''})` : ''}`}
                    </button>
                    {error && (
                        <span className="text-[13px] text-red-600 flex items-center gap-1">
                            <AlertTriangle size={14} /> {error}
                        </span>
                    )}
                </div>
            </div>

            {/* ── Productos sin stock en Bodega ──────────────── */}
            <div className={GLASS + ' px-4 py-3 flex items-center gap-2'}>
                <TriangleAlert size={15} className="text-red-500" />
                <span className="font-semibold text-slate-700 text-[14px]">Productos sin stock en Bodega</span>
                {sinBodega.length > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200 font-semibold">
                        {sinBodega.length.toLocaleString()} productos
                    </span>
                )}
                {searchTerm && (
                    <span className="ml-auto text-[11px] text-slate-400">"{searchTerm}"</span>
                )}
            </div>

            {/* ── Sin-bodega table (DataTable estándar) ────── */}
            <DataTable
                columns={SIN_BODEGA_COLS}
                sortKey={sinSortKey}
                sortDir={sinSortDir}
                onSort={handleSinSort}
                loading={sinBodegaLoad}
                empty={{
                    icon: Package,
                    message: searchTerm
                        ? `Sin resultados para "${searchTerm}"`
                        : 'No hay productos sin stock en Bodega',
                }}
                minWidth="560px"
            >
                {filteredSinBodega.map((row, i) => (
                    <DataRow key={row.erp_product_id} index={i}>
                        <td className="px-4 py-3 text-[13px] font-semibold text-slate-800">
                            {row.product_name}
                        </td>
                        <td className="px-4 py-3 text-[12px] text-slate-500">{row.laboratorio || '—'}</td>
                        <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                                {(row.sucursales || []).map(s => (
                                    <span key={s.erp_sucursal_id}
                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 whitespace-nowrap"
                                        title={`${ERP_NAMES[s.erp_sucursal_id]}: necesita ${s.reponer}${s.ventas_6m > 0 ? ` · ${Math.round(s.ventas_6m)} ventas en 6m` : ''}`}>
                                        <span className="font-medium text-slate-600">{ERP_NAMES[s.erp_sucursal_id]}</span>
                                        <span className="text-red-500 font-semibold">{s.reponer}</span>
                                        {s.ventas_6m > 0 && (
                                            <span className="text-slate-400 flex items-center gap-0.5">
                                                ↻<span className="text-[8px] font-semibold">{Math.round(s.ventas_6m)}</span>
                                            </span>
                                        )}
                                    </span>
                                ))}
                            </div>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                            <span className="text-[13px] font-bold text-red-600 tabular-nums">{row.total_necesidad}</span>
                        </td>
                        <td className="px-4 py-3 text-center hidden sm:table-cell">
                            {row.total_ventas_6m > 0 ? (
                                <span className="inline-flex items-center justify-center gap-1 text-[12px] text-emerald-600 font-semibold tabular-nums">
                                    <TrendingUp size={11} />
                                    {Math.round(row.total_ventas_6m).toLocaleString()}
                                </span>
                            ) : (
                                <span className="text-[11px] text-slate-300">—</span>
                            )}
                        </td>
                    </DataRow>
                ))}
            </DataTable>

            {!sinBodegaLoad && sinFiltered.length > 0 && (
                <TablePagination
                    pageSize={sinPageSize}
                    onPageSizeChange={setSinPageSize}
                    page={sinPage}
                    totalPages={sinTotalPages}
                    onPageChange={setSinPage}
                    total={sinFiltered.length}
                />
            )}
        </div>
    );
}
