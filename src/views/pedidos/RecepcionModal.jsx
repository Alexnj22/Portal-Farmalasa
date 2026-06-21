import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, X, PackageCheck, AlertTriangle, Search,
    Plus, Trash2, PackagePlus,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import PedidoModal from './PedidoModal';
import LiquidAvatar from '../../components/common/LiquidAvatar';

export function EmpChip({ emp, size = 'sm', sub = null, onRemove = null }) {
    if (!emp) return null;
    const avatarCls = size === 'sm' ? 'w-6 h-6 rounded-full text-[10px]' : 'w-8 h-8 rounded-full text-[12px]';
    return (
        <span className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full bg-white border border-slate-200 shadow-sm">
            <LiquidAvatar src={emp.photo_url} alt={emp.name} fallbackText={emp.name} className={avatarCls} />
            <span className="text-[11px] font-semibold text-slate-700 whitespace-nowrap">{emp.name}</span>
            {sub && <span className="text-[9px] text-slate-400 whitespace-nowrap">{sub}</span>}
            {onRemove && (
                <button onClick={onRemove} className="text-slate-300 hover:text-red-500 transition-colors">
                    <X size={11} />
                </button>
            )}
        </span>
    );
}

function fmtPresentacion(r) {
    const tipo   = r.dispatch_tipo;
    const factor = r.dispatch_factor || r.factor || 1;
    const LABELS = { caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja' };
    if (!tipo) return factor > 1 ? `×${factor} unid` : 'Unidad';
    const label = LABELS[tipo] ?? tipo;
    const showF = factor > 1 && ['caja','blister','solo_cajas','multiplo','multiplo_unidades'].includes(tipo);
    return `${label}${showF ? ` ×${factor}` : ''}`;
}


const ERROR_TIPOS = [
    { value: 'faltante',   label: 'Faltante'            },
    { value: 'danado',     label: 'Dañado'              },
    { value: 'vencido',    label: 'Vencido'             },
    { value: 'equivocado', label: 'Producto equivocado' },
    { value: 'otro',       label: 'Otro'                },
];

// 7-column grid: Producto | Asig | F.Pres | F.Qty | S.Pres | S.Qty | ⚠
const GRID = 'grid-cols-[minmax(0,1fr)_2.75rem_5.5rem_3.25rem_5.5rem_3.25rem_1.75rem]';

export default function RecepcionModal({ open, onClose, pedido, sucursalId, sucursalNombre, rows, onConfirmed }) {
    const { user } = useAuth();

    // Per-item state: f = físico (what arrived physically), s = sistema (what to record in system)
    const [fQtyVals,  setFQtyVals]  = useState({});
    const [fPresVals, setFPresVals] = useState({});
    const [sQtyVals,  setSQtyVals]  = useState({});
    const [sPresVals, setSPresVals] = useState({});
    const [notaVals,  setNotaVals]  = useState({});
    const [errorVals, setErrorVals] = useState({});
    const [tieneProblema, setTieneProblema] = useState({});
    const [presMap,   setPresMap]   = useState({});
    const [saving,    setSaving]    = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [prodSearch, setProdSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [apoyo,      setApoyo]      = useState([]);

    const [extras,       setExtras]       = useState([]);
    const [extraSearch,  setExtraSearch]  = useState('');
    const [extraResults, setExtraResults] = useState([]);
    const [extraBusy,    setExtraBusy]    = useState(false);
    const [extraOpen,    setExtraOpen]    = useState(false);

    const searchRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const fQ = {}, fP = {}, sQ = {}, sP = {}, notas = {}, errs = {};
        for (const r of rows) {
            const def = r.dispatch_factor || r.factor || 1;
            fQ[r.id] = r.cantidad_asignada; fP[r.id] = def;
            sQ[r.id] = r.cantidad_asignada; sP[r.id] = def;
            notas[r.id] = ''; errs[r.id] = '';
        }
        setFQtyVals(fQ); setFPresVals(fP); setSQtyVals(sQ); setSPresVals(sP);
        setNotaVals(notas); setErrorVals(errs); setTieneProblema({});
        setSaveError(null); setExtras([]); setExtraSearch(''); setExtraResults([]); setExtraOpen(false);
        setProdSearch(''); setShowSearch(false);

        // Apoyo
        (async () => {
            const { data } = await supabase.from('pedido_apoyo')
                .select('employee_id, employees(name, photo_url)')
                .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
            setApoyo((data || []).map(r => ({ id: r.employee_id, ...r.employees })));
        })();

        // Presentaciones disponibles; join presentaciones(tipo) para label "CAJA 1x100", "BLISTER 1x10"
        const productIds = [...new Set(rows.map(r => r.erp_product_id))];
        if (productIds.length > 0) {
            (async () => {
                const { data } = await supabase.from('product_precios')
                    .select('product_id, factor, descripcion, presentaciones(tipo)')
                    .in('product_id', productIds)
                    .eq('activo', true)
                    .order('factor');
                const map = {};
                (data || []).forEach(p => {
                    const pid = p.product_id;
                    if (!map[pid]) map[pid] = [];
                    const f = p.factor || 1;
                    if (!map[pid].find(x => x.factor === f)) {
                        const tipo = p.presentaciones?.tipo || '';
                        const det  = p.descripcion || '';
                        const label = tipo
                            ? `${tipo}${det ? ' ' + det : ''}`
                            : det || (f === 1 ? 'Unidad' : `×${f}`);
                        map[pid].push({ factor: f, label });
                    }
                });
                setPresMap(map);
            })();
        }
    }, [open, rows, pedido?.id, sucursalId]); // eslint-disable-line

    useEffect(() => {
        if (!extraOpen || extraSearch.trim().length < 2) { setExtraResults([]); return; }
        const t = setTimeout(async () => {
            setExtraBusy(true);
            const { data } = await supabase.from('products').select('id, nombre')
                .eq('activo', true).ilike('nombre', `%${extraSearch.trim()}%`).order('nombre').limit(8);
            setExtraResults(data || []);
            setExtraBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [extraSearch, extraOpen]);

    const addExtra = useCallback((prod) => {
        setExtras(prev => prev.some(e => e.erp_product_id === prod.id)
            ? prev
            : [...prev, { erp_product_id: prod.id, nombre: prod.nombre, cantidad: 1, nota: '' }]);
        setExtraSearch(''); setExtraResults([]);
    }, []);

    const handleConfirmar = useCallback(async () => {
        setSaving(true); setSaveError(null);
        const p_items = rows.map(r => {
            const fQty  = fQtyVals[r.id]  ?? r.cantidad_asignada;
            const sQty  = sQtyVals[r.id]  ?? r.cantidad_asignada;
            const fPres = fPresVals[r.id] ?? (r.dispatch_factor || r.factor || 1);
            const sPres = sPresVals[r.id] ?? (r.dispatch_factor || r.factor || 1);
            const hasProb = !!tieneProblema[r.id];
            const isDiff  = fQty !== sQty || fPres !== sPres || hasProb;

            let nota = notaVals[r.id] || null;
            if (fPres !== sPres && !nota) {
                const dispFactor = r.dispatch_factor || r.factor || 1;
                const opts = presMap[r.erp_product_id] ?? [{ factor: dispFactor, label: fmtPresentacion(r) }];
                const lf = opts.find(o => o.factor === fPres)?.label || `×${fPres}`;
                const ls = opts.find(o => o.factor === sPres)?.label || `×${sPres}`;
                nota = `Físico: ${lf} — Sistema: ${ls}`;
            }

            return {
                pedido_item_id:    r.id,
                cantidad_recibida: fQty,
                nota_diferencia:   isDiff ? nota : null,
                error_tipo:        isDiff ? (errorVals[r.id] || 'faltante') : null,
            };
        });
        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null, p_responsables: [],
            });
            if (error) throw error;

            if (extras.length > 0) {
                const { error: exErr } = await supabase.from('pedido_recepcion_extras').insert(
                    extras.map(e => ({
                        pedido_id: pedido.id, erp_sucursal_id: sucursalId,
                        erp_product_id: e.erp_product_id, cantidad: e.cantidad,
                        nota: e.nota || null, reported_by: user?.id ?? null,
                    }))
                );
                if (exErr) throw exErr;
            }

            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                sucursal_id: sucursalId, items_count: p_items.length, extras_count: extras.length,
            });

            const hasDiff = p_items.some(it => it.error_tipo !== null);
            onConfirmed?.({ hasDiff, extras });
            onClose();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [rows, fQtyVals, fPresVals, sQtyVals, sPresVals, notaVals, errorVals, tieneProblema,
        presMap, extras, pedido, sucursalId, user, onConfirmed, onClose]);

    if (!open) return null;

    const visibleRows = prodSearch.trim()
        ? rows.filter(r => r.products?.nombre?.toLowerCase().includes(prodSearch.trim().toLowerCase()))
        : rows;

    return (
        <PedidoModal open={open} onClose={saving ? undefined : onClose} maxWidth="max-w-2xl">
            {/* Header */}
            <PedidoModal.Header className="px-5 py-4">
                <div className="flex items-center gap-2">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {!showSearch ? (
                            <motion.div key="title" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                                <h3 className="text-[15px] font-bold text-slate-800 leading-snug">Confirmar recepción</h3>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {sucursalNombre}{pedido.codigo && ` · ${pedido.codigo}`} · {rows.length} productos
                                </p>
                            </motion.div>
                        ) : (
                            <motion.div key="search" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                                    <input ref={searchRef} type="text" placeholder="Buscar producto…"
                                        value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                                        className="w-full text-[12px] border border-blue-200 rounded-lg pl-8 pr-8 py-2 focus:outline-none focus:border-blue-400 bg-blue-50/40 placeholder-slate-300"
                                    />
                                    {prodSearch && (
                                        <button onClick={() => setProdSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <motion.button
                            onClick={() => setShowSearch(s => { if (!s) setTimeout(() => searchRef.current?.focus(), 80); else setProdSearch(''); return !s; })}
                            animate={showSearch ? { scale: 1.15 } : { scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Buscar producto"
                        >
                            <Search size={15} />
                        </motion.button>
                        <button onClick={onClose} disabled={saving}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40">
                            <X size={18} />
                        </button>
                    </div>
                </div>
            </PedidoModal.Header>

            {/* Tabla comparativa: Físico vs Sistema */}
            <PedidoModal.Body className="px-0 py-0 max-h-[50vh]">
                {/* Header fijo: grupos + columnas juntos */}
                <div className="sticky top-0 z-10 bg-white border-b-2 border-slate-200 shadow-sm">
                    {/* Grupos Físico / Sistema */}
                    <div className={`grid ${GRID} gap-x-2 px-5 pt-2 pb-1`}>
                        <span /><span />
                        <span className="col-span-2 text-center text-[10px] font-bold text-teal-600 uppercase tracking-widest border-b-2 border-teal-400 pb-1">Físico</span>
                        <span className="col-span-2 text-center text-[10px] font-bold text-violet-600 uppercase tracking-widest border-b-2 border-violet-400 pb-1">Sistema</span>
                        <span />
                    </div>
                    {/* Columnas */}
                    <div className={`grid ${GRID} gap-x-2 items-center px-5 py-1.5`}>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Producto</span>
                        <span className="text-[10px] font-bold text-slate-500 uppercase text-center">Asig.</span>
                        <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Pres.</span>
                        <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Qty</span>
                        <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Pres.</span>
                        <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Qty</span>
                        <span />
                    </div>
                </div>

                {visibleRows.length === 0 && (
                    <p className="text-center text-[12px] text-slate-400 py-6">No se encontraron productos.</p>
                )}

                <div className="divide-y divide-slate-100">
                    {visibleRows.map((r, rowIdx) => {
                        const fQty  = fQtyVals[r.id]  ?? r.cantidad_asignada;
                        const sQty  = sQtyVals[r.id]  ?? r.cantidad_asignada;
                        const fPres = fPresVals[r.id] ?? (r.dispatch_factor || r.factor || 1);
                        const sPres = sPresVals[r.id] ?? (r.dispatch_factor || r.factor || 1);
                        const hasProb  = !!tieneProblema[r.id];
                        const hasDiff  = fQty !== sQty || fPres !== sPres;
                        const showExtra = hasDiff || hasProb;
                        const delta    = fQty - sQty;

                        // Opciones de presentación desde product_precios (deduplicadas por factor)
                        const dispFactor = r.dispatch_factor || r.factor || 1;
                        const rawOpts = presMap[r.erp_product_id] ?? [];
                        const presOpts = rawOpts.length > 0
                            ? rawOpts
                            : [{ factor: dispFactor, label: fmtPresentacion(r) }];

                        return (
                            <div key={r.id} className={`transition-colors ${hasDiff ? 'bg-amber-50' : hasProb ? 'bg-orange-50/40' : 'bg-white hover:bg-slate-50/50'}`}>
                                {/* Fila principal */}
                                <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                                    {/* Producto */}
                                    <span className="text-[12px] text-slate-700 font-semibold leading-snug">{r.products?.nombre}</span>

                                    {/* Asignado (referencia, read-only) */}
                                    <span className="text-[12px] font-bold text-slate-400 tabular-nums text-center">{r.cantidad_asignada}</span>

                                    {/* Físico: Presentación */}
                                    <select
                                        value={fPres}
                                        onChange={e => setFPresVals(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full truncate ${
                                            fPres !== sPres ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-slate-700 focus:border-teal-400'
                                        }`}
                                    >
                                        {presOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}
                                    </select>

                                    {/* Físico: Qty */}
                                    <input
                                        type="number" min={0} value={fQty}
                                        data-qty-row={rowIdx} data-qty-col="fqty"
                                        onChange={e => setFQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                        onKeyDown={e => {
                                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                                e.preventDefault();
                                                const next = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="fqty"]`);
                                                next?.focus(); next?.select();
                                            }
                                        }}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${
                                            fQty !== sQty ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-slate-700 focus:border-teal-400'
                                        }`}
                                    />

                                    {/* Sistema: Presentación */}
                                    <select
                                        value={sPres}
                                        onChange={e => setSPresVals(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full truncate ${
                                            fPres !== sPres ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-slate-700 focus:border-violet-400'
                                        }`}
                                    >
                                        {presOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}
                                    </select>

                                    {/* Sistema: Qty */}
                                    <input
                                        type="number" min={0} value={sQty}
                                        data-qty-row={rowIdx} data-qty-col="sqty"
                                        onChange={e => setSQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                        onKeyDown={e => {
                                            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                                e.preventDefault();
                                                const next = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="sqty"]`);
                                                next?.focus(); next?.select();
                                            }
                                        }}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${
                                            fQty !== sQty ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-slate-700 focus:border-violet-400'
                                        }`}
                                    />

                                    {/* Problema toggle (cuando físico == sistema pero hay otra novedad) */}
                                    {!hasDiff ? (
                                        <button
                                            onClick={() => setTieneProblema(p => ({ ...p, [r.id]: !p[r.id] }))}
                                            title="Reportar problema sin diferencia de cantidad"
                                            className={`flex justify-center p-1 rounded-lg transition-colors ${
                                                hasProb ? 'text-orange-500 bg-orange-100' : 'text-slate-200 hover:text-amber-400'
                                            }`}
                                        >
                                            <AlertTriangle size={13} />
                                        </button>
                                    ) : (
                                        <div className="flex justify-center p-1 text-amber-500" title="Diferencia detectada">
                                            <AlertTriangle size={13} />
                                        </div>
                                    )}
                                </div>

                                {/* Sub-fila: motivo + nota cuando hay diff o problema */}
                                {showExtra && (
                                    <div className="flex items-center gap-2 px-5 pb-2.5">
                                        {hasDiff && fQty !== sQty && (
                                            <span className={`text-[11px] font-bold tabular-nums shrink-0 ${delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                {delta > 0 ? '+' : ''}{delta}
                                            </span>
                                        )}
                                        <select
                                            value={errorVals[r.id] || 'faltante'}
                                            onChange={e => setErrorVals(p => ({ ...p, [r.id]: e.target.value }))}
                                            className="text-[11px] border border-amber-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-amber-400 shrink-0"
                                        >
                                            {ERROR_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                        <input
                                            type="text" placeholder="Nota (opcional)…"
                                            value={notaVals[r.id] ?? ''}
                                            onChange={e => setNotaVals(p => ({ ...p, [r.id]: e.target.value }))}
                                            className="flex-1 text-[11px] border border-amber-200 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 bg-white placeholder-slate-300"
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </PedidoModal.Body>

            {/* Productos no esperados */}
            <div className="border-t border-slate-100 px-5 py-3 space-y-2">
                <button
                    onClick={() => setExtraOpen(o => !o)}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700 transition-colors"
                >
                    <PackagePlus size={13} />
                    ¿Llegó un producto que no estaba en el pedido? {extras.length > 0 && `(${extras.length})`}
                </button>
                {extraOpen && (
                    <div className="space-y-2">
                        <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                            <input
                                type="text" placeholder="Buscar producto recibido de más…"
                                value={extraSearch} onChange={e => setExtraSearch(e.target.value)}
                                className="w-full text-[12px] border border-violet-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:border-violet-400 bg-violet-50/40 placeholder-slate-300"
                            />
                            {extraBusy && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-violet-300" />}
                            {extraResults.length > 0 && (
                                <div className="absolute z-10 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                                    {extraResults.map(prod => (
                                        <button key={prod.id} onClick={() => addExtra(prod)}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-700 hover:bg-violet-50 transition-colors">
                                            <Plus size={12} className="text-violet-400 flex-shrink-0" />
                                            {prod.nombre}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {extras.map((e, i) => (
                            <div key={e.erp_product_id} className="flex items-center gap-2 rounded-xl px-3 py-2 bg-violet-50/60 border border-violet-200">
                                <span className="flex-1 text-[12px] font-medium text-slate-700 min-w-0 truncate">{e.nombre}</span>
                                <input
                                    type="number" min={1} value={e.cantidad}
                                    onChange={ev => { const v = Math.max(1, parseInt(ev.target.value) || 1); setExtras(prev => prev.map((x, j) => j === i ? { ...x, cantidad: v } : x)); }}
                                    className="w-14 text-center border border-violet-300 rounded-lg px-1 py-1 text-[12px] font-semibold bg-white focus:outline-none focus:border-violet-400 tabular-nums"
                                />
                                <input
                                    type="text" placeholder="Nota…" value={e.nota}
                                    onChange={ev => setExtras(prev => prev.map((x, j) => j === i ? { ...x, nota: ev.target.value } : x))}
                                    className="w-32 text-[11px] border border-violet-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-violet-400 placeholder-slate-300"
                                />
                                <button onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))}
                                    className="text-slate-300 hover:text-red-500 transition-colors">
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Responsables (apoyo registrado externamente) */}
            {apoyo.length > 0 && (
                <div className="border-t border-slate-100 px-5 py-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Responsables</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {apoyo.map(a => <EmpChip key={a.id} emp={a} />)}
                    </div>
                </div>
            )}

            <PedidoModal.Footer className="space-y-2">
                {saveError && (
                    <div className="flex items-center gap-2 text-red-600 text-[12px] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <AlertTriangle size={13} /> {saveError}
                    </div>
                )}
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} disabled={saving}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors disabled:opacity-40">
                        Cancelar
                    </button>
                    <button onClick={handleConfirmar} disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 text-[13px] transition-colors disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                        Confirmar recepción
                    </button>
                </div>
            </PedidoModal.Footer>
        </PedidoModal>
    );
}
