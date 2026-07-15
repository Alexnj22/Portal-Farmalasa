// Extracted from TabMinMax.jsx (Bloque 6.C) — expanded panel: multi-branch
// view + current branch breakdown. The most coupled extraction so far: does
// its own Supabase fetches (branch summary, expiring lots, cost/sales
// history), gated by minmax_ver_costos permission.
import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Package, Building2, CheckCircle2, TrendingDown } from 'lucide-react';
import { supabase } from '../../../supabaseClient';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useAuth } from '../../../context/AuthContext';
import { useNowTick } from '../../../hooks/useNowTick';
import { ERP_NAMES, ERP_ORDER, ALERT } from './constants';
import { sortedPres, formatDominant } from './helpers';
import StockBar from './StockBar';
import AbcXyzBadge from './AbcXyzBadge';

export default function ExpandedPanel({ row, cycleDays }) {
    const { hasPermission } = useAuth();
    const now = useNowTick();
    const canSeeCosts  = hasPermission('minmax_ver_costos');
    const pres        = row.presentations || [];
    const stock       = Number(row.current_stock);
    const minN        = Number(row.effective_min);
    const maxN        = Number(row.effective_max);
    const hasDominant = sortedPres(pres).length > 0;
    const coverDays   = row.daily_velocity > 0 ? (stock / row.daily_velocity).toFixed(1) : null;
    const isBodega    = row._erp_sucursal_id === 6;

    const [branchData,   setBranchData]   = useState(null);
    const [branchReady,  setBranchReady]  = useState(false);
    const [expiryData,   setExpiryData]   = useState([]);
    const [historyData,  setHistoryData]  = useState([]);
    const [purchaseData, setPurchaseData] = useState([]);
    const [saleData,     setSaleData]     = useState([]);
    const [detailReady,  setDetailReady]  = useState(false);
    const [deadAction,   setDeadAction]   = useState(null);

    const logDeadStockAction = async (action) => {
        setDeadAction(action);
        await useStaff.getState().appendAuditLog('DEAD_STOCK_ACTION', String(row.erp_product_id), {
            product: row.product_name, action, stock: Number(row.current_stock), erp_sucursal_id: row._erp_sucursal_id,
        });
    };

    // Wave 1: branch summary (renders the cards immediately)
    // Wave 2: everything else in parallel
    useEffect(() => {
        setBranchReady(false); // eslint-disable-line react-hooks/set-state-in-effect -- reset antes de re-fetch al cambiar de producto
        setDetailReady(false);

        supabase.rpc('get_product_branch_summary', { p_erp_product_id: row.erp_product_id })
            .then(({ data }) => {
                setBranchData(data || []);
                setBranchReady(true);
            });

        Promise.all([
            supabase.rpc('get_product_expiring_lots', { p_erp_product_id: row.erp_product_id }),
            supabase.from('product_stock_params_history')
                .select('captured_at, min_units, max_units, daily_velocity, velocity_30d, abc_class, demand_variability')
                .eq('erp_product_id', row.erp_product_id)
                .eq('erp_sucursal_id', row._erp_sucursal_id)
                .order('captured_at', { ascending: false })
                .limit(5),
            canSeeCosts
                ? supabase.from('product_cost_history')
                    .select('fecha, proveedor, precio_unitario, cantidad, lote, fecha_vencimiento')
                    .eq('erp_product_id', row.erp_product_id)
                    .order('fecha', { ascending: false })
                    .limit(6)
                : Promise.resolve({ data: [] }),
            canSeeCosts
                ? supabase.rpc('get_product_last_sales', { p_erp_product_id: row.erp_product_id, p_erp_sucursal_id: row._erp_sucursal_id === 6 ? null : row._erp_sucursal_id })
                : Promise.resolve({ data: [] }),
        ]).then(([{ data: eData }, { data: hData }, { data: pData }, { data: sData }]) => {
            setExpiryData(eData || []);
            setHistoryData(hData || []);
            setPurchaseData(pData || []);
            setSaleData(sData || []);
            setDetailReady(true);
        });
    }, [row.erp_product_id, row._erp_sucursal_id, canSeeCosts]);

    const netStock   = branchData?.filter(b => b.erp_sucursal_id !== 6).reduce((s, b) => s + Number(b.current_stock), 0) ?? null;
    const totalStock = branchData?.reduce((s, b) => s + Number(b.current_stock), 0) ?? null;

    const pedir = (!row.is_dead_stock && maxN > 0 && (row.alert_status === 'out_of_stock' || row.alert_status === 'below_min'))
        ? Math.max(0, maxN - stock)
        : null;

    const transferSuggestions = useMemo(() => {
        if (!branchData || pedir === null || pedir === 0) return [];
        return branchData
            .filter(b => b.erp_sucursal_id !== row._erp_sucursal_id && b.alert_status === 'overstocked')
            .map(b => ({
                name:        ERP_NAMES[b.erp_sucursal_id] || `Suc. ${b.erp_sucursal_id}`,
                transferable: Math.max(0, Number(b.current_stock) - Number(b.effective_max)),
                stock:        Number(b.current_stock),
            }))
            .filter(s => s.transferable > 0)
            .sort((a, b) => b.transferable - a.transferable);
    }, [branchData, row._erp_sucursal_id, pedir]);

    const glassSection = {
        borderTop: '1px solid rgba(255,255,255,0.50)',
    };

    return (
        <div className="mx-3 mb-3 rounded-2xl overflow-hidden"
            style={{
                background: 'rgba(238,243,255,0.96)',
                border: '1px solid rgba(220,228,255,0.80)',
                boxShadow: '0 8px 32px rgba(0,82,204,0.08), inset 0 1px 0 rgba(255,255,255,0.95)',
            }}>

            {/* ── Multi-branch grid ── */}
            <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Stock en red</span>
                    {netStock !== null && (
                        <div className="flex items-center gap-3 text-[9px] text-slate-500">
                            <span>Red: <strong className="text-slate-600 tabular-nums">{netStock.toLocaleString()} und</strong></span>
                            <span className="text-slate-500">·</span>
                            <span>Incl. Bodega: <strong className="text-slate-600 tabular-nums">{totalStock.toLocaleString()} und</strong></span>
                        </div>
                    )}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                {!branchReady ? (
                    <motion.div key="branch-loading"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="flex items-center justify-center py-5">
                        <Loader2 size={14} className="animate-spin text-slate-400" />
                    </motion.div>
                ) : (
                    <motion.div key="branch-grid"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                        className="grid gap-1.5"
                        style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                        {ERP_ORDER.map(erpId => {
                            const bd        = branchData?.find(b => b.erp_sucursal_id === erpId);
                            const isCurrent = erpId === row._erp_sucursal_id;
                            const bStock    = Number(bd?.current_stock ?? 0);
                            const bMin      = Number(bd?.effective_min ?? 0);
                            const bMax      = Number(bd?.effective_max ?? 0);
                            const alert     = ALERT[bd?.alert_status ?? 'ok'] ?? ALERT.ok;
                            const hasData   = !!bd;
                            const hasDraft  = bd?.draft_status === 'pending';
                            const bDraftMin = hasDraft ? Number(bd?.draft_min ?? 0) : null;
                            const bDraftMax = hasDraft ? Number(bd?.draft_max ?? 0) : null;

                            return (
                                <div key={erpId}
                                    className={`rounded-xl px-2 py-2 border transition-colors ${
                                        isCurrent
                                            ? 'border-[#0052CC]/40 bg-blue-50/60 ring-1 ring-[#0052CC]/20'
                                            : 'border-white/70 bg-white/50'
                                    } ${!hasData ? 'opacity-35' : ''}`}>
                                    <div className="flex items-center justify-between gap-0.5 mb-0.5">
                                        <span className="text-[8px] font-black text-slate-500 truncate leading-tight">
                                            {erpId === 6 ? 'Bodega' : ERP_NAMES[erpId].replace('Salud ', 'S.')}
                                        </span>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                    </div>
                                    <div className={`text-[12px] font-black tabular-nums leading-none ${
                                        !hasData ? 'text-slate-500' :
                                        bStock === 0 ? 'text-red-500' :
                                        bStock < bMin ? 'text-orange-600' : 'text-slate-800'
                                    }`}>
                                        {!hasData ? '—' : bStock === 0 ? '0' : bStock.toLocaleString()}
                                    </div>
                                    {hasData && <StockBar current={bStock} min={bMin} max={bMax} />}
                                    {hasData && (bMin > 0 || bMax > 0 || hasDraft) && (
                                        <div className="flex flex-col gap-0.5 mt-0.5">
                                            {(bMin > 0 || bMax > 0) && (
                                                <div className="flex items-center gap-0.5 text-[9px] tabular-nums leading-tight">
                                                    <span className={`font-black ${hasDraft ? 'text-orange-400/70' : 'text-orange-500'}`}>{bMin > 0 ? bMin.toLocaleString() : '—'}</span>
                                                    <span className="text-slate-500">·</span>
                                                    <span className={`font-black ${hasDraft ? 'text-blue-400/70' : 'text-blue-500'}`}>{bMax > 0 ? bMax.toLocaleString() : '—'}</span>
                                                </div>
                                            )}
                                            {hasDraft && (
                                                <div className="flex flex-col items-start gap-0.5 mt-0.5">
                                                    <span className="text-[7px] font-black uppercase tracking-wide text-amber-500 leading-none">Borrador</span>
                                                    <div className="flex items-center gap-0.5 text-[8px] tabular-nums leading-tight rounded px-0.5 py-px border border-dashed border-amber-300 bg-amber-50/50">
                                                        <span className="text-amber-600 font-black">{bDraftMin > 0 ? bDraftMin.toLocaleString() : '—'}</span>
                                                        <span className="text-amber-300">·</span>
                                                        <span className="text-amber-600 font-black">{bDraftMax > 0 ? bDraftMax.toLocaleString() : '—'}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </motion.div>
                )}
                </AnimatePresence>
            </div>

            {/* Sin stock indicator */}
            {branchReady && stock === 0 && (
                <div className="px-4 py-3 flex items-center gap-2 text-[11px] text-slate-500 italic" style={glassSection}>
                    <Package size={13} className="shrink-0 text-slate-500" /> Sin existencias en esta sucursal
                </div>
            )}

            {/* ── Referencia pedido (sucursal actual) ── */}
            {!row.is_dead_stock && (minN > 0 || coverDays) && (
                <div className="px-4 py-2.5 flex items-center gap-5 flex-wrap" style={glassSection}>
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Referencia pedido</span>
                    {coverDays && (
                        <span className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                            <span className="text-slate-500 font-semibold">Cobertura</span>
                            <span className="font-black text-slate-700">{coverDays} días</span>
                            <span className="text-slate-500 text-[10px]">de {cycleDays}d objetivo</span>
                        </span>
                    )}
                    {minN > 0 && (
                        <>
                            <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />
                                <span className="text-slate-500 font-semibold">MIN</span>
                                <span className="font-black text-orange-600">{hasDominant ? formatDominant(minN, pres) : `${minN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-slate-500 text-[10px]">({minN.toLocaleString()} und)</span>}
                            </span>
                            <span className="flex items-center gap-1.5 text-[11px]">
                                <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                                <span className="text-slate-500 font-semibold">MAX</span>
                                <span className="font-black text-blue-600">{hasDominant ? formatDominant(maxN, pres) : `${maxN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-slate-500 text-[10px]">({maxN.toLocaleString()} und)</span>}
                            </span>
                        </>
                    )}
                    {pedir !== null && (
                        <span className="flex items-center gap-1.5 text-[11px]">
                            <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                            <span className="text-slate-500 font-semibold">Pedir</span>
                            <span className="font-black text-red-600">{hasDominant ? formatDominant(pedir, pres) : `${pedir.toLocaleString()} und`}</span>
                            {hasDominant && <span className="text-slate-500 text-[10px]">({pedir.toLocaleString()} und)</span>}
                        </span>
                    )}
                </div>
            )}

            {/* ── Traslado sugerido ── */}
            {transferSuggestions.length > 0 && (
                <div className="px-4 py-2.5 flex flex-col gap-1.5" style={{ borderTop: '1px solid rgba(251,191,36,0.3)', background: 'rgba(255,251,235,0.40)' }}>
                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">Traslado sugerido</span>
                    <div className="flex flex-wrap gap-2">
                        {transferSuggestions.map(s => (
                            <div key={s.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100/80 border border-amber-200/80">
                                <Building2 size={9} className="text-amber-600 shrink-0" />
                                <span className="text-[10px] font-black text-amber-800">{s.name}</span>
                                <span className="text-[10px] font-bold text-amber-600 tabular-nums">{s.transferable.toLocaleString()} und disponibles</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Wave 2 detail: skeleton → content ── */}
            <AnimatePresence mode="wait" initial={false}>
            {!detailReady ? (
                <motion.div key="detail-loading"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 0.14 }}
                    className="px-4 py-4 flex items-center gap-2" style={glassSection}>
                    <div className="flex gap-1.5 items-center">
                        {[0,1,2,3].map(i => (
                            <div key={i} className="h-1.5 rounded-full bg-slate-200/70 animate-pulse"
                                style={{ width: `${32 + i * 12}px`, animationDelay: `${i * 0.12}s` }} />
                        ))}
                    </div>
                </motion.div>
            ) : (
                <motion.div key="detail-content"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
                <>
                    {/* ── Vencimientos próximos (60 días) ── */}
                    {expiryData.length > 0 && (
                        <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(251,146,60,0.25)', background: 'rgba(255,247,237,0.35)' }}>
                            <span className="text-[9px] font-black uppercase tracking-widest text-orange-500">Vencimientos próximos (60 días)</span>
                            <div className="flex flex-col gap-1">
                                {expiryData.map((lot, i) => {
                                    const daysLeft = Math.ceil((new Date(lot.fecha_vencimiento) - now) / 86400000);
                                    const urgent   = daysLeft <= 30;
                                    return (
                                        <div key={i} className="flex items-center gap-3 text-[10px]">
                                            <span className={`font-black tabular-nums w-8 shrink-0 ${urgent ? 'text-red-600' : 'text-orange-600'}`}>{daysLeft}d</span>
                                            <span className="text-slate-500 font-mono text-[9px] shrink-0">{lot.lote || '—'}</span>
                                            <span className="text-slate-600 font-semibold tabular-nums">{Number(lot.cantidad).toLocaleString()} und</span>
                                            <span className="text-slate-500 text-[9px]">{new Date(lot.fecha_vencimiento).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Últimas compras / Últimas ventas ── */}
                    {(purchaseData.length > 0 || saleData.length > 0 || (isBodega && branchData?.some(b => Number(b.effective_min ?? 0) > 0 || Number(b.effective_max ?? 0) > 0))) && (
                        <div style={glassSection}>
                            {isBodega ? (
                                /* Bodega: 3 columnas — compras + ventas red + MIN·MAX por sucursal */
                                <div className="grid grid-cols-3">
                                    {/* Compras */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid rgba(255,255,255,0.50)' }}>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Últimas compras (Bodega)</span>
                                        {!canSeeCosts
                                            ? <span className="text-[10px] text-slate-500 italic">Sin permiso para ver costos de compra</span>
                                            : purchaseData.length === 0
                                            ? <span className="text-[10px] text-slate-500 italic">Sin compras registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {purchaseData.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-[9px] text-slate-500 shrink-0 w-14 tabular-nums">
                                                            {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-slate-700 tabular-nums shrink-0">
                                                            {Number(p.cantidad).toLocaleString()} und
                                                        </span>
                                                        <span className="text-slate-500 shrink-0">${Number(p.precio_unitario).toFixed(2)}</span>
                                                        <span className="text-slate-500 truncate min-w-0 flex-1">{p.proveedor || '—'}</span>
                                                        {p.lote && p.lote !== 'GENERICO' && (
                                                            <span className="shrink-0 text-[8px] font-mono text-slate-500 bg-white/60 px-1 rounded">{p.lote}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* Ventas — todas las sucursales con badge */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid rgba(255,255,255,0.50)' }}>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Últimas ventas</span>
                                        {!canSeeCosts
                                            ? <span className="text-[10px] text-slate-500 italic">Sin permiso para ver costos de compra</span>
                                            : saleData.length === 0
                                            ? <span className="text-[10px] text-slate-500 italic">Sin ventas registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {saleData.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-[9px] text-slate-500 shrink-0 w-14 tabular-nums">
                                                            {new Date(s.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="text-[8px] font-bold text-slate-500 shrink-0 bg-slate-100/80 rounded px-1">
                                                            {(ERP_NAMES[s.erp_sucursal_id] ?? `S${s.erp_sucursal_id}`).replace('Salud ', 'S.').replace('La Popular', 'Pop.')}
                                                        </span>
                                                        <span className="font-bold text-emerald-700 tabular-nums shrink-0">
                                                            {Number(s.cantidad).toLocaleString()} und
                                                        </span>
                                                        {s.total_linea > 0 && (
                                                            <span className="text-slate-500 shrink-0">${Number(s.total_linea).toFixed(2)}</span>
                                                        )}
                                                        {s.cliente && (
                                                            <span className="text-slate-500 truncate min-w-0 flex-1">{s.cliente}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* MIN · MAX por sucursal */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">MIN · MAX red</span>
                                        {!branchReady
                                            ? <Loader2 size={10} className="animate-spin text-slate-300" />
                                            : <div className="flex flex-col gap-1">
                                                {ERP_ORDER.filter(id => id !== 6).map(erpId => {
                                                    const bd = branchData?.find(b => b.erp_sucursal_id === erpId);
                                                    if (!bd) return null;
                                                    const bMin = Number(bd.effective_min ?? 0);
                                                    const bMax = Number(bd.effective_max ?? 0);
                                                    const hasDraft = bd.draft_status === 'pending';
                                                    const dMin = hasDraft ? Number(bd.draft_min ?? 0) : null;
                                                    const dMax = hasDraft ? Number(bd.draft_max ?? 0) : null;
                                                    return (
                                                        <div key={erpId} className="flex items-center gap-1.5 text-[10px]">
                                                            <span className="text-slate-500 shrink-0 w-9 text-[8px] truncate">
                                                                {(ERP_NAMES[erpId] ?? `S${erpId}`).replace('Salud ', 'S.').replace('La Popular', 'Pop.')}
                                                            </span>
                                                            <span className="text-orange-500 font-black tabular-nums">{bMin > 0 ? bMin.toLocaleString() : '—'}</span>
                                                            <span className="text-slate-500">·</span>
                                                            <span className="text-blue-500 font-black tabular-nums">{bMax > 0 ? bMax.toLocaleString() : '—'}</span>
                                                            {hasDraft && (
                                                                <span className="inline-flex items-center gap-0.5 text-[7px] font-black uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-300 border-dashed rounded px-1 py-px whitespace-nowrap">
                                                                    Borrador {dMin > 0 ? dMin.toLocaleString() : '—'}·{dMax > 0 ? dMax.toLocaleString() : '—'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                                {ERP_ORDER.filter(id => id !== 6).every(id => {
                                                    const bd = branchData?.find(b => b.erp_sucursal_id === id);
                                                    if (!bd) return true;
                                                    return Number(bd.effective_min ?? 0) === 0 && Number(bd.effective_max ?? 0) === 0 && bd.draft_status !== 'pending';
                                                }) && (
                                                    <span className="text-[9px] text-rose-400 font-semibold italic">Sin MIN·MAX en ninguna sala</span>
                                                )}
                                            </div>
                                        }
                                    </div>
                                </div>
                            ) : (
                                /* Sucursales: 2 columnas — compras + ventas de la sucursal */
                                <div className="grid grid-cols-2" style={{ divideX: '1px solid rgba(255,255,255,0.50)' }}>
                                    {/* Compras */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid rgba(255,255,255,0.50)' }}>
                                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Últimas compras (Bodega)</span>
                                        {!canSeeCosts
                                            ? <span className="text-[10px] text-slate-500 italic">Sin permiso para ver costos de compra</span>
                                            : purchaseData.length === 0
                                            ? <span className="text-[10px] text-slate-500 italic">Sin compras registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {purchaseData.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-[9px] text-slate-500 shrink-0 w-14 tabular-nums">
                                                            {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-slate-700 tabular-nums shrink-0">
                                                            {Number(p.cantidad).toLocaleString()} und
                                                        </span>
                                                        <span className="text-slate-500 shrink-0">${Number(p.precio_unitario).toFixed(2)}</span>
                                                        <span className="text-slate-500 truncate min-w-0 flex-1">{p.proveedor || '—'}</span>
                                                        {p.lote && p.lote !== 'GENERICO' && (
                                                            <span className="shrink-0 text-[8px] font-mono text-slate-500 bg-white/60 px-1 rounded">{p.lote}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* Ventas de la sucursal */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2">
                                        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Últimas ventas (sucursal)</span>
                                        {!canSeeCosts
                                            ? <span className="text-[10px] text-slate-500 italic">Sin permiso para ver costos de compra</span>
                                            : saleData.length === 0
                                            ? <span className="text-[10px] text-slate-500 italic">Sin ventas registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {saleData.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-[9px] text-slate-500 shrink-0 w-14 tabular-nums">
                                                            {new Date(s.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-emerald-700 tabular-nums shrink-0">
                                                            {Number(s.cantidad).toLocaleString()} und
                                                        </span>
                                                        {s.total_linea > 0 && (
                                                            <span className="text-slate-500 shrink-0">${Number(s.total_linea).toFixed(2)}</span>
                                                        )}
                                                        {s.cliente && (
                                                            <span className="text-slate-500 truncate min-w-0 flex-1">{s.cliente}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── Proyección + Historial (2 columnas en la misma fila al fondo) ── */}
                    {(!row.is_dead_stock && row.daily_velocity > 0 && stock > 0) || historyData.length > 0 ? (
                        <div style={glassSection}>
                            <div className="grid grid-cols-2">
                                {/* Proyección de stock */}
                                <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid rgba(255,255,255,0.50)' }}>
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Proyección de stock</span>
                                    {(!row.is_dead_stock && row.daily_velocity > 0 && stock > 0) ? (
                                        <div className="flex items-center gap-6 flex-wrap">
                                            {[30, 60, 90].map(days => {
                                                const projected = Math.max(0, Math.round(stock - row.daily_velocity * days));
                                                const depleted  = projected === 0;
                                                const low       = projected > 0 && projected < minN;
                                                const color     = depleted ? 'text-red-600' : low ? 'text-orange-600' : 'text-emerald-600';
                                                return (
                                                    <div key={days} className="flex flex-col items-center gap-0.5">
                                                        <span className="text-[9px] text-slate-500 font-semibold">+{days}d</span>
                                                        <span className={`text-[15px] font-black tabular-nums leading-none ${color}`}>
                                                            {depleted ? '0 ✗' : projected.toLocaleString()}
                                                        </span>
                                                        <span className="text-[8px] text-slate-500">und</span>
                                                    </div>
                                                );
                                            })}
                                            <div className="flex-1 text-[9px] text-slate-500 leading-snug">
                                                a {Number(row.daily_velocity).toFixed(2)} und/día
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-[10px] text-slate-500 italic">No disponible</span>
                                    )}
                                </div>

                                {/* Historial de cálculos */}
                                <div className="px-4 py-2.5 flex flex-col gap-2">
                                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Historial de cálculos</span>
                                    {historyData.length === 0 ? (
                                        <span className="text-[10px] text-slate-500 italic">Sin historial</span>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            {historyData.map((h, i) => (
                                                <div key={i} className="flex items-center gap-3 text-[10px] text-slate-500">
                                                    <span className="text-[9px] text-slate-500 shrink-0 w-14 tabular-nums">
                                                        {new Date(h.captured_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                                    </span>
                                                    <span className="font-bold text-orange-500">{(h.min_units ?? 0).toLocaleString()}</span>
                                                    <span className="text-slate-500">→</span>
                                                    <span className="font-bold text-blue-500">{(h.max_units ?? 0).toLocaleString()}</span>
                                                    <span className="text-slate-500">{Number(h.daily_velocity || 0).toFixed(1)}/d</span>
                                                    {h.abc_class && <AbcXyzBadge abc={h.abc_class} xyz={h.demand_variability} />}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* ── Acciones para dead stock ── */}
                    {row.is_dead_stock && (
                        <div className="px-4 py-2.5 flex flex-col gap-2" style={glassSection}>
                            <span className="text-[9px] font-black uppercase tracking-widest text-slate-600">Opciones</span>
                            {deadAction ? (
                                <div className="flex items-center gap-2 text-[11px] text-emerald-700 font-semibold">
                                    <CheckCircle2 size={12} />
                                    {deadAction === 'transfer' ? 'Marcado para traslado' : 'Marcado para liquidación'} — registrado en auditoría
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <button onClick={() => logDeadStockAction('transfer')}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50/80 border border-amber-200/80 rounded-xl hover:bg-amber-100/80 transition-colors">
                                        <Building2 size={11} /> Marcar para traslado
                                    </button>
                                    <button onClick={() => logDeadStockAction('liquidate')}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 border border-blue-200/80 rounded-xl hover:bg-blue-100/80 transition-colors">
                                        <TrendingDown size={11} /> Marcar para liquidación
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    );
}
