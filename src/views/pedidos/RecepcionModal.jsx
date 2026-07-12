import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { tokenMatch } from '../../utils/searchUtils';
import { supabase } from '../../supabaseClient';
import { signPhotosDeep } from '../../utils/storageFiles';
import {
    Loader2, X, PackageCheck, AlertTriangle, Search,
    Plus, Trash2, PackagePlus, Check, ChevronLeft, Box, Truck, Star,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import PedidoModal from './PedidoModal';
import LiquidAvatar from '../../components/common/LiquidAvatar';
import LiquidSelect from '../../components/common/LiquidSelect';

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

const ERROR_TIPOS = [
    { value: 'danado',  label: 'Dañado'  },
    { value: 'vencido', label: 'Vencido' },
    { value: 'otro',    label: 'Otro'    },
];

// Items screen: producto | asig | presF | qtyF | presS | qtyS | acción
const GRID = 'grid-cols-[minmax(0,1fr)_2.5rem_9rem_3rem_9rem_3rem_1.75rem]';
// Extras screen: sin columna "asig" → más espacio para el nombre
const EXTRAS_GRID = 'grid-cols-[minmax(0,1fr)_9rem_3rem_9rem_3rem_1.75rem]';

async function fetchPresOpts(productId) {
    const { data, error } = await supabase.from('product_precios')
        .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
        .eq('product_id', productId).eq('activo', true).order('factor');
    if (error) console.error('fetchPresOpts failed:', error.message);
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

export default function RecepcionModal({
    open, onClose, pedido, sucursalId, sucursalNombre, rows, onConfirmed,
    cajaDanada   = [],   // box numbers that arrived damaged (items still present)
    cajaMap      = {},   // {"1":[1,2],"2":[3,4]} → box → page numbers
    paginaItems  = {},   // {"1":[itemId,...],...} → page → pedido_item IDs
    cajasRecibidas: initCajasRecibidas = [], // already confirmed box numbers (from DB)
    faltaCajas   = [],   // box numbers physically missing (items excluded)
    hasFaltaItems = false, // hay items falta_caja:true en otros grupos (electrolit/especial/caja pendiente)
    especialesLlegadas = {}, // { 'E1': 'ok'|'danada'|'faltante', ... }
}) {
    const { user } = useAuth();

    // Whether we have enough data to do per-box reception
    const hasCajaMap = Object.keys(cajaMap).length > 0 && Object.keys(paginaItems).length > 0;

    // ── Screen ─────────────────────────────────────────────────────────────────
    const [screen,              setScreen]              = useState('cajas');
    const [selectedCaja,        setSelectedCaja]        = useState(null);
    const [selectedEspecial,    setSelectedEspecial]    = useState(null); // { label, item }
    const [confirmedEspecialIds,setConfirmedEspecialIds] = useState(new Set());
    const [localRec,     setLocalRec]     = useState([]);   // confirmed this session
    const [anyHasDiff,   setAnyHasDiff]   = useState(false);

    // ── Per-item input state ────────────────────────────────────────────────────
    const [fQtyVals,  setFQtyVals]  = useState({});
    const [fPresVals, setFPresVals] = useState({});
    const [sQtyVals,  setSQtyVals]  = useState({});
    const [sPresVals, setSPresVals] = useState({});
    const [notaVals,  setNotaVals]  = useState({});
    const [errorVals, setErrorVals] = useState({});
    const [tieneProblema,    setTieneProblema]    = useState({});
    const [cantProblemaVals, setCantProblemaVals] = useState({});
    const [presMap,   setPresMap]   = useState({});
    const [saving,    setSaving]    = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [prodSearch, setProdSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [apoyo,      setApoyo]      = useState([]);

    // ── Extras ─────────────────────────────────────────────────────────────────
    const [extras,       setExtras]       = useState([]);
    const [extraSearch,  setExtraSearch]  = useState('');
    const [extraResults, setExtraResults] = useState([]);
    const [extraBusy,    setExtraBusy]    = useState(false);
    const [prevScreen,   setPrevScreen]   = useState(null);

    const searchRef       = useRef(null);
    const extraRef        = useRef(null);
    const extrasEndRef    = useRef(null);
    const extraBuscarRef  = useRef(null);
    const [extraDropCoords, setExtraDropCoords] = useState({ top: 0, left: 0, width: 0 });

    // ── Sorted all rows ─────────────────────────────────────────────────────────
    const sortedRows = useMemo(() => [...rows].sort((a, b) => {
        const la = a.products?.laboratorios?.nombre ?? '';
        const lb = b.products?.laboratorios?.nombre ?? '';
        return la.localeCompare(lb, 'es') || (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es');
    }), [rows]);

    // Cajas especiales: items with caja_especial=true, labelled E1, E2...
    const especialItems = useMemo(() =>
        sortedRows
            .filter(r => r.caja_especial && (r.cantidad_asignada ?? 0) > 0)
            .map((r, i) => ({ label: `E${i + 1}`, item: r }))
    , [sortedRows]);

    // ── Per-box derived data ────────────────────────────────────────────────────
    const itemIdsByCaja = useMemo(() => {
        if (!hasCajaMap) return {};
        const result = {};
        Object.entries(cajaMap).forEach(([boxStr, pages]) => {
            result[boxStr] = new Set(pages.flatMap(p => paginaItems[String(p)] ?? []));
        });
        return result;
    }, [cajaMap, paginaItems, hasCajaMap]);

    const allBoxNums = useMemo(() =>
        Object.keys(cajaMap).map(Number).sort((a, b) => a - b),
    [cajaMap]);

    // Combined received: DB init + locally confirmed this session
    const allRecibidas = useMemo(() => {
        const s = new Set([...initCajasRecibidas, ...localRec]);
        return [...s].sort((a, b) => a - b);
    }, [initCajasRecibidas, localRec]);

    const accessibleBoxNums = useMemo(() =>
        allBoxNums.filter(n => !faltaCajas.includes(n)),
    [allBoxNums, faltaCajas]);

    const accessibleEspeciales = especialItems.filter(e => !e.item.falta_caja);
    const allEspecialesDone = accessibleEspeciales.every(e => confirmedEspecialIds.has(e.item.id) || e.item.status === 'recibido');
    const hasAnythingToReceive = accessibleBoxNums.length > 0 || accessibleEspeciales.length > 0;
    const allAccessibleDone = hasAnythingToReceive
        && (accessibleBoxNums.length === 0 || accessibleBoxNums.every(n => allRecibidas.includes(n)))
        && allEspecialesDone;

    // Rows for the currently selected box (or especial, or all if no caja map)
    const selectedCajaRows = useMemo(() => {
        if (selectedEspecial !== null) return [selectedEspecial.item];
        if (selectedCaja === null || !hasCajaMap) return sortedRows;
        const ids = itemIdsByCaja[String(selectedCaja)];
        if (!ids) return sortedRows;
        return sortedRows.filter(r => ids.has(r.id));
    }, [selectedCaja, selectedEspecial, itemIdsByCaja, sortedRows, hasCajaMap]);

    // ── Init on open ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        setScreen(hasCajaMap ? 'cajas' : 'items');
        setSelectedCaja(null);
        setSelectedEspecial(null);
        setConfirmedEspecialIds(new Set());
        setLocalRec([]);
        setAnyHasDiff(false);
        setSaveError(null);
        setPresMap({});
        setExtras([]); setExtraSearch(''); setExtraResults([]);
        setProdSearch(''); setShowSearch(false); setPrevScreen(null);

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

        (async () => {
            const { data, error } = await supabase.from('pedido_apoyo')
                .select('employee_id, employees(name, photo_url)')
                .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
            if (error) console.error('fetch pedido_apoyo failed:', error.message);
            setApoyo(await signPhotosDeep((data || []).map(r => ({ id: r.employee_id, ...r.employees }))));
        })();

        const productIds = [...new Set(rows.map(r => r.erp_product_id))];
        if (productIds.length > 0) {
            (async () => {
                const PAGE = 1000;
                let allData = [], from = 0;
                while (true) {
                    const { data, error } = await supabase.from('product_precios')
                        .select('product_id, factor, descripcion, presentaciones!id_presentacion(tipo)')
                        .in('product_id', productIds).eq('activo', true).order('factor')
                        .range(from, from + PAGE - 1);
                    if (error) { console.error('fetch product_precios (paged) failed:', error.message); break; }
                    if (!data || data.length === 0) break;
                    allData = [...allData, ...data];
                    if (data.length < PAGE) break;
                    from += PAGE;
                }
                const map = {};
                allData.forEach(p => {
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

    // ── Extras search ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (screen !== 'extras' || extraSearch.trim().length < 2) { setExtraResults([]); return; }
        const existingIds = [...rows.map(r => r.erp_product_id), ...extras.map(e => e.erp_product_id)];
        const t = setTimeout(async () => {
            setExtraBusy(true);
            let q = supabase.from('products').select('id, nombre')
                .eq('activo', true).ilike('nombre', `%${extraSearch.trim()}%`).order('nombre').limit(10);
            if (existingIds.length > 0) q = q.not('id', 'in', `(${existingIds.join(',')})`);
            const { data, error } = await q;
            if (error) console.error('extras search failed:', error.message);
            setExtraResults((data || []).slice(0, 8));
            setExtraBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [extraSearch, screen, rows, extras]);

    const addExtra = useCallback(async (prod) => {
        if (extras.some(e => e.erp_product_id === prod.id)) return;
        setExtraSearch(''); setExtraResults([]);

        let opts = presMap[prod.id] ? [...presMap[prod.id]] : [];
        if (opts.length === 0) opts = await fetchPresOpts(prod.id);

        const { data: lastDispatch, error: lastDispatchErr } = await supabase.from('pedido_items')
            .select('dispatch_factor, dispatch_tipo')
            .eq('erp_product_id', prod.id)
            .not('dispatch_tipo', 'is', null).not('dispatch_factor', 'is', null)
            .order('id', { ascending: false }).limit(1);
        if (lastDispatchErr) console.error('fetch last dispatch failed:', lastDispatchErr.message);
        if (lastDispatch?.[0]) {
            const df = Number(lastDispatch[0].dispatch_factor) || 1;
            if (!opts.find(o => o.factor === df)) {
                opts.unshift({ factor: df, label: fmtDispatchLabel(lastDispatch[0].dispatch_tipo, df) });
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

    // ── Build p_items payload for a set of rows ─────────────────────────────────
    const buildPItems = useCallback((rowsToProcess) => {
        return rowsToProcess.map(r => {
            const erpFactor  = Number(r.factor) || 1;
            const dispFactor = Number(r.dispatch_factor) || erpFactor;
            const defDispQty = toDispatch(r.cantidad_asignada, erpFactor, dispFactor);
            const fQty  = fQtyVals[r.id]  ?? defDispQty;
            const sQty  = sQtyVals[r.id]  ?? defDispQty;
            const fPres = fPresVals[r.id] ?? dispFactor;
            const sPres = sPresVals[r.id] ?? dispFactor;
            const tp = tieneProblema[r.id];
            const hasProb = !!tp;
            const fRaw = Math.round(fQty * fPres / erpFactor);
            const sRaw = Math.round(sQty * sPres / erpFactor);
            const isDiff = fRaw !== sRaw || fPres !== sPres || hasProb;

            let nota = notaVals[r.id] || null;
            let error_tipo = null;
            if (isDiff) {
                if (hasProb && errorVals[r.id]) {
                    error_tipo = errorVals[r.id];
                } else if (fRaw < sRaw)      error_tipo = 'faltante';
                else if (fRaw > sRaw)         error_tipo = 'sobrante';
                else if (fPres !== sPres)     error_tipo = 'presentacion';
                else                          error_tipo = 'otro';

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
    }, [fQtyVals, fPresVals, sQtyVals, sPresVals, notaVals, errorVals, tieneProblema, cantProblemaVals, presMap]);

    const saveExtras = useCallback(async () => {
        if (!extras.length) return;
        const erpFactorMap = {};
        rows.forEach(r => { erpFactorMap[r.erp_product_id] = Number(r.factor) || 1; });
        await supabase.from('pedido_recepcion_extras').insert(
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
    }, [extras, rows, pedido?.id, sucursalId, presMap, user]);

    // ── Confirm a single box (or all if no caja map) ────────────────────────────
    const handleConfirmarCaja = useCallback(async () => {
        const rowsToSave = (selectedEspecial !== null || (hasCajaMap && selectedCaja !== null)) ? selectedCajaRows : sortedRows;

        const invalidExtra = extras.find(e => e.fQty === 0 && e.sQty === 0);
        if (invalidExtra) {
            setSaveError(`"${invalidExtra.nombre}": al menos uno de físico o sistema debe ser mayor a 0.`);
            return;
        }

        setSaving(true); setSaveError(null);
        const p_items = buildPItems(rowsToSave);

        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            const boxHasDiff = p_items.some(it => it.error_tipo !== null);
            const newAnyDiff = anyHasDiff || boxHasDiff;
            setAnyHasDiff(newAnyDiff);

            if (selectedEspecial !== null) {
                // Mark this especial as confirmed locally
                const newConfirmedIds = new Set([...confirmedEspecialIds, selectedEspecial.item.id]);
                setConfirmedEspecialIds(newConfirmedIds);
                const newAllEspeciales = especialItems
                    .filter(e => !e.item.falta_caja)
                    .every(e => newConfirmedIds.has(e.item.id) || e.item.status === 'recibido');
                const allRegDone = accessibleBoxNums.length === 0 || accessibleBoxNums.every(n => allRecibidas.includes(n));
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_ESPECIAL', pedido.id, {
                    sucursal_id: sucursalId, especial: selectedEspecial.label, items_count: p_items.length,
                });
                if (allRegDone && newAllEspeciales) {
                    await saveExtras();
                    onConfirmed?.({ hasDiff: newAnyDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems });
                    onClose();
                } else {
                    setScreen('cajas'); setSelectedEspecial(null); setProdSearch(''); setShowSearch(false);
                }
            } else if (hasCajaMap && selectedCaja !== null) {
                // Mark this box as received
                const newRec = [...new Set([...allRecibidas, selectedCaja])].sort((a, b) => a - b);
                await supabase.from('pedido_sucursal_status')
                    .update({ cajas_recibidas: newRec })
                    .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
                setLocalRec(prev => [...new Set([...prev, selectedCaja])].sort((a, b) => a - b));

                const nowRegDone = accessibleBoxNums.every(n => newRec.includes(n));
                const nowEspDone = especialItems.filter(e => !e.item.falta_caja).every(e => confirmedEspecialIds.has(e.item.id) || e.item.status === 'recibido');

                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_CAJA', pedido.id, {
                    sucursal_id: sucursalId, caja: selectedCaja, items_count: p_items.length,
                });

                if (nowRegDone && nowEspDone) {
                    await saveExtras();
                    useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                        sucursal_id: sucursalId, extras_count: extras.length,
                    });
                    onConfirmed?.({ hasDiff: newAnyDiff, allDone: true });
                    onClose();
                } else {
                    // More boxes / especiales pending — back to picker
                    setScreen('cajas');
                    setSelectedCaja(null);
                    setProdSearch(''); setShowSearch(false);
                }
            } else {
                // No caja map — single confirm, original behavior
                await saveExtras();
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                    sucursal_id: sucursalId, items_count: p_items.length, extras_count: extras.length,
                });
                onConfirmed?.({ hasDiff: boxHasDiff, allDone: true });
                onClose();
            }
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [
        selectedEspecial, hasCajaMap, selectedCaja, selectedCajaRows, sortedRows, extras, buildPItems,
        pedido, sucursalId, user, anyHasDiff, allRecibidas, accessibleBoxNums, confirmedEspecialIds,
        especialItems, saveExtras, onConfirmed, onClose, faltaCajas, hasFaltaItems,
    ]);

    // ── Confirmar todo sin errores (acción rápida) ──────────────────────────────
    const handleTodoOk = useCallback(async () => {
        const rowsToSave = (hasCajaMap && selectedCaja !== null) ? selectedCajaRows : sortedRows;
        setSaving(true); setSaveError(null);

        // Payload con cantidades exactas asignadas, sin diferencias
        const p_items = rowsToSave.map(r => {
            const erpFactor  = Number(r.factor) || 1;
            const dispFactor = Number(r.dispatch_factor) || erpFactor;
            const dispQty    = toDispatch(r.cantidad_asignada, erpFactor, dispFactor);
            const rawQty     = Math.round(dispQty * dispFactor / erpFactor);
            return { pedido_item_id: r.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null };
        });

        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            if (hasCajaMap && selectedCaja !== null) {
                const newRec = [...new Set([...allRecibidas, selectedCaja])].sort((a, b) => a - b);
                await supabase.from('pedido_sucursal_status')
                    .update({ cajas_recibidas: newRec })
                    .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
                setLocalRec(prev => [...new Set([...prev, selectedCaja])].sort((a, b) => a - b));

                const nowAllDone = accessibleBoxNums.every(n => newRec.includes(n));
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_CAJA', pedido.id, {
                    sucursal_id: sucursalId, caja: selectedCaja, items_count: p_items.length, todo_ok: true,
                });

                if (nowAllDone) {
                    await saveExtras();
                    useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, { sucursal_id: sucursalId, extras_count: extras.length });
                    onConfirmed?.({ hasDiff: anyHasDiff, allDone: true });
                    onClose();
                } else {
                    setScreen('cajas'); setSelectedCaja(null); setProdSearch(''); setShowSearch(false);
                }
            } else {
                await saveExtras();
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, { sucursal_id: sucursalId, items_count: p_items.length, todo_ok: true });
                onConfirmed?.({ hasDiff: false, allDone: true });
                onClose();
            }
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [hasCajaMap, selectedCaja, selectedCajaRows, sortedRows, pedido, sucursalId, user,
        anyHasDiff, allRecibidas, accessibleBoxNums, extras, saveExtras, onConfirmed, onClose]);

    // ── Confirmar TODAS las cajas accesibles de una vez (Todo OK) ──────────────
    const handleConfirmarTodo = useCallback(async () => {
        setSaving(true); setSaveError(null);
        try {
            let newRec = [...allRecibidas];
            for (const boxNum of accessibleBoxNums) {
                if (newRec.includes(boxNum)) continue;
                const ids = itemIdsByCaja[String(boxNum)];
                if (!ids) continue;
                const boxRows = sortedRows.filter(r => ids.has(r.id));
                if (!boxRows.length) continue;
                const p_items = boxRows.map(r => {
                    const erpFactor  = Number(r.factor) || 1;
                    const dispFactor = Number(r.dispatch_factor) || erpFactor;
                    const rawQty     = Math.round(toDispatch(r.cantidad_asignada, erpFactor, dispFactor) * dispFactor / erpFactor);
                    return { pedido_item_id: r.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null };
                });
                const { error } = await supabase.rpc('receive_pedido_sucursal', {
                    p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                    p_items, p_received_by: user?.id ?? null,
                });
                if (error) throw error;
                newRec = [...new Set([...newRec, boxNum])].sort((a, b) => a - b);
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_CAJA', pedido.id, {
                    sucursal_id: sucursalId, caja: boxNum, items_count: p_items.length, todo_ok: true,
                });
            }
            await supabase.from('pedido_sucursal_status')
                .update({ cajas_recibidas: newRec })
                .eq('pedido_id', pedido.id).eq('erp_sucursal_id', sucursalId);
            setLocalRec(newRec.filter(n => !initCajasRecibidas.includes(n)));

            // También confirmar cajas especiales accesibles (no faltantes)
            const newConfirmedEspIds = new Set([...confirmedEspecialIds]);
            for (const { label, item } of especialItems) {
                if (item.falta_caja) continue; // en reenvío, no tocar
                if (confirmedEspecialIds.has(item.id) || item.status === 'recibido') continue;
                const erpF  = Number(item.factor) || 1;
                const dispF = Number(item.dispatch_factor) || erpF;
                const rawQty = Math.round(toDispatch(item.cantidad_asignada, erpF, dispF) * dispF / erpF);
                const { error } = await supabase.rpc('receive_pedido_sucursal', {
                    p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                    p_items: [{ pedido_item_id: item.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null }],
                    p_received_by: user?.id ?? null,
                });
                if (error) throw error;
                newConfirmedEspIds.add(item.id);
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_ESPECIAL', pedido.id, {
                    sucursal_id: sucursalId, especial: label, todo_ok: true,
                });
            }
            setConfirmedEspecialIds(newConfirmedEspIds);

            await saveExtras();
            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                sucursal_id: sucursalId, extras_count: extras.length, todo_ok: true, batch: true,
            });
            // Solo marcar allDone si no hay cajas ni items pendientes de reenvío
            onConfirmed?.({ hasDiff: anyHasDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems });
            onClose();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [accessibleBoxNums, allRecibidas, itemIdsByCaja, sortedRows, pedido, sucursalId, user,
        anyHasDiff, initCajasRecibidas, saveExtras, extras, onConfirmed, onClose,
        especialItems, confirmedEspecialIds]);

    // ── Finalizar desde la pantalla de cajas (cuando todas ya están recibidas) ──
    const handleFinalizar = useCallback(async () => {
        setSaving(true); setSaveError(null);
        try {
            await saveExtras();
            if (extras.length > 0) {
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                    sucursal_id: sucursalId, extras_count: extras.length,
                });
            }
            onConfirmed?.({ hasDiff: anyHasDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems });
            onClose();
        } catch (e) {
            setSaveError(e.message);
        } finally {
            setSaving(false);
        }
    }, [saveExtras, extras, pedido?.id, sucursalId, anyHasDiff, faltaCajas, hasFaltaItems, onConfirmed, onClose]);

    if (!open) return null;

    // Visible rows for the items grid
    const gridRows = selectedCaja !== null ? selectedCajaRows : sortedRows;
    const visibleRows = prodSearch.trim()
        ? gridRows.filter(r => tokenMatch(prodSearch, r.products?.nombre))
        : gridRows;

    // ════════════════════════════════════════════════════════════════
    // SCREEN: CAJAS — box picker
    // ════════════════════════════════════════════════════════════════
    if (screen === 'cajas' && hasCajaMap) {
        const receivedAccessible = accessibleBoxNums.filter(n => allRecibidas.includes(n)).length;

        return (
            <PedidoModal open={open} onClose={saving ? undefined : onClose} maxWidth="max-w-md" className="max-h-[90vh]">
                <PedidoModal.Header className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-[15px] font-bold text-slate-800 leading-snug">Confirmar recepción</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {sucursalNombre} · {rows.length} prod. · {allBoxNums.length} caja{allBoxNums.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                                allAccessibleDone
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}>
                                {receivedAccessible}/{accessibleBoxNums.length} recibidas
                            </span>
                            <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="px-4 py-4 scrollbar-hide">
                    <div className={`grid gap-2 ${allBoxNums.length <= 4 ? 'grid-cols-2' : allBoxNums.length <= 9 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                        {allBoxNums.map(boxNum => {
                            const isRecibida = allRecibidas.includes(boxNum);
                            const isFalta    = faltaCajas.includes(boxNum);
                            const isDanada   = cajaDanada.includes(boxNum);
                            const itemCount  = itemIdsByCaja[String(boxNum)]?.size ?? 0;
                            const pages      = cajaMap[String(boxNum)] ?? [];
                            const pageHint   = pages.length === 0 ? null
                                : pages.length === 1 ? `pág. ${pages[0]}`
                                : `págs. ${pages[0]}–${pages[pages.length - 1]}`;

                            return (
                                <button key={boxNum}
                                    disabled={isRecibida || isFalta}
                                    onClick={() => { setSelectedCaja(boxNum); setScreen('items'); }}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 text-center transition-all ${
                                        isRecibida ? 'bg-emerald-50 border-emerald-200 cursor-default' :
                                        isFalta    ? 'bg-slate-50 border-slate-100 cursor-default opacity-50' :
                                        isDanada   ? 'bg-amber-50 border-amber-300 hover:border-amber-400 active:scale-[0.97] cursor-pointer' :
                                                     'bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50 active:scale-[0.97] cursor-pointer'
                                    }`}>
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                                        isRecibida ? 'bg-emerald-500' :
                                        isFalta    ? 'bg-slate-300' :
                                        isDanada   ? 'bg-amber-400' :
                                                     'bg-violet-500 shadow-[0_2px_8px_rgba(139,92,246,0.3)]'
                                    }`}>
                                        {isRecibida ? <Check size={18} className="text-white" /> :
                                         isFalta    ? <Truck size={16} className="text-white" /> :
                                         isDanada   ? <AlertTriangle size={16} className="text-white" /> :
                                                      <Box size={16} className="text-white" />}
                                    </div>
                                    <div>
                                        <p className={`text-[12px] font-black leading-none ${
                                            isRecibida ? 'text-emerald-700' : isFalta ? 'text-slate-400' : 'text-slate-700'
                                        }`}>Caja {boxNum}</p>
                                        {pageHint && (
                                            <p className="text-[9px] font-semibold text-violet-500 mt-0.5 leading-none">{pageHint}</p>
                                        )}
                                        <p className={`text-[9px] font-medium mt-0.5 ${
                                            isRecibida ? 'text-emerald-500' : isFalta ? 'text-slate-400' : isDanada ? 'text-amber-600' : 'text-slate-400'
                                        }`}>
                                            {isRecibida ? '✓ Recibida' : isFalta ? 'En reenvío' : isDanada ? `${itemCount} prod. ⚠` : `${itemCount} prod.`}
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {!allAccessibleDone && accessibleBoxNums.length > 0 && (
                        <button onClick={handleConfirmarTodo} disabled={saving}
                            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50 text-emerald-700 font-bold text-[13px] hover:bg-emerald-100 active:scale-[0.97] transition-all disabled:opacity-40">
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Confirmar todo OK
                            {faltaCajas.length > 0 && (
                                <span className="text-[10px] font-medium text-emerald-500">(omite cajas en reenvío)</span>
                            )}
                        </button>
                    )}

                    {allAccessibleDone && (
                        <div className={`mt-4 flex items-start gap-2.5 px-3 py-3 rounded-2xl border ${faltaCajas.length > 0 || hasFaltaItems ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                            <PackageCheck size={15} className={`shrink-0 mt-0.5 ${faltaCajas.length > 0 || hasFaltaItems ? 'text-amber-500' : 'text-emerald-500'}`} />
                            <p className={`text-[12px] font-medium leading-snug ${faltaCajas.length > 0 || hasFaltaItems ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {faltaCajas.length > 0
                                    ? `Cajas disponibles confirmadas. Caja${faltaCajas.length > 1 ? 's' : ''} ${faltaCajas.map(n => `#${n}`).join(', ')} pendiente${faltaCajas.length > 1 ? 's' : ''} de reenvío.`
                                    : hasFaltaItems
                                        ? 'Cajas disponibles confirmadas. Aún hay electrolit o cajas especiales pendientes de reenvío. Finaliza cuando lleguen.'
                                        : '¡Todas las cajas recibidas!'
                                }
                            </p>
                        </div>
                    )}

                    {faltaCajas.length > 0 && !allAccessibleDone && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
                            <Truck size={12} className="text-slate-400 shrink-0" />
                            <p className="text-[11px] text-slate-500">
                                Caja{faltaCajas.length > 1 ? 's' : ''} {faltaCajas.map(n => `#${n}`).join(', ')} en reenvío — se recibirá por separado.
                            </p>
                        </div>
                    )}

                    {/* Cajas especiales */}
                    {especialItems.length > 0 && (
                        <div className="mt-4">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">Cajas especiales</p>
                            <div className={`grid gap-2 ${especialItems.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                {especialItems.map(({ label, item }) => {
                                    const isDamaged   = especialesLlegadas[label] === 'danada';
                                    const isFaltante  = !!item.falta_caja;
                                    const isConfirmed = confirmedEspecialIds.has(item.id) || item.status === 'recibido';
                                    return (
                                        <button key={item.id}
                                            disabled={isConfirmed || isFaltante}
                                            onClick={() => { setSelectedEspecial({ label, item }); setScreen('items'); }}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 text-center transition-all ${
                                                isConfirmed ? 'bg-emerald-50 border-emerald-200 cursor-default' :
                                                isFaltante  ? 'bg-slate-50 border-slate-100 cursor-default opacity-50' :
                                                isDamaged   ? 'bg-amber-50 border-amber-300 hover:border-amber-400 active:scale-[0.97] cursor-pointer' :
                                                              'bg-violet-50/60 border-violet-200 hover:border-violet-400 active:scale-[0.97] cursor-pointer'
                                            }`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                                                isConfirmed ? 'bg-emerald-500' :
                                                isFaltante  ? 'bg-slate-300' :
                                                isDamaged   ? 'bg-amber-400' :
                                                              'bg-violet-400'
                                            }`}>
                                                {isConfirmed ? <Check size={16} className="text-white" /> :
                                                 isFaltante  ? <Truck size={14} className="text-white" /> :
                                                 isDamaged   ? <AlertTriangle size={14} className="text-white" /> :
                                                               <Star size={14} className="text-white" />}
                                            </div>
                                            <div>
                                                <p className={`text-[12px] font-black leading-none ${
                                                    isConfirmed ? 'text-emerald-700' : isFaltante ? 'text-slate-400' : 'text-slate-700'
                                                }`}>{label}</p>
                                                <p className="text-[9px] text-slate-400 mt-0.5 leading-tight max-w-[90px] truncate">
                                                    {item.products?.nombre ?? ''}
                                                </p>
                                                <p className={`text-[9px] font-medium mt-0.5 ${
                                                    isConfirmed ? 'text-emerald-500' : isFaltante ? 'text-slate-400' : isDamaged ? 'text-amber-600' : 'text-violet-500'
                                                }`}>
                                                    {isConfirmed ? '✓ Confirmado' : isFaltante ? 'En reenvío' : isDamaged ? '⚠ Dañada' : `${item.cantidad_asignada} unid.`}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </PedidoModal.Body>

                {/* Extras section on cajas screen */}
                <div className="flex-none border-t border-slate-100 px-4 py-3">
                    <button onClick={() => { setPrevScreen('cajas'); setScreen('extras'); setTimeout(() => extraRef.current?.focus(), 80); }}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors py-0.5">
                        <PackagePlus size={13} />
                        ¿Llegó un producto extra?
                        {extras.length > 0 && <span className="ml-1 bg-indigo-100 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{extras.length}</span>}
                    </button>
                </div>

                {allAccessibleDone && (
                    <PedidoModal.Footer className="space-y-2">
                        {saveError && (
                            <div className="flex items-center gap-2 text-red-600 text-[12px] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                <AlertTriangle size={13} /> {saveError}
                            </div>
                        )}
                        <div className="flex justify-end">
                            <button onClick={handleFinalizar} disabled={saving}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-[13px] hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm">
                                {saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                                Finalizar recepción
                            </button>
                        </div>
                    </PedidoModal.Footer>
                )}
            </PedidoModal>
        );
    }

    // ════════════════════════════════════════════════════════════════
    // SCREEN: EXTRAS — dedicated screen for extra products
    // ════════════════════════════════════════════════════════════════
    const goBackFromExtras = () => setScreen(prevScreen ?? (hasCajaMap ? 'cajas' : 'items'));

    if (screen === 'extras') {
        return (
            <PedidoModal open={open} onClose={saving ? undefined : goBackFromExtras} maxWidth="max-w-2xl" className="max-h-[90vh]">
                <PedidoModal.Header className="px-5 py-4">
                    <div className="flex items-center gap-2">
                        <button onClick={goBackFromExtras} disabled={saving}
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all shrink-0 disabled:opacity-40">
                            <ChevronLeft size={14} />
                        </button>
                        <div className="flex-1 min-w-0">
                            <h3 className="text-[15px] font-bold text-slate-800 leading-snug">Productos extra</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                {extras.length === 0
                                    ? 'Productos recibidos que no estaban en el pedido'
                                    : `${extras.length} producto${extras.length !== 1 ? 's' : ''} agregado${extras.length !== 1 ? 's' : ''}`}
                            </p>
                        </div>
                        <button onClick={goBackFromExtras} disabled={saving}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40">
                            <X size={18} />
                        </button>
                    </div>
                </PedidoModal.Header>

                {/* Item grid — mismo formato que pantalla de items */}
                <PedidoModal.Body className="px-0 py-0" style={{ overflow: 'hidden', flex: 'none' }}>
                    <div className="max-h-[48vh] overflow-y-auto scrollbar-hide">
                        <div className="sticky top-0 z-10 bg-white/97 backdrop-blur-sm border-b-2 border-slate-200 shadow-sm">
                            <div className={`grid ${EXTRAS_GRID} gap-x-2 px-5 pt-2.5 pb-1`}>
                                <span />
                                <span className="col-span-2 text-center text-[10px] font-bold text-teal-600 uppercase tracking-widest border-b-2 border-teal-400 pb-1">Físico</span>
                                <span className="col-span-2 text-center text-[10px] font-bold text-violet-600 uppercase tracking-widest border-b-2 border-violet-400 pb-1">Sistema</span>
                                <span />
                            </div>
                            <div className={`grid ${EXTRAS_GRID} gap-x-2 items-center px-5 py-2`}>
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wide">Producto</span>
                                <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Pres.</span>
                                <span className="text-[10px] font-bold text-teal-600 uppercase text-center">Qty</span>
                                <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Pres.</span>
                                <span className="text-[10px] font-bold text-violet-600 uppercase text-center">Qty</span>
                                <span />
                            </div>
                        </div>

                        {extras.length === 0 && (
                            <div className="py-12 text-center">
                                <PackagePlus size={30} className="text-indigo-200 mx-auto mb-2" />
                                <p className="text-[13px] font-semibold text-slate-400">Sin productos extra</p>
                                <p className="text-[11px] text-slate-300 mt-1">Buscá un producto abajo para agregarlo</p>
                            </div>
                        )}

                        <div className="divide-y divide-slate-100">
                            {extras.map((e, ei) => {
                                const eOpts     = presMap[e.erp_product_id] ?? [{ factor: 1, label: 'Unidad' }];
                                const fRaw      = e.fQty * e.fPres;
                                const sRaw      = e.sQty * e.sPres;
                                const eDiff     = fRaw !== sRaw;
                                const eBothZero = e.fQty === 0 && e.sQty === 0;
                                const delta     = fRaw - sRaw;
                                return (
                                    <div key={e.erp_product_id} className={`transition-colors ${eBothZero ? 'bg-red-50' : eDiff ? 'bg-amber-50' : 'bg-white hover:bg-slate-50/50'}`}>
                                        <div className={`grid ${EXTRAS_GRID} gap-x-2 items-center px-5 py-2`}>
                                            <div className="min-w-0">
                                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 mb-0.5">
                                                    <Plus size={8} /> Extra
                                                </span>
                                                <p className={`text-[12px] font-semibold leading-snug ${eBothZero ? 'text-red-600' : 'text-slate-700'}`}>{e.nombre}</p>
                                                {eBothZero && <p className="text-[10px] text-red-500 font-medium">Al menos uno &gt; 0</p>}
                                            </div>

                                            <div className={eDiff ? 'ring-2 ring-amber-400 ring-offset-0 rounded-2xl' : ''}>
                                                <LiquidSelect
                                                    value={String(e.fPres)}
                                                    onChange={v => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fPres: Number(v) } : x))}
                                                    options={eOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                                    compact
                                                    clearable={false}
                                                />
                                            </div>

                                            <div className="relative">
                                                <input type="number" min={0} value={e.fQty}
                                                    onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fQty: Math.max(0, parseInt(ev.target.value) || 0) } : x))}
                                                    className={`w-full text-center border rounded-lg px-1 py-1 text-[16px] font-bold focus:outline-none tabular-nums ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-teal-700 focus:border-teal-400'}`}
                                                />
                                                {eDiff && delta !== 0 && (
                                                    <span className={`absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 rounded-full border border-white ${delta < 0 ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                                                        {delta > 0 ? '+' : ''}{delta}
                                                    </span>
                                                )}
                                            </div>

                                            <div className={eDiff ? 'ring-2 ring-amber-400 ring-offset-0 rounded-2xl' : ''}>
                                                <LiquidSelect
                                                    value={String(e.sPres)}
                                                    onChange={v => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, sPres: Number(v) } : x))}
                                                    options={eOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                                    compact
                                                    clearable={false}
                                                />
                                            </div>

                                            <input type="number" min={0} value={e.sQty}
                                                onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, sQty: Math.max(0, parseInt(ev.target.value) || 0) } : x))}
                                                className={`w-full text-center border rounded-lg px-1 py-1 text-[16px] font-bold focus:outline-none tabular-nums ${eDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-violet-700 focus:border-violet-400'}`}
                                            />

                                            <button onClick={() => setExtras(prev => prev.filter((_, j) => j !== ei))}
                                                className="flex justify-center p-1 text-slate-300 hover:text-red-500 transition-colors">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                        {(eDiff || e.nota) && (
                                            <div className="px-5 pb-2">
                                                <input type="text" placeholder="Nota (opcional)…" value={e.nota}
                                                    onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, nota: ev.target.value } : x))}
                                                    className="w-full text-[16px] border border-indigo-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-indigo-400 placeholder-slate-300"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div ref={extrasEndRef} />
                        </div>
                    </div>
                </PedidoModal.Body>

                {/* Buscador para agregar productos */}
                <div className="flex-none border-t border-slate-100 px-5 py-3">
                    <div ref={extraBuscarRef}
                        className="flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50/60 px-3 py-2">
                        <Search size={13} className="text-indigo-400 shrink-0" />
                        <input ref={extraRef} type="text" placeholder="Buscar producto extra recibido…"
                            value={extraSearch}
                            onChange={e => {
                                setExtraSearch(e.target.value);
                                if (extraBuscarRef.current) {
                                    const r = extraBuscarRef.current.getBoundingClientRect();
                                    setExtraDropCoords({ top: r.top, left: r.left, width: r.width });
                                }
                            }}
                            className="flex-1 text-[16px] bg-transparent focus:outline-none placeholder-indigo-300 text-slate-700"
                        />
                        {extraBusy
                            ? <Loader2 size={12} className="animate-spin text-indigo-400 shrink-0" />
                            : extraSearch && <button onClick={() => setExtraSearch('')} className="text-slate-300 hover:text-slate-500 shrink-0"><X size={13} /></button>
                        }
                    </div>
                    {extraResults.length > 0 && createPortal(
                        <div style={{
                            position: 'fixed',
                            bottom: window.innerHeight - extraDropCoords.top + 8,
                            left: extraDropCoords.left,
                            width: extraDropCoords.width,
                            zIndex: 99999,
                        }} className="rounded-xl border border-indigo-200 bg-white/80 backdrop-blur-xl shadow-2xl overflow-hidden">
                            {extraResults.map(prod => (
                                <button key={prod.id} onMouseDown={() => addExtra(prod)}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[12px] text-slate-700 hover:bg-indigo-50 transition-colors border-b border-slate-50 last:border-0">
                                    <Plus size={12} className="text-indigo-400 shrink-0" />
                                    {prod.nombre}
                                </button>
                            ))}
                        </div>,
                        document.body
                    )}
                </div>

                <PedidoModal.Footer className="space-y-2">
                    {saveError && (
                        <div className="flex items-center gap-2 text-red-600 text-[12px] bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <AlertTriangle size={13} /> {saveError}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <button onClick={goBackFromExtras} disabled={saving}
                            className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors disabled:opacity-40">
                            Volver
                        </button>
                        <button onClick={goBackFromExtras}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-500 text-white font-bold text-[13px] hover:bg-indigo-600 transition-colors shadow-sm">
                            <Check size={14} />
                            {extras.length > 0 ? `Listo · ${extras.length} extra${extras.length !== 1 ? 's' : ''}` : 'Listo'}
                        </button>
                    </div>
                </PedidoModal.Footer>
            </PedidoModal>
        );
    }

    // ════════════════════════════════════════════════════════════════
    // SCREEN: ITEMS — product grid for selected box (or all items)
    // ════════════════════════════════════════════════════════════════
    const goBack = () => { setScreen('cajas'); setSelectedCaja(null); setSelectedEspecial(null); setProdSearch(''); setShowSearch(false); };
    const isDanadaBox = cajaDanada.includes(selectedCaja);
    const isDanadaEspecial = selectedEspecial ? especialesLlegadas[selectedEspecial.label] === 'danada' : false;

    return (
        <PedidoModal open={open} onClose={saving ? undefined : ((hasCajaMap || selectedEspecial !== null) ? goBack : onClose)} maxWidth="max-w-2xl" className="max-h-[90vh]">

            {/* Header */}
            <PedidoModal.Header className="px-5 py-4">
                <div className="flex items-center gap-2">
                    {hasCajaMap && (
                        <button onClick={goBack} disabled={saving}
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 transition-all shrink-0 disabled:opacity-40">
                            <ChevronLeft size={14} />
                        </button>
                    )}
                    <AnimatePresence mode="popLayout" initial={false}>
                        {!showSearch ? (
                            <motion.div key="title" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                                {selectedEspecial !== null ? (
                                    <>
                                        <h3 className="text-[15px] font-bold text-slate-800 leading-snug">
                                            {selectedEspecial.label} — Caja especial
                                            {isDanadaEspecial && <span className="ml-2 text-[11px] font-semibold text-amber-600">⚠ Dañada</span>}
                                        </h3>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            {selectedEspecial.item.products?.nombre ?? ''} · {sucursalNombre}
                                        </p>
                                    </>
                                ) : hasCajaMap ? (
                                    <>
                                        <h3 className="text-[15px] font-bold text-slate-800 leading-snug">
                                            Caja {selectedCaja}
                                            {isDanadaBox && <span className="ml-2 text-[11px] font-semibold text-amber-600">⚠ Dañada</span>}
                                        </h3>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            {selectedCajaRows.length} productos · {sucursalNombre}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-[15px] font-bold text-slate-800 leading-snug">Confirmar recepción</h3>
                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                            {sucursalNombre}{pedido.codigo && ` · ${pedido.codigo}`} · {rows.length} productos
                                        </p>
                                    </>
                                )}
                                {(isDanadaBox || isDanadaEspecial) && (
                                    <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                                        <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                                        <span className="text-[10px] text-amber-700 font-medium">
                                            {isDanadaEspecial ? 'Esta caja especial llegó dañada — revisá el estado físico al contar' : 'Esta caja llegó dañada — revisá el estado físico al contar'}
                                        </span>
                                    </div>
                                )}
                                {!hasCajaMap && !isDanadaBox && cajaDanada.length > 0 && (
                                    <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200">
                                        <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                                        <span className="text-[10px] text-amber-700 font-medium">
                                            Caja{cajaDanada.length > 1 ? 's' : ''} {cajaDanada.map(n => `#${n}`).join(', ')} llegó dañada — revisá el estado físico
                                        </span>
                                    </div>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div key="search" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
                                    <input ref={searchRef} type="text" placeholder="Buscar producto…"
                                        value={prodSearch} onChange={e => setProdSearch(e.target.value)}
                                        className="w-full text-[16px] border border-blue-200 rounded-lg pl-8 pr-8 py-2 focus:outline-none focus:border-blue-400 bg-blue-50/40 placeholder-slate-300"
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
                        <button
                            onClick={showSearch ? () => { setShowSearch(false); setProdSearch(''); } : (hasCajaMap ? goBack : onClose)}
                            disabled={!showSearch && saving}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1 disabled:opacity-40"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            </PedidoModal.Header>

            {/* Item grid */}
            <PedidoModal.Body className="px-0 py-0" style={{ overflow: 'hidden', flex: 'none' }}>
              <div className="max-h-[48vh] overflow-y-auto">
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
                        const hasProb   = !!tp;
                        const panelOpen = tp === true;
                        const fRaw = Math.round(fQty * fPres / erpFactor);
                        const sRaw = Math.round(sQty * sPres / erpFactor);
                        const hasDiff = fRaw !== sRaw || fPres !== sPres;
                        const delta   = fRaw - sRaw;

                        const rawOpts  = presMap[r.erp_product_id] ?? [];
                        const dispLabel = fmtDispatchLabel(r.dispatch_tipo, dispFactor);
                        const dispOpt  = { factor: dispFactor, label: dispLabel };
                        const hasDispRule = r.dispatch_tipo && dispFactor !== erpFactor;
                        const _seen = new Set();
                        const presOpts = [];
                        if (hasDispRule) { presOpts.push(dispOpt); _seen.add(dispFactor); }
                        rawOpts.forEach(o => { if (!_seen.has(o.factor)) { presOpts.push(o); _seen.add(o.factor); } });
                        if (!presOpts.length) presOpts.push(dispOpt);

                        const navKey = (col, dir) => document.querySelector(`[data-qty-row="${rowIdx + dir}"][data-qty-col="${col}"]`)?.focus();

                        const toggleProblema = () => {
                            setTieneProblema(p => {
                                const cur = p[r.id];
                                if (!cur) return { ...p, [r.id]: true };
                                if (cur === true) { setErrorVals(ev => ({ ...ev, [r.id]: '' })); return { ...p, [r.id]: false }; }
                                return { ...p, [r.id]: true };
                            });
                        };
                        const confirmProblema = () => setTieneProblema(p => ({ ...p, [r.id]: 'done' }));

                        return (
                            <div key={r.id} className={`transition-colors ${hasDiff ? 'bg-amber-50' : hasProb ? 'bg-orange-50/40' : 'bg-white hover:bg-slate-50/50'}`}>
                                <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                                    <span className="text-[12px] text-slate-700 font-semibold leading-snug">
                                        {r.products?.nombre}
                                        {!hasCajaMap && r.caja_especial && (
                                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-1.5 py-0.5">
                                                <Star size={8} />Especial
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-[12px] font-bold text-slate-500 tabular-nums text-center">{defDispQty}</span>

                                    <div className={fPres !== sPres ? 'ring-2 ring-amber-400 ring-offset-0 rounded-2xl' : ''}>
                                        <LiquidSelect
                                            value={String(fPres)}
                                            onChange={v => setFPresVals(p => ({ ...p, [r.id]: Number(v) }))}
                                            options={presOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                            compact
                                            clearable={false}
                                        />
                                    </div>

                                    <div className="relative">
                                        <input type="number" min={0} value={fQty}
                                            data-qty-row={rowIdx} data-qty-col="fqty"
                                            onChange={e => setFQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="fqty"]`); n?.focus(); n?.select(); } }}
                                            className={`w-full text-center border rounded-lg px-1 py-1 text-[16px] font-bold focus:outline-none tabular-nums ${hasDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-teal-200 bg-white text-slate-700 focus:border-teal-400'}`}
                                        />
                                        {hasDiff && (
                                            <span className={`absolute -top-1.5 -right-1.5 text-[9px] font-bold px-1 rounded-full border border-white ${delta < 0 ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'}`}>
                                                {delta > 0 ? '+' : ''}{delta}
                                            </span>
                                        )}
                                    </div>

                                    <div className={fPres !== sPres ? 'ring-2 ring-amber-400 ring-offset-0 rounded-2xl' : ''}>
                                        <LiquidSelect
                                            value={String(sPres)}
                                            onChange={v => setSPresVals(p => ({ ...p, [r.id]: Number(v) }))}
                                            options={presOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                            compact
                                            clearable={false}
                                        />
                                    </div>

                                    <input type="number" min={0} value={sQty}
                                        data-qty-row={rowIdx} data-qty-col="sqty"
                                        onChange={e => setSQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="sqty"]`); n?.focus(); n?.select(); } }}
                                        className={`w-full text-center border rounded-lg px-1 py-1 text-[16px] font-bold focus:outline-none tabular-nums ${hasDiff ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-slate-700 focus:border-violet-400'}`}
                                    />

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
                                        {(errorVals[r.id] === 'danado' || errorVals[r.id] === 'vencido') && (
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span className="text-[10px] text-slate-400">¿Cuántos?</span>
                                                <input type="number" min={1} max={fQty}
                                                    value={cantProblemaVals[r.id] ?? 1}
                                                    onChange={e => setCantProblemaVals(p => ({
                                                        ...p, [r.id]: Math.max(1, Math.min(fQty, parseInt(e.target.value) || 1))
                                                    }))}
                                                    className="w-12 text-center border border-orange-300 rounded-full px-2 py-1 text-[16px] font-bold focus:outline-none focus:border-orange-500 bg-white text-orange-700"
                                                />
                                                <span className="text-[10px] text-slate-400">de {fQty}</span>
                                            </div>
                                        )}
                                        <input type="text" placeholder="Nota…"
                                            value={notaVals[r.id] ?? ''}
                                            onChange={e => setNotaVals(p => ({ ...p, [r.id]: e.target.value }))}
                                            onKeyDown={e => e.key === 'Enter' && confirmProblema()}
                                            className="flex-1 min-w-0 text-[16px] border border-orange-200 rounded-full px-3 py-1 focus:outline-none focus:border-orange-400 bg-white placeholder-slate-300"
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

                    <div ref={extrasEndRef} />
                </div>
              </div>
            </PedidoModal.Body>

            {/* Extras — navigate to dedicated screen */}
            <div className="flex-none border-t border-slate-100 px-5 py-3">
                <button onClick={() => { setPrevScreen(screen); setScreen('extras'); setTimeout(() => extraRef.current?.focus(), 80); }}
                    className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition-colors py-0.5">
                    <PackagePlus size={13} />
                    ¿Llegó un producto extra?
                    {extras.length > 0 && <span className="ml-1 bg-indigo-100 text-indigo-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{extras.length}</span>}
                </button>
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
                <div className="flex justify-between gap-2">
                    <button
                        onClick={hasCajaMap ? goBack : onClose}
                        disabled={saving}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-[13px] transition-colors disabled:opacity-40">
                        {hasCajaMap ? 'Volver' : 'Cancelar'}
                    </button>
                    <button onClick={handleConfirmarCaja} disabled={saving}
                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 text-[13px] transition-colors disabled:opacity-50">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                        {hasCajaMap ? `Confirmar Caja ${selectedCaja}` : 'Confirmar recepción'}
                    </button>
                </div>
            </PedidoModal.Footer>
        </PedidoModal>
    );
}
