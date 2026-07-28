import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { createPortal } from 'react-dom';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useAuth } from '../../context/AuthContext';
import {
    Package, FlaskConical, Check, Loader2,
    ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Info,
    Camera, TrendingDown, ShieldAlert, Plus, X, Building2, Tag,
    Sparkles, History, MapPin, Search, Clipboard, Eye, RotateCcw, Ban,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import StatCard from '../../components/common/StatCard';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import PhotoEditorModal from '../../components/common/PhotoEditorModal';
import { normSearch } from '../../utils/searchUtils';
import SrsBuscadorWidget from '../../components/srs/SrsBuscadorWidget';
import SrsEnriquecerModal from '../../components/srs/SrsEnriquecerModal';
import SegmentedControl from '../../components/common/SegmentedControl';
import {
    deleteProductActivePrinciples, insertProductActivePrinciples, updateProductPrincipioActivo,
    updateProductCategoria, insertProductCategory, upsertProductLocations, deleteProductLocations,
    updateProductDevolutivo, updateProductFoto, fetchProductPreciosMarginPage, fetchProductCounts,
    fetchChangelogPage, fetchProductsList, fetchProductChangeAndMarginData, fetchProductDetail,
} from '../../data/productos';


const PRICE_FIELDS = [
    { key: 'vineta',      label: 'Víneta'   },
    { key: 'descuento_1', label: 'Desc. 1'  },
    { key: 'vip',         label: 'VIP'      },
    { key: 'clinica',     label: 'Clínica'  },
    { key: 'mayoreo',     label: 'Mayoreo'  },
    { key: 'premium',     label: 'Premium'  },
    { key: 'precio_7',    label: 'Precio 7' },
];
const PRICE_LEVEL_ORDER = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'];
const PRICE_SELECT = PRICE_FIELDS.map(f => f.key).join(', ');
// premium and precio_7 are excluded from loss/margin checks (external/special price tiers)
const MARGIN_FIELDS = PRICE_FIELDS.filter(f => f.key !== 'precio_7' && f.key !== 'premium');
// only premium gets the special loss badge (precio_7 is fully excluded from all checks)
const SPECIAL_LOSS_FIELDS = PRICE_FIELDS.filter(f => f.key === 'premium');
// internal FK fields that should never appear in the changelog UI
const CHANGELOG_HIDDEN = new Set(['laboratorio_id']);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtP(v) {
    if (v == null || v === '' || parseFloat(v) === 0) return '—';
    return `$${parseFloat(v).toFixed(2)}`;
}

function calcMargin(price, costo) {
    const p = parseFloat(price), c = parseFloat(costo);
    if (!p || !c || p <= 0 || c <= 0) return null;
    return (p - c) / p * 100;
}

function allMargins(pp, fields = PRICE_FIELDS) {
    const costo = parseFloat(pp.costo);
    if (!costo || costo <= 0) return {};
    const out = {};
    fields.forEach(f => {
        const price = parseFloat(pp[f.key]);
        if (price > 0) out[f.key] = (price - costo) / price * 100;
    });
    return out;
}

function worstMarginOf(pp, fields = PRICE_FIELDS) {
    const vals = Object.values(allMargins(pp, fields));
    return vals.length ? Math.min(...vals) : null;
}

// Returns which special fields (premium, precio_7) have a loss for a single precio row
function specialLossKeys(pp) {
    const costo = parseFloat(pp.costo);
    if (!costo || costo <= 0) return [];
    return SPECIAL_LOSS_FIELDS
        .filter(f => { const p = parseFloat(pp[f.key]); return p > 0 && p < costo; })
        .map(f => f.key);
}

// Returns human-readable label for a special loss key
function specialLossLabel(key) {
    return key === 'premium' ? 'Premium' : 'Precio 7';
}

function marginLabel(m) {
    if (m === null) return null;
    if (m < 0)  return { label: 'Pérdida',     cls: 'bg-danger/10 text-danger-text border-danger/30'      };
    if (m < 15) return { label: 'Margen bajo',  cls: 'bg-warning/10 text-warning-text border-warning/30' };
    return null;
}

// ── MarginPct ─────────────────────────────────────────────────────────────────

function MarginPct({ pct }) {
    if (pct === null) return <span className="text-micro text-content-3">—</span>;
    const cls = pct < 0 ? 'text-danger' : pct < 15 ? 'text-warning' : 'text-success';
    return <span className={`text-micro font-bold tabular-nums ${cls}`}>{pct.toFixed(1)}%</span>;
}

// ── MarginStatCards ───────────────────────────────────────────────────────────

function MarginStatCards({ stats, loading, filterMargin, onFilter, productStats, productStatsLoading, filterNuevos, onFilterNuevos, filterModificados, onFilterModificados, modificadosStats, modificadosLoading }) {
    const perdidaCount = stats?.perdidaIds?.size ?? 0;
    const bajoCount    = stats?.bajoIds?.size    ?? 0;

    // Neutral card (info only, not clickable filter)
    const infoCard = 'bg-surface-card border-border-card backdrop-blur-sm shadow-sm';

    const statText   = 'text-content-2';
    const statLabel  = 'text-content-2';
    const statSub    = 'text-content-3';
    const statIconBg = 'bg-chart-1/10';
    const divider    = 'bg-surface-card-hover';

    const filterCardDef = [
        {
            id: 'perdida',
            Icon: ShieldAlert,
            label: 'Con pérdida',
            sub: 'precio < costo',
            count: perdidaCount,
            activeBg: 'bg-danger/10 border-danger/40 shadow-red-100/80',
            inactiveBg: 'bg-surface-card border-divider hover:border-danger/30 hover:bg-danger/10',
            iconBg: filterMargin === 'perdida'
                ? 'bg-surface-card'
                : 'bg-danger/10',
            iconColor: 'text-danger',
            countColor: perdidaCount > 0
                ? 'text-danger'
                : 'text-content-3',
        },
        {
            id: 'bajo',
            Icon: TrendingDown,
            label: 'Margen bajo',
            sub: '< 15% en algún precio',
            count: bajoCount,
            activeBg: 'bg-warning/10 border-warning/40 shadow-amber-100/80',
            inactiveBg: 'bg-surface-card border-divider hover:border-warning/30 hover:bg-warning/10',
            iconBg: filterMargin === 'bajo'
                ? 'bg-surface-card'
                : 'bg-warning/10',
            iconColor: 'text-warning',
            countColor: bajoCount > 0
                ? 'text-warning'
                : 'text-content-3',
        },
    ];

    // Nuevos card
    const nuevosBg = filterNuevos
        ? 'bg-success/10 border-success/50 shadow-md shadow-success/20 -translate-y-px'
        : 'bg-surface-card border-border-card hover:border-success/30 hover:bg-success/10';

    const nuevosIconBg = filterNuevos
        ? 'bg-surface-card'
        : 'bg-success/10';

    return (
        <div className="flex gap-3 flex-wrap">
            {/* Info card — total */}
            <div className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[140px] ${infoCard}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${statIconBg}`}>
                    <Package size={15} className={'text-brand-text'} />
                </div>
                <div className="text-left min-w-0">
                    <div className={`text-title-lg font-black leading-none tabular-nums ${statText}`}>
                        {productStatsLoading ? <span className={'text-content-3'}>–</span> : (productStats?.activos ?? 0).toLocaleString()}
                    </div>
                    <div className={`text-caption font-bold leading-tight ${statLabel}`}>Productos activos</div>
                    {!productStatsLoading && (productStats?.inactivos ?? 0) > 0 && (
                        <div className={`text-micro tabular-nums ${statSub}`}>
                            {(productStats.inactivos).toLocaleString()} inactivos
                        </div>
                    )}
                </div>
            </div>

            {/* §16.x — estas tarjetas de métrica eran la misma anatomía escrita
                a mano. `StatCard` ya la tenía, con la × al estar activa incluida. */}
            <StatCard
                icon={Sparkles} iconBg={nuevosIconBg} iconCls="text-success"
                label="Nuevos este mes"
                sub={`agregados en ${new Date().toLocaleDateString('es-SV', { month: 'long' })}`}
                value={productStatsLoading ? '–' : (productStats?.nuevos ?? 0).toLocaleString()}
                valueCls="text-success"
                active={filterNuevos} inactiveBg={nuevosBg}
                activeBg={nuevosBg}
                loading={productStatsLoading}
                onClick={onFilterNuevos}
            />

            <StatCard
                icon={History} iconBg={filterModificados ? 'bg-surface-card' : 'bg-warning/10'} iconCls="text-warning"
                label="Modificados este mes" sub="precios o datos cambiados"
                value={modificadosLoading ? '–' : (modificadosStats?.count ?? 0).toLocaleString()}
                valueCls={(modificadosStats?.count ?? 0) > 0 ? 'text-warning' : 'text-content-3'}
                active={filterModificados}
                activeBg="bg-warning/10 border-warning/40 shadow-md"
                loading={modificadosLoading}
                onClick={onFilterModificados}
            />

            {/* Divider */}
            <div className={`w-px h-14 self-center hidden sm:block ${divider}`} />

            {/* Filter cards */}
            {filterCardDef.map(c => {
                const active = filterMargin === c.id;
                return (
                    <StatCard key={c.id}
                        icon={c.Icon} iconBg={c.iconBg} iconCls={c.iconColor}
                        label={c.label} sub={c.sub}
                        value={loading ? '–' : c.count.toLocaleString()} valueCls={c.countColor}
                        active={active}
                        activeBg={`${c.activeBg} shadow-md`} inactiveBg={c.inactiveBg}
                        loading={loading}
                        onClick={() => onFilter(c.id)}
                    />
                );
            })}
        </div>
    );
}


// ── PrincipiosEditor ──────────────────────────────────────────────────────────

const PA_PRESETS = ['Insumo', 'No aplica'];

const PrincipiosEditor = forwardRef(function PrincipiosEditor({ productId, initial, onSaved }, ref) {
    const [items, setItems] = useState([]);
    const [preset, setPreset] = useState(null); // null | 'Insumo' | 'No aplica'
    const [savingPA, setSavingPA] = useState(false);
    const skipNextAutosave = useRef(true);

    useEffect(() => {
        skipNextAutosave.current = true;
        if (initial && initial.length > 0) {
            const first = initial[0]?.nombre;
            if (PA_PRESETS.includes(first) && initial.length === 1 && !initial[0]?.concentracion) {
                setPreset(first);
                setItems([]);
            } else {
                setPreset(null);
                setItems(initial.map((p, i) => ({ ...p, _key: p.id ?? i })));
            }
        } else {
            setPreset(null);
            setItems([{ nombre: '', concentracion: '', orden: 0, _key: 0 }]);
        }
    }, [initial]);

    const selectPreset = (p) => {
        if (preset === p) {
            setPreset(null);
            setItems([{ nombre: '', concentracion: '', orden: 0, _key: Date.now() }]);
        } else {
            setPreset(p);
            setItems([]);
        }
    };

    const addItem = () =>
        setItems(prev => [...prev, { nombre: '', concentracion: '', orden: prev.length, _key: Date.now() }]);
    const removeItem = key =>
        setItems(prev => prev.length > 1 ? prev.filter(p => p._key !== key) : [{ nombre: '', concentracion: '', orden: 0, _key: Date.now() }]);
    const updateItem = (key, field, value) =>
        setItems(prev => prev.map(p => p._key === key ? { ...p, [field]: value } : p));

    const save = async ({ quiet = false } = {}) => {
        setSavingPA(true);
        try {
            await deleteProductActivePrinciples(productId);
            let text = null;
            let saved = [];
            if (preset) {
                await insertProductActivePrinciples([{
                    product_id: productId, nombre: preset, concentracion: null, orden: 0,
                }]);
                text = preset;
                saved = [{ nombre: preset }];
            } else {
                const toSave = items.filter(p => p.nombre.trim());
                if (toSave.length > 0) {
                    await insertProductActivePrinciples(
                        toSave.map((p, i) => ({
                            product_id:    productId,
                            nombre:        p.nombre.trim(),
                            concentracion: p.concentracion?.trim() || null,
                            orden:         i,
                        }))
                    );
                    text = toSave.map(p => [p.nombre.trim(), p.concentracion?.trim()].filter(Boolean).join(' ')).join(', ');
                }
                saved = toSave;
            }
            await updateProductPrincipioActivo(productId, text);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_PRINCIPLES', String(productId), { count: saved.length });
            if (!quiet) useToastStore.getState().showToast('Guardado', 'Principios activos actualizados.', 'success');
            if (onSaved) onSaved(saved, text || null);
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
            throw e;
        } finally {
            setSavingPA(false);
        }
    };

    // Autosave: persist automatically shortly after items/preset settle (no explicit Guardar).
    useEffect(() => {
        if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }
        const t = setTimeout(() => { save({ quiet: true }); }, 700);
        return () => clearTimeout(t);
    }, [items, preset]); // eslint-disable-line react-hooks/exhaustive-deps

    useImperativeHandle(ref, () => ({ save }));

 const inp = 'bg-surface-card-hover border-divider text-content-2 placeholder:text-content-3';
    const numCls = 'text-content-3';
    const rmBtn  = 'text-content-3 hover:text-danger hover:bg-danger/10';
    const addCls = 'text-content-3 hover:text-brand-text';

    // `presetChipBase/On/Off` vivían acá: el riel de `SegmentedControl` escrito
    // a mano. Se fueron con los chips (2026-07-28).

    return (
        <div className="space-y-2">
            <SegmentedControl
                size="sm"
                label="Presentación sugerida"
                value={preset}
                onChange={selectPreset}
                options={PA_PRESETS.map(p => ({ value: p, label: p }))}
            />

            {/* Input list — hidden when a preset is active */}
            {!preset && (
                <>
                    {items.map((item, idx) => (
                        <div key={item._key} className="flex items-center gap-1.5">
                            <span className={`text-micro font-bold w-3 text-right shrink-0 ${numCls}`}>{idx + 1}</span>
                            <input
                                value={item.nombre}
                                onChange={e => updateItem(item._key, 'nombre', e.target.value)}
                                placeholder="Nombre del principio"
 className={`flex-1 min-w-0 px-2 py-1.5 border rounded-lg text-body-xl transition-colors ${inp}`}
                            />
                            <input
                                value={item.concentracion || ''}
                                onChange={e => updateItem(item._key, 'concentracion', e.target.value)}
                                placeholder="Cant."
 className={`w-[58px] shrink-0 px-2 py-1.5 border rounded-lg text-body-xl text-center transition-colors ${inp}`}
                            />
                            <Button variant="ghost" size="xs" icon={X} iconOnly className={rmBtn} onClick={() => removeItem(item._key)} />
                        </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                        <Button variant="ghost" icon={Plus} className={addCls} onClick={addItem}>Agregar principio</Button>
                        {savingPA && (
                            <span className="flex items-center gap-1 text-micro font-semibold text-content-3">
                                <Loader2 size={9} className="animate-spin" /> Guardando…
                            </span>
                        )}
                    </div>
                </>
            )}
        </div>
    );
});

// ── CategoryEditor ────────────────────────────────────────────────────────

const CategoryEditor = forwardRef(function CategoryEditor({ productId, initial, categories, onCategoryCreated, onCategoryUpdated }, ref) {
    const [selected, setSelected] = useState(initial || '');
    const [savingCat, setSavingCat] = useState(false);
    const skipNextAutosave = useRef(true);

    useEffect(() => { skipNextAutosave.current = true; setSelected(initial || ''); }, [initial]);

    const catOpts = categories.map(c => ({ value: c, label: c }));

    const save = async ({ quiet = false } = {}) => {
        setSavingCat(true);
        try {
            await updateProductCategoria(productId, selected);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_CATEGORY', String(productId), { categoria: selected || null });
            if (!quiet) useToastStore.getState().showToast('Guardado', 'Categoría actualizada.', 'success');
            onCategoryUpdated?.(productId, selected || null);
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
            throw e;
        } finally {
            setSavingCat(false);
        }
    };

    // Autosave: persist immediately whenever the selection changes (no explicit Guardar).
    useEffect(() => {
        if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }
        save({ quiet: true });
    }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreate = async (nombre) => {
        try {
            await insertProductCategory(nombre);
            setSelected(nombre);
            if (onCategoryCreated) onCategoryCreated(nombre);
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        }
    };

    useImperativeHandle(ref, () => ({ save, getValue: () => selected }));

    return (
        <div>
            <LiquidSelect
                value={selected}
                onChange={setSelected}
                options={catOpts}
                placeholder="Sin categoría"
                icon={Tag}
                creatable
                onCreateOption={handleCreate}
            />
            {savingCat && (
                <span className="flex items-center gap-1 text-micro font-semibold text-content-3 mt-1.5">
                    <Loader2 size={9} className="animate-spin" /> Guardando…
                </span>
            )}
        </div>
    );
});

// ── LocationGrid ──────────────────────────────────────────────────────────────

const LocationGrid = forwardRef(function LocationGrid({ productId, initial, branches }, ref) {
    const [locs, setLocs] = useState([]);

    useEffect(() => {
        if (!branches) return;
        const farm = branches.filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));
        setLocs(farm.map(b => { // eslint-disable-line react-hooks/set-state-in-effect -- deriva la grilla de ubicaciones desde branches/initial
            const saved = (initial || []).find(l => l.branch_id === b.id);
            return {
                branch_id:      b.id,
                branch_name:    b.name,
                branch_type:    b.type,
                // Sala de ventas
                tipo:           saved?.estante ? 'estante' : 'vitrina',
                numero:         saved?.estante || saved?.vitrina || '',
                peldano:        saved?.peldano || '',
                // Bodega interna
                bodega_numero:  saved?.bodega_numero  || '',
                bodega_peldano: saved?.bodega_peldano || '',
                // Active view (UI only)
                view: 'sala',
            };
        }));
    }, [initial, branches]);

    const setField = (i, field, value) =>
        setLocs(ls => ls.map((l, j) => j === i ? { ...l, [field]: value } : l));

    const hasAnyData = l =>
        l.numero.trim() || l.peldano.trim() || l.bodega_numero.trim() || l.bodega_peldano.trim();

    const save = async ({ quiet = false } = {}) => {
        try {
            const toUpsert = locs.filter(hasAnyData).map(l => ({
                product_id:     productId,
                branch_id:      l.branch_id,
                vitrina:        l.tipo === 'vitrina' ? (l.numero.trim() || null) : null,
                estante:        l.tipo === 'estante' ? (l.numero.trim() || null) : null,
                peldano:        l.peldano.trim()        || null,
                bodega_numero:  l.bodega_numero.trim()  || null,
                bodega_peldano: l.bodega_peldano.trim() || null,
                updated_at:     new Date().toISOString(),
            }));
            const toDelete = locs.filter(l => !hasAnyData(l)).map(l => l.branch_id);
            if (toUpsert.length > 0)
                await upsertProductLocations(toUpsert);
            if (toDelete.length > 0)
                await deleteProductLocations(productId, toDelete);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_LOCATIONS', String(productId), { branches: toUpsert.length });
            if (!quiet) useToastStore.getState().showToast('Guardado', 'Ubicaciones actualizadas.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
            throw e;
        }
    };

    useImperativeHandle(ref, () => ({ save }));


    if (!locs.length) return (
        <p className={`text-label italic ${'text-content-3'}`}>Sin sucursales.</p>
    );

    const labelCls = 'text-content-3';


    const inp = (sala) =>
 `bg-surface-card-hover text-content-2 font-bold ${sala ? 'border-divider' : 'border-warning/30'}`;

    return (
        <div className="space-y-2">
            {locs.map((loc, i) => {
                const isSala       = loc.view === 'sala';
                const isMainBodega = loc.branch_type === 'BODEGA';
                const hasSala      = loc.numero.trim() || loc.peldano.trim();
                const hasBodega    = loc.bodega_numero.trim() || loc.bodega_peldano.trim();
                const hasData      = hasSala || hasBodega;

                const rowBg =
                    hasData ? 'bg-chart-1/10 border-chart-1/30' : 'bg-surface-card-hover border-divider';

                return (
                    <div key={loc.branch_id} className={`rounded-xl border px-3.5 py-2.5 transition-colors ${rowBg}`}>
                        {/* Header: branch name + view toggle */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className={`text-label font-black ${'text-content-2'}`}>{loc.branch_name}</span>
                                <Badge variant={loc.branch_type === 'BODEGA' ? 'warning' : 'chart-1'} size="sm">
                                    {loc.branch_type === 'BODEGA' ? 'Bodega' : 'Farmacia'}
                                </Badge>
                                {hasSala && !hasBodega && <span className={`text-micro ${'text-chart-1-text'}`}>Sala</span>}
                                {hasBodega && !hasSala && <span className={`text-micro ${'text-warning'}`}>Bodega int.</span>}
                                {hasSala && hasBodega && <span className={`text-micro ${'text-success'}`}>Sala + Bodega</span>}
                            </div>
                            {!isMainBodega && (
                                <SegmentedControl
                                    size="sm" tone="chart-9"
                                    options={[{ value: 'sala', label: 'Sala' }, { value: 'bodega', label: 'Bodega int.', tone: 'warning' }]}
                                    value={isSala ? 'sala' : 'bodega'}
                                    onChange={v => setField(i, 'view', v)} label="Vista de ubicación" />
                            )}
                        </div>

                        {/* Inputs */}
                        <div className="flex items-end gap-3">
                            {isSala && (
                                <div className={`flex rounded-lg p-0.5 gap-0.5 self-start mt-0.5 ${'bg-surface-card-hover'}`}>
                                    <SegmentedControl
                                        size="sm" tone="chart-9"
                                        options={[{ value: 'vitrina', label: 'Vit.' }, { value: 'estante', label: 'Est.' }]}
                                        value={loc.tipo} onChange={v => setField(i, 'tipo', v)}
                                        label="Tipo de ubicación" className="self-start mt-0.5" />
                                </div>
                            )}
                            {!isSala && !isMainBodega && (
                                <span className={`text-micro font-bold self-center ${'text-warning'}`}>Bodega interna</span>
                            )}
                            {isMainBodega && (
                                <span className={`text-micro font-bold self-center ${'text-warning'}`}>Bodega principal</span>
                            )}
                            <div className="flex gap-2 flex-1">
                                <div className="flex-1">
                                    <p className={`text-micro font-semibold mb-1 ${labelCls}`}>N°</p>
                                    <input
                                        value={isSala ? loc.numero : loc.bodega_numero}
                                        onChange={e => setField(i, isSala ? 'numero' : 'bodega_numero', e.target.value)}
                                        maxLength={4}
                                        placeholder="—"
                                        className={`w-full px-2 py-1.5 border rounded-lg text-body-xl text-center font-bold transition-colors ${inp(isSala)}`}
                                    />
                                </div>
                                <div className="flex-1">
                                    <p className={`text-micro font-semibold mb-1 ${labelCls}`}>Peldaño</p>
                                    <input
                                        value={isSala ? loc.peldano : loc.bodega_peldano}
                                        onChange={e => setField(i, isSala ? 'peldano' : 'bodega_peldano', e.target.value)}
                                        maxLength={4}
                                        placeholder="—"
                                        className={`w-full px-2 py-1.5 border rounded-lg text-body-xl text-center font-bold transition-colors ${inp(isSala)}`}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

// ── PhotoContextMenu ──────────────────────────────────────────────────────────
// Right-click context menu for photo areas; reads image from clipboard.

function PhotoContextMenu({ pos, onPaste, onClose }) {
    useEffect(() => {
        const close = () => onClose();
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed z-confirm bg-surface-card rounded-xl shadow-xl border border-divider py-1 min-w-[170px] overflow-hidden"
            style={{ top: pos.y, left: pos.x }}
            onMouseDown={e => e.stopPropagation()}>
            <Button variant="secondary" icon={Clipboard} onClick={onPaste}>Pegar imagen
                <span className="ml-auto text-caption text-content-3">Ctrl+V</span></Button>
        </div>,
        document.body
    );
}

// inject lightbox keyframe once
if (typeof document !== 'undefined' && !document.getElementById('lb-style')) {
    const s = document.createElement('style');
    s.id = 'lb-style';
    s.textContent = '@keyframes lightbox-in { from { opacity:0; transform:scale(0.88) } to { opacity:1; transform:scale(1) } }';
    document.head.appendChild(s);
}

function PhotoLightbox({ src, onClose }) {
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return createPortal(
        <div
            className="fixed inset-0 z-flyout flex items-center justify-center"
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', backgroundColor: 'var(--scrim)' }}
            onClick={onClose}>
            <div
                className="relative max-w-[90vw] max-h-[90vh] rounded-3xl overflow-hidden shadow-[var(--shadow-elevation-xl)] ring-1 ring-[var(--border-card)]"
                style={{ animation: 'lightbox-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both' }}
                onClick={e => e.stopPropagation()}>
                <img src={src} alt="" className="block max-w-[90vw] max-h-[90vh] object-contain" />
                <Button icon={X} iconOnly size="md" variant="ghost" onClick={onClose} />
            </div>
        </div>,
        document.body
    );
}

async function pasteImageFromClipboard() {
    if (!navigator.clipboard?.read) return null;
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            for (const type of item.types) {
                if (type.startsWith('image/')) {
                    const blob = await item.getType(type);
                    return new File([blob], 'paste.png', { type });
                }
            }
        }
    } catch { /* Permission denied or no image */ }
    return null;
}

// Resize + compress an image File to a JPEG Blob (max side = maxPx)
function resizeImage(file, maxPx, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const ratio = Math.min(1, maxPx / Math.max(img.width, img.height));
            const w = Math.round(img.width  * ratio);
            const h = Math.round(img.height * ratio);
            const canvas = document.createElement('canvas');
            canvas.width  = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
        img.src = url;
    });
}

// ── Purchase history helpers ──────────────────────────────────────────────────

function classifyFromPurchases(purchases) {
    if (!purchases || purchases.length === 0) return null;
    const today  = new Date();
    const cut60  = new Date(today); cut60.setDate(today.getDate() - 60);
    const cut270 = new Date(today); cut270.setDate(today.getDate() - 270);

    const dates = purchases
        .map(p => new Date(p.purchase_receipts?.fecha))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);

    if (dates.length === 0) return null;

    const firstDate = dates[0];
    const lastDate  = dates[dates.length - 1];

    if (firstDate >= cut60) return 'Nuevo';

    const hasRecent       = lastDate >= cut60;
    const hasIntermediate = dates.some(d => d < cut60 && d >= cut270);

    if (hasRecent && !hasIntermediate) return 'Reentrada';
    if (hasRecent) return 'Regular';
    return null;
}

const CLASIF_STYLE = {
    Nuevo:     { bg: 'bg-success/10 border-success/30 text-success-text', Icon: Sparkles   },
    Reentrada: { bg: 'bg-chart-3/10 border-chart-3/30 text-chart-3-text',   Icon: RotateCcw  },
    Regular:   { bg: 'bg-chart-1/10 border-chart-1/30 text-chart-1-text',         Icon: Package    },
};

function PurchaseHistorySection({ purchases, canSeeCosts = true }) {
    const [showAll, setShowAll] = useState(false);

    if (!canSeeCosts)
        return <p className="text-label text-content-3 italic">Sin permiso para ver costos de compra.</p>;

    if (!purchases || purchases.length === 0)
        return <p className="text-label text-content-3 italic">Sin historial de compras registrado.</p>;

    const clasificacion = classifyFromPurchases(purchases);
    const cs = clasificacion ? CLASIF_STYLE[clasificacion] : null;

    const rows = [...purchases]
        .filter(p => p.purchase_receipts)
        .sort((a, b) => new Date(b.purchase_receipts.fecha) - new Date(a.purchase_receipts.fecha));

    const allDates  = rows.map(r => new Date(r.purchase_receipts.fecha));
    const firstDate = allDates.length ? new Date(Math.min(...allDates)) : null;
    const lastDate  = allDates.length ? new Date(Math.max(...allDates)) : null;

    const visible   = showAll ? rows : rows.slice(0, 8);
    const fmtDate   = d => d ? new Date(d).toLocaleDateString('es-SV', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const fmtCost   = v => v != null && parseFloat(v) > 0 ? `$${parseFloat(v).toFixed(4)}` : '—';

    return (
        <div className="space-y-3">
            {/* Classification badge + summary */}
            <div className="flex items-center gap-3 flex-wrap">
                {cs && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-label font-bold border ${cs.bg}`}>
                        <cs.Icon size={10} /> {clasificacion}
                    </span>
                )}
                <span className="text-caption text-content-3">
                    Primera compra: <span className="font-semibold text-content-2">{fmtDate(firstDate)}</span>
                </span>
                <span className="text-micro text-content-3">·</span>
                <span className="text-caption text-content-3">
                    Última: <span className="font-semibold text-content-2">{fmtDate(lastDate)}</span>
                </span>
                <span className="text-micro text-content-3">·</span>
                <span className="text-caption text-content-3">
                    <span className="font-semibold text-content-2">{rows.length}</span> compra{rows.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Cost history table */}
            <div className="overflow-x-auto rounded-xl border border-divider shadow-sm">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="bg-surface-card-hover/80 border-b border-divider">
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-left text-content-2">Fecha</th>
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-left text-content-2">Proveedor</th>
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-center text-content-2">Cant.</th>
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-right text-content-2">Costo unit.</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                        {visible.map((row, i) => (
                            <tr key={i} className="hover:bg-surface-card-hover/40 transition-colors">
                                <td className="px-3 py-2 text-label text-content-2 whitespace-nowrap">
                                    {fmtDate(row.purchase_receipts?.fecha)}
                                </td>
                                <td className="px-3 py-2 text-label text-content-2 max-w-[180px] truncate">
                                    {row.purchase_receipts?.proveedor || '—'}
                                </td>
                                <td className="px-3 py-2 text-label text-content-2 text-center tabular-nums">
                                    {parseFloat(row.cantidad || 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-body-sm font-semibold text-content-2 text-right tabular-nums">
                                    {fmtCost(row.precio_unitario)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {rows.length > 8 && (
                <Button variant="ghost" onClick={() => setShowAll(v => !v)}>{showAll ? 'Ver menos' : `Ver ${rows.length - 8} compra${rows.length - 8 !== 1 ? 's' : ''} anterior${rows.length - 8 !== 1 ? 'es' : ''}`}</Button>
            )}
        </div>
    );
}

// 7B.6 — historial de precios vigentes (SCD2, distinto del changelog
// campo-a-campo de arriba). product_precios_history acumula una fila por
// corrida del sync aunque el precio no cambie (write-churn preexistente,
// fuera de alcance del changelog) — se colapsan acá los snapshots
// consecutivos idénticos por presentación, solo se muestran cambios reales.
function PriceHistorySection({ history, allowedPriceFields }) {
    const [showAll, setShowAll] = useState(false);

    const deduped = useMemo(() => {
        const out = [];
        const lastByPres = {};
        for (const r of (history || [])) {
            const key = r.id_presentacion;
            const snap = JSON.stringify([r.vineta, r.descuento_1, r.vip, r.clinica, r.mayoreo, r.premium, r.precio_7]);
            if (lastByPres[key] !== snap) { out.push(r); lastByPres[key] = snap; }
        }
        return out.sort((a, b) => new Date(b.valid_from) - new Date(a.valid_from));
    }, [history]);

    if (deduped.length === 0)
        return <p className="text-label text-content-3 italic">Sin historial de precios registrado.</p>;

    const fmtDate = d => d ? new Date(d).toLocaleDateString('es-SV', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const visible = showAll ? deduped : deduped.slice(0, 8);

    return (
        <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-divider shadow-sm">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="bg-surface-card-hover/80 border-b border-divider">
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-left text-content-2">Fecha</th>
                            <th className="px-3 py-2 text-micro font-black uppercase tracking-wider text-left text-content-2">Presentación</th>
                            {allowedPriceFields.map(f => (
                                <th key={f.key} className="px-3 py-2 text-micro font-black uppercase tracking-wider text-right text-content-2">{f.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                        {visible.map((row, i) => (
                            <tr key={row.id_presentacion + '-' + row.valid_from + '-' + i} className="hover:bg-surface-card-hover/40 transition-colors">
                                <td className="px-3 py-2 text-label text-content-2 whitespace-nowrap">{fmtDate(row.valid_from)}</td>
                                <td className="px-3 py-2 text-label text-content-2">{row.presentaciones?.tipo || '—'}</td>
                                {allowedPriceFields.map(f => (
                                    <td key={f.key} className="px-3 py-2 text-body-sm font-semibold text-content-2 text-right tabular-nums">{fmtP(row[f.key])}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {deduped.length > 8 && (
                <Button variant="ghost" onClick={() => setShowAll(v => !v)}>{showAll ? 'Ver menos' : `Ver ${deduped.length - 8} cambio${deduped.length - 8 !== 1 ? 's' : ''} anterior${deduped.length - 8 !== 1 ? 'es' : ''}`}</Button>
            )}
        </div>
    );
}

// ── ExpandedProductRow ────────────────────────────────────────────────────────

function ExpandedProductRow({ product, data, loadingRow, onPhotoUpdated, onPrinciplesUpdated, onCategoryUpdated, onClose, categories, onCategoryCreated }) {
    const { maxPriceLevel, hasPermission } = useAuth();
    const canSeeCosts = hasPermission('productos_tab_catalogo_costos');

    // ── Expanded-row theme tokens ────────────────────────────────────────────
    const xk = {
        // `via-white` (blanco puro, sin alpha) y el hex crudo #EEF4FF eran los
        // dos únicos stops de esta familia que no pasaban por tokens — se
        // alinean con las otras 4 copias de la fila expandida (v2.62.4).
        container: 'bg-gradient-to-br from-chart-1/10 via-[var(--row-expand-sheen)] to-divider border-t border-brand/[0.12]',
        loadingRow: 'bg-gradient-to-br from-chart-1/10 via-[var(--row-expand-sheen)] to-divider border-t border-chart-1/30',
        loadingText: 'text-content-3',
        alertDanger: 'bg-danger/10 border-danger/30 text-danger-text',
        alertWarning: 'bg-warning/10 border-warning/30 text-warning-text',
        sectionLabel: 'text-caption font-black uppercase tracking-widest text-content-2',
        photoBtn: 'border-divider hover:border-brand/50 bg-surface-card-hover/70 hover:bg-chart-1/10',
        photoSubText: 'text-content-3',
        photoUploadIcon: 'text-content-3 group-hover:text-brand-text',
        photoUploadLabel: 'text-content-3 group-hover:text-brand-text',
        changesBadge: 'bg-warning/10 text-warning-text border-warning/30',
        emptyPresentaciones: 'bg-surface-card-hover border-divider text-content-3',
        pricingWrapper: 'bg-surface-card border-divider shadow-sm',
        pricingThead: 'bg-brand/[0.05] border-b border-brand/[0.08]',
        pricingThText: 'text-content-3',
        pricingDivide: 'divide-y divide-divider',
        pricingRowChanged: 'bg-warning/10',
        pricingRowLoss: 'bg-danger/10',
        pricingRowNormal: 'bg-surface-card',
        pricingCellChanged: 'bg-warning/10',
        pricingValueChanged: 'text-warning-text',
        pricingValueNormal: 'text-content-2',
        pricingOldValue: 'text-content-3',
        pricingFactor: 'text-content-3',
        pricingCosto: 'text-content-3',
        changelog: 'bg-warning/10 border border-warning/30',
        changelogDate: 'bg-surface-card border-divider text-content-3',
        changelogField: 'text-content-2',
        changelogOld: 'text-content-3',
        changelogArrow: 'text-content-3',
        changelogNew: 'text-content',
        sinCambios: 'text-content-3 italic',
        divider: 'border-divider',
        vertDivider: 'bg-surface-card-hover',
        btnCancel: 'bg-surface-card border-divider text-content-3 hover:border-divider hover:text-content-2',
        srsBtnInactive: 'bg-surface-card-hover text-content-3 border-divider hover:bg-chart-3/10 hover:text-chart-3-text hover:border-chart-3/30',
        srsBtnActive: 'bg-chart-3/10 text-chart-3-text border-chart-3/30',
        srsDivider: 'border-divider',
    };

    const allowedPriceFields = useMemo(() => {
        if (!maxPriceLevel) return PRICE_FIELDS;
        const maxIdx = PRICE_LEVEL_ORDER.indexOf(maxPriceLevel);
        if (maxIdx === -1) return PRICE_FIELDS;
        return PRICE_FIELDS.filter(f => PRICE_LEVEL_ORDER.indexOf(f.key) <= maxIdx);
    }, [maxPriceLevel]);
    const marginCheckFields = useMemo(() => allowedPriceFields.filter(f => f.key !== 'precio_7' && f.key !== 'premium'), [allowedPriceFields]);

    const [photoLoading, setPhotoLoading] = useState(false);
    const [localFoto, setLocalFoto]       = useState(product.foto_url);
    const [pendingFile, setPendingFile]   = useState(null);
    const [showSrs, setShowSrs]           = useState(false);
    const [ctxMenu, setCtxMenu]           = useState(null);
    const [showInactive, setShowInactive] = useState(false);
    const [lightboxSrc, setLightboxSrc]   = useState(null);
    const [showAllLog, setShowAllLog]     = useState(false);
    const [devolutivo, setDevolutivo]           = useState(!!product.devolutivo);
    const [savingDevolutivo, setSavingDevolutivo] = useState(false);
    const fileRef       = useRef(null);

    useEffect(() => { setDevolutivo(!!product.devolutivo); }, [product.devolutivo]);

    const toggleDevolutivo = async () => {
        if (savingDevolutivo) return;
        setSavingDevolutivo(true);
        const newVal = !devolutivo;
        const { error } = await updateProductDevolutivo(product.id, newVal);
        if (error) {
            useToastStore.getState().showToast('Error', error.message, 'error');
        } else {
            setDevolutivo(newVal);
            useStaff.getState().appendAuditLog('PRODUCTO_DEVOLUTIVO', String(product.id), { producto: product.nombre, devolutivo: newVal });
        }
        setSavingDevolutivo(false);
    };

    useEffect(() => { setLocalFoto(product.foto_url); }, [product.foto_url]);

    useEffect(() => {
        const onPaste = (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) { setPendingFile(f); break; } }
            }
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, []);

    const handlePhotoContextMenu = (e) => { e.preventDefault(); setCtxMenu({ x: e.clientX + 2, y: e.clientY + 2 }); };
    const handlePasteFromMenu = async () => { setCtxMenu(null); const f = await pasteImageFromClipboard(); if (f) setPendingFile(f); };

    const handlePhotoSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPendingFile(file);
        e.target.value = '';
    };

    const handlePhotoConfirm = async (blob) => {
        setPendingFile(null);
        setPhotoLoading(true);
        try {
            const resized = await resizeImage(blob, 800, 0.85);
            const path = `${product.id}.jpg`;
            const { error: upErr } = await supabase.storage.from('product-photos').upload(path, resized, { upsert: true, contentType: 'image/jpeg' });
            if (upErr) throw upErr;
            const { data: { publicUrl } } = supabase.storage.from('product-photos').getPublicUrl(path);
            const cacheBust = `${publicUrl}?t=${Date.now()}`;
            await updateProductFoto(product.id, cacheBust);
            setLocalFoto(cacheBust);
            onPhotoUpdated(product.id, cacheBust);
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally { setPhotoLoading(false); }
    };

    if (loadingRow) {
        return (
            <tr className={xk.loadingRow}>
                <td colSpan={5} className="px-5 py-4">
                    <div className={`flex items-center gap-2 text-label ${xk.loadingText}`}>
                        <Loader2 size={12} className="animate-spin text-chart-1-text" /> Cargando detalle…
                    </div>
                </td>
            </tr>
        );
    }

    const changesMap = {};
    (data?.changelog || []).forEach(c => {
        if (!changesMap[c.id_presentacion]) changesMap[c.id_presentacion] = {};
        const ex = changesMap[c.id_presentacion][c.campo];
        if (!ex || new Date(c.detected_at) > new Date(ex.detected_at))
            changesMap[c.id_presentacion][c.campo] = { anterior: c.valor_anterior, detected_at: c.detected_at };
    });

    const precios    = data?.precios    || [];
    const prodLog    = (data?.prodLog || []).filter(c =>
        !(CHANGELOG_HIDDEN.has(c.campo) && !c.valor_anterior)
    );
    const principles = data?.principles || [];
    const hasChanges = Object.keys(changesMap).length > 0 || prodLog.length > 0;

    const inactiveCount  = precios.filter(pp => pp.activo === false).length;
    const visiblePrecios = showInactive ? precios : precios.filter(pp => pp.activo !== false);

    const _now1 = new Date();
    const _startOfMonth1 = new Date(_now1.getFullYear(), _now1.getMonth(), 1);
    const thisMonthLog1 = prodLog.filter(c => new Date(c.detected_at) >= _startOfMonth1);
    const olderLog1     = prodLog.filter(c => new Date(c.detected_at) < _startOfMonth1);
    const displayLog1   = showAllLog ? prodLog : (thisMonthLog1.length > 0 ? thisMonthLog1 : prodLog.slice(0, 5));

    const worstOverall = precios.reduce((min, pp) => {
        const w = worstMarginOf(pp, marginCheckFields);
        if (w === null) return min;
        return min === null ? w : Math.min(min, w);
    }, null);

    const specialLossSet = precios.reduce((acc, pp) => {
        specialLossKeys(pp).forEach(k => acc.add(k));
        return acc;
    }, new Set());

    return (
        <>
        <tr className={xk.container}>
            <td colSpan={5} className="px-0 py-0">
                <div className="px-5 py-5 space-y-5">

                    {/* ── Alert banner ── */}
                    {worstOverall !== null && worstOverall < 15 && (
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-label font-medium ${
                            worstOverall < 0 ? xk.alertDanger : xk.alertWarning
                        }`}>
                            {worstOverall < 0
                                ? <ShieldAlert size={14} className="shrink-0 text-danger" />
                                : <AlertTriangle size={13} className="shrink-0 text-warning" />}
                            {worstOverall < 0
                                ? <><strong>Pérdida detectada</strong> — alguna presentación tiene precio de venta por debajo del costo.</>
                                : <><strong>Margen bajo</strong> — alguna presentación tiene margen inferior al 15 %. Estándar farmacéutico: 20–35 %.</>}
                        </div>
                    )}
                    {specialLossSet.size > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-label font-medium bg-chart-4/10 border-chart-4/30 text-chart-4-text">
                            <TrendingDown size={13} className="shrink-0 text-chart-4-text" />
                            <><strong>Pérdida en precio especial</strong> — {[...specialLossSet].map(specialLossLabel).join(' y ')} está por debajo del costo en alguna presentación.</>
                        </div>
                    )}

                    {/* ── Devolutivo / No devolutivo (ND) toggle ── */}
                    {/* Default esperado: Devolutivo (el proveedor acepta devolución). Activar este
                        botón marca la EXCEPCIÓN — el producto NO se puede devolver (ND) — por eso
                        el estado "activado" se resalta en ámbar, no en verde. */}
                    <Button
                        size="sm"
                        aria-pressed={!devolutivo}
                        loading={savingDevolutivo}
                        variant="secondary"
                        tone={!devolutivo ? 'warning' : null}
                        soft
                        icon={!devolutivo ? Ban : RotateCcw}
                        onClick={toggleDevolutivo}
                        title={devolutivo
                            ? 'Este producto SÍ puede devolverse al proveedor antes de vencer. Clic para marcarlo como No Devolutivo (ND).'
                            : 'Este producto NO puede devolverse al proveedor (ND). Clic para marcarlo como Devolutivo.'}
                    >
                        {savingDevolutivo ? <Loader2 size={12} className="animate-spin" /> : !devolutivo ? <Ban size={12} /> : <RotateCcw size={12} />}
                        {!devolutivo ? 'No devolutivo (ND)' : 'Devolutivo'}
                    </Button>

                    {/* ── Main layout: two columns ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">

                        {/* ── LEFT: Foto ── */}
                        <div>
                            <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-1.5`}>
                                <Camera size={9} /> Foto del producto
                            </p>
                            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoSelect} />
                            {pendingFile && (
                                <PhotoEditorModal
                                    file={pendingFile}
                                    onConfirm={handlePhotoConfirm}
                                    onCancel={() => setPendingFile(null)}
                                />
                            )}
                            <button onClick={() => localFoto ? setLightboxSrc(localFoto) : fileRef.current?.click()}
                                onContextMenu={handlePhotoContextMenu}
                                className={`relative w-full h-[200px] max-w-[200px] rounded-2xl border-2 border-dashed overflow-hidden transition-all duration-200 group ${xk.photoBtn}`}>
                                {localFoto ? (
                                    <>
                                        <img src={localFoto} alt="" className="w-full h-full object-contain bg-surface-card p-2" />
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-transparent group-hover:bg-scrim transition-all">
                                            {photoLoading
                                                ? <Loader2 size={22} className="text-white animate-spin" />
                                                : <>
                                                    <Camera size={22} className="text-white opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" />
                                                    <span className="text-caption font-bold text-white opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">Ver foto</span>
                                                </>}
                                        </div>
                                    </>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                                        {photoLoading
                                            ? <Loader2 size={24} className="text-brand-text animate-spin" />
                                            : <>
                                                <Camera size={24} className={`transition-colors ${xk.photoUploadIcon}`} />
                                                <span className={`text-caption font-semibold transition-colors ${xk.photoUploadLabel}`}>Subir foto</span>
                                                <span className={`text-micro ${xk.photoSubText}`}>JPG, PNG o WebP</span>
                                            </>}
                                    </div>
                                )}
                            </button>
                            {localFoto && (
                                <Button variant="ghost" size="xs" className="mt-1.5" onClick={() => fileRef.current?.click()}>Cambiar foto</Button>
                            )}
                        </div>

                        {/* ── RIGHT: Precios ── */}
                        <div className="min-w-0">
                            <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-2`}>
                                Presentaciones y precios
                                {hasChanges && (
                                    <span className={`inline-flex items-center gap-1 text-micro font-bold border px-1.5 py-0.5 rounded-full ${xk.changesBadge}`}>
                                        <AlertTriangle size={8} /> cambios
                                    </span>
                                )}
                            </p>

                            {precios.length === 0 ? (
                                <div className={`flex items-center gap-2 text-label py-3 px-3 rounded-xl border ${xk.emptyPresentaciones}`}>
                                    <Info size={12} className="shrink-0 opacity-60" />
                                    Sin presentaciones en el ERP.
                                </div>
                            ) : (
                                <div className={`overflow-x-auto rounded-xl border ${xk.pricingWrapper}`}>
                                    <table className="min-w-full text-sm">
                                        <thead>
                                            <tr className={xk.pricingThead}>
                                                <th className={`px-3 py-2.5 text-micro font-black uppercase tracking-wider text-left whitespace-nowrap ${xk.pricingThText}`}>Presentación</th>
                                                <th className={`px-3 py-2.5 text-micro font-black uppercase tracking-wider text-center ${xk.pricingThText}`}>Factor</th>
                                                <th className={`px-3 py-2.5 text-micro font-black uppercase tracking-wider text-right ${xk.pricingThText}`}>Costo</th>
                                                {allowedPriceFields.map(f => (
                                                    <th key={f.key} className={`px-3 py-2.5 text-micro font-black uppercase tracking-wider text-right whitespace-nowrap ${xk.pricingThText}`}>{f.label}</th>
                                                ))}
                                                <th className={`px-3 py-2.5 text-micro font-black uppercase tracking-wider text-center ${xk.pricingThText}`}>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody className={xk.pricingDivide}>
                                            {visiblePrecios.map(pp => {
                                                const pCh = changesMap[pp.id_presentacion] || {};
                                                const rowChanged = Object.keys(pCh).length > 0;
                                                const worst = worstMarginOf(pp, marginCheckFields);
                                                return (
                                                    <tr key={pp.id_presentacion} className={
                                                        rowChanged ? xk.pricingRowChanged :
                                                        worst !== null && worst < 0 ? xk.pricingRowLoss :
                                                        xk.pricingRowNormal
                                                    }>
                                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                                            <span className={`text-body-sm font-semibold ${xk.pricingValueNormal}`}>{pp.presentaciones?.tipo || '—'}</span>
                                                            {pp.descripcion && (
                                                                <span className={`text-micro ml-1 ${xk.pricingFactor}`}>{pp.descripcion}</span>
                                                            )}
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-center text-label ${xk.pricingFactor}`}>{pp.factor ?? '—'}</td>
                                                        <td className={`px-3 py-2.5 text-right text-label font-medium ${xk.pricingCosto}`}>{fmtP(pp.costo)}</td>
                                                        {allowedPriceFields.map(f => {
                                                            const ch = pCh[f.key];
                                                            const m  = calcMargin(pp[f.key], pp.costo);
                                                            return (
                                                                <td key={f.key} className={`px-3 py-2.5 text-right ${ch ? xk.pricingCellChanged : ''}`}>
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <span className={`text-body-sm font-semibold ${ch ? xk.pricingValueChanged : xk.pricingValueNormal}`}>
                                                                            {fmtP(pp[f.key])}
                                                                        </span>
                                                                        {ch && (
                                                                            <div className="flex flex-col items-end gap-0.5">
                                                                                <span className={`text-micro line-through whitespace-nowrap ${xk.pricingOldValue}`}>
                                                                                    {fmtP(ch.anterior)}
                                                                                </span>
                                                                                <span className={`text-micro ${'text-content-3'}`}>
                                                                                    {new Date(ch.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        {f.key !== 'precio_7' && <MarginPct pct={m} />}
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="px-3 py-2.5 text-center">
                                                            <Badge variant={pp.activo !== false ? 'success' : 'neutral'} size="sm" uppercase={false}>
                                                                {pp.activo !== false ? 'Activa' : 'Inactiva'}
                                                            </Badge>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {inactiveCount > 0 && (
                                <Button variant="ghost" size="xs" icon={Eye} className="mt-2"
                                    onClick={() => setShowInactive(v => !v)}>
                                    {showInactive ? 'Ocultar inactivas' : `Mostrar ${inactiveCount} inactiva${inactiveCount !== 1 ? 's' : ''}`}
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* ── Categoría | Cambios | Principios activos ── */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">

                        {/* Categoría */}
                        <div>
                            <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-1.5`}>
                                <Tag size={9} /> Categoría
                            </p>
                            <CategoryEditor
                                productId={product.id}
                                initial={product.tipo_medicamento}
                                categories={categories}
                                onCategoryCreated={onCategoryCreated}
                                onCategoryUpdated={onCategoryUpdated}
                            />
                        </div>

                        {/* Cambios en el producto */}
                        <div>
                            <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-1.5`}>
                                <History size={9} /> Cambios en el producto
                            </p>
                            {prodLog.length === 0 ? (
                                <p className={`text-label ${xk.sinCambios}`}>Sin cambios registrados.</p>
                            ) : (
                                <div className={`rounded-xl px-3.5 py-3 space-y-1.5 ${xk.changelog}`}>
                                    {displayLog1.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2 text-label flex-wrap">
                                            <span className={`font-mono text-caption shrink-0 px-1.5 py-0.5 rounded border ${xk.changelogDate}`}>
                                                {new Date(c.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                            </span>
                                            <span className={`font-semibold ${xk.changelogField}`}>{c.campo}</span>
                                            <span className={`line-through text-caption ${xk.changelogOld}`}>{c.valor_anterior || '—'}</span>
                                            <span className={`text-micro font-bold ${xk.changelogArrow}`}>→</span>
                                            <span className={`font-medium ${xk.changelogNew}`}>{c.valor_nuevo || '—'}</span>
                                        </div>
                                    ))}
                                    {olderLog1.length > 0 && (
                                        <Button variant="ghost" size="xs" className="mt-1.5"
                                            onClick={() => setShowAllLog(v => !v)}>
                                            {showAllLog ? 'Ver solo este mes' : `Ver ${olderLog1.length} cambio${olderLog1.length !== 1 ? 's' : ''} anterior${olderLog1.length !== 1 ? 'es' : ''}`}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Principios activos */}
                        <div>
                            <div className="flex items-center justify-between mb-2.5">
                                <p className={`${xk.sectionLabel} flex items-center gap-1.5`}>
                                    <FlaskConical size={9} /> Principios activos
                                </p>
                                {!PA_PRESETS.includes(product.principio_activo) && (
                                    <Button
                                        size="xs"
                                        aria-pressed={showSrs}
                                        variant="secondary"
                                        tone={showSrs ? 'brand' : null}
                                        soft
                                        icon={Search}
                                        onClick={() => setShowSrs(v => !v)}
                                    >
                                        SRS
                                    </Button>
                                )}
                            </div>
                            <PrincipiosEditor
                                productId={product.id}
                                initial={principles}
                                onSaved={(saved, text) => onPrinciplesUpdated(product.id, saved, text)}
                            />
                            {showSrs && !PA_PRESETS.includes(product.principio_activo) && (
                                <div className={`mt-3 border-t ${xk.srsDivider} pt-3`}>
                                    <SrsBuscadorWidget initialQuery={product.nombre} />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Historial de compras ── */}
                    <div>
                        <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-1.5`}>
                            <Package size={9} /> Historial de compras
                        </p>
                        <PurchaseHistorySection purchases={data?.purchases || []} canSeeCosts={canSeeCosts} />
                    </div>

                    {/* ── Historial de precios ── */}
                    <div>
                        <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-1.5`}>
                            <History size={9} /> Historial de precios
                        </p>
                        <PriceHistorySection history={data?.precioHistory || []} allowedPriceFields={allowedPriceFields} />
                    </div>

                    {/* ── Cerrar (todo autoguarda: foto, devolutivo, categoría y principios) ── */}
                    <div className={`border-t ${xk.divider} pt-4 flex items-center justify-end gap-2`}>
                        <Button variant="ghost" size="sm" className={xk.btnCancel} onClick={onClose}>Cerrar</Button>
                    </div>

                </div>
            </td>
        </tr>
        {ctxMenu && <PhotoContextMenu pos={ctxMenu} onPaste={handlePasteFromMenu} onClose={() => setCtxMenu(null)} />}
        {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
        </>
    );
}

// ── TabCatalogo ───────────────────────────────────────────────────────────────

export default function TabCatalogo({
    searchTerm        = '',
    filterActivo      = 'activos',
    setFilterActivo,
    filterLab         = null,
    setFilterLab,
    filterCategoria   = null,
    setFilterCategoria,
    labOptions        = [],
    catOptions        = [],
    onCategoryCreated = null,
}) {
    const { maxPriceLevel, hasPermission } = useAuth();
    const canSeeCosts = hasPermission('productos_tab_catalogo_costos');
    const allowedPriceFields = useMemo(() => {
        if (!maxPriceLevel) return PRICE_FIELDS;
        const maxIdx = PRICE_LEVEL_ORDER.indexOf(maxPriceLevel);
        if (maxIdx === -1) return PRICE_FIELDS;
        return PRICE_FIELDS.filter(f => PRICE_LEVEL_ORDER.indexOf(f.key) <= maxIdx);
    }, [maxPriceLevel]);


    // ── Theme tokens ────────────────────────────────────────────────────────────
    const tk = {
        rowExpanded: 'bg-brand/[0.05]',
        textStrong: 'text-content',
        textMid: 'text-content-3',
        textInactive: 'text-content-3 line-through decoration-content-3',
        avatarBg: 'bg-brand/[0.07]',
        avatarIcon: 'text-brand-text/50',
        filterPill: 'bg-surface-card border-divider shadow-[var(--shadow-glow-brand)]',
        filterDivider: 'bg-surface-card-hover',
        filterBtn: 'text-content-3 hover:text-content-2 hover:bg-surface-card-hover',
        totalText: 'text-content-3',
    };

    const branches = useStaff(s => s.branches);

    const [products, setProducts]     = useState([]);
    const [total, setTotal]           = useState(0);
    const [loading, setLoading]       = useState(false);
    const [loadError, setLoadError]   = useState(null);
    const loadRef = useRef(0);
    const [page, setPage]             = useState(1);
    const [pageSize, setPageSize]     = useState(25);
    const [expandedId, setExpandedId] = useState(null);
    const [expandedCache, setExpandedCache] = useState({});
    const [loadingExpandedId, setLoadingExpandedId] = useState(null);

    // Margin filter (controlled by stat cards in body)
    const [filterMargin, setFilterMargin] = useState('all');
    const [filterNuevos, setFilterNuevos] = useState(false);
    const [filterModificados, setFilterModificados] = useState(false);

    // Modificados stats (products with changelog entries this month)
    const [modificadosStats, setModificadosStats] = useState(null);
    const [modificadosLoading, setModificadosLoading] = useState(false);

    // Sort
    const [sortField, setSortField] = useState('nombre');
    const [sortDir,   setSortDir]   = useState('asc');

    // Per-row indicators
    const [changedIds,      setChangedIds]      = useState(new Set());
    const [marginMap,       setMarginMap]        = useState({});
    // specialLossMap: product_id → Set of keys ('premium', 'precio_7') with price < cost
    const [specialLossMap,  setSpecialLossMap]   = useState({});

    const [showEnriquecer, setShowEnriquecer] = useState(false);

    // Margin stats (loaded once, used for stat cards)
    const [marginStats,       setMarginStats]       = useState(null);
    const [statsLoading,      setStatsLoading]      = useState(false);
    const [productStats,      setProductStats]      = useState(null);
    const [productStatsLoading, setProductStatsLoading] = useState(false);

    // Prefetch
    const prefetchTimerRef = useRef(null);
    const prefetchingRef   = useRef(new Set());

    // ── Load margin stats (re-runs when price level access changes) ────────
    useEffect(() => {
        let cancelled = false;
        setStatsLoading(true);

        const PAGE = 1000;
        const perdidaIds = new Set();
        const bajoIds    = new Set();
        const marginCheckFields = allowedPriceFields.filter(f => f.key !== 'precio_7' && f.key !== 'premium');

        const fetchPage = async (from) => {
            const { data, error } = await fetchProductPreciosMarginPage(PRICE_SELECT, from, PAGE);
            if (cancelled) return;
            if (error || !data) {
                setMarginStats({ perdidaIds, bajoIds });
                setStatsLoading(false);
                return;
            }
            data.forEach(pp => {
                const w = worstMarginOf(pp, marginCheckFields);
                if (w === null) return;
                if (w < 0)  perdidaIds.add(pp.product_id);
                if (w < 15) bajoIds.add(pp.product_id);
            });
            if (data.length === PAGE) {
                await fetchPage(from + PAGE);
            } else {
                setMarginStats({ perdidaIds, bajoIds });
                setStatsLoading(false);
            }
        };

        fetchPage(0).catch(() => {
            if (!cancelled) { setMarginStats({ perdidaIds: new Set(), bajoIds: new Set() }); setStatsLoading(false); }
        });
        return () => { cancelled = true; };
    }, [allowedPriceFields]);

    // ── Load product counts (activos + inactivos + nuevos este mes) ───────────
    useEffect(() => {
        setProductStatsLoading(true);
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        fetchProductCounts(startOfMonth).then(([{ count: activos }, { count: inactivos }, { count: nuevos }]) => {
            setProductStats({ activos: activos ?? 0, inactivos: inactivos ?? 0, nuevos: nuevos ?? 0 });
            setProductStatsLoading(false);
        });
    }, []);

    // ── Load products modified this month (via changelogs) ────────────────
    useEffect(() => {
        let cancelled = false;
        setModificadosLoading(true);
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const PAGE = 1000;
        const ids = new Set();

        const fetchPage = async (table, from) => {
            const isProd = table === 'products_changelog';
            const { data, error } = await fetchChangelogPage(table, isProd, startOfMonth, from, PAGE);
            if (error) throw error;
            if (cancelled) return;
            (data || []).forEach(r => {
                if (isProd && CHANGELOG_HIDDEN.has(r.campo) && !r.valor_anterior) return;
                ids.add(r.product_id);
            });
            if ((data || []).length === PAGE) await fetchPage(table, from + PAGE);
        };

        Promise.all([fetchPage('products_changelog', 0), fetchPage('product_precios_changelog', 0)])
            .then(() => { if (!cancelled) { setModificadosStats({ ids, count: ids.size }); setModificadosLoading(false); } })
            .catch(() => { if (!cancelled) { setModificadosStats({ ids: new Set(), count: 0 }); setModificadosLoading(false); } });

        return () => { cancelled = true; };
    }, []);

    // ── loadProducts ────────────────────────────────────────────────────────
    const loadProducts = useCallback(async (q, pg, ps, fa, bids, lab, cat, sField, sDir, fNuevos, modBids = null) => {
        const rid = ++loadRef.current;
        setLoading(true);
        setLoadError(null);
        try {
            const term = q.trim() ? (normSearch(q) || q.trim()).replace(/,/g, ' ') : null;
            const fNuevosIso = fNuevos
                ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
                : null;

            // Combine margin bids and modificados bids (intersection if both active)
            let effectiveBids = bids;
            if (modBids !== null) {
                if (effectiveBids !== null) {
                    const modSet = new Set(modBids);
                    effectiveBids = effectiveBids.filter(id => modSet.has(id));
                } else {
                    effectiveBids = modBids;
                }
            }
            if (effectiveBids !== null && effectiveBids.length === 0) {
                if (rid === loadRef.current) { setProducts([]); setTotal(0); setLoading(false); }
                return;
            }

            const { data, count, error } = await fetchProductsList({
                search: term, page: pg, pageSize: ps, filterActivo: fa, laboratorioId: lab, categoria: cat,
                filterNuevos: fNuevosIso, effectiveBids, sortField: sField, sortDir: sDir,
            });
            if (rid !== loadRef.current) return;
            if (error) throw error;
            const rows = data || [];
            setProducts(rows);
            setTotal(count || 0);

            if (rows.length > 0) {
                const ids = rows.map(r => r.id);
                const [{ data: pc, error: pcErr }, { data: prc, error: prcErr }, { data: pp, error: ppErr }] = await fetchProductChangeAndMarginData(ids, PRICE_SELECT);
                if (pcErr) throw pcErr;
                if (prcErr) throw prcErr;
                if (ppErr) throw ppErr;
                if (rid !== loadRef.current) return;
                const visiblePrc = (prc || []).filter(c => !(CHANGELOG_HIDDEN.has(c.campo) && !c.valor_anterior));
                setChangedIds(new Set([...(pc || []).map(c => c.product_id), ...visiblePrc.map(c => c.product_id)]));
                const mm  = {};
                const slm = {};
                const marginCheckFields = allowedPriceFields.filter(f => f.key !== 'precio_7' && f.key !== 'premium');
                (pp || []).forEach(row => {
                    const w = worstMarginOf(row, marginCheckFields);
                    if (w !== null && (mm[row.product_id] === undefined || w < mm[row.product_id])) mm[row.product_id] = w;
                    specialLossKeys(row).forEach(k => {
                        if (!slm[row.product_id]) slm[row.product_id] = new Set();
                        slm[row.product_id].add(k);
                    });
                });
                setMarginMap(mm);
                setSpecialLossMap(slm);
            } else {
                setChangedIds(new Set());
                setMarginMap({});
                setSpecialLossMap({});
            }
        } catch (e) {
            if (rid !== loadRef.current) return;
            console.error('loadProducts error:', JSON.stringify(e));
            setLoadError(e?.message || 'Error al cargar productos');
        } finally {
            if (rid === loadRef.current) setLoading(false);
        }
    }, [allowedPriceFields]);

    // Reset page on filter/sort changes
    useEffect(() => { setPage(1); }, [searchTerm, pageSize, filterActivo, filterMargin, filterNuevos, filterModificados, filterLab, filterCategoria, sortField]);

    // Trigger load — normal (no margin filter). marginStats/statsLoading intentionally
    // excluded from deps to prevent reloading the list when stats finish loading.
    useEffect(() => {
        if (filterMargin !== 'all') return;
        if (filterModificados && !modificadosStats) return;
        const modBids = filterModificados ? [...(modificadosStats?.ids ?? [])] : null;
        const t = setTimeout(() =>
            loadProducts(searchTerm, page, pageSize, filterActivo, null, filterLab, filterCategoria, sortField, sortDir, filterNuevos, modBids),
            50
        );
        return () => clearTimeout(t);
    }, [searchTerm, page, pageSize, filterActivo, filterMargin, filterNuevos, filterModificados, modificadosStats, filterLab, filterCategoria, sortField, sortDir, loadProducts]);

    // Trigger load — margin filter active. Waits for stats to be ready.
    useEffect(() => {
        if (filterMargin === 'all') return;
        if (statsLoading || marginStats === null) return;
        if (filterModificados && !modificadosStats) return;
        const bids = filterMargin === 'perdida' ? [...(marginStats.perdidaIds || [])]
                                                : [...(marginStats.bajoIds    || [])];
        const modBids = filterModificados ? [...(modificadosStats?.ids ?? [])] : null;
        const t = setTimeout(() =>
            loadProducts(searchTerm, page, pageSize, filterActivo, bids, filterLab, filterCategoria, sortField, sortDir, filterNuevos, modBids),
            50
        );
        return () => clearTimeout(t);
    }, [searchTerm, page, pageSize, filterActivo, filterMargin, filterNuevos, filterModificados, modificadosStats, marginStats, statsLoading, filterLab, filterCategoria, sortField, sortDir, loadProducts]);

    // ── Sort handler ────────────────────────────────────────────────────────
    const handleSort = useCallback((field) => {
        if (field === sortField) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortField(field); setSortDir('asc'); }
        setPage(1);
    }, [sortField]);

    // ── Prefetch ────────────────────────────────────────────────────────────
    const prefetchRow = useCallback((productId) => {
        if (expandedCache[productId] || prefetchingRef.current.has(productId)) return;
        prefetchTimerRef.current = setTimeout(async () => {
            prefetchingRef.current.add(productId);
            try {
                const results = await fetchProductDetail(productId, PRICE_SELECT, canSeeCosts);
                const firstErr = results.find(r => r.error)?.error;
                if (firstErr) console.error('prefetchRow failed:', firstErr.message);
                const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: principles }, { data: purchases }, { data: precioHistory }] = results;
                setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], principles: principles || [], purchases: purchases || [], precioHistory: precioHistory || [] } }));
            } catch { /* silent */ }
        }, 120);
    }, [expandedCache, canSeeCosts]);

    const cancelPrefetch = useCallback(() => { clearTimeout(prefetchTimerRef.current); }, []);

    const toggleRow = useCallback(async (productId) => {
        cancelPrefetch();
        if (expandedId === productId) { setExpandedId(null); return; }
        setExpandedId(productId);
        if (expandedCache[productId]) return;
        setLoadingExpandedId(productId);
        prefetchingRef.current.add(productId);
        try {
            const results = await fetchProductDetail(productId, PRICE_SELECT, canSeeCosts);
            const firstErr = results.find(r => r.error)?.error;
            if (firstErr) console.error('toggleRow: expand product failed:', firstErr.message);
            const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: principles }, { data: purchases }, { data: precioHistory }] = results;
            setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], principles: principles || [], purchases: purchases || [], precioHistory: precioHistory || [] } }));
        } finally { setLoadingExpandedId(null); }
    }, [expandedId, expandedCache, cancelPrefetch, canSeeCosts]);

    const handlePhotoUpdated = useCallback((productId, url) => {
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, foto_url: url } : p));
    }, []);

    const handlePrinciplesUpdated = useCallback((productId, saved, text) => {
        setExpandedCache(c => ({ ...c, [productId]: { ...(c[productId] || {}), principles: saved } }));
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, principio_activo: text } : p));
    }, []);

    const handleCategoryUpdated = useCallback((productId, cat) => {
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, tipo_medicamento: cat } : p));
    }, []);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const selectedLab = labOptions.find(o => o.value === String(filterLab));
    const labW = selectedLab ? Math.max(185, Math.min(260, 90 + selectedLab.label.length * 7)) : 185;
    const catW = filterCategoria ? Math.max(165, Math.min(220, 90 + filterCategoria.length * 7)) : 165;
    const resetFilters = () => {
        setFilterLab?.(null); setFilterCategoria?.(null); setFilterActivo?.('activos');
    };

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {showEnriquecer && (
                <SrsEnriquecerModal onClose={() => setShowEnriquecer(false)} />
            )}

            {/* ── Stats + filter pill row ──
                Nota: el wrapper de stat cards NO lleva flex-1/min-w-0 a
                propósito — con flex-1 siempre reclama el espacio "sobrante"
                en vez de envolver como bloque cuando no cabe junto al
                cluster de filtros (a 1024px el cluster de filtros ocupa
                ~500px, dejando solo ~330px al wrapper, forzando 1 card por
                fila). Sin flex-1, su ancho preferido hace que flex-wrap del
                padre lo baje a su propia línea completa cuando no cabe —
                corrige 1024×768 sin romper 1440px (auditoría responsive T4,
                2026-07-23). */}
            <div className="flex items-start gap-3 flex-wrap">
                {/* Stat cards */}
                <div className="flex items-center gap-3 flex-wrap">
                    <MarginStatCards
                        stats={marginStats}
                        loading={statsLoading}
                        filterMargin={filterMargin}
                        onFilter={(id) => setFilterMargin(prev => prev === id ? 'all' : id)}
                        productStats={productStats}
                        productStatsLoading={productStatsLoading}
                        filterNuevos={filterNuevos}
                        onFilterNuevos={() => setFilterNuevos(v => !v)}
                        filterModificados={filterModificados}
                        onFilterModificados={() => setFilterModificados(v => !v)}
                        modificadosStats={modificadosStats}
                        modificadosLoading={modificadosLoading}
                    />
                </div>

                {/* §17 — píldora escrita a mano y `hidden lg:flex`: bajo 1024px
                    esta pestaña no tenía ningún filtro ni el botón de SRS.
                    "Activos / Todos" era un uno-de-N escrito a mano dentro de la
                    píldora: es `SegmentedControl`.
                    `ml-auto` y no un espaciador `flex-1`: con el espaciador, al
                    envolver a otra línea se quedaba en la primera y el grupo
                    aparecía a la izquierda. */}
                <div className="flex flex-col items-end gap-2 shrink-0 ml-auto">
                    <FilterBar
                        onClear={resetFilters}
                        activeCount={[filterLab !== null, filterCategoria !== null, filterActivo === 'todos'].filter(Boolean).length}
                    >
                        <FilterBar.Section active={filterActivo === 'todos'}
                            onClear={() => setFilterActivo?.('activos')} label="estado">
                            <SegmentedControl
                                size="sm"
                                tone="success"
                                label="Estado del producto"
                                value={filterActivo}
                                onChange={v => setFilterActivo?.(v)}
                                options={[{ value: 'activos', label: 'Activos' }, { value: 'todos', label: 'Todos' }]}
                            />
                        </FilterBar.Section>

                        <FilterBar.Section active={filterLab !== null} onClear={() => setFilterLab?.(null)} label="laboratorio">
                            <div style={{ width: labW + 'px' }} className="transition-all duration-200">
                                <LiquidSelect
                                    value={filterLab ? String(filterLab) : ''}
                                    onChange={v => setFilterLab?.(v ? parseInt(v) : null)}
                                    options={labOptions}
                                    placeholder="Laboratorio"
                                    icon={Building2}
                                    compact bare
                                />
                            </div>
                        </FilterBar.Section>

                        <FilterBar.Section active={filterCategoria !== null} onClear={() => setFilterCategoria?.(null)} label="categoría">
                            <div style={{ width: catW + 'px' }} className="transition-all duration-200">
                                <LiquidSelect
                                    value={filterCategoria || ''}
                                    onChange={v => setFilterCategoria?.(v || null)}
                                    options={catOptions}
                                    placeholder="Categoría"
                                    icon={Tag}
                                    compact bare
                                />
                            </div>
                        </FilterBar.Section>
                    </FilterBar>

                    {/* Acción, fuera de la barra de filtros (§17) */}
                    <Button tone="chart-3" icon={FlaskConical} onClick={() => setShowEnriquecer(true)}>Enriquecer SRS</Button>
                </div>
            </div>

            {/* ── Table ── */}
            {loadError ? (
                <div className="rounded-2xl border border-danger/30 bg-danger/10 shadow-sm py-16 text-center">
                    <AlertTriangle size={28} className="opacity-40 mx-auto mb-3 text-danger" />
                    <p className="text-sm font-semibold text-danger mb-1">Error al cargar productos</p>
                    <p className="text-label text-danger mb-4">{loadError}</p>
                    <Button variant="destructive" onClick={() => { const bids = filterMargin === 'all' ? null : filterMargin === 'perdida' ? [...(marginStats?.perdidaIds||[])] : [...(marginStats?.bajoIds||[])]; loadProducts(searchTerm, page, pageSize, filterActivo, bids, filterLab, filterCategoria, sortField, sortDir, filterNuevos); }}>Reintentar</Button>
                </div>
            ) : (
                <DataTable
                    columns={[
                        { key: 'nombre',    label: 'Producto',    sortable: true },
                        { key: 'lab',       label: 'Laboratorio', sortable: true, hideBelow: 'md' },
                        { key: 'categoria', label: 'Categoría',   sortable: true, hideBelow: 'lg' },
                        { key: 'activo',    label: 'Estado',      sortable: true, hideBelow: 'sm' },
                        { key: '_expand',   label: '',             className: 'w-10' },
                    ]}
                    sortKey={sortField}
                    sortDir={sortDir}
                    onSort={handleSort}
                    loading={loading}
                    skeletonRows={8}
                    empty={{ icon: Package, message: 'No se encontraron productos' }}
                >
                    {products.map((p, index) => {
                        const isExpanded    = expandedId === p.id;
                        const isLoadingThis = loadingExpandedId === p.id;
                        const hasChanges    = changedIds.has(p.id);
                        const worstM        = marginMap[p.id];
                        const mInfo         = worstM !== undefined ? marginLabel(worstM) : null;
                        const isInactive    = !p.activo && filterActivo === 'todos';
                        const specLoss      = specialLossMap[p.id];
                        return (
                            <React.Fragment key={p.id}>
                                <DataRow
                                    index={index}
                                    onClick={() => toggleRow(p.id)}
                                    onMouseEnter={() => prefetchRow(p.id)}
                                    onMouseLeave={cancelPrefetch}
                                    style={{ borderLeftColor: isExpanded ? 'var(--brand)' : 'transparent' }}
                                    className={`border-l-[3px] ${isExpanded ? tk.rowExpanded : isInactive ? 'opacity-50' : ''}`}
                                >
                                    <DataCell>
                                        <div className="flex items-center gap-3.5">
                                            {p.foto_url
                                                ? <img src={p.foto_url} alt="" className="w-11 h-11 rounded-2xl object-cover shrink-0 shadow-sm" />
                                                : <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tk.avatarBg}`}><Package size={16} className={tk.avatarIcon} /></div>
                                            }
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <span className={`text-[13.5px] font-semibold leading-snug ${isInactive ? tk.textInactive : tk.textStrong}`}>{p.nombre}</span>
                                                    {mInfo && <span className={`inline-flex items-center gap-0.5 text-micro font-bold border px-1.5 py-0.5 rounded-full shrink-0 ${mInfo.cls}`}>{worstM < 0 ? <ShieldAlert size={7} /> : <TrendingDown size={7} />}{mInfo.label}</span>}
                                                    {specLoss && [...specLoss].map(k => (
                                                        <Badge key={k} variant="chart-4" size="sm" icon={TrendingDown} uppercase={false}>Pérd. {specialLossLabel(k)}</Badge>
                                                    ))}
                                                    {hasChanges && <Badge variant="warning" size="sm" icon={AlertTriangle} uppercase={false}>cambios</Badge>}
                                                    {!p.devolutivo && <Badge title="No devolutivo — no se puede devolver al proveedor" variant="warning" size="sm" icon={Ban} uppercase={false}>ND</Badge>}
                                                </div>
                                                {p.principio_activo && <p className="text-caption flex items-center gap-1 mt-0.5 text-chart-3-text/70"><FlaskConical size={8} className="shrink-0" /><span className="truncate max-w-[240px]">{p.principio_activo}</span></p>}
                                            </div>
                                        </div>
                                    </DataCell>
                                    <DataCell hideBelow="md"><span className={`text-label ${tk.textMid}`}>{p.laboratorios?.nombre || '—'}</span></DataCell>
                                    <DataCell hideBelow="lg">
                                        <div className="flex flex-wrap gap-1">
                                            {p.tipo_medicamento && <Badge variant="chart-1" size="sm" uppercase={false}>{p.tipo_medicamento}</Badge>}
                                            {p.es_antibiotico   && <Badge variant="danger" size="sm" uppercase={false}>Bajo Receta</Badge>}
                                            {p.requiere_receta  && <Badge variant="danger" size="sm" uppercase={false}>Receta</Badge>}
                                            {!p.tipo_medicamento && !p.es_antibiotico && !p.requiere_receta && <span className="text-label text-content-3">—</span>}
                                        </div>
                                    </DataCell>
                                    <DataCell hideBelow="sm">
                                        <span className={`text-micro font-black px-2 py-0.5 rounded-full uppercase tracking-wide border ${p.activo ? 'bg-success/10 text-success border-success/30' : 'bg-surface-card-hover text-content-2 border-divider'}`}>
                                            {p.activo ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </DataCell>
                                    <DataCell className="w-10 text-center">
                                        {isLoadingThis
                                            ? <Loader2 size={13} className="animate-spin text-chart-1-text mx-auto" />
                                            : <ChevronDown size={13} className={`transition-transform duration-200 mx-auto ${isExpanded ? 'rotate-180 text-chart-1-text' : tk.textMid}`} />
                                        }
                                    </DataCell>
                                </DataRow>
                                {isExpanded && (
                                    <ExpandedProductRow
                                        product={p}
                                        data={expandedCache[p.id]}
                                        loadingRow={isLoadingThis && !expandedCache[p.id]}
                                        branches={branches}
                                        onPhotoUpdated={handlePhotoUpdated}
                                        onPrinciplesUpdated={handlePrinciplesUpdated}
                                        onCategoryUpdated={handleCategoryUpdated}
                                        onClose={() => setExpandedId(null)}
                                        categories={catOptions.map(o => o.value)}
                                        onCategoryCreated={onCategoryCreated}
                                    />
                                )}
                            </React.Fragment>
                        );
                    })}
                </DataTable>
            )}

            {/* ── Pagination ── */}
            {!loading && total > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={total}
                />
            )}
        </div>
    );
}
