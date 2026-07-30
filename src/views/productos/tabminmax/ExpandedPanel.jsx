// Extracted from TabMinMax.jsx (Bloque 6.C) — expanded panel: multi-branch
// view + current branch breakdown. The most coupled extraction so far: does
// its own Supabase fetches (branch summary, expiring lots, cost/sales
// history), gated by minmax_ver_costos permission.
import { useState, useEffect, useMemo } from 'react';
import Button from '../../../components/common/Button';
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
import { fetchStockParamsHistory, fetchProductCostHistory } from '../../../data/stockParams';
import { formatMoney } from '../../../utils/formatNumber';

// 7B.2 — regla (g) de Bodega: la cuenta regresiva es sobre la política en
// meses, NO el mes de vencimiento — el envío llega ~1 mes después de
// mandarse (regla h: se manda 25-30 del mes, llega primeros 15 días del mes
// siguiente). Ej.: vence diciembre, política 2 meses → el límite de envío
// es la última semana de SEPTIEMBRE (no octubre, que sería la resta ingenua).
function computeSendDeadline(fechaVencimiento, mesesDevolucion) {
    const d = new Date(fechaVencimiento);
    d.setMonth(d.getMonth() - (mesesDevolucion + 1));
    d.setDate(25); // ventana de envío real: 25-30 del mes (regla h)
    return d;
}

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
    const [policyData,   setPolicyData]   = useState(null);
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
            fetchStockParamsHistory(row.erp_product_id, row._erp_sucursal_id),
            canSeeCosts
                ? fetchProductCostHistory(row.erp_product_id)
                : Promise.resolve({ data: [] }),
            canSeeCosts
                ? supabase.rpc('get_product_last_sales', { p_erp_product_id: row.erp_product_id, p_erp_sucursal_id: row._erp_sucursal_id === 6 ? null : row._erp_sucursal_id })
                : Promise.resolve({ data: [] }),
            // 7B.2: política de vencimiento/devolución resuelta (laboratorio →
            // viñeta del proveedor, con ND a nivel de producto como excepción).
            supabase.rpc('get_product_vencimiento_policy', { p_erp_product_id: row.erp_product_id }),
        ]).then(([{ data: eData }, { data: hData }, { data: pData }, { data: sData }, { data: polData }]) => {
            setExpiryData(eData || []);
            setHistoryData(hData || []);
            setPurchaseData(pData || []);
            setSaleData(sData || []);
            setPolicyData(polData?.[0] || null);
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
        // Era `rgba(255,255,255,.50)`: un divisor BLANCO fijo, invisible
        // sobre tema claro y una raya luminosa sobre los oscuros.
        borderTop: '1px solid var(--border-card)',
    };

    return (
        <div className="mx-3 mb-3 rounded-2xl overflow-hidden"
            style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-card)',
                boxShadow: 'var(--shadow-glass-3)',
            }}>

            {/* ── Multi-branch grid ── */}
            <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Stock en red</span>
                    {netStock !== null && (
                        <div className="flex items-center gap-3 text-micro text-content-3">
                            <span>Red: <strong className="text-content-2 tabular-nums">{netStock.toLocaleString()} und</strong></span>
                            <span className="text-content-3">·</span>
                            <span>Incl. Bodega: <strong className="text-content-2 tabular-nums">{totalStock.toLocaleString()} und</strong></span>
                        </div>
                    )}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                {!branchReady ? (
                    <motion.div key="branch-loading"
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className="flex items-center justify-center py-5">
                        <Loader2 size={14} className="animate-spin text-content-3" />
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
                                    data-surface={isCurrent ? undefined : 'card'} className={`rounded-xl px-2 py-2 border transition-colors ${isCurrent ? 'border-brand/40 bg-chart-1/10 ring-1 ring-brand/30' : ''} ${!hasData ? 'opacity-35' : ''}`}>
                                    <div className="flex items-center justify-between gap-0.5 mb-0.5">
                                        <span className="text-micro font-black text-content-3 truncate leading-tight">
                                            {erpId === 6 ? 'Bodega' : ERP_NAMES[erpId].replace('Salud ', 'S.')}
                                        </span>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${alert.dot}`} />
                                    </div>
                                    <div className={`text-body-sm font-black tabular-nums leading-none ${
                                        !hasData ? 'text-content-3' :
                                        bStock === 0 ? 'text-danger' :
                                        bStock < bMin ? 'text-chart-4-text' : 'text-content'
                                    }`}>
                                        {!hasData ? '—' : bStock === 0 ? '0' : bStock.toLocaleString()}
                                    </div>
                                    {hasData && <StockBar current={bStock} min={bMin} max={bMax} />}
                                    {hasData && (bMin > 0 || bMax > 0 || hasDraft) && (
                                        <div className="flex flex-col gap-0.5 mt-0.5">
                                            {(bMin > 0 || bMax > 0) && (
                                                <div className="flex items-center gap-0.5 text-micro tabular-nums leading-tight">
                                                    <span className={`font-black ${hasDraft ? 'text-chart-4-text/70' : 'text-chart-4-text'}`}>{bMin > 0 ? bMin.toLocaleString() : '—'}</span>
                                                    <span className="text-content-3">·</span>
                                                    <span className={`font-black ${hasDraft ? 'text-chart-1-text/70' : 'text-chart-1-text'}`}>{bMax > 0 ? bMax.toLocaleString() : '—'}</span>
                                                </div>
                                            )}
                                            {hasDraft && (
                                                <div className="flex flex-col items-start gap-0.5 mt-0.5">
                                                    <span className="text-micro font-black uppercase tracking-wide text-warning leading-none">Borrador</span>
                                                    <div className="flex items-center gap-0.5 text-micro tabular-nums leading-tight rounded px-0.5 py-px border border-dashed border-warning/40 bg-warning/10">
                                                        <span className="text-warning font-black">{bDraftMin > 0 ? bDraftMin.toLocaleString() : '—'}</span>
                                                        <span className="text-warning">·</span>
                                                        <span className="text-warning font-black">{bDraftMax > 0 ? bDraftMax.toLocaleString() : '—'}</span>
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
                <div className="px-4 py-3 flex items-center gap-2 text-label text-content-3 italic" style={glassSection}>
                    <Package size={13} className="shrink-0 text-content-3" /> Sin existencias en esta sucursal
                </div>
            )}

            {/* ── Referencia pedido (sucursal actual) ── */}
            {!row.is_dead_stock && (minN > 0 || coverDays) && (
                <div className="px-4 py-2.5 flex items-center gap-5 flex-wrap" style={glassSection}>
                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Referencia pedido</span>
                    {coverDays && (
                        <span className="flex items-center gap-1.5 text-label">
                            <span className="w-2 h-2 rounded-full bg-content-3 shrink-0" />
                            <span className="text-content-3 font-semibold">Cobertura</span>
                            <span className="font-black text-content-2">{coverDays} días</span>
                            <span className="text-content-3 text-caption">de {cycleDays}d objetivo</span>
                        </span>
                    )}
                    {minN > 0 && (
                        <>
                            <span className="flex items-center gap-1.5 text-label">
                                <span className="w-2 h-2 rounded-full bg-chart-4 shrink-0" />
                                <span className="text-content-3 font-semibold">MIN</span>
                                <span className="font-black text-chart-4-text">{hasDominant ? formatDominant(minN, pres) : `${minN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-content-3 text-caption">({minN.toLocaleString()} und)</span>}
                            </span>
                            <span className="flex items-center gap-1.5 text-label">
                                <span className="w-2 h-2 rounded-full bg-chart-1 shrink-0" />
                                <span className="text-content-3 font-semibold">MAX</span>
                                <span className="font-black text-chart-1-text">{hasDominant ? formatDominant(maxN, pres) : `${maxN.toLocaleString()} und`}</span>
                                {hasDominant && <span className="text-content-3 text-caption">({maxN.toLocaleString()} und)</span>}
                            </span>
                        </>
                    )}
                    {pedir !== null && (
                        <span className="flex items-center gap-1.5 text-label">
                            <span className="w-2 h-2 rounded-full bg-danger shrink-0" />
                            <span className="text-content-3 font-semibold">Pedir</span>
                            <span className="font-black text-danger">{hasDominant ? formatDominant(pedir, pres) : `${pedir.toLocaleString()} und`}</span>
                            {hasDominant && <span className="text-content-3 text-caption">({pedir.toLocaleString()} und)</span>}
                        </span>
                    )}
                </div>
            )}

            {/* ── Traslado sugerido ── */}
            {transferSuggestions.length > 0 && (
                <div className="px-4 py-2.5 flex flex-col gap-1.5" // Amarillo y naranja quemados: en tema oscuro estos avisos quedaban
                        // en un beige claro. Los tokens de estado ya llevan su tinte.
                        style={{ borderTop: '1px solid color-mix(in srgb, var(--warning) 30%, transparent)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)' }}>
                    <span className="text-micro font-black uppercase tracking-widest text-warning">Traslado sugerido</span>
                    <div className="flex flex-wrap gap-2">
                        {transferSuggestions.map(s => (
                            <div key={s.name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 border border-warning/30">
                                <Building2 size={9} className="text-warning shrink-0" />
                                <span className="text-caption font-black text-warning-text">{s.name}</span>
                                <span className="text-caption font-bold text-warning tabular-nums">{s.transferable.toLocaleString()} und disponibles</span>
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
                            <div key={i} className="h-1.5 rounded-full bg-surface-card-hover/70 animate-pulse"
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
                        <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderTop: '1px solid color-mix(in srgb, var(--chart-4) 25%, transparent)', background: 'color-mix(in srgb, var(--chart-4) 7%, transparent)' }}>
                            <div className="flex items-center justify-between flex-wrap gap-1.5">
                                <span className="text-micro font-black uppercase tracking-widest text-chart-4-text">Vencimientos próximos (60 días)</span>
                                {policyData && (
                                    <span className="flex items-center gap-1 text-micro font-bold text-content-3">
                                        {policyData.es_cofarsal && (
                                            <span title="COFARSAL" className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                                        )}
                                        {policyData.proveedor_nombre}
                                        {policyData.es_devolutivo
                                            ? (policyData.meses_devolucion != null ? ` · ${policyData.meses_devolucion}m devolutivo` : '')
                                            : ' · ND'}
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-col gap-1.5">
                                {expiryData.map((lot, i) => {
                                    const daysLeft = Math.ceil((new Date(lot.fecha_vencimiento) - now) / 86400000);
                                    const urgent   = daysLeft <= 30;
                                    const sendDeadline = (policyData?.es_devolutivo && policyData?.meses_devolucion != null)
                                        ? computeSendDeadline(lot.fecha_vencimiento, policyData.meses_devolucion)
                                        : null;
                                    const pastDeadline = sendDeadline ? now > sendDeadline : false;
                                    const ndReport = policyData && !policyData.es_devolutivo && daysLeft <= 210;
                                    return (
                                        <div key={i} className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-3 text-caption">
                                                <span className={`font-black tabular-nums w-8 shrink-0 ${urgent ? 'text-danger' : 'text-chart-4-text'}`}>{daysLeft}d</span>
                                                <span className="text-content-3 font-mono text-micro shrink-0">{lot.lote || '—'}</span>
                                                <span className="text-content-2 font-semibold tabular-nums">{Number(lot.cantidad).toLocaleString()} und</span>
                                                <span className="text-content-3 text-micro">{new Date(lot.fecha_vencimiento).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                            </div>
                                            {sendDeadline && (
                                                <span className={`text-micro pl-11 font-semibold ${pastDeadline ? 'text-danger' : 'text-content-3'}`}>
                                                    {pastDeadline ? 'FUERA DE PLAZO — límite era el ' : 'Enviar a bodega antes del '}
                                                    {sendDeadline.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                                </span>
                                            )}
                                            {ndReport && (
                                                <span className="text-micro pl-11 font-semibold text-warning">
                                                    ND — reportar a jefe inmediato (6-7 meses antes de vencer)
                                                </span>
                                            )}
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
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid var(--border-card)' }}>
                                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Últimas compras (Bodega)</span>
                                        {!canSeeCosts
                                            ? <span className="text-caption text-content-3 italic">Sin permiso para ver costos de compra</span>
                                            : purchaseData.length === 0
                                            ? <span className="text-caption text-content-3 italic">Sin compras registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {purchaseData.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-caption">
                                                        <span className="text-micro text-content-3 shrink-0 w-14 tabular-nums">
                                                            {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-content-2 tabular-nums shrink-0">
                                                            {Number(p.cantidad).toLocaleString()} und
                                                        </span>
                                                        <span className="text-content-3 shrink-0">{formatMoney(p.precio_unitario)}</span>
                                                        <span className="text-content-3 truncate min-w-0 flex-1">{p.proveedor || '—'}</span>
                                                        {p.lote && p.lote !== 'GENERICO' && (
                                                            <span className="shrink-0 text-micro font-mono text-content-3 bg-surface-card px-1 rounded">{p.lote}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* Ventas — todas las sucursales con badge */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid var(--border-card)' }}>
                                        <span className="text-micro font-black uppercase tracking-widest text-success">Últimas ventas</span>
                                        {!canSeeCosts
                                            ? <span className="text-caption text-content-3 italic">Sin permiso para ver costos de compra</span>
                                            : saleData.length === 0
                                            ? <span className="text-caption text-content-3 italic">Sin ventas registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {saleData.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-caption">
                                                        <span className="text-micro text-content-3 shrink-0 w-14 tabular-nums">
                                                            {new Date(s.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="text-micro font-bold text-content-3 shrink-0 bg-surface-card-hover/80 rounded px-1">
                                                            {(ERP_NAMES[s.erp_sucursal_id] ?? `S${s.erp_sucursal_id}`).replace('Salud ', 'S.').replace('La Popular', 'Pop.')}
                                                        </span>
                                                        <span className="font-bold text-success-text tabular-nums shrink-0">
                                                            {Number(s.cantidad).toLocaleString()} und
                                                        </span>
                                                        {s.total_linea > 0 && (
                                                            <span className="text-content-3 shrink-0">{formatMoney(s.total_linea)}</span>
                                                        )}
                                                        {s.cliente && (
                                                            <span className="text-content-3 truncate min-w-0 flex-1">{s.cliente}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* MIN · MAX por sucursal */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2">
                                        <span className="text-micro font-black uppercase tracking-widest text-chart-3-text">MIN · MAX red</span>
                                        {!branchReady
                                            ? <Loader2 size={10} className="animate-spin text-content-3" />
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
                                                        <div key={erpId} className="flex items-center gap-1.5 text-caption">
                                                            <span className="text-content-3 shrink-0 w-9 text-micro truncate">
                                                                {(ERP_NAMES[erpId] ?? `S${erpId}`).replace('Salud ', 'S.').replace('La Popular', 'Pop.')}
                                                            </span>
                                                            <span className="text-chart-4-text font-black tabular-nums">{bMin > 0 ? bMin.toLocaleString() : '—'}</span>
                                                            <span className="text-content-3">·</span>
                                                            <span className="text-chart-1-text font-black tabular-nums">{bMax > 0 ? bMax.toLocaleString() : '—'}</span>
                                                            {hasDraft && (
                                                                <span className="inline-flex items-center gap-0.5 text-micro font-black uppercase tracking-wide text-warning bg-warning/10 border border-warning/40 border-dashed rounded px-1 py-px whitespace-nowrap">
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
                                                    <span className="text-micro text-danger-text font-semibold italic">Sin MIN·MAX en ninguna sala</span>
                                                )}
                                            </div>
                                        }
                                    </div>
                                </div>
                            ) : (
                                /* Sucursales: 2 columnas — compras + ventas de la sucursal */
                                <div className="grid grid-cols-2" style={{ divideX: '1px solid var(--border-card)' }}>
                                    {/* Compras */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid var(--border-card)' }}>
                                        <span className="text-micro font-black uppercase tracking-widest text-content-2">Últimas compras (Bodega)</span>
                                        {!canSeeCosts
                                            ? <span className="text-caption text-content-3 italic">Sin permiso para ver costos de compra</span>
                                            : purchaseData.length === 0
                                            ? <span className="text-caption text-content-3 italic">Sin compras registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {purchaseData.map((p, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-caption">
                                                        <span className="text-micro text-content-3 shrink-0 w-14 tabular-nums">
                                                            {new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-content-2 tabular-nums shrink-0">
                                                            {Number(p.cantidad).toLocaleString()} und
                                                        </span>
                                                        <span className="text-content-3 shrink-0">{formatMoney(p.precio_unitario)}</span>
                                                        <span className="text-content-3 truncate min-w-0 flex-1">{p.proveedor || '—'}</span>
                                                        {p.lote && p.lote !== 'GENERICO' && (
                                                            <span className="shrink-0 text-micro font-mono text-content-3 bg-surface-card px-1 rounded">{p.lote}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        }
                                    </div>
                                    {/* Ventas de la sucursal */}
                                    <div className="px-4 py-2.5 flex flex-col gap-2">
                                        <span className="text-micro font-black uppercase tracking-widest text-success">Últimas ventas (sucursal)</span>
                                        {!canSeeCosts
                                            ? <span className="text-caption text-content-3 italic">Sin permiso para ver costos de compra</span>
                                            : saleData.length === 0
                                            ? <span className="text-caption text-content-3 italic">Sin ventas registradas</span>
                                            : <div className="flex flex-col gap-1">
                                                {saleData.map((s, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-caption">
                                                        <span className="text-micro text-content-3 shrink-0 w-14 tabular-nums">
                                                            {new Date(s.fecha + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: '2-digit' })}
                                                        </span>
                                                        <span className="font-bold text-success-text tabular-nums shrink-0">
                                                            {Number(s.cantidad).toLocaleString()} und
                                                        </span>
                                                        {s.total_linea > 0 && (
                                                            <span className="text-content-3 shrink-0">{formatMoney(s.total_linea)}</span>
                                                        )}
                                                        {s.cliente && (
                                                            <span className="text-content-3 truncate min-w-0 flex-1">{s.cliente}</span>
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
                                <div className="px-4 py-2.5 flex flex-col gap-2" style={{ borderRight: '1px solid var(--border-card)' }}>
                                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Proyección de stock</span>
                                    {(!row.is_dead_stock && row.daily_velocity > 0 && stock > 0) ? (
                                        <div className="flex items-center gap-6 flex-wrap">
                                            {[30, 60, 90].map(days => {
                                                const projected = Math.max(0, Math.round(stock - row.daily_velocity * days));
                                                const depleted  = projected === 0;
                                                const low       = projected > 0 && projected < minN;
                                                const color     = depleted ? 'text-danger' : low ? 'text-chart-4-text' : 'text-success';
                                                return (
                                                    <div key={days} className="flex flex-col items-center gap-0.5">
                                                        <span className="text-micro text-content-3 font-semibold">+{days}d</span>
                                                        <span className={`text-subtitle font-black tabular-nums leading-none ${color}`}>
                                                            {depleted ? '0 ✗' : projected.toLocaleString()}
                                                        </span>
                                                        <span className="text-micro text-content-3">und</span>
                                                    </div>
                                                );
                                            })}
                                            <div className="flex-1 text-micro text-content-3 leading-snug">
                                                a {Number(row.daily_velocity).toFixed(2)} und/día
                                            </div>
                                        </div>
                                    ) : (
                                        <span className="text-caption text-content-3 italic">No disponible</span>
                                    )}
                                </div>

                                {/* Historial de cálculos */}
                                <div className="px-4 py-2.5 flex flex-col gap-2">
                                    <span className="text-micro font-black uppercase tracking-widest text-content-2">Historial de cálculos</span>
                                    {historyData.length === 0 ? (
                                        <span className="text-caption text-content-3 italic">Sin historial</span>
                                    ) : (
                                        <div className="flex flex-col gap-1">
                                            {historyData.map((h, i) => (
                                                <div key={i} className="flex items-center gap-3 text-caption text-content-3">
                                                    <span className="text-micro text-content-3 shrink-0 w-14 tabular-nums">
                                                        {new Date(h.captured_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}
                                                    </span>
                                                    <span className="font-bold text-chart-4-text">{(h.min_units ?? 0).toLocaleString()}</span>
                                                    <span className="text-content-3">→</span>
                                                    <span className="font-bold text-chart-1-text">{(h.max_units ?? 0).toLocaleString()}</span>
                                                    <span className="text-content-3">{Number(h.daily_velocity || 0).toFixed(1)}/d</span>
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
                            <span className="text-micro font-black uppercase tracking-widest text-content-2">Opciones</span>
                            {deadAction ? (
                                <div className="flex items-center gap-2 text-label text-success-text font-semibold">
                                    <CheckCircle2 size={12} />
                                    {deadAction === 'transfer' ? 'Marcado para traslado' : 'Marcado para liquidación'} — registrado en auditoría
                                </div>
                            ) : (
                                <div className="flex flex-wrap gap-2">
                                    <Button tone="warning" icon={Building2} onClick={() => logDeadStockAction('transfer')}>Marcar para traslado</Button>
                                    <Button tone="chart-1" icon={TrendingDown} onClick={() => logDeadStockAction('liquidate')}>Marcar para liquidación</Button>
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
