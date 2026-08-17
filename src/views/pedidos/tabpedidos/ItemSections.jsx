// Extracted from TabPedidos.jsx (Bloque 6.C) — the 4 collapsible item
// tables inside an expanded pedido card (Enviados/Agotamiento/Sin stock/
// Revisar regla) plus the inline MIN/MAX editor for "Revisar regla" rows.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import Button from '../../../components/common/Button';
import Badge from '../../../components/common/Badge';
import { SkeletonText } from '../../../components/common/StateViews';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Search, X, Loader2, Check, RotateCcw, ShieldAlert } from 'lucide-react';
import { smartFilter } from '../../../utils/searchUtils';
import { useStaffStore as useStaff } from '../../../store/staffStore';
import { useToastStore } from '../../../store/toastStore';
import { DataTable, DataRow, DataCell } from '../../../components/common/DataTable';
import TablePagination from '../../../components/common/TablePagination';
import ConfirmModal from '../../../components/common/ConfirmModal';
import { calcSolicitado } from './helpers';
import SearchInput from '../../../components/common/SearchInput';
import { useSearchToggle } from '../../../hooks/useSearchToggle';
import { fetchStockParamsForRevision, updateStockParams, effectiveMinMaxPair } from '../../../data/stockParams';
import PortalInput from '../../../components/common/PortalInput';

const MINI_PAGE = 15;

function renderLab(row) {
    return <span className="text-content-3 text-label whitespace-nowrap">{row.products?.laboratorios?.nombre ?? '—'}</span>;
}
function renderProd(row) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-content-2">{row.products?.nombre ?? `Prod. ${row.erp_product_id}`}</span>
            {row.products?.es_antibiotico && <Badge variant="danger" size="sm" uppercase={false} className="shrink-0">Bajo Receta</Badge>}
        </div>
    );
}
function renderPresentacion(row) {
    const tipo   = row.dispatch_tipo;
    const factor = row.dispatch_factor || row.factor || 1;
    const TIPO_LABELS = { caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja' };
    if (!tipo) {
        if (factor > 1) return <Badge uppercase={false}>×{factor} unid</Badge>;
        return <span className="text-content-3 text-label">Unidad</span>;
    }
    const label      = TIPO_LABELS[tipo] ?? tipo;
    const showFactor = factor > 1 && ['caja','blister','solo_cajas'].includes(tipo);
    return (
        <Badge uppercase={false}>{label}{showFactor ? ` ×${factor}` : ''}{['multiplo','multiplo_unidades'].includes(tipo) ? ` ×${factor}` : ''}</Badge>
    );
}
// Para la sección "Revisar regla": muestra la unidad de stock (lo que pidió la sucursal),
// no la unidad de despacho. Así "Solicitado=4" lee como "4 Unidad", no "4 CAJA".
function renderPresStock(row) {
    const factor     = row.factor || 1;
    const dispFactor = row.dispatch_factor || factor;
    if (factor === dispFactor || !row.dispatch_tipo) return renderPresentacion(row);
    return (
        <Badge uppercase={false}>{factor <= 1 ? 'Unidad' : `×${factor} unid`}</Badge>
    );
}

const renderSolicitado = r => {
    const sol = calcSolicitado(r);
    return sol != null
        ? <span className="tabular-nums text-content-3">{sol}</span>
        : <span className="text-content-3">—</span>;
};

const COLS_ENVIADOS = [
    { key: 'lab',        label: 'Laboratorio',   render: renderLab },
    { key: 'prod',       label: 'Producto',      render: renderProd },
    { key: 'pres',       label: 'Presentación',  render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'asig',       label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums">{r.cantidad_asignada}</span> },
    { key: 'rec',        label: 'Recibido',   align: 'center', render: r => {
        if (r.cantidad_recibida == null) return <span className="text-content-3">—</span>;
        const diff = r.cantidad_recibida - r.cantidad_asignada;
        return (
            <span className={`font-bold tabular-nums ${diff < 0 ? 'text-warning' : diff > 0 ? 'text-success' : 'text-content-2'}`}>
                {r.cantidad_recibida}{diff !== 0 && <span className="text-caption ml-0.5">({diff > 0 ? '+' : ''}{diff})</span>}
            </span>
        );
    }},
    { key: 'status', label: 'Estado', render: r => (
        <span className={`text-micro font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
            r.status === 'recibido'       ? 'bg-success/10 text-success-text border-success/30' :
            r.status === 'con_diferencia' ? 'bg-warning/10   text-warning-text   border-warning/30'   :
                                            'bg-surface-card-hover   text-content-3   border-divider'
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
    { key: 'enviado',    label: 'Enviado',    align: 'center', render: r => <span className="font-bold tabular-nums text-content-2">{r.cantidad_asignada}</span> },
    { key: 'falto',      label: 'Faltó',      align: 'center', render: r => {
        const sol = calcSolicitado(r);
        const falto = sol != null ? Math.max(0, sol - (r.cantidad_asignada ?? 0)) : null;
        return falto != null
            ? <span className="font-bold tabular-nums text-warning-text">{falto}</span>
            : <span className="text-content-3">—</span>;
    }},
];

const COLS_SIN_STOCK = [
    { key: 'lab',        label: 'Laboratorio',  render: renderLab },
    { key: 'prod',       label: 'Producto',     render: renderProd },
    { key: 'pres',       label: 'Presentación', render: renderPresentacion },
    { key: 'solicitado', label: 'Solicitado', align: 'center', render: renderSolicitado },
    { key: 'stock_suc',  label: 'Stock sucursal', align: 'center', render: r => (
        <span className={`tabular-nums text-label font-semibold ${(r.stock_packs_snapshot ?? 0) === 0 ? 'text-danger-text' : 'text-content-2'}`}>
            {r.stock_packs_snapshot ?? '—'}
        </span>
    )},
    { key: 'motivo', label: 'Motivo', render: () => (
        <div className="flex flex-col gap-0.5">
            <span className="text-warning text-caption font-semibold">Sin stock en bodega</span>
            <span className="text-content-3 text-micro">Esperar reabastecimiento o generar un pedido manual</span>
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
    if (!row.dispatch_tipo) return <span className="text-content-3">—</span>;
    const tipoKey    = (row.dispatch_tipo ?? '').toLowerCase();
    const tipos      = { caja: 'CAJA', blister: 'BLÍSTER', multiplo: 'UND ×', multiplo_unidades: 'UND ×', solo_cajas: 'SOLO CAJAS' };
    const base       = tipos[tipoKey] ?? row.dispatch_tipo.toUpperCase();
    // dispatch_pres_factor = raw factor per dispatch unit (e.g. 12 for CAJA×12)
    // dispatch_multiplo = how many dispatch units per delivery (default 1)
    const presFactor = Number(row.dispatch_pres_factor ?? row.dispatch_factor);
    const multiplo   = Number(row.dispatch_multiplo ?? 1);
    const showFactor = presFactor > 1 && tipoKey !== 'solo_cajas';
    return (
        <Badge variant="danger" uppercase={false}>{base}{showFactor ? ` ×${presFactor}` : ''} | ×{multiplo}</Badge>
    );
}

// Es una fábrica y no una constante porque la última línea del «Motivo» es una
// INSTRUCCIÓN: decirle «ajustá el MAX» a quien no ve ni toca el MIN·MAX lo manda
// a buscar un campo que su pantalla no tiene. Quien no ajusta MIN·MAX se queda
// con el porqué —que es lo que necesita para entender su pedido— y sin la orden.
function colsRegla(canEditMinMax) {
    return [
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
            <span className={`tabular-nums text-label font-semibold ${(units ?? 0) === 0 ? 'text-danger-text' : 'text-content-2'}`}>
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
                <span className="text-danger-text text-caption font-semibold">Necesidad baja</span>
                <span className="text-content-3 text-micro">
                    {needUnd != null ? `Reponer ${needUnd} und. no alcanza el mín. de la regla` : 'Cantidad < 40% de la unidad mínima de despacho'}
                </span>
                {canEditMinMax && <span className="text-content-3 text-micro">Ajustar MAX o reducir el múltiplo en la regla</span>}
            </div>
        );
    }},
    ];
}

function ItemSection({ label, count, variante = 'neutral', rows, columns, noteEl, renderRowExtra }) {
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

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): click
    // afuera cierra SOLO si está vacío (Escape ya lo maneja el onKeyDown de
    // SearchInput más abajo, que llama a closeSearch — este hook solo agrega
    // el click-afuera; declarado antes del `if (!count)` porque un hook
    // después de un return temprano se saltearía en algunos renders).
    const { containerProps: searchContainerRef } = useSearchToggle({
        active: searchOpen,
        value: search,
        onClear: () => setSearch(''),
        onClose: () => setSearchOpen(false),
    });

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
        <div className="border-t border-divider">
            <div className="flex items-center gap-1 pr-2 hover:bg-surface-card-hover/50 transition-colors">
                <Button variant="ghost" className="flex-1" onClick={() => setOpen(v => !v)}>
                    <span className="text-label font-semibold text-content-2 flex-1">{label}</span>
                    <Badge variant={search ? 'info' : variante} size="sm" className="shrink-0" uppercase={false}>
                        {search ? `${filteredRows.length}/${count}` : count}
                    </Badge>
                </Button>
                <AnimatePresence mode="wait">
                    {searchOpen ? (
                        <motion.div {...searchContainerRef} key="input" initial={{ width: 0, opacity: 0 }} animate={{ width: 190, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden shrink-0 flex items-center gap-1">
                            <SearchInput
                                ref={searchRef}
                                size="sm"
                                value={search}
                                onChange={val => { setSearch(val); setPage(1); }}
                                onKeyDown={e => e.key === 'Escape' && closeSearch()}
                                placeholder="Buscar…"
                            />
                            <Button variant="ghost" icon={X} iconOnly onClick={closeSearch} />
                        </motion.div>
                    ) : (
                        <motion.button key="icon" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={openSearch} className="p-1.5 rounded-lg text-content-3 hover:text-brand-text hover:bg-brand/10 transition-colors shrink-0">
                            <Search size={12} />
                        </motion.button>
                    )}
                </AnimatePresence>
                <Button variant="ghost" onClick={() => setOpen(v => !v)}>{open ? <ChevronDown size={12} className="text-content-3" /> : <ChevronRight size={12} className="text-content-3" />}</Button>
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

// `canEditMinMax` sale de `minmax.can_edit`, NO de `pedidos.can_edit`. La fila de
// «revisión MIN·MAX» escribe `product_stock_params`, que es el dato del módulo
// MIN·MAX: quién puede tocarlo lo decide ese módulo y no el hecho de estar
// mirando un pedido. Sin esto la fila se pintaba para cualquiera que abriera la
// tarjeta —`pedidos.can_edit` lo tienen ONCE cargos, porque los de sala lo
// necesitan para RECIBIR—, y el guardado es automático al teclear: no hay botón
// que sirva de freno. Reportado el 2026-08-15.
//
// Y sin el permiso la fila NO SE PINTA — no queda en solo lectura (2026-08-17).
// El primer arreglo dejó los campos visibles y deshabilitados con un cartel; lo
// pedido era que MIN y MAX no estuvieran ahí. Un dependiente no tiene por qué
// ver el mínimo, el máximo ni las ventas de 6 meses de su sala para entender por
// qué un producto no le llegó: eso lo dice la columna «Motivo». Además la fila
// deshabilitada seguía TRAYENDO los datos —`fetchStockParamsForRevision` corría
// igual—, así que «no se ve» era sólo la pantalla: el número viajaba al
// navegador de todos modos. Por eso la compuerta está también en el fetch.
export default function ItemSections({ allItems, loading, canEditMinMax = false }) {
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
        // Sin permiso no hay fila que llenar: no se pide el dato. Que la consulta
        // corriera igual era la mitad del hallazgo — el MIN·MAX llegaba al
        // navegador aunque el campo estuviera deshabilitado.
        if (!canEditMinMax) { setPspMap({}); setEditMap({}); return; }
        const items = allItems.filter(i => i.revision_minmax);
        if (items.length === 0) { setPspMap({}); setEditMap({}); return; }
        const productIds  = [...new Set(items.map(r => r.erp_product_id))];
        const sucursalIds = [...new Set(items.map(r => r.erp_sucursal_id))];
        (async () => {
            // `data: null` es el fallo: la consulta pagina y `fetchAllRows` ya
            // dejó el motivo en consola. No devuelve `error` porque un fallo a
            // media paginación no es un error de una sola consulta.
            const { data } = await fetchStockParamsForRevision(productIds, sucursalIds);
            if (!data) return;
            const map = {};
            for (const psp of data) map[`${psp.erp_product_id}_${psp.erp_sucursal_id}`] = psp;
            const em = {};
            for (const item of items) {
                const psp = map[`${item.erp_product_id}_${item.erp_sucursal_id}`];
                const ef = effectiveMinMaxPair(psp);
                em[item.id] = {
                    min: String(ef.min ?? 0),
                    max: String(ef.max ?? 0),
                };
            }
            setPspMap(map);
            setEditMap(em);
            setOrigMap({ ...em });
        })();
    }, [revisionKey, canEditMinMax]); // eslint-disable-line react-hooks/exhaustive-deps

    // Must be defined BEFORE any early return — hooks cannot be called conditionally
    const revertToOrig = React.useCallback((rowId) => {
        const orig = origMap[rowId] ?? { min: '0', max: '0' };
        setEditMap(prev => ({ ...prev, [rowId]: orig }));
        setErrorMap(prev => ({ ...prev, [rowId]: null }));
    }, [origMap]);

    if (loading) return <div className="flex justify-center py-5 border-t border-divider"><SkeletonText lines={4} className="w-full max-w-md" /></div>;

    const enviados    = allItems.filter(i => i.cantidad_asignada > 0);
    const agotamiento = allItems.filter(i => i.agotamiento);
    const sinStock    = allItems.filter(i => i.sin_stock);
    const porRegla    = allItems.filter(i => i.revision_minmax);
    const total       = allItems.length;

    if (total === 0) return <div className="border-t border-divider py-4 text-center text-label text-content-3">Sin ítems.</div>;

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
        // La compuerta también acá y no sólo en los campos: `doSave` lo llaman
        // tres caminos (teclear, «Restaurar» y «0 / 0») y uno corre por un
        // temporizador de 800ms, así que puede dispararse después de que el
        // permiso ya no esté. La base es la que manda —esto no la reemplaza—,
        // pero un guardado que no puede funcionar no debería salir.
        if (!canEditMinMax) return;
        setSavingId(row.id);
        try {
            const k = `${row.erp_product_id}_${row.erp_sucursal_id}`;
            const prevPsp = pspMap[k];
            // F2.7 — dos cosas que faltaban en este payload:
            //   · updated_at: el polling de Bodega avanza por cursor keyset
            //     (updated_at, erp_product_id). Sin bumpearlo, este cambio era
            //     invisible para la pestaña de Bodega abierta al lado.
            //   · draft_status/draft_min/draft_max: si la fila tenía un borrador
            //     pendiente, quedaba pendiente — y al publicar, el borrador viejo
            //     pisaba lo que se acaba de guardar acá. Es lo mismo que hace el
            //     guardado en vivo de MIN·MAX (useMinMaxData, rama saveLive).
            const { error } = await updateStockParams(row.erp_product_id, row.erp_sucursal_id, {
                min_units: min, max_units: max, manual_min: null, manual_max: null,
                draft_status: 'none', draft_min: null, draft_max: null,
                updated_at: new Date().toISOString(),
            });
            if (error) throw error;
            // target_id debe ser el producto (no el pedido) — es lo que el historial
            // MIN/MAX de Productos usa para buscar cambios de un producto puntual.
            useStaff.getState().appendAuditLog('MINMAX_UPDATED_FROM_PEDIDO', String(row.erp_product_id), {
                field: 'min+max', product: row.product_name, sucursal_id: row.erp_sucursal_id,
                old_min: effectiveMinMaxPair(prevPsp).min ?? 0,
                old_max: effectiveMinMaxPair(prevPsp).max ?? 0,
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
        if (!row.revision_minmax || !canEditMinMax) return null;
        const psp      = pspMap[`${row.erp_product_id}_${row.erp_sucursal_id}`];
        const edit     = editMap[row.id] ?? { min: '0', max: '0' };
        const isSaving = savingId === row.id;
        const isSaved  = savedId  === row.id;
        const err      = errorMap[row.id] ?? null;
        const v6m      = psp?.units_sold_6m ?? null;
        return (
            <tr key={`mm_${row.id}`}>
                <td colSpan={colCount} className="px-4 pb-2.5 pt-0">
                    <div className="rounded-xl border border-divider bg-surface-card-hover/50 px-3 py-2 flex items-center gap-2 flex-wrap">
                        <span className="text-micro font-semibold text-content-2 uppercase tracking-wide shrink-0">Ventas 6M</span>
                        <span className="text-label font-bold tabular-nums text-content-2 shrink-0">
                            {psp === undefined ? <span className="text-content-3">—</span> : v6m != null ? `${v6m} und.` : '0 und.'}
                        </span>
                        <div className="w-px h-4 bg-divider shrink-0 mx-0.5" />
                        <span className="text-micro font-semibold text-content-2 uppercase tracking-wide shrink-0">MIN</span>
                        <PortalInput
                            aria-label="Mínimo"
                            tono={!!err && err !== 'MAX inválido' && !err.startsWith('MAX') ? 'danger' : undefined}
                            type="number"
                            min="0"
                            value={edit.min}
                            onChange={e => onMinMaxChange(row, 'min', e.target.value)}
                            onBlur={() => {
                                const e = validateEdit(editMap[row.id] ?? {});
                                setErrorMap(prev => ({ ...prev, [row.id]: e ?? null }));
                            }}
                            readOnly={isSaving}
                            compact
                            inputClassName="text-center font-bold tabular-nums"
                        />
                        <span className="text-micro font-semibold text-content-2 uppercase tracking-wide shrink-0">MAX</span>
                        <PortalInput
                            aria-label="Máximo"
                            tono={!!err && err !== 'MIN inválido' ? 'danger' : undefined}
                            type="number"
                            min="0"
                            value={edit.max}
                            onChange={e => onMinMaxChange(row, 'max', e.target.value)}
                            onBlur={() => {
                                const e = validateEdit(editMap[row.id] ?? {});
                                setErrorMap(prev => ({ ...prev, [row.id]: e ?? null }));
                            }}
                            readOnly={isSaving}
                            compact
                            inputClassName="text-center font-bold tabular-nums"
                        />
                        {isSaving && <Loader2 size={10} className="animate-spin text-brand-text shrink-0" />}
                        {!isSaving && isSaved && <Check size={10} className="text-success shrink-0" />}
                        <Button icon={RotateCcw} disabled={isSaving} title="Restaurar MIN/MAX original" onClick={() => restoreMinMax(row)}>Restaurar</Button>
                        <Button variant="destructive" icon={X} disabled={isSaving} title="Dejar en 0/0 — excluye del próximo pedido" onClick={() => resetZero(row)}>0 / 0</Button>
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <>
            <div className="border-t border-divider px-4 py-2.5 bg-surface-card-hover/60 flex items-center gap-5 flex-wrap">
                <span className="text-label text-content-3">Solicitados <strong className="text-content-2">{total}</strong></span>
                <span className="text-label text-content-3">Enviados <strong className="text-success">{enviados.length}</strong></span>
                {agotamiento.length > 0 && <span className="text-label text-content-3">Stock insuficiente <strong className="text-warning-text">{agotamiento.length}</strong></span>}
                {sinStock.length > 0 && <span className="text-label text-content-3">Sin inventario <strong className="text-warning">{sinStock.length}</strong></span>}
                {porRegla.length > 0 && <span className="text-label text-content-3">Revisar regla <strong className="text-danger-text">{porRegla.length}</strong></span>}
            </div>
            <ItemSection label="Productos enviados" count={enviados.length} variante="success" rows={enviados} columns={COLS_ENVIADOS} />
            <ItemSection
                label="Stock insuficiente en bodega" count={agotamiento.length} variante="warning" rows={agotamiento} columns={COLS_AGOTAMIENTO}
                noteEl={<p className="text-caption text-warning-text/80">Bodega tenía stock pero no alcanzó para cubrir la necesidad completa. Se envió lo disponible; el faltante quedará pendiente para el próximo pedido.</p>}
            />
            <ItemSection label="Sin inventario en bodega" count={sinStock.length} variante="warning" rows={sinStock} columns={COLS_SIN_STOCK} noteEl={<p className="text-caption text-warning-text/80">No se incluyeron por falta de stock en bodega al momento del despacho.</p>} />
            <ItemSection
                label="Revisar regla de despacho" count={porRegla.length} variante="danger" rows={porRegla} columns={colsRegla(canEditMinMax)}
                renderRowExtra={renderMinMaxRow}
                noteEl={<div className="flex items-start gap-2 text-caption text-danger-text/80 bg-danger/10 border border-danger/30 rounded-xl px-3 py-2"><ShieldAlert size={12} className="mt-0.5 shrink-0 text-danger" />Estos productos no pudieron despacharse. Puede ser porque la necesidad no alcanzó el mínimo de la regla de despacho, o porque el stock en bodega fue insuficiente tras asignarlo a otras sucursales. Revisa la columna "Motivo"{canEditMinMax ? ' y ajusta los MIN/MAX.' : '.'}</div>}
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
