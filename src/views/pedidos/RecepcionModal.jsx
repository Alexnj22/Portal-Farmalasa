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

export default function RecepcionModal({ open, onClose, pedido, sucursalId, sucursalNombre, rows, onConfirmed }) {
    const { user } = useAuth();

    const [recepVals,  setRecepVals]  = useState({});
    const [notaVals,   setNotaVals]   = useState({});
    const [errorVals,  setErrorVals]  = useState({});
    const [saving,     setSaving]     = useState(false);
    const [saveError,  setSaveError]  = useState(null);
    const [prodSearch, setProdSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [apoyo,      setApoyo]      = useState([]);

    // Productos no esperados
    const [extras,       setExtras]       = useState([]);
    const [extraSearch,  setExtraSearch]  = useState('');
    const [extraResults, setExtraResults] = useState([]);
    const [extraBusy,    setExtraBusy]    = useState(false);
    const [extraOpen,    setExtraOpen]    = useState(false);

    const searchRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const vals = {}, notas = {}, errs = {};
        for (const r of rows) { vals[r.id] = r.cantidad_asignada; notas[r.id] = ''; errs[r.id] = ''; }
        setRecepVals(vals); setNotaVals(notas); setErrorVals(errs);
        setSaveError(null); setExtras([]); setExtraSearch(''); setExtraResults([]); setExtraOpen(false);
        setProdSearch(''); setShowSearch(false);
        // Cargar apoyo registrado para este pedido/sucursal
        (async () => {
            const { data } = await supabase.from('pedido_apoyo')
                .select('employee_id, employees(name, photo_url)')
                .eq('pedido_id', pedido.id)
                .eq('erp_sucursal_id', sucursalId);
            setApoyo((data || []).map(r => ({ id: r.employee_id, ...r.employees })));
        })();
    }, [open, rows, pedido?.id, sucursalId]);

    // ── Búsqueda de productos no esperados ─────────────────────────────────────
    useEffect(() => {
        if (!extraOpen || extraSearch.trim().length < 2) { setExtraResults([]); return; }
        const t = setTimeout(async () => {
            setExtraBusy(true);
            const { data } = await supabase.from('products')
                .select('id, nombre')
                .eq('activo', true)
                .ilike('nombre', `%${extraSearch.trim()}%`)
                .order('nombre')
                .limit(8);
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

    // ── Confirmar ─────────────────────────────────────────────────────────────
    const handleConfirmar = useCallback(async () => {
        setSaving(true); setSaveError(null);
        const p_items = rows.map(r => {
            const recibida = recepVals[r.id] ?? r.cantidad_asignada;
            const hasDiff  = recibida !== r.cantidad_asignada;
            return {
                pedido_item_id:    r.id,
                cantidad_recibida: recibida,
                nota_diferencia:   hasDiff ? (notaVals[r.id] || null) : null,
                error_tipo:        hasDiff ? (errorVals[r.id] || 'faltante') : null,
            };
        });
        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id:    pedido.id,
                p_sucursal_id:  sucursalId,
                p_items,
                p_received_by:  user?.id ?? null,
                p_responsables: [],
            });
            if (error) throw error;

            // Productos no esperados
            if (extras.length > 0) {
                const { error: exErr } = await supabase.from('pedido_recepcion_extras').insert(
                    extras.map(e => ({
                        pedido_id:       pedido.id,
                        erp_sucursal_id: sucursalId,
                        erp_product_id:  e.erp_product_id,
                        cantidad:        e.cantidad,
                        nota:            e.nota || null,
                        reported_by:     user?.id ?? null,
                    }))
                );
                if (exErr) throw exErr;
            }

            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                sucursal_id:   sucursalId,
                items_count:   p_items.length,
                extras_count:  extras.length,
            });

            const hasDiff = p_items.some(it => it.error_tipo !== null);
            onConfirmed?.({ hasDiff, extras });
            onClose();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [rows, recepVals, notaVals, errorVals, extras, pedido, sucursalId, user, onConfirmed, onClose]);

    if (!open) return null;

    const visibleRows = prodSearch.trim()
        ? rows.filter(r => r.products?.nombre?.toLowerCase().includes(prodSearch.trim().toLowerCase()))
        : rows;

    return (
        <PedidoModal open={open} onClose={saving ? undefined : onClose} maxWidth="max-w-xl">
                {/* Header */}
                <PedidoModal.Header className="px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <h3 className="text-[15px] font-bold text-slate-800 leading-snug">
                                Confirmar recepción
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {sucursalNombre}{pedido.codigo && ` · ${pedido.codigo}`} · {rows.length} productos
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button
                                onClick={() => {
                                    setShowSearch(s => {
                                        if (!s) setTimeout(() => searchRef.current?.focus(), 80);
                                        else setProdSearch('');
                                        return !s;
                                    });
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                                title="Buscar producto"
                            >
                                <motion.div
                                    animate={showSearch ? { rotate: 0, scale: 1.15 } : { rotate: 0, scale: 1 }}
                                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                                >
                                    <Search size={15} />
                                </motion.div>
                            </button>
                            <button onClick={onClose} disabled={saving}
                                className="text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                    <AnimatePresence>
                        {showSearch && (
                            <motion.div
                                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                animate={{ opacity: 1, height: 'auto', marginTop: 8 }}
                                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                transition={{ duration: 0.18, ease: 'easeInOut' }}
                                className="overflow-hidden"
                            >
                                <div className="relative">
                                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        placeholder="Buscar producto…"
                                        value={prodSearch}
                                        onChange={e => setProdSearch(e.target.value)}
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
                </PedidoModal.Header>

                {/* Items — tabla */}
                <PedidoModal.Body className="px-0 py-0 max-h-[46vh]">
                    {/* Encabezado */}
                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-5 py-2 border-b border-slate-100 bg-slate-50/60 sticky top-0 z-10">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Producto</span>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center w-20">Presentación</span>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center w-16">Asignado</span>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center w-16">Recibido</span>
                    </div>

                    {visibleRows.length === 0 && (
                        <p className="text-center text-[12px] text-slate-400 py-6">No se encontraron productos.</p>
                    )}

                    <div className="divide-y divide-slate-100">
                        {visibleRows.map(r => {
                            const recibida = recepVals[r.id] ?? r.cantidad_asignada;
                            const hasDiff  = recibida !== r.cantidad_asignada;
                            const delta    = recibida - r.cantidad_asignada;
                            const pres     = fmtPresentacion(r);
                            return (
                                <div key={r.id} className={`transition-colors ${hasDiff ? 'bg-amber-50' : 'bg-white hover:bg-slate-50/60'}`}>
                                    {/* Fila principal */}
                                    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-5 py-2.5">
                                        <span className="text-[13px] text-slate-700 font-semibold truncate pr-1">
                                            {r.products?.nombre}
                                        </span>
                                        <span className="w-20 text-center">
                                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200 whitespace-nowrap">
                                                {pres}
                                            </span>
                                        </span>
                                        <span className="w-16 text-center text-[13px] font-semibold text-slate-500 tabular-nums">
                                            {r.cantidad_asignada}
                                        </span>
                                        <div className="w-16 flex items-center justify-center gap-1">
                                            <input
                                                type="number" min={0} value={recibida}
                                                onChange={e => {
                                                    const v = Math.max(0, parseInt(e.target.value) || 0);
                                                    setRecepVals(prev => ({ ...prev, [r.id]: v }));
                                                }}
                                                className={`w-14 text-center border rounded-lg px-1 py-1 text-[13px] font-semibold focus:outline-none tabular-nums ${
                                                    hasDiff ? 'border-amber-400 bg-amber-50 text-amber-700 focus:border-amber-500' : 'border-slate-200 focus:border-blue-400 bg-white'
                                                }`}
                                            />
                                        </div>
                                    </div>
                                    {/* Delta + motivo */}
                                    {hasDiff && (
                                        <div className="flex items-center gap-2 px-5 pb-2.5">
                                            <span className={`text-[11px] font-bold tabular-nums ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {delta > 0 ? '+' : ''}{delta}
                                            </span>
                                            <select
                                                value={errorVals[r.id] || 'faltante'}
                                                onChange={e => setErrorVals(prev => ({ ...prev, [r.id]: e.target.value }))}
                                                className="text-[11px] border border-amber-300 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:border-amber-400"
                                            >
                                                {ERROR_TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                            <input
                                                type="text" placeholder="Nota (opcional)…"
                                                value={notaVals[r.id] ?? ''}
                                                onChange={e => setNotaVals(prev => ({ ...prev, [r.id]: e.target.value }))}
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
                                    value={extraSearch}
                                    onChange={e => setExtraSearch(e.target.value)}
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
                                        onChange={ev => {
                                            const v = Math.max(1, parseInt(ev.target.value) || 1);
                                            setExtras(prev => prev.map((x, j) => j === i ? { ...x, cantidad: v } : x));
                                        }}
                                        className="w-14 text-center border border-violet-300 rounded-lg px-1 py-1 text-[12px] font-semibold bg-white focus:outline-none focus:border-violet-400 tabular-nums"
                                    />
                                    <input
                                        type="text" placeholder="Nota…"
                                        value={e.nota}
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
