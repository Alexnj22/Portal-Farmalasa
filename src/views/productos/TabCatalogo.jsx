import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle, useMemo } from 'react';
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
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import PhotoEditorModal from '../../components/common/PhotoEditorModal';
import { normSearch } from '../../utils/searchUtils';
import SrsBuscadorWidget from '../../components/srs/SrsBuscadorWidget';
import SrsEnriquecerModal from '../../components/srs/SrsEnriquecerModal';


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
    if (m < 0)  return { label: 'Pérdida',     cls: 'bg-red-100 text-red-700 border-red-200'      };
    if (m < 15) return { label: 'Margen bajo',  cls: 'bg-amber-100 text-amber-700 border-amber-200' };
    return null;
}

// ── MarginPct ─────────────────────────────────────────────────────────────────

function MarginPct({ pct }) {
    if (pct === null) return <span className="text-[9px] text-slate-200">—</span>;
    const cls = pct < 0 ? 'text-red-500' : pct < 15 ? 'text-amber-500' : 'text-emerald-600';
    return <span className={`text-[9px] font-bold tabular-nums ${cls}`}>{pct.toFixed(1)}%</span>;
}

// ── MarginStatCards ───────────────────────────────────────────────────────────

function MarginStatCards({ stats, loading, filterMargin, onFilter, productStats, productStatsLoading, filterNuevos, onFilterNuevos, filterModificados, onFilterModificados, modificadosStats, modificadosLoading }) {
    const perdidaCount = stats?.perdidaIds?.size ?? 0;
    const bajoCount    = stats?.bajoIds?.size    ?? 0;

    // Neutral card (info only, not clickable filter)
    const infoCard = 'bg-white/70 border-white/80 backdrop-blur-sm shadow-sm';

    const statText   = 'text-slate-700';
    const statLabel  = 'text-slate-600';
    const statSub    = 'text-slate-400';
    const statIconBg = 'bg-blue-50';
    const divider    = 'bg-slate-100';

    const filterCardDef = [
        {
            id: 'perdida',
            Icon: ShieldAlert,
            label: 'Con pérdida',
            sub: 'precio < costo',
            count: perdidaCount,
            activeBg: 'bg-red-50 border-red-300 shadow-red-100/80',
            inactiveBg: 'bg-white border-slate-200 hover:border-red-200 hover:bg-red-50/40',
            iconBg: filterMargin === 'perdida'
                ? 'bg-white'
                : 'bg-red-50',
            iconColor: 'text-red-500',
            countColor: perdidaCount > 0
                ? 'text-red-600'
                : 'text-slate-300',
        },
        {
            id: 'bajo',
            Icon: TrendingDown,
            label: 'Margen bajo',
            sub: '< 15% en algún precio',
            count: bajoCount,
            activeBg: 'bg-amber-50 border-amber-300 shadow-amber-100/80',
            inactiveBg: 'bg-white border-slate-200 hover:border-amber-200 hover:bg-amber-50/40',
            iconBg: filterMargin === 'bajo'
                ? 'bg-white'
                : 'bg-amber-50',
            iconColor: 'text-amber-500',
            countColor: bajoCount > 0
                ? 'text-amber-600'
                : 'text-slate-300',
        },
    ];

    // Nuevos card
    const nuevosBg = filterNuevos
        ? 'bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px'
        : 'bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40';

    const nuevosIconBg = filterNuevos
        ? 'bg-white'
        : 'bg-emerald-50';

    return (
        <div className="flex gap-3 flex-wrap">
            {/* Info card — total */}
            <div className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[140px] ${infoCard}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${statIconBg}`}>
                    <Package size={15} className={'text-[#0052CC]'} />
                </div>
                <div className="text-left min-w-0">
                    <div className={`text-[22px] font-black leading-none tabular-nums ${statText}`}>
                        {productStatsLoading ? <span className={'text-slate-200'}>–</span> : (productStats?.activos ?? 0).toLocaleString()}
                    </div>
                    <div className={`text-[10px] font-bold leading-tight ${statLabel}`}>Productos activos</div>
                    {!productStatsLoading && (productStats?.inactivos ?? 0) > 0 && (
                        <div className={`text-[9px] tabular-nums ${statSub}`}>
                            {(productStats.inactivos).toLocaleString()} inactivos
                        </div>
                    )}
                </div>
            </div>

            {/* Nuevos filter card */}
            <button
                onClick={onFilterNuevos}
                disabled={productStatsLoading}
                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[140px] disabled:opacity-40 disabled:cursor-wait ${nuevosBg}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${nuevosIconBg}`}>
                    <Sparkles size={15} className={'text-emerald-500'} />
                </div>
                <div className="text-left min-w-0">
                    <div className={`text-[22px] font-black leading-none tabular-nums ${'text-emerald-600'}`}>
                        {productStatsLoading ? <span className={'text-slate-200'}>–</span> : (productStats?.nuevos ?? 0).toLocaleString()}
                    </div>
                    <div className={`text-[10px] font-bold leading-tight ${statLabel}`}>Nuevos este mes</div>
                    <div className={`text-[9px] ${statSub}`}>agregados en {new Date().toLocaleDateString('es-SV', { month: 'long' })}</div>
                </div>
                {filterNuevos && <X size={11} className={`${'text-slate-400'} ml-auto shrink-0`} />}
            </button>

            {/* Modificados este mes filter card */}
            <button
                onClick={onFilterModificados}
                disabled={modificadosLoading}
                className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[140px] disabled:opacity-40 disabled:cursor-wait ${
                    filterModificados
                        ? 'bg-amber-50 border-amber-300 shadow-md shadow-amber-100/80 -translate-y-px'
                        : 'bg-white border-slate-100 hover:border-amber-200 hover:bg-amber-50/40'
                }`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    filterModificados
                        ? 'bg-white'
                        : 'bg-amber-50'
                }`}>
                    <History size={15} className={'text-amber-500'} />
                </div>
                <div className="text-left min-w-0">
                    <div className={`text-[22px] font-black leading-none tabular-nums ${
                        (modificadosStats?.count ?? 0) > 0
                            ? 'text-amber-600'
                            : 'text-slate-300'
                    }`}>
                        {modificadosLoading ? <span className={'text-slate-200'}>–</span> : (modificadosStats?.count ?? 0).toLocaleString()}
                    </div>
                    <div className={`text-[10px] font-bold leading-tight ${statLabel}`}>Modificados este mes</div>
                    <div className={`text-[9px] ${statSub}`}>precios o datos cambiados</div>
                </div>
                {filterModificados && <X size={11} className={`${'text-slate-400'} ml-auto shrink-0`} />}
            </button>

            {/* Divider */}
            <div className={`w-px h-14 self-center hidden sm:block ${divider}`} />

            {/* Filter cards */}
            {filterCardDef.map(c => {
                const active = filterMargin === c.id;
                return (
                    <button key={c.id}
                        onClick={() => onFilter(c.id)}
                        disabled={loading}
                        className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[160px] ${
                            active ? c.activeBg + ' shadow-md -translate-y-px' : c.inactiveBg
                        } disabled:opacity-40 disabled:cursor-wait`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${c.iconBg}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0">
                            <div className={`text-[22px] font-black leading-none tabular-nums ${c.countColor}`}>
                                {loading ? <span className={'text-slate-200'}>–</span> : c.count.toLocaleString()}
                            </div>
                            <div className={`text-[10px] font-bold leading-tight ${statLabel}`}>{c.label}</div>
                            <div className={`text-[9px] ${statSub}`}>{c.sub}</div>
                        </div>
                        {active && <X size={11} className={`${'text-slate-400'} ml-auto shrink-0`} />}
                    </button>
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
            await supabase.from('product_active_principles').delete().eq('product_id', productId);
            let text = null;
            let saved = [];
            if (preset) {
                await supabase.from('product_active_principles').insert([{
                    product_id: productId, nombre: preset, concentracion: null, orden: 0,
                }]);
                text = preset;
                saved = [{ nombre: preset }];
            } else {
                const toSave = items.filter(p => p.nombre.trim());
                if (toSave.length > 0) {
                    await supabase.from('product_active_principles').insert(
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
            await supabase.from('products').update({ principio_activo: text || null }).eq('id', productId);
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

    const inp = 'bg-slate-50 border-slate-200 text-slate-700 placeholder:text-slate-300 focus:ring-[#0052CC]/20';
    const numCls = 'text-slate-300';
    const rmBtn  = 'text-slate-300 hover:text-red-400 hover:bg-red-50';
    const addCls = 'text-slate-400 hover:text-[#0052CC]';

    const presetChipBase = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all';
    const presetChipOn  = 'bg-amber-50 text-amber-600 border-amber-300';
    const presetChipOff = 'bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600';

    return (
        <div className="space-y-2">
            {/* Preset chips */}
            <div className="flex gap-1.5">
                {PA_PRESETS.map(p => (
                    <button key={p} onClick={() => selectPreset(p)}
                        className={`${presetChipBase} ${preset === p ? presetChipOn : presetChipOff}`}>
                        {p}
                    </button>
                ))}
            </div>

            {/* Input list — hidden when a preset is active */}
            {!preset && (
                <>
                    {items.map((item, idx) => (
                        <div key={item._key} className="flex items-center gap-1.5">
                            <span className={`text-[9px] font-bold w-3 text-right shrink-0 ${numCls}`}>{idx + 1}</span>
                            <input
                                value={item.nombre}
                                onChange={e => updateItem(item._key, 'nombre', e.target.value)}
                                placeholder="Nombre del principio"
                                className={`flex-1 min-w-0 px-2 py-1.5 border rounded-lg text-[16px] focus:outline-none focus:ring-2 transition-colors ${inp}`}
                            />
                            <input
                                value={item.concentracion || ''}
                                onChange={e => updateItem(item._key, 'concentracion', e.target.value)}
                                placeholder="Cant."
                                className={`w-[58px] shrink-0 px-2 py-1.5 border rounded-lg text-[16px] focus:outline-none focus:ring-2 text-center transition-colors ${inp}`}
                            />
                            <button onClick={() => removeItem(item._key)}
                                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all shrink-0 ${rmBtn}`}>
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                        <button onClick={addItem}
                            className={`flex items-center gap-1 text-[10px] font-bold transition-colors ${addCls}`}>
                            <Plus size={10} /> Agregar principio
                        </button>
                        {savingPA && (
                            <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-400">
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
            await supabase.from('products').update({ tipo_medicamento: selected || null }).eq('id', productId);
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
            await supabase.from('product_categories').insert({ nombre });
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
                <span className="flex items-center gap-1 text-[9px] font-semibold text-slate-400 mt-1.5">
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
                await supabase.from('product_locations').upsert(toUpsert, { onConflict: 'product_id,branch_id' });
            if (toDelete.length > 0)
                await supabase.from('product_locations').delete().eq('product_id', productId).in('branch_id', toDelete);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_LOCATIONS', String(productId), { branches: toUpsert.length });
            if (!quiet) useToastStore.getState().showToast('Guardado', 'Ubicaciones actualizadas.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
            throw e;
        }
    };

    useImperativeHandle(ref, () => ({ save }));


    if (!locs.length) return (
        <p className={`text-[11px] italic ${'text-slate-300'}`}>Sin sucursales.</p>
    );

    const cellBg = (hasData) =>
        hasData ? 'bg-blue-50/50 border-blue-100' : 'bg-white border-slate-100';

    const labelCls = 'text-slate-500';
    const trackCls = 'bg-slate-100';

    const salaActiveBtn  = 'bg-white text-[#0052CC] shadow-sm';
    const inactivBtn     = 'text-slate-400 hover:text-slate-600';
    const bodegaActiveBtn = 'bg-white text-amber-600 shadow-sm';

    const inp = (sala) =>
        `bg-slate-50 text-slate-700 font-bold focus:ring-1 focus:outline-none ${sala ? 'border-slate-200 focus:ring-[#0052CC]/30' : 'border-amber-200 focus:ring-amber-400/30'}`;

    return (
        <div className="space-y-2">
            {locs.map((loc, i) => {
                const isSala       = loc.view === 'sala';
                const isMainBodega = loc.branch_type === 'BODEGA';
                const hasSala      = loc.numero.trim() || loc.peldano.trim();
                const hasBodega    = loc.bodega_numero.trim() || loc.bodega_peldano.trim();
                const hasData      = hasSala || hasBodega;

                const rowBg =
                    hasData ? 'bg-blue-50/60 border-blue-100' : 'bg-slate-50 border-slate-100';

                return (
                    <div key={loc.branch_id} className={`rounded-xl border px-3.5 py-2.5 transition-colors ${rowBg}`}>
                        {/* Header: branch name + view toggle */}
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className={`text-[11px] font-black ${'text-slate-700'}`}>{loc.branch_name}</span>
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                                    loc.branch_type === 'BODEGA'
                                        ? 'bg-amber-100 text-amber-700'
                                        : 'bg-blue-100 text-blue-700'
                                }`}>{loc.branch_type === 'BODEGA' ? 'Bodega' : 'Farmacia'}</span>
                                {hasSala && !hasBodega && <span className={`text-[8px] ${'text-blue-400'}`}>Sala</span>}
                                {hasBodega && !hasSala && <span className={`text-[8px] ${'text-amber-500'}`}>Bodega int.</span>}
                                {hasSala && hasBodega && <span className={`text-[8px] ${'text-emerald-500'}`}>Sala + Bodega</span>}
                            </div>
                            {!isMainBodega && (
                                <div className={`flex rounded-lg p-0.5 gap-0.5 ${'bg-slate-100'}`}>
                                    <button onClick={() => setField(i, 'view', 'sala')}
                                        className={`px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide transition-all ${isSala ? salaActiveBtn : inactivBtn}`}>Sala</button>
                                    <button onClick={() => setField(i, 'view', 'bodega')}
                                        className={`px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide transition-all ${!isSala ? bodegaActiveBtn : inactivBtn}`}>Bodega int.</button>
                                </div>
                            )}
                        </div>

                        {/* Inputs */}
                        <div className="flex items-end gap-3">
                            {isSala && (
                                <div className={`flex rounded-lg p-0.5 gap-0.5 self-start mt-0.5 ${'bg-slate-100'}`}>
                                    {['vitrina', 'estante'].map(t => (
                                        <button key={t} onClick={() => setField(i, 'tipo', t)}
                                            className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase transition-all ${loc.tipo === t ? salaActiveBtn : inactivBtn}`}>
                                            {t === 'vitrina' ? 'Vit.' : 'Est.'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!isSala && !isMainBodega && (
                                <span className={`text-[9px] font-bold self-center ${'text-amber-500'}`}>Bodega interna</span>
                            )}
                            {isMainBodega && (
                                <span className={`text-[9px] font-bold self-center ${'text-amber-500'}`}>Bodega principal</span>
                            )}
                            <div className="flex gap-2 flex-1">
                                <div className="flex-1">
                                    <p className={`text-[9px] font-semibold mb-1 ${labelCls}`}>N°</p>
                                    <input
                                        value={isSala ? loc.numero : loc.bodega_numero}
                                        onChange={e => setField(i, isSala ? 'numero' : 'bodega_numero', e.target.value)}
                                        maxLength={4}
                                        placeholder="—"
                                        className={`w-full px-2 py-1.5 border rounded-lg text-[16px] text-center font-bold transition-colors ${inp(isSala)}`}
                                    />
                                </div>
                                <div className="flex-1">
                                    <p className={`text-[9px] font-semibold mb-1 ${labelCls}`}>Peldaño</p>
                                    <input
                                        value={isSala ? loc.peldano : loc.bodega_peldano}
                                        onChange={e => setField(i, isSala ? 'peldano' : 'bodega_peldano', e.target.value)}
                                        maxLength={4}
                                        placeholder="—"
                                        className={`w-full px-2 py-1.5 border rounded-lg text-[16px] text-center font-bold transition-colors ${inp(isSala)}`}
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
            className="fixed z-[99999] bg-white rounded-xl shadow-xl border border-slate-100 py-1 min-w-[170px] overflow-hidden"
            style={{ top: pos.y, left: pos.x }}
            onMouseDown={e => e.stopPropagation()}>
            <button
                onClick={onPaste}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left">
                <Clipboard size={13} className="shrink-0 text-slate-400" />
                Pegar imagen
                <span className="ml-auto text-[10px] text-slate-500">Ctrl+V</span>
            </button>
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
            className="fixed inset-0 z-[300] flex items-center justify-center"
            style={{ backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', backgroundColor: 'rgba(0,0,0,0.65)' }}
            onClick={onClose}>
            <div
                className="relative max-w-[90vw] max-h-[90vh] rounded-3xl overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.6)] ring-1 ring-white/20"
                style={{ animation: 'lightbox-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both' }}
                onClick={e => e.stopPropagation()}>
                <img src={src} alt="" className="block max-w-[90vw] max-h-[90vh] object-contain" />
                <button
                    onClick={onClose}
                    className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/70 transition-colors border border-white/20">
                    <X size={16} strokeWidth={2.5} />
                </button>
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
    Nuevo:     { bg: 'bg-emerald-50 border-emerald-200 text-emerald-700', Icon: Sparkles   },
    Reentrada: { bg: 'bg-violet-50 border-violet-200 text-violet-700',   Icon: RotateCcw  },
    Regular:   { bg: 'bg-blue-50 border-blue-200 text-blue-700',         Icon: Package    },
};

function PurchaseHistorySection({ purchases, canSeeCosts = true }) {
    const [showAll, setShowAll] = useState(false);

    if (!canSeeCosts)
        return <p className="text-[11px] text-slate-300 italic">Sin permiso para ver costos de compra.</p>;

    if (!purchases || purchases.length === 0)
        return <p className="text-[11px] text-slate-300 italic">Sin historial de compras registrado.</p>;

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
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold border ${cs.bg}`}>
                        <cs.Icon size={10} /> {clasificacion}
                    </span>
                )}
                <span className="text-[10px] text-slate-400">
                    Primera compra: <span className="font-semibold text-slate-600">{fmtDate(firstDate)}</span>
                </span>
                <span className="text-[9px] text-slate-200">·</span>
                <span className="text-[10px] text-slate-400">
                    Última: <span className="font-semibold text-slate-600">{fmtDate(lastDate)}</span>
                </span>
                <span className="text-[9px] text-slate-200">·</span>
                <span className="text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-600">{rows.length}</span> compra{rows.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Cost history table */}
            <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm">
                <table className="min-w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-100">
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-left text-slate-400">Fecha</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-left text-slate-400">Proveedor</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-center text-slate-400">Cant.</th>
                            <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-right text-slate-400">Costo unit.</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {visible.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50/40 transition-colors">
                                <td className="px-3 py-2 text-[11px] text-slate-600 whitespace-nowrap">
                                    {fmtDate(row.purchase_receipts?.fecha)}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-700 max-w-[180px] truncate">
                                    {row.purchase_receipts?.proveedor || '—'}
                                </td>
                                <td className="px-3 py-2 text-[11px] text-slate-600 text-center tabular-nums">
                                    {parseFloat(row.cantidad || 0).toLocaleString()}
                                </td>
                                <td className="px-3 py-2 text-[12px] font-semibold text-slate-700 text-right tabular-nums">
                                    {fmtCost(row.precio_unitario)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {rows.length > 8 && (
                <button
                    onClick={() => setShowAll(v => !v)}
                    className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors">
                    {showAll ? 'Ver menos' : `Ver ${rows.length - 8} compra${rows.length - 8 !== 1 ? 's' : ''} anterior${rows.length - 8 !== 1 ? 'es' : ''}`}
                </button>
            )}
        </div>
    );
}

// ── ExpandedProductRow ────────────────────────────────────────────────────────

function ExpandedProductRow({ product, data, loadingRow, branches, onPhotoUpdated, onPrinciplesUpdated, onCategoryUpdated, onClose, categories, onCategoryCreated }) {
    const { maxPriceLevel, hasPermission } = useAuth();
    const canSeeCosts = hasPermission('productos_tab_catalogo_costos');

    // ── Expanded-row theme tokens ────────────────────────────────────────────
    const xk = {
        container: 'bg-gradient-to-br from-[#EEF4FF]/80 via-white to-slate-50/50 border-t border-[#0052CC]/[0.12]',
        loadingRow: 'bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 border-t border-blue-100/60',
        loadingText: 'text-slate-400',
        alertDanger: 'bg-red-50 border-red-200 text-red-700',
        alertWarning: 'bg-amber-50 border-amber-200 text-amber-700',
        sectionLabel: 'text-[10px] font-black uppercase tracking-widest text-slate-400',
        photoBtn: 'border-slate-200 hover:border-[#0052CC]/50 bg-slate-50/70 hover:bg-blue-50/30',
        photoSubText: 'text-slate-300',
        photoUploadIcon: 'text-slate-300 group-hover:text-[#0052CC]',
        photoUploadLabel: 'text-slate-400 group-hover:text-[#0052CC]',
        changesBadge: 'bg-amber-100 text-amber-700 border-amber-200',
        emptyPresentaciones: 'bg-slate-50 border-slate-100 text-slate-400',
        pricingWrapper: 'bg-white border-slate-100 shadow-sm',
        pricingThead: 'bg-[#0052CC]/[0.05] border-b border-[#0052CC]/[0.08]',
        pricingThText: 'text-slate-400',
        pricingDivide: 'divide-y divide-slate-50',
        pricingRowChanged: 'bg-amber-50/60',
        pricingRowLoss: 'bg-red-50/30',
        pricingRowNormal: 'bg-white',
        pricingCellChanged: 'bg-amber-50',
        pricingValueChanged: 'text-amber-700',
        pricingValueNormal: 'text-slate-700',
        pricingOldValue: 'text-slate-400',
        pricingFactor: 'text-slate-500',
        pricingCosto: 'text-slate-500',
        statusActive: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
        statusInactive: 'bg-slate-100 text-slate-400',
        changelog: 'bg-amber-50/50 border border-amber-100',
        changelogDate: 'bg-white border-slate-100 text-slate-400',
        changelogField: 'text-slate-600',
        changelogOld: 'text-slate-400',
        changelogArrow: 'text-slate-300',
        changelogNew: 'text-slate-800',
        sinCambios: 'text-slate-300 italic',
        divider: 'border-slate-100/80',
        vertDivider: 'bg-slate-100',
        btnCancel: 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700',
        srsBtnInactive: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-violet-50 hover:text-violet-600 hover:border-violet-200',
        srsBtnActive: 'bg-violet-100 text-violet-700 border-violet-200',
        srsDivider: 'border-slate-100',
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
        const { error } = await supabase.from('products').update({ devolutivo: newVal }).eq('id', product.id);
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
            await supabase.from('products').update({ foto_url: cacheBust }).eq('id', product.id);
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
                    <div className={`flex items-center gap-2 text-[11px] ${xk.loadingText}`}>
                        <Loader2 size={12} className="animate-spin text-blue-400" /> Cargando detalle…
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
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-medium ${
                            worstOverall < 0 ? xk.alertDanger : xk.alertWarning
                        }`}>
                            {worstOverall < 0
                                ? <ShieldAlert size={14} className="shrink-0 text-red-500" />
                                : <AlertTriangle size={13} className="shrink-0 text-amber-500" />}
                            {worstOverall < 0
                                ? <><strong>Pérdida detectada</strong> — alguna presentación tiene precio de venta por debajo del costo.</>
                                : <><strong>Margen bajo</strong> — alguna presentación tiene margen inferior al 15 %. Estándar farmacéutico: 20–35 %.</>}
                        </div>
                    )}
                    {specialLossSet.size > 0 && (
                        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-medium bg-orange-50 border-orange-200 text-orange-700">
                            <TrendingDown size={13} className="shrink-0 text-orange-500" />
                            <><strong>Pérdida en precio especial</strong> — {[...specialLossSet].map(specialLossLabel).join(' y ')} está por debajo del costo en alguna presentación.</>
                        </div>
                    )}

                    {/* ── Devolutivo / No devolutivo (ND) toggle ── */}
                    {/* Default esperado: Devolutivo (el proveedor acepta devolución). Activar este
                        botón marca la EXCEPCIÓN — el producto NO se puede devolver (ND) — por eso
                        el estado "activado" se resalta en ámbar, no en verde. */}
                    <button
                        onClick={toggleDevolutivo}
                        disabled={savingDevolutivo}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors disabled:opacity-50 ${
                            !devolutivo
                                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                        }`}
                        title={devolutivo
                            ? 'Este producto SÍ puede devolverse al proveedor antes de vencer. Clic para marcarlo como No Devolutivo (ND).'
                            : 'Este producto NO puede devolverse al proveedor (ND). Clic para marcarlo como Devolutivo.'}
                    >
                        {savingDevolutivo ? <Loader2 size={12} className="animate-spin" /> : !devolutivo ? <Ban size={12} /> : <RotateCcw size={12} />}
                        {!devolutivo ? 'No devolutivo (ND)' : 'Devolutivo'}
                    </button>

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
                                        <img src={localFoto} alt="" className="w-full h-full object-contain bg-white p-2" />
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/0 group-hover:bg-black/45 transition-all">
                                            {photoLoading
                                                ? <Loader2 size={22} className="text-white animate-spin" />
                                                : <>
                                                    <Camera size={22} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <span className="text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">Ver foto</span>
                                                </>}
                                        </div>
                                    </>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                                        {photoLoading
                                            ? <Loader2 size={24} className="text-[#0052CC] animate-spin" />
                                            : <>
                                                <Camera size={24} className={`transition-colors ${xk.photoUploadIcon}`} />
                                                <span className={`text-[10px] font-semibold transition-colors ${xk.photoUploadLabel}`}>Subir foto</span>
                                                <span className={`text-[8px] ${xk.photoSubText}`}>JPG, PNG o WebP</span>
                                            </>}
                                    </div>
                                )}
                            </button>
                            {localFoto && (
                                <button onClick={() => fileRef.current?.click()} className={`mt-1.5 text-[9px] font-semibold transition-colors ${'text-slate-400 hover:text-slate-600'}`}>Cambiar foto</button>
                            )}
                        </div>

                        {/* ── RIGHT: Precios ── */}
                        <div className="min-w-0">
                            <p className={`${xk.sectionLabel} mb-2.5 flex items-center gap-2`}>
                                Presentaciones y precios
                                {hasChanges && (
                                    <span className={`inline-flex items-center gap-1 text-[9px] font-bold border px-1.5 py-0.5 rounded-full ${xk.changesBadge}`}>
                                        <AlertTriangle size={8} /> cambios
                                    </span>
                                )}
                            </p>

                            {precios.length === 0 ? (
                                <div className={`flex items-center gap-2 text-[11px] py-3 px-3 rounded-xl border ${xk.emptyPresentaciones}`}>
                                    <Info size={12} className="shrink-0 opacity-60" />
                                    Sin presentaciones en el ERP.
                                </div>
                            ) : (
                                <div className={`overflow-x-auto rounded-xl border ${xk.pricingWrapper}`}>
                                    <table className="min-w-full text-sm">
                                        <thead>
                                            <tr className={xk.pricingThead}>
                                                <th className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-left whitespace-nowrap ${xk.pricingThText}`}>Presentación</th>
                                                <th className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-center ${xk.pricingThText}`}>Factor</th>
                                                <th className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-right ${xk.pricingThText}`}>Costo</th>
                                                {allowedPriceFields.map(f => (
                                                    <th key={f.key} className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-right whitespace-nowrap ${xk.pricingThText}`}>{f.label}</th>
                                                ))}
                                                <th className={`px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-center ${xk.pricingThText}`}>Estado</th>
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
                                                            <span className={`text-[12px] font-semibold ${xk.pricingValueNormal}`}>{pp.presentaciones?.tipo || '—'}</span>
                                                            {pp.descripcion && (
                                                                <span className={`text-[9px] ml-1 ${xk.pricingFactor}`}>{pp.descripcion}</span>
                                                            )}
                                                        </td>
                                                        <td className={`px-3 py-2.5 text-center text-[11px] ${xk.pricingFactor}`}>{pp.factor ?? '—'}</td>
                                                        <td className={`px-3 py-2.5 text-right text-[11px] font-medium ${xk.pricingCosto}`}>{fmtP(pp.costo)}</td>
                                                        {allowedPriceFields.map(f => {
                                                            const ch = pCh[f.key];
                                                            const m  = calcMargin(pp[f.key], pp.costo);
                                                            return (
                                                                <td key={f.key} className={`px-3 py-2.5 text-right ${ch ? xk.pricingCellChanged : ''}`}>
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <span className={`text-[12px] font-semibold ${ch ? xk.pricingValueChanged : xk.pricingValueNormal}`}>
                                                                            {fmtP(pp[f.key])}
                                                                        </span>
                                                                        {ch && (
                                                                            <div className="flex flex-col items-end gap-0.5">
                                                                                <span className={`text-[9px] line-through whitespace-nowrap ${xk.pricingOldValue}`}>
                                                                                    {fmtP(ch.anterior)}
                                                                                </span>
                                                                                <span className={`text-[8px] ${'text-slate-300'}`}>
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
                                                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${pp.activo !== false ? xk.statusActive : xk.statusInactive}`}>
                                                                {pp.activo !== false ? 'Activa' : 'Inactiva'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {inactiveCount > 0 && (
                                <button
                                    onClick={() => setShowInactive(v => !v)}
                                    className={`mt-2 flex items-center gap-1.5 text-[10px] font-bold transition-colors ${
                                        'text-slate-400 hover:text-slate-600'
                                    }`}>
                                    <Eye size={11} />
                                    {showInactive ? 'Ocultar inactivas' : `Mostrar ${inactiveCount} inactiva${inactiveCount !== 1 ? 's' : ''}`}
                                </button>
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
                                <p className={`text-[11px] ${xk.sinCambios}`}>Sin cambios registrados.</p>
                            ) : (
                                <div className={`rounded-xl px-3.5 py-3 space-y-1.5 ${xk.changelog}`}>
                                    {displayLog1.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                                            <span className={`font-mono text-[10px] shrink-0 px-1.5 py-0.5 rounded border ${xk.changelogDate}`}>
                                                {new Date(c.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                            </span>
                                            <span className={`font-semibold ${xk.changelogField}`}>{c.campo}</span>
                                            <span className={`line-through text-[10px] ${xk.changelogOld}`}>{c.valor_anterior || '—'}</span>
                                            <span className={`text-[9px] font-bold ${xk.changelogArrow}`}>→</span>
                                            <span className={`font-medium ${xk.changelogNew}`}>{c.valor_nuevo || '—'}</span>
                                        </div>
                                    ))}
                                    {olderLog1.length > 0 && (
                                        <button onClick={() => setShowAllLog(v => !v)}
                                            className={`mt-1.5 text-[10px] font-bold transition-colors ${'text-slate-400 hover:text-slate-600'}`}>
                                            {showAllLog ? 'Ver solo este mes' : `Ver ${olderLog1.length} cambio${olderLog1.length !== 1 ? 's' : ''} anterior${olderLog1.length !== 1 ? 'es' : ''}`}
                                        </button>
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
                                    <button
                                        onClick={() => setShowSrs(v => !v)}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                                            showSrs ? xk.srsBtnActive : xk.srsBtnInactive
                                        }`}
                                    >
                                        <Search size={9} strokeWidth={2.5} /> SRS
                                    </button>
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

                    {/* ── Cerrar (todo autoguarda: foto, devolutivo, categoría y principios) ── */}
                    <div className={`border-t ${xk.divider} pt-4 flex items-center justify-end gap-2`}>
                        <button onClick={onClose}
                            className={`px-4 h-9 rounded-full text-[11px] font-bold border transition-all ${xk.btnCancel}`}>
                            Cerrar
                        </button>
                    </div>

                </div>
            </td>
        </tr>
        {ctxMenu && <PhotoContextMenu pos={ctxMenu} onPaste={handlePasteFromMenu} onClose={() => setCtxMenu(null)} />}
        {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
        </>
    );
}

// ── Aurora Expanded Panel ─────────────────────────────────────────────────────
// Dark-glass expanded detail used inside AuroraView cards (not a <tr>).

function AuroraExpandedPanel({ product, data, loadingRow, branches, onPhotoUpdated, onPrinciplesUpdated, onCategoryUpdated, onClose, categories, onCategoryCreated, allowedPriceFields }) {
    const { maxPriceLevel } = useAuth();
    const marginCheckFields = useMemo(() => (allowedPriceFields || PRICE_FIELDS).filter(f => f.key !== 'precio_7' && f.key !== 'premium'), [allowedPriceFields]);

    const [photoLoading, setPhotoLoading] = useState(false);
    const [localFoto, setLocalFoto]       = useState(product.foto_url);
    const [pendingFile, setPendingFile]   = useState(null);
    const [saving, setSaving]             = useState(false);
    const [showSrs, setShowSrs]           = useState(false);
    const [ctxMenu, setCtxMenu]           = useState(null);
    const [showInactive, setShowInactive] = useState(false);
    const [lightboxSrc, setLightboxSrc]   = useState(null);
    const [showAllLog, setShowAllLog]     = useState(false);
    const fileRef       = useRef(null);
    const principiosRef = useRef(null);
    const locationRef   = useRef(null);
    const categoryRef   = useRef(null);

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

    const handleSave = async () => {
        setSaving(true);
        const newCat = categoryRef.current?.getValue() ?? null;
        try {
            await Promise.all([
                principiosRef.current?.save({ quiet: true }),
                locationRef.current?.save({ quiet: true }),
                categoryRef.current?.save({ quiet: true }),
            ]);
            useToastStore.getState().showToast('Guardado', 'Cambios guardados correctamente.', 'success');
            onCategoryUpdated?.(product.id, newCat || null);
            if (onClose) onClose();
        } catch (_) {}
        finally { setSaving(false); }
    };

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
            await supabase.from('products').update({ foto_url: cacheBust }).eq('id', product.id);
            setLocalFoto(cacheBust);
            onPhotoUpdated(product.id, cacheBust);
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally { setPhotoLoading(false); }
    };

    if (loadingRow) return (
        <div className="px-5 py-4 border-t border-white/[0.08] flex items-center gap-2 text-[11px] text-white/40">
            <Loader2 size={12} className="animate-spin text-blue-400" /> Cargando detalle…
        </div>
    );

    const precios    = data?.precios    || [];
    const prodLog    = (data?.prodLog || []).filter(c =>
        !(CHANGELOG_HIDDEN.has(c.campo) && !c.valor_anterior)
    );
    const principles = data?.principles || [];
    const changesMap = {};
    (data?.changelog || []).forEach(c => {
        if (!changesMap[c.id_presentacion]) changesMap[c.id_presentacion] = {};
        const ex = changesMap[c.id_presentacion][c.campo];
        if (!ex || new Date(c.detected_at) > new Date(ex.detected_at))
            changesMap[c.id_presentacion][c.campo] = { anterior: c.valor_anterior, detected_at: c.detected_at };
    });
    const hasChanges = Object.keys(changesMap).length > 0 || prodLog.length > 0;

    const inactiveCount  = precios.filter(pp => pp.activo === false).length;
    const visiblePrecios = showInactive ? precios : precios.filter(pp => pp.activo !== false);

    const _now2 = new Date();
    const _startOfMonth2 = new Date(_now2.getFullYear(), _now2.getMonth(), 1);
    const thisMonthLog2 = prodLog.filter(c => new Date(c.detected_at) >= _startOfMonth2);
    const olderLog2     = prodLog.filter(c => new Date(c.detected_at) < _startOfMonth2);
    const displayLog2   = showAllLog ? prodLog : (thisMonthLog2.length > 0 ? thisMonthLog2 : prodLog.slice(0, 5));

    const worstOverall = precios.reduce((min, pp) => {
        const w = worstMarginOf(pp, marginCheckFields);
        return w === null ? min : min === null ? w : Math.min(min, w);
    }, null);
    const specialLossSet = precios.reduce((acc, pp) => {
        specialLossKeys(pp).forEach(k => acc.add(k));
        return acc;
    }, new Set());

    const sectionLabel = (
        <span className="text-[9px] font-black uppercase tracking-widest text-blue-400/80" />
    );
    const SL = ({ icon: Icon, children }) => (
        <p className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-blue-400/80 mb-2.5">
            {Icon && <Icon size={9} />}{children}
        </p>
    );
    const Divider = () => <div className="h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent my-5" />;

    const priceFields = allowedPriceFields || PRICE_FIELDS;

    return (
        <div className="animate-cosmos-panel border-t border-white/[0.08] bg-[#050c1d]/80 px-5 py-5 space-y-5">

            {/* Alert */}
            {worstOverall !== null && worstOverall < 15 && (
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-medium ${
                    worstOverall < 0
                        ? 'bg-red-500/[0.15] border-red-500/[0.30] text-red-300'
                        : 'bg-amber-500/[0.15] border-amber-500/[0.30] text-amber-300'
                }`}>
                    {worstOverall < 0
                        ? <ShieldAlert size={14} className="shrink-0 text-red-400 badge-pulse" />
                        : <AlertTriangle size={13} className="shrink-0 text-amber-400" />}
                    {worstOverall < 0
                        ? <><strong>Pérdida detectada</strong> — algún precio está por debajo del costo.</>
                        : <><strong>Margen bajo</strong> — margen inferior al 15 % en alguna presentación.</>}
                </div>
            )}
            {specialLossSet.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-medium bg-orange-500/[0.12] border-orange-400/[0.25] text-orange-300">
                    <TrendingDown size={13} className="shrink-0 text-orange-400" />
                    <><strong>Pérdida en precio especial</strong> — {[...specialLossSet].map(specialLossLabel).join(' y ')} está por debajo del costo en alguna presentación.</>
                </div>
            )}

            {/* Foto + Precios */}
            <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-6">
                {/* Foto */}
                <div>
                    <SL icon={Camera}>Foto del producto</SL>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoSelect} />
                    {pendingFile && <PhotoEditorModal file={pendingFile} onConfirm={handlePhotoConfirm} onCancel={() => setPendingFile(null)} />}
                    <button onClick={() => localFoto ? setLightboxSrc(localFoto) : fileRef.current?.click()}
                        onContextMenu={handlePhotoContextMenu}
                        className="group relative w-full h-[180px] max-w-[180px] rounded-2xl border-2 border-dashed border-white/[0.12] overflow-hidden transition-all duration-200 hover:border-blue-400/[0.40] hover:shadow-[0_0_20px_rgba(96,165,250,0.15)]">
                        {localFoto ? (
                            <>
                                <img src={localFoto} alt="" className="w-full h-full object-contain bg-white/[0.02] p-2" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/0 group-hover:bg-black/50 transition-all">
                                    {photoLoading
                                        ? <Loader2 size={22} className="text-white animate-spin" />
                                        : <>
                                            <Camera size={22} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                            <span className="text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">Ver foto</span>
                                          </>}
                                </div>
                            </>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-blue-900/20 to-violet-900/20">
                                {photoLoading
                                    ? <Loader2 size={24} className="text-blue-400 animate-spin" />
                                    : <>
                                        <Camera size={24} className="text-white/25 group-hover:text-blue-400 transition-colors" />
                                        <span className="text-[10px] font-semibold text-white/30 group-hover:text-blue-300 transition-colors">Subir foto</span>
                                        <span className="text-[8px] text-white/15">JPG, PNG o WebP</span>
                                      </>}
                            </div>
                        )}
                    </button>
                    {localFoto && (
                        <button onClick={() => fileRef.current?.click()} className="mt-1.5 text-[9px] font-semibold text-white/30 hover:text-white/60 transition-colors">Cambiar foto</button>
                    )}
                </div>

                {/* Precios */}
                <div className="min-w-0">
                    <SL icon={null}>
                        Presentaciones y precios
                        {hasChanges && <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-500/[0.18] text-amber-300 border border-amber-400/[0.28] px-1.5 py-0.5 rounded-full badge-pulse">⚡ cambios</span>}
                    </SL>
                    {precios.length === 0 ? (
                        <div className="flex items-center gap-2 text-[11px] text-white/35 py-3 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                            <Info size={12} className="text-white/20 shrink-0" /> Sin presentaciones en el ERP.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-white/[0.09] bg-[#0a1628]/60">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-white/[0.05] border-b border-white/[0.08]">
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/35 text-left">Presentación</th>
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/35 text-center">Factor</th>
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/35 text-right">Costo</th>
                                        {priceFields.map(f => <th key={f.key} className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/35 text-right whitespace-nowrap">{f.label}</th>)}
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-white/35 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.05]">
                                    {visiblePrecios.map(pp => {
                                        const pCh = changesMap[pp.id_presentacion] || {};
                                        const rowChanged = Object.keys(pCh).length > 0;
                                        const worst = worstMarginOf(pp, marginCheckFields);
                                        return (
                                            <tr key={pp.id_presentacion} className={`transition-colors ${rowChanged ? 'bg-amber-500/[0.10]' : worst !== null && worst < 0 ? 'bg-red-500/[0.08]' : 'bg-transparent hover:bg-white/[0.03]'}`}>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span className="text-[12px] font-semibold text-white/85">{pp.presentaciones?.tipo || '—'}</span>
                                                    {pp.descripcion && <span className="text-[9px] text-white/35 ml-1">{pp.descripcion}</span>}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[11px] text-white/50">{pp.factor ?? '—'}</td>
                                                <td className="px-3 py-2 text-right text-[11px] text-white/50">{fmtP(pp.costo)}</td>
                                                {priceFields.map(f => {
                                                    const ch = pCh[f.key];
                                                    const m  = calcMargin(pp[f.key], pp.costo);
                                                    return (
                                                        <td key={f.key} className={`px-3 py-2 text-right ${ch ? 'bg-amber-500/[0.12]' : ''}`}>
                                                            <div className="flex flex-col items-end gap-0.5">
                                                                <span className={`text-[12px] font-semibold ${ch ? 'text-amber-300' : 'text-white/85'}`}>{fmtP(pp[f.key])}</span>
                                                                {ch && (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <span className="text-[9px] text-white/25 line-through">{fmtP(ch.anterior)}</span>
                                                                        <span className="text-[8px] text-white/25">
                                                                            {new Date(ch.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                {f.key !== 'precio_7' && <MarginPct pct={m} />}
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${pp.activo !== false ? 'bg-emerald-500/[0.18] text-emerald-400 border-emerald-500/[0.25]' : 'bg-white/[0.06] text-white/30 border-white/[0.10]'}`}>
                                                        {pp.activo !== false ? 'Activa' : 'Inactiva'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {inactiveCount > 0 && (
                        <button
                            onClick={() => setShowInactive(v => !v)}
                            className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-white/35 hover:text-white/60 transition-colors">
                            <Eye size={11} />
                            {showInactive ? 'Ocultar inactivas' : `Mostrar ${inactiveCount} inactiva${inactiveCount !== 1 ? 's' : ''}`}
                        </button>
                    )}
                </div>
            </div>

            <Divider />

            {/* Categoría | Cambios | Principios activos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div>
                    <SL icon={Tag}>Categoría</SL>
                    <CategoryEditor ref={categoryRef} productId={product.id} initial={product.tipo_medicamento} categories={categories} onCategoryCreated={onCategoryCreated} />
                </div>
                <div>
                    <SL icon={History}>Cambios en el producto</SL>
                    {prodLog.length === 0 ? (
                        <p className="text-[11px] text-white/25 italic">Sin cambios registrados.</p>
                    ) : (
                        <div className="rounded-xl bg-amber-900/[0.18] border border-amber-500/[0.20] px-3.5 py-3 space-y-1.5">
                            {displayLog2.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                                    <span className="font-mono text-[10px] bg-white/[0.07] border border-white/[0.10] text-white/40 px-1.5 py-0.5 rounded shrink-0">{new Date(c.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}</span>
                                    <span className="font-semibold text-white/70">{c.campo}</span>
                                    <span className="text-white/30 line-through text-[10px]">{c.valor_anterior || '—'}</span>
                                    <span className="text-white/20 text-[9px] font-bold">→</span>
                                    <span className="text-white/85 font-medium">{c.valor_nuevo || '—'}</span>
                                </div>
                            ))}
                            {olderLog2.length > 0 && (
                                <button onClick={() => setShowAllLog(v => !v)}
                                    className="mt-1.5 text-[10px] font-bold text-white/35 hover:text-white/55 transition-colors">
                                    {showAllLog ? 'Ver solo este mes' : `Ver ${olderLog2.length} cambio${olderLog2.length !== 1 ? 's' : ''} anterior${olderLog2.length !== 1 ? 'es' : ''}`}
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div>
                    <div className="flex items-center justify-between mb-2.5">
                        <SL icon={FlaskConical}>Principios activos</SL>
                        {!PA_PRESETS.includes(product.principio_activo) && (
                            <button onClick={() => setShowSrs(v => !v)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${
                                    showSrs ? 'bg-violet-500/[0.20] text-violet-300 border-violet-400/[0.30]' : 'bg-white/[0.06] text-white/45 border-white/[0.14] hover:bg-violet-500/[0.12] hover:text-violet-300 hover:border-violet-400/[0.25]'
                                }`}>
                                <Search size={9} strokeWidth={2.5} /> SRS
                            </button>
                        )}
                    </div>
                    <PrincipiosEditor ref={principiosRef} productId={product.id} initial={principles} onSaved={(saved, text) => onPrinciplesUpdated(product.id, saved, text)} />
                    {showSrs && !PA_PRESETS.includes(product.principio_activo) && (
                        <div className="mt-3 border-t border-white/[0.07] pt-3">
                            <SrsBuscadorWidget initialQuery={product.nombre} />
                        </div>
                    )}
                </div>
            </div>

            <Divider />

            {/* Footer */}
            <div className="flex items-center justify-end gap-2">
                <button onClick={onClose}
                    className="px-4 h-9 rounded-full text-[11px] font-bold border transition-all bg-white/[0.06] border-white/[0.14] text-white/55 hover:bg-white/[0.12] hover:text-white">
                    Cancelar
                </button>
                <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-1.5 px-6 h-9 rounded-full text-[11px] font-black text-white transition-all disabled:opacity-50 disabled:cursor-wait bg-gradient-to-r from-blue-500 to-violet-600 shadow-[0_4px_20px_rgba(139,92,246,0.40)] hover:shadow-[0_4px_28px_rgba(139,92,246,0.60)] hover:-translate-y-0.5 active:scale-[0.97]">
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
                    Guardar
                </button>
            </div>
            {ctxMenu && <PhotoContextMenu pos={ctxMenu} onPaste={handlePasteFromMenu} onClose={() => setCtxMenu(null)} />}
            {lightboxSrc && <PhotoLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
        </div>
    );
}

// ── AuroraFullscreenModal ─────────────────────────────────────────────────────
// Portal-based fullscreen overlay for the Aurora theme expanded product detail.

function AuroraFullscreenModal({ product, data, loadingRow, onClose, branches, onPhotoUpdated, onPrinciplesUpdated, onCategoryUpdated, categories, onCategoryCreated, allowedPriceFields }) {
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    return createPortal(
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 md:p-6">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-[#020810]/88 backdrop-blur-sm cursor-pointer" onClick={onClose} />

            {/* Modal panel */}
            <div className="relative z-10 w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl overflow-hidden border border-white/[0.10] bg-[#07111e] shadow-[0_32px_80px_rgba(0,0,0,0.85),0_0_80px_rgba(96,165,250,0.06)]">
                {/* Modal header */}
                <div className="flex items-center gap-4 px-6 py-4 border-b border-white/[0.08] bg-[#040c1a]/70 backdrop-blur-sm shrink-0 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-900/20 via-transparent to-violet-900/15 pointer-events-none" />
                    {/* Avatar */}
                    <div className="relative w-14 h-14 rounded-full overflow-hidden shrink-0 ring-2 ring-blue-400/[0.32] shadow-[0_0_24px_rgba(96,165,250,0.32)]">
                        {product.foto_url
                            ? <img src={product.foto_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full bg-gradient-to-br from-blue-900 to-violet-900 flex items-center justify-center">
                                <Package size={22} className="text-blue-300/55" />
                              </div>
                        }
                    </div>
                    <div className="flex-1 min-w-0 relative z-10">
                        <h2 className="text-[18px] md:text-[20px] font-black text-white/95 leading-tight truncate">{product.nombre}</h2>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            {product.laboratorios?.nombre && <span className="text-[11px] text-white/40">{product.laboratorios.nombre}</span>}
                            {product.principio_activo && (
                                <span className="text-[10px] text-violet-400/60 flex items-center gap-1">
                                    <FlaskConical size={8} className="shrink-0" />
                                    <span className="truncate max-w-[180px]">{product.principio_activo}</span>
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose}
                        className="relative z-10 w-10 h-10 rounded-full bg-white/[0.06] border border-white/[0.14] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.12] hover:border-white/[0.22] transition-all shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Scrollable content */}
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                    <AuroraExpandedPanel
                        product={product}
                        data={data}
                        loadingRow={loadingRow}
                        branches={branches}
                        onPhotoUpdated={onPhotoUpdated}
                        onPrinciplesUpdated={onPrinciplesUpdated}
                        onCategoryUpdated={onCategoryUpdated}
                        onClose={onClose}
                        categories={categories}
                        onCategoryCreated={onCategoryCreated}
                        allowedPriceFields={allowedPriceFields}
                    />
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── AuroraView ────────────────────────────────────────────────────────────────
// Card-based product list for the Aurora (Cosmos) theme.

function AuroraView({ products, expandedId, expandedCache, loadingExpandedId, changedIds, marginMap, specialLossMap, filterActivo, allowedPriceFields, branches, catOptions, onCategoryCreated, toggleRow, prefetchRow, cancelPrefetch, handlePhotoUpdated, handlePrinciplesUpdated, handleCategoryUpdated, setExpandedId }) {
    const expandedProduct = products.find(p => p.id === expandedId) ?? null;

    return (
        <>
            <div className="space-y-2">
                {products.map((p, index) => {
                    const isExpanded    = expandedId === p.id;
                    const isLoadingThis = loadingExpandedId === p.id;
                    const hasChangesP   = changedIds.has(p.id);
                    const worstM        = marginMap[p.id];
                    const hasLoss       = worstM !== undefined && worstM < 0;
                    const hasWarn       = worstM !== undefined && worstM >= 0 && worstM < 15;
                    const isInactive    = !p.activo && filterActivo === 'todos';
                    const specLoss      = specialLossMap?.[p.id];

                    const cardGlow = hasLoss ? 'glow-danger' : hasWarn ? 'glow-warning' : '';
                    const cardBorder = isExpanded
                        ? 'border-blue-400/[0.38] bg-[#0c1a30]'
                        : 'border-white/[0.07] bg-[#070d1a] hover:border-blue-400/[0.20] hover:bg-[#0a1525]';
                    const avatarRing = hasLoss
                        ? 'ring-2 ring-red-500/[0.55] shadow-[0_0_16px_rgba(239,68,68,0.40)]'
                        : hasWarn
                        ? 'ring-2 ring-amber-400/[0.45] shadow-[0_0_14px_rgba(251,191,36,0.30)]'
                        : isExpanded
                        ? 'ring-2 ring-blue-400/[0.45] shadow-[0_0_16px_rgba(96,165,250,0.30)]'
                        : 'ring-1 ring-white/[0.10] group-hover:ring-blue-400/[0.28] group-hover:shadow-[0_0_14px_rgba(96,165,250,0.18)]';

                    return (
                        <div key={p.id}
                            className={`group animate-cosmos-in rounded-2xl border overflow-hidden transition-all duration-350 cursor-pointer ${cardGlow} ${cardBorder} ${isInactive ? 'opacity-50' : ''}`}
                            style={{ animationDelay: `${Math.min(index, 14) * 35}ms`, transitionProperty: 'border-color, background-color, box-shadow' }}>

                            {/* Card header */}
                            <div className="flex items-center gap-4 px-4 py-3.5"
                                onClick={() => toggleRow(p.id)}
                                onMouseEnter={() => prefetchRow(p.id)}
                                onMouseLeave={cancelPrefetch}>

                                {/* Avatar */}
                                <div className={`relative shrink-0 w-12 h-12 rounded-full overflow-hidden transition-all duration-300 ${avatarRing}`}>
                                    {p.foto_url
                                        ? <img src={p.foto_url} alt="" className="w-full h-full object-cover" />
                                        : <div className="w-full h-full bg-gradient-to-br from-blue-900/60 to-violet-900/60 flex items-center justify-center">
                                            <Package size={18} className={`${hasLoss ? 'text-red-400/70' : hasWarn ? 'text-amber-400/70' : 'text-blue-300/60'}`} />
                                          </div>
                                    }
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                        <span className={`text-[14px] font-semibold leading-snug ${isInactive ? 'text-white/30 line-through' : 'text-white/90'}`}>{p.nombre}</span>
                                        {hasLoss && <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-red-500/[0.22] text-red-300 border border-red-500/[0.32] px-1.5 py-0.5 rounded-full badge-pulse"><ShieldAlert size={7} /> Pérdida</span>}
                                        {!hasLoss && hasWarn && <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-amber-500/[0.20] text-amber-300 border border-amber-400/[0.30] px-1.5 py-0.5 rounded-full"><TrendingDown size={7} /> Margen bajo</span>}
                                        {specLoss && [...specLoss].map(k => (
                                            <span key={k} className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-orange-500/[0.18] text-orange-300 border border-orange-400/[0.28] px-1.5 py-0.5 rounded-full">
                                                <TrendingDown size={7} /> Pérd. {specialLossLabel(k)}
                                            </span>
                                        ))}
                                        {hasChangesP && <span className="text-[9px] font-bold bg-amber-500/[0.16] text-amber-300 border border-amber-400/[0.24] px-1.5 py-0.5 rounded-full">cambios</span>}
                                    </div>
                                    <div className="flex items-center gap-3 flex-wrap">
                                        {p.laboratorios?.nombre && <span className="text-[10px] text-white/40">{p.laboratorios.nombre}</span>}
                                        {p.principio_activo && (
                                            <span className="text-[10px] text-violet-400/65 flex items-center gap-1">
                                                <FlaskConical size={8} className="shrink-0" />
                                                <span className="truncate max-w-[200px]">{p.principio_activo}</span>
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        {p.tipo_medicamento && <span className="text-[9px] bg-blue-500/[0.14] text-blue-300 border border-blue-400/[0.22] px-1.5 py-0.5 rounded-full">{p.tipo_medicamento}</span>}
                                        {p.es_antibiotico   && <span className="text-[9px] bg-orange-500/[0.14] text-orange-300 border border-orange-400/[0.22] px-1.5 py-0.5 rounded-full">Bajo Receta</span>}
                                        {p.requiere_receta  && <span className="text-[9px] bg-red-500/[0.14] text-red-300 border border-red-400/[0.22] px-1.5 py-0.5 rounded-full">Receta</span>}
                                    </div>
                                </div>

                                {/* Right: margin + status + chevron */}
                                <div className="flex items-center gap-4 shrink-0">
                                    {worstM !== undefined && (
                                        <div className="text-center hidden sm:block">
                                            <span className={`text-[13px] font-black tabular-nums ${worstM < 0 ? 'text-red-400' : worstM < 15 ? 'text-amber-400' : 'text-emerald-400'}`}>{worstM.toFixed(1)}%</span>
                                            <p className="text-[8px] text-white/25 mt-0.5">margen</p>
                                        </div>
                                    )}
                                    <div className="text-center">
                                        <div className={`w-2 h-2 rounded-full mx-auto mb-0.5 ${p.activo ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]' : 'bg-white/20'}`} />
                                        <span className={`text-[8px] font-bold uppercase ${p.activo ? 'text-emerald-400/70' : 'text-white/25'}`}>{p.activo ? 'Activo' : 'Inactivo'}</span>
                                    </div>
                                    {isLoadingThis
                                        ? <Loader2 size={15} className="animate-spin text-blue-400 shrink-0" />
                                        : <ChevronDown size={15} className={`transition-transform duration-300 shrink-0 ${isExpanded ? 'rotate-180 text-blue-400' : 'text-white/25 group-hover:text-white/55'}`} />
                                    }
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Fullscreen modal — rendered via portal to escape CSS containment */}
            {expandedProduct && (
                <AuroraFullscreenModal
                    product={expandedProduct}
                    data={expandedCache[expandedProduct.id]}
                    loadingRow={loadingExpandedId === expandedProduct.id && !expandedCache[expandedProduct.id]}
                    branches={branches}
                    onPhotoUpdated={handlePhotoUpdated}
                    onPrinciplesUpdated={handlePrinciplesUpdated}
                    onCategoryUpdated={handleCategoryUpdated}
                    onClose={() => setExpandedId(null)}
                    categories={catOptions.map(o => o.value)}
                    onCategoryCreated={onCategoryCreated}
                    allowedPriceFields={allowedPriceFields}
                />
            )}
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
        rowExpanded: 'bg-[#0052CC]/[0.05]',
        textStrong: 'text-slate-800',
        textMid: 'text-slate-500',
        textInactive: 'text-slate-400 line-through decoration-slate-300',
        avatarBg: 'bg-[#0052CC]/[0.07]',
        avatarIcon: 'text-[#0052CC]/50',
        filterPill: 'bg-white/80 border-slate-200/70 shadow-[0_2px_12px_rgba(0,82,204,0.08)]',
        filterDivider: 'bg-slate-100',
        filterBtn: 'text-slate-400 hover:text-slate-600 hover:bg-slate-50',
        totalText: 'text-slate-400',
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
            const { data, error } = await supabase.from('product_precios')
                .select(`product_id, costo, ${PRICE_SELECT}`)
                .eq('activo', true)
                .gt('costo', 0)
                .range(from, from + PAGE - 1);
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
        Promise.all([
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', true),
            supabase.from('products').select('*', { count: 'exact', head: true }).eq('activo', false),
            supabase.from('products').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth),
        ]).then(([{ count: activos }, { count: inactivos }, { count: nuevos }]) => {
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
            const { data, error } = await supabase.from(table)
                .select(isProd ? 'product_id, campo, valor_anterior' : 'product_id')
                .gte('detected_at', startOfMonth)
                .range(from, from + PAGE - 1);
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
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, foto_url, devolutivo, laboratorios(nombre)', { count: 'exact' })
                .range((pg - 1) * ps, pg * ps - 1);

            if (q.trim()) {
                const term = (normSearch(q) || q.trim()).replace(/,/g, ' ');
                qb = qb.or(`nombre.ilike.%${term}%,principio_activo.ilike.%${term}%`);
            }
            if (fa === 'activos') qb = qb.eq('activo', true);
            if (lab)  qb = qb.eq('laboratorio_id', lab);
            if (cat)  qb = qb.eq('tipo_medicamento', cat);
            if (fNuevos) {
                const now = new Date();
                qb = qb.gte('created_at', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
            }
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
            if (effectiveBids !== null) {
                if (effectiveBids.length === 0) {
                    if (rid === loadRef.current) { setProducts([]); setTotal(0); setLoading(false); }
                    return;
                }
                qb = qb.in('id', effectiveBids);
            }

            if (sField === 'nombre')          qb = qb.order('nombre', { ascending: sDir === 'asc' });
            else if (sField === 'activo')      qb = qb.order('activo', { ascending: sDir === 'asc' }).order('nombre');
            else if (sField === 'categoria')   qb = qb.order('tipo_medicamento', { ascending: sDir === 'asc', nullsFirst: false }).order('nombre');
            else if (sField === 'lab')         qb = qb.order('nombre', { referencedTable: 'laboratorios', ascending: sDir === 'asc', nullsFirst: false }).order('nombre');
            else                               qb = qb.order('nombre');

            const { data, count, error } = await qb;
            if (rid !== loadRef.current) return;
            if (error) throw error;
            const rows = data || [];
            setProducts(rows);
            setTotal(count || 0);

            if (rows.length > 0) {
                const ids = rows.map(r => r.id);
                const [{ data: pc, error: pcErr }, { data: prc, error: prcErr }, { data: pp, error: ppErr }] = await Promise.all([
                    supabase.from('product_precios_changelog').select('product_id').in('product_id', ids),
                    supabase.from('products_changelog').select('product_id, campo, valor_anterior').in('product_id', ids),
                    supabase.from('product_precios').select(`product_id, costo, ${PRICE_SELECT}`).in('product_id', ids).eq('activo', true).gt('costo', 0),
                ]);
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
                const results = await Promise.all([
                    supabase.from('product_precios').select(`id_presentacion, activo, descripcion, factor, costo, ${PRICE_SELECT}, presentaciones(tipo)`).eq('product_id', productId).order('activo', { ascending: false }),
                    supabase.from('product_precios_changelog').select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                    supabase.from('products_changelog').select('campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                    supabase.from('product_active_principles').select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden'),
                    canSeeCosts
                    ? supabase.from('purchase_receipt_items').select('cantidad, precio_unitario, purchase_receipts(fecha, proveedor)').eq('erp_product_id', productId).order('receipt_id', { ascending: false }).limit(60)
                    : Promise.resolve({ data: [] }),
                ]);
                const firstErr = results.find(r => r.error)?.error;
                if (firstErr) console.error('prefetchRow failed:', firstErr.message);
                const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: principles }, { data: purchases }] = results;
                setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], principles: principles || [], purchases: purchases || [] } }));
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
            const results = await Promise.all([
                supabase.from('product_precios').select(`id_presentacion, activo, descripcion, factor, costo, ${PRICE_SELECT}, presentaciones(tipo)`).eq('product_id', productId).order('activo', { ascending: false }),
                supabase.from('product_precios_changelog').select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                supabase.from('products_changelog').select('campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                supabase.from('product_active_principles').select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden'),
                canSeeCosts
                    ? supabase.from('purchase_receipt_items').select('cantidad, precio_unitario, purchase_receipts(fecha, proveedor)').eq('erp_product_id', productId).order('receipt_id', { ascending: false }).limit(60)
                    : Promise.resolve({ data: [] }),
            ]);
            const firstErr = results.find(r => r.error)?.error;
            if (firstErr) console.error('toggleRow: expand product failed:', firstErr.message);
            const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: principles }, { data: purchases }] = results;
            setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], principles: principles || [], purchases: purchases || [] } }));
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
    const hasActiveFilters = filterLab !== null || filterCategoria !== null || filterActivo === 'todos';
    const resetFilters = () => {
        setFilterLab?.(null); setFilterCategoria?.(null); setFilterActivo?.('activos');
    };

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {showEnriquecer && (
                <SrsEnriquecerModal onClose={() => setShowEnriquecer(false)} />
            )}

            {/* ── Stats + filter pill row ── */}
            <div className="flex items-start gap-3 flex-wrap">
                {/* Stat cards */}
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
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

                {/* Filter pill + Enriquecer SRS stacked — desktop only */}
                <div className="hidden lg:flex flex-col items-end gap-2 shrink-0">
                    <div className={`flex group items-center gap-0 rounded-2xl border transition-all duration-300 hover:-translate-y-0.5 overflow-visible ${tk.filterPill}`}>

                        {/* Activos / Todos */}
                        <div className="flex items-center gap-0.5 px-2.5 py-2">
                            {[['activos', 'Activos'], ['todos', 'Todos']].map(([v, label]) => (
                                <button key={v} onClick={() => setFilterActivo?.(v)}
                                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                        filterActivo === v
                                            ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                                            : tk.filterBtn
                                    }`}>{label}</button>
                            ))}
                        </div>

                        <div className={`h-5 w-px shrink-0 ${tk.filterDivider}`} />

                        {/* Laboratorio */}
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: labW + 'px' }}>
                            <LiquidSelect
                                value={filterLab ? String(filterLab) : ''}
                                onChange={v => setFilterLab?.(v ? parseInt(v) : null)}
                                options={labOptions}
                                placeholder="Laboratorio"
                                icon={Building2}
                                compact
                                bare
                            />
                        </div>

                        <div className={`h-5 w-px shrink-0 ${tk.filterDivider}`} />

                        {/* Categoría */}
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: catW + 'px' }}>
                            <LiquidSelect
                                value={filterCategoria || ''}
                                onChange={v => setFilterCategoria?.(v || null)}
                                options={catOptions}
                                placeholder="Categoría"
                                icon={Tag}
                                compact
                                bare
                            />
                        </div>

                        {/* Clear all */}
                        {hasActiveFilters && (
                            <>
                                <div className={`h-5 w-px shrink-0 ${tk.filterDivider}`} />
                                <button onClick={resetFilters} title="Limpiar todos los filtros"
                                    className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                                    <X size={11} strokeWidth={3} />
                                </button>
                            </>
                        )}
                    </div>

                    {/* Enriquecer SRS — below filter pill */}
                    <button onClick={() => setShowEnriquecer(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold text-violet-600 border border-violet-200 bg-violet-50 hover:bg-violet-100 transition-all self-end">
                        <FlaskConical size={11} strokeWidth={2.5} /> Enriquecer SRS
                    </button>
                </div>
            </div>

            {/* ── Table ── */}
            {loadError ? (
                <div className="rounded-2xl border border-red-100 bg-red-50 shadow-sm py-16 text-center">
                    <AlertTriangle size={28} className="opacity-40 mx-auto mb-3 text-red-400" />
                    <p className="text-sm font-semibold text-red-600 mb-1">Error al cargar productos</p>
                    <p className="text-[11px] text-red-400 mb-4">{loadError}</p>
                    <button onClick={() => { const bids = filterMargin === 'all' ? null : filterMargin === 'perdida' ? [...(marginStats?.perdidaIds||[])] : [...(marginStats?.bajoIds||[])]; loadProducts(searchTerm, page, pageSize, filterActivo, bids, filterLab, filterCategoria, sortField, sortDir, filterNuevos); }}
                        className="px-5 py-2 text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 rounded-full transition-colors">
                        Reintentar
                    </button>
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
                                    style={{ borderLeftColor: isExpanded ? '#0052CC' : 'transparent' }}
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
                                                    {mInfo && <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold border px-1.5 py-0.5 rounded-full shrink-0 ${mInfo.cls}`}>{worstM < 0 ? <ShieldAlert size={7} /> : <TrendingDown size={7} />}{mInfo.label}</span>}
                                                    {specLoss && [...specLoss].map(k => (
                                                        <span key={k} className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                            <TrendingDown size={7} /> Pérd. {specialLossLabel(k)}
                                                        </span>
                                                    ))}
                                                    {hasChanges && <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0"><AlertTriangle size={7} /> cambios</span>}
                                                    {!p.devolutivo && <span title="No devolutivo — no se puede devolver al proveedor" className="inline-flex items-center gap-0.5 text-[9px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0"><Ban size={7} /> ND</span>}
                                                </div>
                                                {p.principio_activo && <p className="text-[10px] flex items-center gap-1 mt-0.5 text-violet-500/70"><FlaskConical size={8} className="shrink-0" /><span className="truncate max-w-[240px]">{p.principio_activo}</span></p>}
                                            </div>
                                        </div>
                                    </DataCell>
                                    <DataCell hideBelow="md"><span className={`text-[11px] ${tk.textMid}`}>{p.laboratorios?.nombre || '—'}</span></DataCell>
                                    <DataCell hideBelow="lg">
                                        <div className="flex flex-wrap gap-1">
                                            {p.tipo_medicamento && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap border bg-blue-50 text-blue-600 border-blue-100">{p.tipo_medicamento}</span>}
                                            {p.es_antibiotico   && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-100">Bajo Receta</span>}
                                            {p.requiere_receta  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border bg-red-50 text-red-600 border-red-100">Receta</span>}
                                            {!p.tipo_medicamento && !p.es_antibiotico && !p.requiere_receta && <span className="text-[11px] text-slate-300">—</span>}
                                        </div>
                                    </DataCell>
                                    <DataCell hideBelow="sm">
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide border ${p.activo ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                                            {p.activo ? 'Activo' : 'Inactivo'}
                                        </span>
                                    </DataCell>
                                    <DataCell className="w-10 text-center">
                                        {isLoadingThis
                                            ? <Loader2 size={13} className="animate-spin text-blue-400 mx-auto" />
                                            : <ChevronDown size={13} className={`transition-transform duration-200 mx-auto ${isExpanded ? 'rotate-180 text-blue-400' : tk.textMid}`} />
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
