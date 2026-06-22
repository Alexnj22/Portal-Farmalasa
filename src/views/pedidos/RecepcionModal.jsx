import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../supabaseClient';
import {
    Loader2, X, PackageCheck, AlertTriangle, Search,
    Plus, Trash2, PackagePlus, Check,
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

// Misma fórmula que pedidoPrint.js
function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}

function fmtDispatchLabel(dispatch_tipo, dispatch_factor) {
    const f = Number(dispatch_factor) || 1;
    const LABELS = { CAJA: 'Caja', BLISTER: 'Blíster', MULTIPLO: 'Unid', UNIDAD: 'Unidad', caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja', unidad: 'Unidad' };
    const label = LABELS[dispatch_tipo] ?? dispatch_tipo ?? 'Unidad';
    return f > 1 ? `${label} ×${f}` : label;
}

// Solo causa manual (faltante/sobrante/equivocado/pres se detectan automáticamente)
const ERROR_TIPOS = [
    { value: 'danado',  label: 'Dañado'  },
    { value: 'vencido', label: 'Vencido' },
    { value: 'otro',    label: 'Otro'    },
];

// 7-column grid: Producto | Asig | F.Pres | F.Qty | S.Pres | S.Qty | ⚠
const GRID = 'grid-cols-[minmax(0,1fr)_2.75rem_8rem_3.25rem_8rem_3.25rem_2rem]';

async function fetchPresOpts(productId) {
    const { data } = await supabase.from('product_precios')
        .select('product_id, factor, descripcion, presentaciones(tipo)')
        .eq('product_id', productId).eq('activo', true).order('factor');
    const opts = [];
    (data || []).forEach(p => {
        const f = Number(p.factor) || 1;
        if (!opts.find(x => x.factor === f)) {
            const tipo = p.presentaciones?.tipo || '';
            const det  = p.descripcion || '';
            const label = tipo ? `${tipo}${det ? ' ' + det : ''}` : det || (f === 1 ? 'Unidad' : `×${f}`);
            opts.push({ factor: f, label });
        }
    });
    return opts;
}

export default function RecepcionModal({ open, onClose, pedido, sucursalId, sucursalNombre, rows, onConfirmed }) {
    const { user } = useAuth();

    const [fQtyVals,  setFQtyVals]  = useState({});
    const [fPresVals, setFPresVals] = useState({});
    const [sQtyVals,  setSQtyVals]  = useState({});
    const [sPresVals, setSPresVals] = useState({});
    const [notaVals,  setNotaVals]  = useState({});
    const [errorVals, setErrorVals] = useState({});
    // tieneProblema[id]: false = nada | true = panel abierto | 'done' = confirmado
    const [tieneProblema,    setTieneProblema]    = useState({});
    const [cantProblemaVals, setCantProblemaVals] = useState({});
    const [presMap,   setPresMap]   = useState({});
    const [saving,    setSaving]    = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [prodSearch, setProdSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [apoyo,      setApoyo]      = useState([]);

    // extras: { erp_product_id, nombre, fPres, fQty, sPres, sQty, nota }
    const [extras,       setExtras]       = useState([]);
    const [extraSearch,  setExtraSearch]  = useState('');
    const [extraResults, setExtraResults] = useState([]);
    const [extraBusy,    setExtraBusy]    = useState(false);
    const [extraOpen,    setExtraOpen]    = useState(false);

    const searchRef    = useRef(null);
    const extraRef     = useRef(null);
    const extrasEndRef = useRef(null);

    // Ordenar por laboratorio (igual que PDF)
    const sortedRows = useMemo(() => [...rows].sort((a, b) => {
        const la = a.products?.laboratorios?.nombre ?? '';
        const lb = b.products?.laboratorios?.nombre ?? '';
        return la.localeCompare(lb, 'es') || (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es');
    }), [rows]);

    useEffect(() => {
        if (!open) return;
        const fQ = {}, fP = {}, sQ = {}, sP = {}, notas = {}, errs = {};
        for (const r of rows) {
            const erpF  = Number(r.factor) || 1;
            const dispF = Number(r.dispatch_factor) || erpF;
            const dispQty = toDispatch(r.cantidad_asignada, erpF, dispF);
            fQ[r.id] = dispQty; fP[r.id] = dispF;
            sQ[r.id] = dispQty; sP[r.id] = dispF;
            notas[r.id] = ''; errs[r.id] = '';
        }
        setFQtyVals(fQ); setFPresVals(fP); setSQtyVals(sQ); setSPresVals(sP);
        setNotaVals(notas); setErrorVals(errs); setTieneProblema({}); setCantProblemaVals({});
        setSaveError(null); setExtras([]); setExtraSearch(''); setExtraResults([]); setExtraOpen(false);
        setProdSearch(''); setShowSearch(false);

        // Apoyo
        (async () => {
            const { data } = await supabase.from('pedido_apoyo')
                .select('employee_id, employees(name, photo_url)')
                .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
            setApoyo((data || []).map(r => ({ id: r.employee_id, ...r.employees })));
        })();

        // Presentaciones disponibles por producto
        const productIds = [...new Set(rows.map(r => r.erp_product_id))];
        if (productIds.length > 0) {
            (async () => {
                const { data } = await supabase.from('product_precios')
                    .select('product_id, factor, descripcion, presentaciones(tipo)')
                    .in('product_id', productIds).eq('activo', true).order('factor');
                const map = {};
                (data || []).forEach(p => {
                    const pid = p.product_id;
                    if (!map[pid]) map[pid] = [];
                    const f = Number(p.factor) || 1;
                    if (!map[pid].find(x => x.factor === f)) {
                        const tipo = p.presentaciones?.tipo || '';
                        const det  = p.descripcion || '';
                        const label = tipo ? `${tipo}${det ? ' ' + det : ''}` : det || (f === 1 ? 'Unidad' : `×${f}`);
                        map[pid].push({ factor: f, label });
                    }
                });
                setPresMap(map);
            })();
        }
    }, [open, rows, pedido?.id, sucursalId]); // eslint-disable-line

    // Búsqueda extras — excluye productos ya en el pedido
    useEffect(() => {
        if (!extraOpen || extraSearch.trim().length < 2) { setExtraResults([]); return; }
        const existingIds = [...rows.map(r => r.erp_product_id), ...extras.map(e => e.erp_product_id)];
        const t = setTimeout(async () => {
            setExtraBusy(true);
            let q = supabase.from('products').select('id, nombre')
                .eq('activo', true).ilike('nombre', `%${extraSearch.trim()}%`).order('nombre').limit(10);
            if (existingIds.length > 0) q = q.not('id', 'in', `(${existingIds.join(',')})`);
            const { data } = await q;
            setExtraResults((data || []).slice(0, 8));
            setExtraBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [extraSearch, extraOpen, rows, extras]);

    const addExtra = useCallback(async (prod) => {
        if (extras.some(e => e.erp_product_id === prod.id)) return;
        setExtraSearch(''); setExtraResults([]);

        // Cargar presentaciones de product_precios
        let opts = presMap[prod.id] ? [...presMap[prod.id]] : [];
        if (opts.length === 0) {
            opts = await fetchPresOpts(prod.id);
        }

        // Buscar regla de despacho del último pedido para este producto
        const { data: lastDispatch } = await supabase.from('pedido_items')
            .select('dispatch_factor, dispatch_tipo')
            .eq('erp_product_id', prod.id)
            .not('dispatch_tipo', 'is', null)
            .not('dispatch_factor', 'is', null)
            .order('id', { ascending: false })
            .limit(1);
        if (lastDispatch?.[0]) {
            const df = Number(lastDispatch[0].dispatch_factor) || 1;
            if (!opts.find(o => o.factor === df)) {
                const label = fmtDispatchLabel(lastDispatch[0].dispatch_tipo, df);
                opts.unshift({ factor: df, label });
            }
        }

        if (opts.length > 0) setPresMap(prev => ({ ...prev, [prod.id]: opts }));

        const defF = opts[0]?.factor ?? 1;
        setExtras(prev => [...prev, {
            erp_product_id: prod.id, nombre: prod.nombre,
            fPres: defF, fQty: 1, sPres: defF, sQty: 1, nota: '',
        }]);
        setTimeout(() => extrasEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 80);
    }, [extras, presMap]);

    const handleConfirmar = useCallback(async () => {
        const invalidExtra = extras.find(e => e.fQty === 0 && e.sQty === 0);
        if (invalidExtra) {
            setSaveError(`"${invalidExtra.nombre}": al menos uno de físico o sistema debe ser mayor a 0.`);
            return;
        }
        setSaving(true); setSaveError(null);
        const p_items = rows.map(r => {
            const erpFactor  = Number(r.factor) || 1;
            const dispFactor = Number(r.dispatch_factor) || erpFactor;
            const defDispQty = toDispatch(r.cantidad_asignada, erpFactor, dispFactor);
            const fQty  = fQtyVals[r.id]  ?? defDispQty;
            const sQty  = sQtyVals[r.id]  ?? defDispQty;
            const fPres = fPresVals[r.id] ?? dispFactor;
            const sPres = sPresVals[r.id] ?? dispFactor;
            const tp = tieneProblema[r.id];
            const hasProb = !!tp;
            // Convertir de vuelta a unidades ERP: qty * pres / erpFactor
            const fRaw = Math.round(fQty * fPres / erpFactor);
            const sRaw = Math.round(sQty * sPres / erpFactor);
            const isDiff = fRaw !== sRaw || fPres !== sPres || hasProb;

            let nota = notaVals[r.id] || null;
            let error_tipo = null;
            if (isDiff) {
                if (hasProb && errorVals[r.id]) {
                    error_tipo = errorVals[r.id];
                } else if (fRaw < sRaw) {
                    error_tipo = 'faltante';
                } else if (fRaw > sRaw) {
                    error_tipo = 'sobrante';
                } else if (fPres !== sPres) {
                    error_tipo = 'presentacion';
                } else {
                    error_tipo = 'otro';
                }
                if (fPres !== sPres && !nota) {
                    const opts = presMap[r.erp_product_id] ?? [];
                    const lf = opts.find(o => o.factor === fPres)?.label || `×${fPres}`;
                    const ls = opts.find(o => o.factor === sPres)?.label || `×${sPres}`;
                    nota = `Físico: ${lf} — Sistema: ${ls}`;
                }
            }
            const cantProb = (error_tipo === 'danado' || error_tipo === 'vencido')
                ? (cantProblemaVals[r.id] ?? 1) : null;
            return { pedido_item_id: r.id, cantidad_recibida: fRaw, nota_diferencia: nota, error_tipo, cantidad_problema: cantProb };
        });
        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            if (extras.length > 0) {
                const erpFactorMap = {};
                rows.forEach(r => { erpFactorMap[r.erp_product_id] = Number(r.factor) || 1; });
                const { error: exErr } = await supabase.from('pedido_recepcion_extras').insert(
                    extras.map(e => {
                        const ef = erpFactorMap[e.erp_product_id] ?? 1;
                        return {
                            pedido_id: pedido.id, erp_sucursal_id: sucursalId,
                            erp_product_id: e.erp_product_id,
                            cantidad: Math.round(e.fQty * e.fPres / ef),
                            nota: e.nota || (e.fPres !== e.sPres || e.fQty !== e.sQty
                                ? `Sistema: ${e.sQty} × ${presMap[e.erp_product_id]?.find(x => x.factor === e.sPres)?.label ?? `×${e.sPres}`}`
                                : null),
                            reported_by: user?.id ?? null,
                        };
                    })
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
        cantProblemaVals, presMap, extras, pedido, sucursalId, user, onConfirmed, onClose]);

    if (!open) return null;

    const visibleRows = prodSearch.trim()
        ? sortedRows.filter(r => r.products?.nombre?.toLowerCase().includes(prodSearch.trim().toLowerCase()))
        : sortedRows;

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
                        {/* X cierra buscador si está abierto, si no cierra el modal */}
                        <button
                            onClick={showSearch ? () => { setShowSearch(false); setProdSearch(''); } : onClose}
                            disabled={!showSearch && saving}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40"
                            title={showSearch ? 'Cerrar búsqueda' : 'Cerrar'}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            </PedidoModal.Header>

            {/* Tabla — Body sin overflow propio; el div interno maneja el scroll */}
            <PedidoModal.Body className="px-0 py-0" style={{ overflow: 'hidden', flex: 'none' }}>
              <div className="max-h-[48vh] overflow-y-auto">

                {/* Header sticky — dentro del contenedor scroll, ancho idéntico a las filas */}
                <div className="sticky top-0 z-10 bg-white/97 backdrop-blur-sm border-b-2 border-slate-200 shadow-sm">
                    <div className={`grid ${GRID} gap-x-2 px-5 pt-2.5 pb-1`}>
                        <span /><span />
                        <span className="col-span-2 text-center text-[10px] font-bold text-teal-600 uppercase tracking-widest border-b-2 border-teal-400 pb-1">Físico</span>
                        <span className="col-span-2 text-center text-[10px] font-bold text-violet-600 uppercase tracking-widest border-b-2 border-violet-400 pb-1">Sistema</span>
                        <span />
                    </div>
                    <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Producto</span>
                        <span className="text-[10px] font-bold text-slate-600 uppercase text-center">Asig.</span>
                        <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Pres.</span>
                        <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Qty</span>
                        <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Pres.</span>
                        <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Qty</span>
                        <span />
                    </div>
                </div>

                {visibleRows.length === 0 && !extras.length && (
                    <p className="text-center text-[12px] text-slate-400 py-6">No se encontraron productos.</p>
                )}

                <div className="divide-y divide-slate-100">
                    {visibleRows.map((r, rowIdx) => {
                        const erpFactor  = Number(r.factor) || 1;
                        const dispFactor = Number(r.dispatch_factor) || erpFactor;
                        const defDispQty = toDispatch(r.cantidad_asignada, erpFactor, dispFactor);
                        const fQty  = fQtyVals[r.id]  ?? defDispQty;
                        const sQty  = sQtyVals[r.id]  ?? defDispQty;
                        const fPres = fPresVals[r.id] ?? dispFactor;
                        const sPres = sPresVals[r.id] ?? dispFactor;
                        const tp = tieneProblema[r.id];
                        const hasProb    = !!tp; // true o 'done'
                        const panelOpen  = tp === true; // panel de edición abierto
                        // Raw ERP units para comparar
                        const fRaw = Math.round(fQty * fPres / erpFactor);
                        const sRaw = Math.round(sQty * sPres / erpFactor);
                        const hasDiff = fRaw !== sRaw || fPres !== sPres;
                        const delta   = fRaw - sRaw;

                        // Presentaciones: siempre incluir la de despacho (regla especial del PDF)
                        const rawOpts  = presMap[r.erp_product_id] ?? [];
                        const dispLabel = fmtDispatchLabel(r.dispatch_tipo, dispFactor);
                        const dispOpt  = { factor: dispFactor, label: dispLabel };
                        const presOpts = rawOpts.length > 0
                            ? rawOpts.find(o => o.factor === dispFactor) ? rawOpts : [dispOpt, ...rawOpts]
                            : [dispOpt];

                        const navKey = (col, dir) => document.querySelector(`[data-qty-row="${rowIdx + dir}"][data-qty-col="${col}"]`)?.focus();

                        const toggleProblema = () => {
                            setTieneProblema(p => {
                                const cur = p[r.id];
                                if (!cur) return { ...p, [r.id]: true };          // abrir panel
                                if (cur === true) { setErrorVals(ev => ({ ...ev, [r.id]: '' })); return { ...p, [r.id]: false }; } // cancelar
                                return { ...p, [r.id]: true };                    // re-abrir desde 'done'
                            });
                        };

                        const confirmProblema = () => setTieneProblema(p => ({ ...p, [r.id]: 'done' }));

                        return (
                            <div key={r.id} className={`transition-colors ${hasDiff ? 'bg-amber-50' : hasProb ? 'bg-orange-50/40' : 'bg-white hover:bg-slate-50/50'}`}>
                                <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                                    {/* Producto */}
                                    <span className="text-[12px] text-slate-700 font-semibold leading-snug">{r.products?.nombre}</span>

                                    {/* Asignado */}
                                    <span className="text-[12px] font-bold text-slate-500 tabular-nums text-center">{defDispQty}</span>

                                    {/* Físico Pres */}
                                    <select value={fPres}
                                        data-qty-row={rowIdx} data-qty-col="fpres"
                                        onChange={e => setFPresVals(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                                        onKeyDown={e => {
                                            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                            const dir = e.key === 'ArrowDown' ? 1 : -1;
                                            const sel = e.currentTarget;
                                            if (dir === 1 ? sel.selectedIndex === sel.options.length - 1 : sel.selectedIndex === 0) { e.preventDefault(); navKey('fpres', dir); }
                                        }}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full ${fPres !== sPres ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-slate-700 focus:border-teal-400'}`}
                                    >{presOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}</select>

                                    {/* Físico Qty */}
                                    <div className="relative">
                                        <input type="number" min={0} value={fQty}
                                            data-qty-row={rowIdx} data-qty-col="fqty"
                                            onChange={e => setFQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="fqty"]`); n?.focus(); n?.select(); } }}
                                            className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${hasDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-slate-700 focus:border-teal-400'}`}
                                        />
                                        {hasDiff && (
                                            <span className={`absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 rounded-full border border-white ${delta < 0 ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                                                {delta > 0 ? '+' : ''}{delta}
                                            </span>
                                        )}
                                    </div>

                                    {/* Sistema Pres */}
                                    <select value={sPres}
                                        data-qty-row={rowIdx} data-qty-col="spres"
                                        onChange={e => setSPresVals(p => ({ ...p, [r.id]: Number(e.target.value) }))}
                                        onKeyDown={e => {
                                            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                                            const dir = e.key === 'ArrowDown' ? 1 : -1;
                                            const sel = e.currentTarget;
                                            if (dir === 1 ? sel.selectedIndex === sel.options.length - 1 : sel.selectedIndex === 0) { e.preventDefault(); navKey('spres', dir); }
                                        }}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full ${fPres !== sPres ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-slate-700 focus:border-violet-400'}`}
                                    >{presOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}</select>

                                    {/* Sistema Qty */}
                                    <input type="number" min={0} value={sQty}
                                        data-qty-row={rowIdx} data-qty-col="sqty"
                                        onChange={e => setSQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="sqty"]`); n?.focus(); n?.select(); } }}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${hasDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-slate-700 focus:border-violet-400'}`}
                                    />

                                    {/* ⚠ — toggle problema manual */}
                                    <button onClick={toggleProblema}
                                        title={panelOpen ? 'Cancelar problema' : hasProb ? 'Editar problema' : hasDiff ? 'Diferencia detectada' : 'Reportar problema'}
                                        className={`flex justify-center p-1 rounded-lg transition-colors ${
                                            tp === 'done' ? 'text-orange-500 bg-orange-100'
                                            : tp === true  ? 'text-orange-500 bg-orange-100'
                                            : hasDiff      ? 'text-amber-500 hover:bg-amber-100'
                                            : 'text-slate-300 hover:text-amber-500 hover:bg-amber-50'
                                        }`}
                                    >
                                        <AlertTriangle size={14} />
                                    </button>
                                </div>

                                {/* Panel de problema — solo causas manuales: dañado / vencido / otro */}
                                {panelOpen && (
                                    <div className="px-5 pb-2.5 flex items-center gap-2 flex-wrap">
                                        {ERROR_TIPOS.map(t => (
                                            <button key={t.value}
                                                onClick={() => setErrorVals(p => ({ ...p, [r.id]: (p[r.id] === t.value ? '' : t.value) }))}
                                                className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-all shrink-0 ${
                                                    (errorVals[r.id] || '') === t.value
                                                        ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                                                        : 'bg-white text-slate-500 border-slate-200 hover:border-orange-300 hover:text-orange-500'
                                                }`}
                                            >{t.label}</button>
                                        ))}
                                        {/* ¿Cuántos están dañados/vencidos? */}
                                        {(errorVals[r.id] === 'danado' || errorVals[r.id] === 'vencido') && (
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span className="text-[10px] text-slate-400">¿Cuántos?</span>
                                                <input type="number" min={1} max={fQty}
                                                    value={cantProblemaVals[r.id] ?? 1}
                                                    onChange={e => setCantProblemaVals(p => ({
                                                        ...p, [r.id]: Math.max(1, Math.min(fQty, parseInt(e.target.value) || 1))
                                                    }))}
                                                    className="w-12 text-center border border-orange-300 rounded-full px-2 py-1 text-[11px] font-bold focus:outline-none focus:border-orange-500 bg-white text-orange-700"
                                                />
                                                <span className="text-[10px] text-slate-400">de {fQty}</span>
                                            </div>
                                        )}
                                        <input type="text" placeholder="Nota…"
                                            value={notaVals[r.id] ?? ''}
                                            onChange={e => setNotaVals(p => ({ ...p, [r.id]: e.target.value }))}
                                            onKeyDown={e => e.key === 'Enter' && confirmProblema()}
                                            className="flex-1 min-w-0 text-[11px] border border-orange-200 rounded-full px-3 py-1 focus:outline-none focus:border-orange-400 bg-white placeholder-slate-300"
                                        />
                                        <button onClick={confirmProblema}
                                            className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors">
                                            <Check size={10} /> Listo
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Extras — misma grid, color distinto */}
                    {extras.map((e, ei) => {
                        const eOpts   = presMap[e.erp_product_id] ?? [{ factor: 1, label: 'Unidad' }];
                        const eDiff   = e.fQty !== e.sQty || e.fPres !== e.sPres;
                        const eBothZero = e.fQty === 0 && e.sQty === 0;
                        return (
                            <div key={e.erp_product_id} className={`${eBothZero ? 'bg-red-50/70' : 'bg-indigo-50/60'}`}>
                                <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                                    <div className="min-w-0">
                                        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full mb-0.5 ${eBothZero ? 'text-red-500 bg-red-100' : 'text-indigo-500 bg-indigo-100'}`}>
                                            <Plus size={8} /> Extra
                                        </span>
                                        <p className={`text-[12px] font-semibold leading-snug ${eBothZero ? 'text-red-600' : 'text-indigo-700'}`}>{e.nombre}</p>
                                        {eBothZero && <p className="text-[10px] text-red-500 font-medium mt-0.5">Al menos uno debe tener valor</p>}
                                    </div>
                                    <span className="text-[12px] text-slate-400 text-center">—</span>

                                    {/* Físico Pres */}
                                    <select value={e.fPres}
                                        onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fPres: Number(ev.target.value) } : x))}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-indigo-700'}`}
                                    >{eOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}</select>

                                    {/* Físico Qty */}
                                    <input type="number" min={0} value={e.fQty}
                                        onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fQty: Math.max(0, parseInt(ev.target.value) ?? 0) } : x))}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-indigo-700'}`}
                                    />

                                    {/* Sistema Pres */}
                                    <select value={e.sPres}
                                        onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, sPres: Number(ev.target.value) } : x))}
                                        className={`text-[11px] border rounded-lg px-1 py-1 focus:outline-none w-full ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-indigo-700'}`}
                                    >{eOpts.map(o => <option key={o.factor} value={o.factor}>{o.label}</option>)}</select>

                                    {/* Sistema Qty */}
                                    <input type="number" min={0} value={e.sQty}
                                        onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, sQty: Math.max(0, parseInt(ev.target.value) ?? 0) } : x))}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[12px] font-bold focus:outline-none tabular-nums ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-indigo-700'}`}
                                    />

                                    <button onClick={() => setExtras(prev => prev.filter((_, j) => j !== ei))}
                                        className="flex justify-center p-1 text-slate-300 hover:text-red-500 transition-colors">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                                <div className="px-5 pb-2">
                                    <input type="text" placeholder="Nota (opcional)…" value={e.nota}
                                        onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, nota: ev.target.value } : x))}
                                        className="w-full text-[11px] border border-indigo-200 rounded-lg px-3 py-1 bg-white focus:outline-none focus:border-indigo-400 placeholder-slate-300"
                                    />
                                </div>
                            </div>
                        );
                    })}
                    <div ref={extrasEndRef} />
                </div>
              </div>{/* end inner scroll container */}
            </PedidoModal.Body>

            {/* Buscador de extras */}
            <div className="flex-none border-t border-slate-100 px-5 py-3">
                <div className="relative">
                    {extraOpen && (
                        <>
                            <div className="flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50/60 px-3 py-2">
                                <Search size={13} className="text-indigo-400 shrink-0" />
                                <input ref={extraRef} type="text" placeholder="Buscar producto extra recibido…"
                                    value={extraSearch} onChange={e => setExtraSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Escape' && (setExtraOpen(false), setExtraSearch(''))}
                                    className="flex-1 text-[12px] bg-transparent focus:outline-none placeholder-indigo-300 text-slate-700"
                                />
                                {extraBusy
                                    ? <Loader2 size={12} className="animate-spin text-indigo-400 shrink-0" />
                                    : <button onClick={() => { setExtraOpen(false); setExtraSearch(''); setExtraResults([]); }} className="text-slate-300 hover:text-slate-500 shrink-0"><X size={13} /></button>
                                }
                            </div>
                            {extraResults.length > 0 && (
                                <div className="absolute bottom-full mb-1 left-0 right-0 rounded-xl border border-indigo-200 bg-white shadow-2xl overflow-hidden z-50">
                                    {extraResults.map(prod => (
                                        <button key={prod.id} onMouseDown={() => addExtra(prod)}
                                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] text-slate-700 hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-0">
                                            <Plus size={12} className="text-indigo-400 shrink-0" />
                                            {prod.nombre}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                    {!extraOpen && (
                        <button
                            onClick={() => { setExtraOpen(true); setTimeout(() => extraRef.current?.focus(), 60); }}
                            className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors py-0.5"
                        >
                            <PackagePlus size={13} />
                            ¿Llegó un producto extra?
                            {extras.length > 0 && <span className="ml-1 bg-indigo-100 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{extras.length}</span>}
                        </button>
                    )}
                </div>
            </div>

            {/* Responsables */}
            {apoyo.length > 0 && (
                <div className="flex-none border-t border-slate-100 px-5 py-3">
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
