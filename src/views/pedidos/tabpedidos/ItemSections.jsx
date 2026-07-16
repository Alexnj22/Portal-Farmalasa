// Extracted from TabPedidos.jsx (Bloque 6.C) — the 4 collapsible item
// tables inside an expanded pedido card (Enviados/Agotamiento/Sin stock/
// Revisar regla) plus the inline MIN/MAX editor for "Revisar regla" rows.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Search, X, Loader2, Check, RotateCcw, ShieldAlert } from 'lucide-react';
import { smartFilter } from '../../../utils/searchUtils';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import { DataTable, DataRow, DataCell } from '../../../components/common/DataTable';
import TablePagination from '../../../components/common/TablePagination';
import ConfirmModal from '../../../components/common/ConfirmModal';
import { calcSolicitado } from './helpers';
import { fetchStockParamsForRevision, updateStockParams } from '../../../data/stockParams';

const MINI_PAGE = 15;

function renderLab(row) {
    return <span className="text-slate-500 text-[11px] whitespace-nowrap">{row.products?.laboratorios?.nombre ?? '—'}</span>;
}
function renderProd(row) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-slate-700">{row.products?.nombre ?? `Prod. ${row.erp_product_id}`}</span>
            {row.products?.es_antibiotico && <span className="text-[9px] px-1.5 rounded-full bg-red-50 border border-red-200 text-red-500 font-semibold shrink-0">Bajo Receta</span>}
        </div>
    );
}
function renderPresentacion(row) {
    const tipo   = row.dispatch_tipo;
    const factor = row.dispatch_factor || row.factor || 1;
    const TIPO_LABELS = { caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja' };
    if (!tipo) {
        if (factor > 1) return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">×{factor} unid</span>;
        return <span className="text-slate-500 text-[11px]">Unidad</span>;
    }
    const label      = TIPO_LABELS[tipo] ?? tipo;
    const showFactor = factor > 1 && ['caja','blister','solo_cajas'].includes(tipo);
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            {label}{showFactor ? ` ×${factor}` : ''}{['multiplo','multiplo_unidades'].includes(tipo) ? ` ×${factor}` : ''}
        </span>
    );
}
// Para la sección "Revisar regla": muestra la unidad de stock (lo que pidió la sucursal),
// no la unidad de despacho. Así "Solicitado=4" lee como "4 Unidad", no "4 CAJA".
function renderPresStock(row) {
    const factor     = row.factor || 1;
    const dispFactor = row.dispatch_factor || factor;
    if (factor === dispFactor || !row.dispatch_tipo) return renderPresentacion(row);
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
            {factor <= 1 ? 'Unidad' : `×${factor} unid`}
        </span>
    );
}

const renderSolicitado = r => {
    const sol = calcSolicitado(r);
    return sol != null
        ? <span className="tabular-nums text-slate-500">{sol}</span>
        : <span className="text-slate-500">—</span>;
};

const COLS_ENVIADOS = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'asig',       label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums">{r.cantidad_asignada}</span> },
    { key: 'rec',        label: 'Recibido',   align: 'center', render: r => {
        if (r.cantidad_recibida == null) return <span className="text-slate-500">—</span>;
        const diff = r.cantidad_recibida - r.cantidad_asignada;
        return (
            <span className={`font-bold tabular-nums ${diff < 0 ? 'text-amber-600' : diff > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                {r.cantidad_recibida}{diff !== 0 && <span className="text-[10px] ml-0.5">({diff > 0 ? '+' : ''}{diff})</span>}
            </span>
        );
    }},
    { key: 'status', label: 'Estado', render: r => (
        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.status === 'recibido'       ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            r.status === 'con_diferencia' ? 'bg-amber-50   text-amber-700   border-amber-200'   :
                                            'bg-slate-50   text-slate-500   border-slate-200'
        }`}>
            {r.status === 'recibido' ? 'Recibido' : r.status === 'con_diferencia' ? 'Diferencia' : 'Pendiente'}
        </span>
    )},
];

const COLS_AGOTAMIENTO = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'enviado',    label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums text-slate-700">{r.cantidad_asignada}</span> },
    { key: 'falto',      label: 'Faltó',      align: 'center', render: r => {
        const sol = calcSolicitado(r);
        const falto = sol != null ? Math.max(0, sol - (r.cantidad_asignada ?? 0)) : null;
        return falto != null
            ? <span className="font-bold tabular-nums text-orange-600">{falto}</span>
            : <span className="text-slate-500">—</span>;
    }},
];

const COLS_SIN_STOCK = [
    { key: 'lab',        label: 'Laboratorio',  render: renderLab },
    { key: 'prod',       label: 'Producto',     render: renderProd },
    { key: 'pres',       label: 'Presentación', render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => (
        <span className={`tabular-nums text-[11px] font-semibold ${(r.stock_packs_snapshot ?? 0) === 0 ? 'text-rose-500' : 'text-slate-600'}`}>
            {r.stock_packs_snapshot ?? '—'}
        </span>
    )},
    { key: 'motivo', label: 'Motivo', render: () => (
        <div className="flex flex-col gap-0.5">
            <span className="text-amber-600 text-[10px] font-semibold">Sin stock en bodega</span>
            <span className="text-slate-500 text-[9px]">Esperar reabastecimiento o generar un pedido manual</span>
        </div>
    )},
];

function sortedPresRegla(presentations) {
    return [...new Map((presentations || []).map(p => [p.factor, p])).values()]
        .filter(p => p.factor > 1).sort((a, b) => b.factor - a.factor);
}
function formatUnitsRegla(units, presentations) {
    const n = Math.round(Number(units));
    if (n === 0) return '0 und';
    const pres = sortedPresRegla(presentations);
    if (!pres.length) return `${n} und`;
    let rem = n;
    const parts = [];
    for (const { tipo, factor } of pres) {
        if (rem >= factor) { parts.push(`${Math.floor(rem / factor)} ${tipo.trim()}`); rem %= factor; }
    }
    if (rem > 0) parts.push(`${rem} und`);
    return parts.length ? parts.join(' + ') : `${n} und`;
}

// Solo usado dentro de COLS_REGLA — no se comparte con el cuerpo principal.
function fmtRegla(row) {
    if (!row.dispatch_tipo) return <span className="text-slate-500">—</span>;
    const tipoKey    = (row.dispatch_tipo ?? '').toLowerCase();
    const tipos      = { caja: 'CAJA', blister: 'BLÍSTER', multiplo: 'UND ×', multiplo_unidades: 'UND ×', solo_cajas: 'SOLO CAJAS' };
    const base       = tipos[tipoKey] ?? row.dispatch_tipo.toUpperCase();
    // dispatch_pres_factor = raw factor per dispatch unit (e.g. 12 for CAJA×12)
    // dispatch_multiplo = how many dispatch units per delivery (default 1)
    const presFactor = Number(row.dispatch_pres_factor ?? row.dispatch_factor);
    const multiplo   = Number(row.dispatch_multiplo ?? 1);
    const showFactor = presFactor > 1 && tipoKey !== 'solo_cajas';
    return (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200 whitespace-nowrap">
            {base}{showFactor ? ` ×${presFactor}` : ''} | ×{multiplo}
        </span>
    );
}

const COLS_REGLA = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresStock },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => {
        const packs  = r.stock_packs_snapshot ?? null;
        const factor = Number(r.factor) || 1;
        const units  = packs != null ? Math.round(packs * factor) : null;
        const txt    = units != null ? formatUnitsRegla(units, r.presentations) : null;
        return (
            <span className={`tabular-nums text-[11px] font-semibold ${(units ?? 0) === 0 ? 'text-rose-500' : 'text-slate-600'}`}>
                {txt ?? '—'}
            </span>
        );
    }},
    { key: 'regla',  label: 'Regla', render: fmtRegla },
    { key: 'motivo', label: 'Motivo', render: r => {
        const factor  = Number(r.factor) || 1;
        const needed  = r.max_qty_snapshot != null && r.stock_packs_snapshot != null
            ? Math.max(0, r.max_qty_snapshot - r.stock_packs_snapshot) : null;
        const needUnd = needed != null ? Math.ceil(needed * factor) : null;
        return (
            <div className="flex flex-col gap-0.5">
                <span className="text-rose-600 text-[10px] font-semibold">Necesidad baja</span>
                <span className="text-slate-500 text-[9px]">
                    {needUnd != null ? `Reponer ${needUnd} und. no alcanza el mín. de la regla` : 'Cantidad < 40% de la unidad mínima de despacho'}
                </span>
                <span className="text-slate-500 text-[9px]">Ajustar MAX o reducir el múltiplo en la regla</span>
            </div>
        );
    }},
];

function ItemSection({ label, count, badgeCls, rows, columns, noteEl, renderRowExtra }) {
    const [open,        setOpen]        = useState(false);
    const [page,        setPage]        = useState(1);
    const [pageSize,    setPageSize]    = useState(MINI_PAGE);
    const [search,      setSearch]      = useState('');
    const [searchOpen,  setSearchOpen]  = useState(false);
    const searchRef = useRef(null);

    const filteredRows = useMemo(() => {
        if (!search.trim()) return rows;
        const { results } = smartFilter(search, rows, r => [
            r.products?.nombre ?? r.product_name ?? '',
            r.products?.laboratorios?.nombre ?? '',
        ]);
        return results;
    }, [rows, search]);

    useEffect(() => {
        if (!open) { setSearch(''); setSearchOpen(false); setPage(1); } // eslint-disable-line react-hooks/set-state-in-effect -- resetea búsqueda/paginación al cerrar
    }, [open]);

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
    const pageRows   = filteredRows.slice((page - 1) * pageSize, page * pageSize);

    if (!count) return null;

    const openSearch = (e) => {
        e.stopPropagation();
        if (!open) setOpen(true);
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 80);
    };
    const closeSearch = (e) => {
        e?.stopPropagation();
        setSearchOpen(false);
        setSearch('');
        setPage(1);
    };

    return (
        <div className="border-t border-slate-100">
            <div className="flex items-center gap-1 pr-2 hover:bg-slate-50/50 transition-colors">
                <button onClick={() => setOpen(v => !v)} className="flex-1 flex items-center gap-2 px-4 py-2.5 text-left">
                    <span className="text-[11px] font-semibold text-slate-700 flex-1">{label}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${search ? 'bg-blue-50 text-blue-700 border-blue-200' : badgeCls}`}>
                        {search ? `${filteredRows.length}/${count}` : count}
                    </span>
                </button>
                <AnimatePresence mode="wait">
                    {searchOpen ? (
                        <motion.div key="input" initial={{ width: 0, opacity: 0 }} animate={{ width: 160, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden shrink-0">
                            <div className="relative flex items-center">
                                <Search size={10} className="absolute left-2 text-slate-400 pointer-events-none" />
                                <input
                                    ref={searchRef}
                                    value={search}
                                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    onKeyDown={e => e.key === 'Escape' && closeSearch()}
                                    placeholder="Buscar…"
                                    className="w-full pl-6 pr-5 py-1 text-[16px] bg-white border border-blue-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-200 focus:border-blue-400 text-slate-700 placeholder:text-slate-400 shadow-sm"
                                />
                                <button onClick={closeSearch} className="absolute right-1.5 text-slate-500 hover:text-slate-600">
                                    <X size={9} />
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.button key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={openSearch} className="p-1.5 rounded-lg text-slate-500 hover:text-blue-500 hover:bg-blue-50 transition-colors shrink-0">
                            <Search size={12} />
                        </motion.button>
                    )}
                </AnimatePresence>
                <button onClick={() => setOpen(v => !v)} className="p-1.5 shrink-0">
                    {open ? <ChevronDown size={12} className="text-slate-500" /> : <ChevronRight size={12} className="text-slate-500" />}
                </button>
            </div>
            <AnimatePresence>
                {open && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                        <div className="px-4 pb-4 space-y-3">
                            {noteEl}
                            <DataTable
                                columns={columns}
                                minWidth="400px"
                                footer={
                                    <TablePagination
                                        page={page}
                                        totalPages={totalPages}
                                        onPageChange={p => setPage(p)}
                                        pageSize={pageSize}
                                        onPageSizeChange={sz => { setPageSize(sz); setPage(1); }}
                                        total={rows.length}
                                        filteredTotal={search ? filteredRows.length : undefined}
                                        unit="productos"
                                    />
                                }
                            >
                                {pageRows.map((row, idx) => (
                                    <React.Fragment key={row.id ?? idx}>
                                        <DataRow index={idx}>
                                            {columns.map(col => (
                                                <DataCell key={col.key} align={col.align ?? 'left'}>
                                                    {col.render ? col.render(row) : row[col.key]}
                                                </DataCell>
                                            ))}
                                        </DataRow>
                                        {renderRowExtra && renderRowExtra(row, columns.length)}
                                    </React.Fragment>
                                ))}
                            </DataTable>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function ItemSections({ allItems, loading }) {
    const [pspMap,          setPspMap]          = React.useState({});
    const [editMap,         setEditMap]         = React.useState({});
    const [origMap,         setOrigMap]         = React.useState({});
    const [savingId,        setSavingId]        = React.useState(null);
    const [savedId,         setSavedId]         = React.useState(null);
    const [errorMap,        setErrorMap]        = React.useState({});
    const [resetZeroTarget, setResetZeroTarget] = React.useState(null);
    const debounceRef = React.useRef({});

    // Stable key so the effect only refires when the set of revision_minmax products changes
    const revisionKey = React.useMemo(() =>
        allItems.filter(i => i.revision_minmax)
            .map(r => `${r.erp_product_id}_${r.erp_sucursal_id}`).sort().join(','),
        [allItems]
    );

    // Fetch product_stock_params for all revision_minmax items (has-rule + no-rule)
    React.useEffect(() => {
        const items = allItems.filter(i => i.revision_minmax);
        if (items.length === 0) { setPspMap({}); setEditMap({}); return; }
        const productIds  = [...new Set(items.map(r => r.erp_product_id))];
        const sucursalIds = [...new Set(items.map(r => r.erp_sucursal_id))];
        (async () => {
            const { data, error } = await fetchStockParamsForRevision(productIds, sucursalIds);
            if (error) console.error('fetch product_stock_params (revision_minmax) failed:', error.message);
            if (!data) return;
            const map = {};
            for (const psp of data) map[`${psp.erp_product_id}_${psp.erp_sucursal_id}`] = psp;
            const em = {};
            for (const item of items) {
                const psp = map[`${item.erp_product_id}_${item.erp_sucursal_id}`];
                em[item.id] = {
                    min: String(psp?.manual_min ?? psp?.min_units ?? 0),
                    max: String(psp?.manual_max ?? psp?.max_units ?? 0),
                };
            }
            setPspMap(map);
            setEditMap(em);
            setOrigMap({ ...em });
        })();
    }, [revisionKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Must be defined BEFORE any early return — hooks cannot be called conditionally
    const revertToOrig = React.useCallback((rowId) => {
        const orig = origMap[rowId] ?? { min: '0', max: '0' };
        setEditMap(prev => ({ ...prev, [rowId]: orig }));
        setErrorMap(prev => ({ ...prev, [rowId]: null }));
    }, [origMap]);

    if (loading) return <div className="flex justify-center py-5 border-t border-slate-100"><Loader2 size={16} className="animate-spin text-slate-500" /></div>;

    const enviados    = allItems.filter(i => i.cantidad_asignada > 0);
    const agotamiento = allItems.filter(i => i.agotamiento);
    const sinStock    = allItems.filter(i => i.sin_stock);
    const porRegla    = allItems.filter(i => i.revision_minmax);
    const total       = allItems.length;

    if (total === 0) return <div className="border-t border-slate-100 py-4 text-center text-[11px] text-slate-500">Sin ítems.</div>;

    // Mirrors the DB constraint chk_min_lt_max:
    // min=0 → max must be 0 or 1; min≥1 → max must be strictly > min
    const validateEdit = (edit) => {
        const min = parseInt(edit.min, 10);
        const max = parseInt(edit.max, 10);
        if (isNaN(min) || min < 0) return 'MIN inválido';
        if (isNaN(max) || max < 0) return 'MAX inválido';
        if (min === 0 && max > 1)  return 'Con MIN=0, MAX debe ser 0 o 1';
        if (min >= 1 && max <= min) return 'MAX debe ser mayor que MIN';
        return null;
    };

    const doSave = async (row, min, max) => {
        setSavingId(row.id);
        try {
            const k = `${row.erp_product_id}_${row.erp_sucursal_id}`;
            const prevPsp = pspMap[k];
            const { error } = await updateStockParams(row.erp_product_id, row.erp_sucursal_id, { min_units: min, max_units: max, manual_min: null, manual_max: null });
            if (error) throw error;
            // target_id debe ser el producto (no el pedido) — es lo que el historial
            // MIN/MAX de Productos usa para buscar cambios de un producto puntual.
            useStaff.getState().appendAuditLog('MINMAX_UPDATED_FROM_PEDIDO', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: row.erp_sucursal_id,
                old_min: prevPsp?.manual_min ?? prevPsp?.min_units ?? 0,
                old_max: prevPsp?.manual_max ?? prevPsp?.max_units ?? 0,
                new_min: min, new_max: max,
                pedido_id: row.pedido_id,
            });
            setPspMap(prev => ({ ...prev, [k]: { ...(prev[k] ?? {}), min_units: min, max_units: max, manual_min: null, manual_max: null } }));
            setSavedId(row.id);
            setTimeout(() => setSavedId(id => id === row.id ? null : id), 2000);
        } catch (e) {
            // Revert to last-saved values so the input doesn't stay in an invalid state
            revertToOrig(row.id);
            const msg = /check constraint/i.test(e?.message ?? '')
                ? 'Valor fuera del rango permitido (MIN=0 → MAX 0–1; MIN≥1 → MAX > MIN).'
                : (e?.message ?? 'No se pudo guardar.');
            useToastStore.getState().showToast('Error al guardar', msg, 'error');
        } finally {
            setSavingId(null);
        }
    };

    const onMinMaxChange = (row, field, value) => {
        const newEdit = { ...(editMap[row.id] ?? {}), [field]: value };
        setEditMap(prev => ({ ...prev, [row.id]: newEdit }));
        setErrorMap(prev => ({ ...prev, [row.id]: null })); // clear while typing so arrows work freely
        if (debounceRef.current[row.id]) clearTimeout(debounceRef.current[row.id]);
        // Validate and save after 800ms idle — no revert, user can keep editing toward valid state
        debounceRef.current[row.id] = setTimeout(() => {
            const err = validateEdit(newEdit);
            if (err) {
                setErrorMap(prev => ({ ...prev, [row.id]: err }));
                useToastStore.getState().showToast('Valor inválido', err, 'error');
            } else {
                doSave(row, parseInt(newEdit.min, 10), parseInt(newEdit.max, 10));
            }
        }, 800);
    };

    const restoreMinMax = (row) => {
        const orig = origMap[row.id] ?? { min: '0', max: '0' };
        setEditMap(prev => ({ ...prev, [row.id]: orig }));
        setErrorMap(prev => ({ ...prev, [row.id]: null }));
        doSave(row, parseInt(orig.min, 10), parseInt(orig.max, 10));
    };

    const resetZero = (row) => {
        setResetZeroTarget(row);
    };

    const renderMinMaxRow = (row, colCount) => {
        if (!row.revision_minmax) return null;
        const psp      = pspMap[`${row.erp_product_id}_${row.erp_sucursal_id}`];
        const edit     = editMap[row.id] ?? { min: '0', max: '0' };
        const isSaving = savingId === row.id;
        const isSaved  = savedId  === row.id;
        const err      = errorMap[row.id] ?? null;
        const v6m      = psp?.units_sold_6m ?? null;
        const inputCls = (hasErr) =>
            `w-14 text-[11px] font-bold border rounded-lg px-2 py-1 focus:outline-none bg-white text-slate-700 text-center disabled:opacity-40 transition-colors ${
                hasErr ? 'border-rose-300 focus:border-rose-400 bg-rose-50/60' : 'border-slate-200 focus:border-blue-400'
            }`;
        return (
            <tr key={`mm_${row.id}`}>
                <td colSpan={colCount} className="px-4 pb-2.5 pt-0">
                    <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2 flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide shrink-0">Ventas 6M</span>
                        <span className="text-[11px] font-bold tabular-nums text-slate-700 shrink-0">
                            {psp === undefined ? <span className="text-slate-500">—</span> : v6m != null ? `${v6m} und.` : '0 und.'}
                        </span>
                        <div className="w-px h-4 bg-slate-200 shrink-0 mx-0.5" />
                        <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide shrink-0">MIN</span>
                        <input
                            type="number" min="0" value={edit.min} disabled={isSaving}
                            onChange={e => onMinMaxChange(row, 'min', e.target.value)}
                            onBlur={() => {
                                const e = validateEdit(editMap[row.id] ?? {});
                                setErrorMap(prev => ({ ...prev, [row.id]: e ?? null }));
                            }}
                            className={inputCls(!!err && err !== 'MAX inválido' && !err.startsWith('MAX'))}
                        />
                        <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-wide shrink-0">MAX</span>
                        <input
                            type="number" min="0" value={edit.max} disabled={isSaving}
                            onChange={e => onMinMaxChange(row, 'max', e.target.value)}
                            onBlur={() => {
                                const e = validateEdit(editMap[row.id] ?? {});
                                setErrorMap(prev => ({ ...prev, [row.id]: e ?? null }));
                            }}
                            className={inputCls(!!err && err !== 'MIN inválido')}
                        />
                        {isSaving && <Loader2 size={10} className="animate-spin text-blue-400 shrink-0" />}
                        {!isSaving && isSaved && <Check size={10} className="text-emerald-500 shrink-0" />}
                        <button
                            onClick={() => restoreMinMax(row)} disabled={isSaving}
                            title="Restaurar MIN/MAX original"
                            className="ml-auto flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50 disabled:opacity-50 transition-colors shrink-0"
                        >
                            <RotateCcw size={9} />Restaurar
                        </button>
                        <button
                            onClick={() => resetZero(row)} disabled={isSaving}
                            title="Dejar en 0/0 — excluye del próximo pedido"
                            className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors shrink-0"
                        >
                            <X size={9} />0 / 0
                        </button>
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <>
            <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50/60 flex items-center gap-5 flex-wrap">
                <span className="text-[11px] text-slate-500">Solicitados <strong className="text-slate-700">{total}</strong></span>
                <span className="text-[11px] text-slate-500">Enviados <strong className="text-emerald-600">{enviados.length}</strong></span>
                {agotamiento.length > 0 && <span className="text-[11px] text-slate-500">Stock insuficiente <strong className="text-orange-600">{agotamiento.length}</strong></span>}
                {sinStock.length > 0 && <span className="text-[11px] text-slate-500">Sin inventario <strong className="text-amber-600">{sinStock.length}</strong></span>}
                {porRegla.length > 0 && <span className="text-[11px] text-slate-500">Revisar regla <strong className="text-rose-600">{porRegla.length}</strong></span>}
            </div>
            <ItemSection label="Productos enviados" count={enviados.length} badgeCls="bg-emerald-50 text-emerald-700 border-emerald-200" rows={enviados} columns={COLS_ENVIADOS} />
            <ItemSection
                label="Stock insuficiente en bodega" count={agotamiento.length} badgeCls="bg-orange-50 text-orange-700 border-orange-200" rows={agotamiento} columns={COLS_AGOTAMIENTO}
                noteEl={<p className="text-[10px] text-orange-600/80">Bodega tenía stock pero no alcanzó para cubrir la necesidad completa. Se envió lo disponible; el faltante quedará pendiente para el próximo pedido.</p>}
            />
            <ItemSection label="Sin inventario en bodega" count={sinStock.length} badgeCls="bg-amber-50 text-amber-700 border-amber-200" rows={sinStock} columns={COLS_SIN_STOCK} noteEl={<p className="text-[10px] text-amber-600/80">No se incluyeron por falta de stock en bodega al momento del despacho.</p>} />
            <ItemSection
                label="Revisar regla de despacho" count={porRegla.length} badgeCls="bg-rose-50 text-rose-700 border-rose-200" rows={porRegla} columns={COLS_REGLA}
                renderRowExtra={renderMinMaxRow}
                noteEl={<div className="flex items-start gap-2 text-[10px] text-rose-600/80 bg-rose-50/60 border border-rose-100 rounded-xl px-3 py-2"><ShieldAlert size={12} className="mt-0.5 shrink-0 text-rose-500" />Estos productos no pudieron despacharse. Puede ser porque la necesidad no alcanzó el mínimo de la regla de despacho, o porque el stock en bodega fue insuficiente tras asignarlo a otras sucursales. Revisa la columna "Motivo" y ajusta los MIN/MAX.</div>}
            />
            <ConfirmModal
                isOpen={!!resetZeroTarget}
                onClose={() => setResetZeroTarget(null)}
                onConfirm={() => {
                    const row = resetZeroTarget;
                    setResetZeroTarget(null);
                    if (debounceRef.current[row.id]) clearTimeout(debounceRef.current[row.id]);
                    setEditMap(prev => ({ ...prev, [row.id]: { min: '0', max: '0' } }));
                    setErrorMap(prev => ({ ...prev, [row.id]: null }));
                    doSave(row, 0, 0);
                }}
                title="¿Dejar MIN/MAX en 0 / 0?"
                message={`"${resetZeroTarget?.products?.nombre ?? 'Este producto'}" quedará excluido del próximo pedido automático.`}
                confirmText="Confirmar"
                cancelText="Cancelar"
                isDestructive={false}
            />
        </>
    );
}
