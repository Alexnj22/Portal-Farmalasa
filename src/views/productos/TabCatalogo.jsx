import React, { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    Package, FlaskConical, Check, Loader2,
    ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Info,
    Camera, TrendingDown, ShieldAlert, Plus, X, Building2, Tag,
    Sparkles, History, MapPin,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';

const PAGE_SIZES = [25, 50, 100];

const PRICE_FIELDS = [
    { key: 'vineta',      label: 'Víneta'  },
    { key: 'descuento_1', label: 'Desc. 1' },
    { key: 'vip',         label: 'VIP'     },
    { key: 'clinica',     label: 'Clínica' },
    { key: 'mayoreo',     label: 'Mayoreo' },
    { key: 'premium',     label: 'Premium' },
];
const PRICE_SELECT = PRICE_FIELDS.map(f => f.key).join(', ');

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

function allMargins(pp) {
    const costo = parseFloat(pp.costo);
    if (!costo || costo <= 0) return {};
    const out = {};
    PRICE_FIELDS.forEach(f => {
        const price = parseFloat(pp[f.key]);
        if (price > 0) out[f.key] = (price - costo) / price * 100;
    });
    return out;
}

function worstMarginOf(pp) {
    const vals = Object.values(allMargins(pp));
    return vals.length ? Math.min(...vals) : null;
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

// ── SmartPagination ───────────────────────────────────────────────────────────

function SmartPagination({ page, total, onChange }) {
    if (total <= 1) return null;
    const buildPages = () => {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        const left  = Math.max(2, page - 1);
        const right = Math.min(total - 1, page + 1);
        if (left > 2) pages.push('…');
        for (let i = left; i <= right; i++) pages.push(i);
        if (right < total - 1) pages.push('…');
        pages.push(total);
        return pages;
    };
    return (
        <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                <ChevronLeft size={12} strokeWidth={2.5} /> Ant.
            </button>
            <div className="flex items-center gap-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <span key={`e${i}`} className="w-6 text-center text-slate-300 text-[12px] font-bold select-none">·</span>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-full text-[12px] font-black transition-all duration-200 ${
                                p === page
                                    ? 'bg-[#007AFF] text-white shadow-md shadow-blue-200 scale-110'
                                    : 'text-slate-500 hover:bg-white hover:border hover:border-slate-200 hover:shadow-sm hover:text-slate-800'
                            }`}>{p}</button>
                )}
            </div>
            <button disabled={page >= total} onClick={() => onChange(page + 1)}
                className="flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm">
                Sig. <ChevronRight size={12} strokeWidth={2.5} />
            </button>
        </div>
    );
}

// ── MarginStatCards ───────────────────────────────────────────────────────────

function MarginStatCards({ stats, loading, filterMargin, onFilter, productStats, productStatsLoading }) {
    const perdidaCount = stats?.perdidaIds?.size ?? 0;
    const bajoCount    = stats?.bajoIds?.size    ?? 0;

    const filterCards = [
        {
            id: 'perdida',
            Icon: ShieldAlert,
            label: 'Con pérdida',
            sub: 'precio < costo',
            count: perdidaCount,
            activeBg:   'bg-red-50 border-red-300 shadow-red-100/80',
            inactiveBg: 'bg-white border-slate-200 hover:border-red-200 hover:bg-red-50/40',
            iconBg:     filterMargin === 'perdida' ? 'bg-white' : 'bg-red-50',
            iconColor:  'text-red-500',
            countColor: perdidaCount > 0 ? 'text-red-600' : 'text-slate-300',
        },
        {
            id: 'bajo',
            Icon: TrendingDown,
            label: 'Margen bajo',
            sub: '< 15% en algún precio',
            count: bajoCount,
            activeBg:   'bg-amber-50 border-amber-300 shadow-amber-100/80',
            inactiveBg: 'bg-white border-slate-200 hover:border-amber-200 hover:bg-amber-50/40',
            iconBg:     filterMargin === 'bajo' ? 'bg-white' : 'bg-amber-50',
            iconColor:  'text-amber-500',
            countColor: bajoCount > 0 ? 'text-amber-600' : 'text-slate-300',
        },
    ];

    return (
        <div className="flex gap-3 flex-wrap">
            {/* Informational cards — total & nuevos */}
            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[140px]">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-blue-50">
                    <Package size={15} className="text-[#007AFF]" />
                </div>
                <div className="text-left min-w-0">
                    <div className="text-[22px] font-black leading-none tabular-nums text-slate-700">
                        {productStatsLoading ? <span className="text-slate-200">–</span> : (productStats?.activos ?? 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] font-bold text-slate-600 leading-tight">Productos activos</div>
                    {!productStatsLoading && (productStats?.inactivos ?? 0) > 0 && (
                        <div className="text-[9px] text-slate-400 tabular-nums">
                            {(productStats.inactivos).toLocaleString()} inactivos
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border border-slate-100 bg-white min-w-[140px]">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50">
                    <Sparkles size={15} className="text-emerald-500" />
                </div>
                <div className="text-left min-w-0">
                    <div className="text-[22px] font-black leading-none tabular-nums text-emerald-600">
                        {productStatsLoading ? <span className="text-slate-200">–</span> : (productStats?.nuevos ?? 0).toLocaleString()}
                    </div>
                    <div className="text-[10px] font-bold text-slate-600 leading-tight">Nuevos este mes</div>
                    <div className="text-[9px] text-slate-400">agregados en {new Date().toLocaleDateString('es-SV', { month: 'long' })}</div>
                </div>
            </div>

            {/* Divider */}
            <div className="w-px h-14 bg-slate-100 self-center hidden sm:block" />

            {/* Filter cards */}
            {filterCards.map(c => {
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
                                {loading ? <span className="text-slate-200">–</span> : c.count.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold text-slate-600 leading-tight">{c.label}</div>
                            <div className="text-[9px] text-slate-400">{c.sub}</div>
                        </div>
                        {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
                    </button>
                );
            })}
        </div>
    );
}

// ── SortTh ────────────────────────────────────────────────────────────────────

function SortTh({ field, label, sortField, sortDir, onSort, className = '' }) {
    const active = sortField === field;
    return (
        <th onClick={() => onSort(field)}
            className={`px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest cursor-pointer select-none transition-colors whitespace-nowrap ${
                active ? 'text-[#007AFF]' : 'text-slate-400 hover:text-slate-600'
            } ${className}`}>
            <span className="flex items-center gap-1">
                {label}
                <span className={`text-[10px] ${active ? 'opacity-100' : 'opacity-30'}`}>
                    {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                </span>
            </span>
        </th>
    );
}

// ── PrincipiosEditor ──────────────────────────────────────────────────────────

const PrincipiosEditor = forwardRef(function PrincipiosEditor({ productId, initial, onSaved }, ref) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        if (initial && initial.length > 0) {
            setItems(initial.map((p, i) => ({ ...p, _key: p.id ?? i })));
        } else {
            setItems([{ nombre: '', concentracion: '', orden: 0, _key: 0 }]);
        }
    }, [initial]);

    const addItem = () =>
        setItems(prev => [...prev, { nombre: '', concentracion: '', orden: prev.length, _key: Date.now() }]);
    const removeItem = key =>
        setItems(prev => prev.length > 1 ? prev.filter(p => p._key !== key) : [{ nombre: '', concentracion: '', orden: 0, _key: Date.now() }]);
    const updateItem = (key, field, value) =>
        setItems(prev => prev.map(p => p._key === key ? { ...p, [field]: value } : p));

    const save = async ({ quiet = false } = {}) => {
        try {
            const toSave = items.filter(p => p.nombre.trim());
            await supabase.from('product_active_principles').delete().eq('product_id', productId);
            if (toSave.length > 0) {
                await supabase.from('product_active_principles').insert(
                    toSave.map((p, i) => ({
                        product_id:    productId,
                        nombre:        p.nombre.trim(),
                        concentracion: p.concentracion?.trim() || null,
                        orden:         i,
                    }))
                );
            }
            const text = toSave.map(p => [p.nombre.trim(), p.concentracion?.trim()].filter(Boolean).join(' ')).join(', ');
            await supabase.from('products').update({ principio_activo: text || null }).eq('id', productId);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_PRINCIPLES', String(productId), { count: toSave.length });
            if (!quiet) useToastStore.getState().showToast('Guardado', 'Principios activos actualizados.', 'success');
            if (onSaved) onSaved(toSave, text || null);
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
            throw e;
        }
    };

    useImperativeHandle(ref, () => ({ save }));

    return (
        <div className="space-y-2">
            {items.map((item, idx) => (
                <div key={item._key} className="flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-300 font-bold w-3 text-right shrink-0">{idx + 1}</span>
                    <input
                        value={item.nombre}
                        onChange={e => updateItem(item._key, 'nombre', e.target.value)}
                        placeholder="Nombre del principio"
                        className="flex-1 min-w-0 px-2 py-1.5 border border-slate-200 rounded-lg text-[11px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 bg-slate-50 placeholder:text-slate-300"
                    />
                    <input
                        value={item.concentracion || ''}
                        onChange={e => updateItem(item._key, 'concentracion', e.target.value)}
                        placeholder="Cant."
                        className="w-[58px] shrink-0 px-2 py-1.5 border border-slate-200 rounded-lg text-[10px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 bg-slate-50 placeholder:text-slate-300 text-center"
                    />
                    <button onClick={() => removeItem(item._key)}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-slate-300 hover:text-red-400 hover:bg-red-50 transition-all shrink-0">
                        <X size={10} />
                    </button>
                </div>
            ))}
            <button onClick={addItem}
                className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-[#007AFF] transition-colors pt-1">
                <Plus size={10} /> Agregar principio
            </button>
        </div>
    );
});

// ── LocationGrid ──────────────────────────────────────────────────────────────

const LocationGrid = forwardRef(function LocationGrid({ productId, initial, branches }, ref) {
    const [locs, setLocs] = useState([]);

    useEffect(() => {
        if (!branches) return;
        const farm = branches.filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));
        setLocs(farm.map(b => {
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

    if (!locs.length) return <p className="text-[11px] text-slate-300 italic">Sin sucursales.</p>;

    return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${locs.length}, minmax(0, 1fr))` }}>
            {locs.map((loc, i) => {
                const isSala       = loc.view === 'sala';
                const isMainBodega = loc.branch_type === 'BODEGA';
                const hasSala      = loc.numero.trim() || loc.peldano.trim();
                const hasBodega    = loc.bodega_numero.trim() || loc.bodega_peldano.trim();
                const hasData      = hasSala || hasBodega;

                return (
                    <div key={loc.branch_id} className={`rounded-xl border p-2.5 transition-colors min-w-0 ${hasData ? 'bg-blue-50/50 border-blue-100' : 'bg-white border-slate-100'}`}>

                        {/* Header: name + Sala/Bodega toggle */}
                        <div className="flex items-start justify-between gap-0.5 mb-2">
                            <p className="text-[7px] font-black uppercase tracking-wide text-slate-500 truncate leading-tight mt-0.5">{loc.branch_name}</p>
                            {!isMainBodega && (
                                <div className="flex bg-slate-100 rounded-full p-0.5 shrink-0">
                                    <button onClick={() => setField(i, 'view', 'sala')}
                                        className={`px-1.5 py-0.5 rounded-full text-[6px] font-black uppercase transition-all leading-none ${
                                            isSala ? 'bg-white text-[#007AFF] shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}>Sala</button>
                                    <button onClick={() => setField(i, 'view', 'bodega')}
                                        className={`px-1.5 py-0.5 rounded-full text-[6px] font-black uppercase transition-all leading-none ${
                                            !isSala ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}>Bodega</button>
                                </div>
                            )}
                        </div>

                        {/* Vit/Est toggle */}
                        {isSala ? (
                            <div className="flex items-center bg-slate-100 rounded-full p-0.5 mb-2">
                                {['vitrina', 'estante'].map(t => (
                                    <button key={t} onClick={() => setField(i, 'tipo', t)}
                                        className={`flex-1 py-0.5 rounded-full text-[6px] font-black uppercase tracking-wide transition-all ${
                                            loc.tipo === t ? 'bg-white text-[#007AFF] shadow-sm' : 'text-slate-400'
                                        }`}>
                                        {t === 'vitrina' ? 'Vit.' : 'Est.'}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="mb-2 h-[18px] flex items-center justify-center">
                                <span className="text-[7px] font-bold text-amber-500 uppercase tracking-wide">Bodega interna</span>
                            </div>
                        )}

                        {/* N° and Peld inputs */}
                        <div className="flex gap-1">
                            <div className="flex-1 min-w-0">
                                <p className="text-[6px] text-slate-400 font-semibold leading-none mb-1">N°</p>
                                <input
                                    value={isSala ? loc.numero : loc.bodega_numero}
                                    onChange={e => setField(i, isSala ? 'numero' : 'bodega_numero', e.target.value)}
                                    maxLength={2}
                                    className={`w-full px-0.5 py-1.5 border rounded text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-1 bg-slate-50 text-center min-w-0 ${
                                        isSala ? 'border-slate-200 focus:ring-[#007AFF]/30' : 'border-amber-200 focus:ring-amber-400/30'
                                    }`} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[6px] text-slate-400 font-semibold leading-none mb-1">Peld.</p>
                                <input
                                    value={isSala ? loc.peldano : loc.bodega_peldano}
                                    onChange={e => setField(i, isSala ? 'peldano' : 'bodega_peldano', e.target.value)}
                                    maxLength={2}
                                    className={`w-full px-0.5 py-1.5 border rounded text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-1 bg-slate-50 text-center min-w-0 ${
                                        isSala ? 'border-slate-200 focus:ring-[#007AFF]/30' : 'border-amber-200 focus:ring-amber-400/30'
                                    }`} />
                            </div>
                        </div>

                        {/* Dot: other view has data */}
                        {!isMainBodega && (
                            <div className="mt-1.5 flex justify-center">
                                <span className={`w-1 h-1 rounded-full transition-all ${
                                    isSala && hasBodega ? 'bg-amber-400' :
                                    !isSala && hasSala  ? 'bg-[#007AFF]' : 'bg-transparent'
                                }`} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

// ── ExpandedProductRow ────────────────────────────────────────────────────────

function ExpandedProductRow({ product, data, loadingRow, branches, onPhotoUpdated, onPrinciplesUpdated, onClose }) {
    const [photoLoading, setPhotoLoading] = useState(false);
    const [localFoto, setLocalFoto]       = useState(product.foto_url);
    const [saving, setSaving]             = useState(false);
    const fileRef       = useRef(null);
    const principiosRef = useRef(null);
    const locationRef   = useRef(null);

    const handleSave = async () => {
        setSaving(true);
        try {
            await Promise.all([
                principiosRef.current?.save({ quiet: true }),
                locationRef.current?.save({ quiet: true }),
            ]);
            useToastStore.getState().showToast('Guardado', 'Cambios guardados correctamente.', 'success');
            if (onClose) onClose();
        } catch (_) {}
        finally { setSaving(false); }
    };

    useEffect(() => { setLocalFoto(product.foto_url); }, [product.foto_url]);

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoLoading(true);
        try {
            const ext  = file.name.split('.').pop().toLowerCase();
            const path = `${product.id}.${ext}`;
            const { error: upErr } = await supabase.storage.from('product-photos').upload(path, file, { upsert: true });
            if (upErr) throw upErr;
            const { data: { publicUrl } } = supabase.storage.from('product-photos').getPublicUrl(path);
            await supabase.from('products').update({ foto_url: publicUrl }).eq('id', product.id);
            setLocalFoto(publicUrl);
            onPhotoUpdated(product.id, publicUrl);
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally { setPhotoLoading(false); e.target.value = ''; }
    };

    if (loadingRow) {
        return (
            <tr className="border-t border-blue-100/60">
                <td colSpan={5} className="px-5 py-4 bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
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
    const prodLog    = data?.prodLog    || [];
    const principles = data?.principles || [];
    const hasChanges = Object.keys(changesMap).length > 0 || prodLog.length > 0;

    const worstOverall = precios.reduce((min, pp) => {
        const w = worstMarginOf(pp);
        if (w === null) return min;
        return min === null ? w : Math.min(min, w);
    }, null);

    return (
        <tr className="border-t border-blue-100/60">
            <td colSpan={5} className="px-0 py-0 bg-gradient-to-br from-blue-50/30 via-white/70 to-slate-50/20">
                <div className="px-5 py-5 space-y-5">

                    {/* ── Alert banner ── */}
                    {worstOverall !== null && worstOverall < 15 && (
                        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[11px] font-medium ${
                            worstOverall < 0
                                ? 'bg-red-50 border-red-200 text-red-700'
                                : 'bg-amber-50 border-amber-200 text-amber-700'
                        }`}>
                            {worstOverall < 0
                                ? <ShieldAlert size={14} className="shrink-0 text-red-500" />
                                : <AlertTriangle size={13} className="shrink-0 text-amber-500" />}
                            {worstOverall < 0
                                ? <><strong>Pérdida detectada</strong> — alguna presentación tiene precio de venta por debajo del costo.</>
                                : <><strong>Margen bajo</strong> — alguna presentación tiene margen inferior al 15 %. Estándar farmacéutico: 20–35 %.</>}
                        </div>
                    )}

                    {/* ── Main layout: two columns ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">

                        {/* ── LEFT: Foto ── */}
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-1.5">
                                <Camera size={9} /> Foto del producto
                            </p>
                            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />
                            <button onClick={() => fileRef.current?.click()}
                                className="relative w-full aspect-square max-w-[200px] rounded-2xl border-2 border-dashed overflow-hidden transition-all duration-200 group
                                    border-slate-200 hover:border-[#007AFF]/50 bg-slate-50/70 hover:bg-blue-50/30">
                                {localFoto ? (
                                    <>
                                        <img src={localFoto} alt="" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/0 group-hover:bg-black/45 transition-all">
                                            {photoLoading
                                                ? <Loader2 size={22} className="text-white animate-spin" />
                                                : <>
                                                    <Camera size={22} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    <span className="text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">Cambiar foto</span>
                                                </>}
                                        </div>
                                    </>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                                        {photoLoading
                                            ? <Loader2 size={24} className="text-[#007AFF] animate-spin" />
                                            : <>
                                                <Camera size={24} className="text-slate-300 group-hover:text-[#007AFF] transition-colors" />
                                                <span className="text-[10px] font-semibold text-slate-400 group-hover:text-[#007AFF] transition-colors">Subir foto</span>
                                                <span className="text-[8px] text-slate-300">JPG, PNG o WebP</span>
                                            </>}
                                    </div>
                                )}
                            </button>
                        </div>

                        {/* ── RIGHT: Precios + Changelog ── */}
                        <div className="space-y-4 min-w-0">

                            {/* Prices */}
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-2">
                                    Presentaciones y precios
                                    {hasChanges && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                            <AlertTriangle size={8} /> cambios
                                        </span>
                                    )}
                                </p>

                                {precios.length === 0 ? (
                                    <div className="flex items-center gap-2 text-[11px] text-slate-400 py-3 px-3 rounded-xl bg-slate-50 border border-slate-100">
                                        <Info size={12} className="text-slate-300 shrink-0" />
                                        Sin presentaciones en el ERP.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto rounded-xl border border-slate-100 shadow-sm">
                                        <table className="min-w-full text-sm">
                                            <thead>
                                                <tr className="bg-slate-50/95 border-b border-slate-200/60">
                                                    <th className="px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 text-left whitespace-nowrap">Presentación</th>
                                                    <th className="px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 text-center">Factor</th>
                                                    <th className="px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 text-right">Costo</th>
                                                    {PRICE_FIELDS.map(f => (
                                                        <th key={f.key} className="px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">{f.label}</th>
                                                    ))}
                                                    <th className="px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-slate-400 text-center">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {precios.map(pp => {
                                                    const pCh = changesMap[pp.id_presentacion] || {};
                                                    const rowChanged = Object.keys(pCh).length > 0;
                                                    const worst = worstMarginOf(pp);
                                                    return (
                                                        <tr key={pp.id_presentacion} className={
                                                            rowChanged ? 'bg-amber-50/60' :
                                                            worst !== null && worst < 0 ? 'bg-red-50/30' :
                                                            'bg-white'
                                                        }>
                                                            <td className="px-3 py-2.5 whitespace-nowrap">
                                                                <span className="text-[12px] font-semibold text-slate-700">{pp.presentaciones?.tipo || '—'}</span>
                                                                {pp.presentaciones?.descripcion && (
                                                                    <span className="text-[9px] text-slate-400 ml-1">{pp.presentaciones.descripcion}</span>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center text-[11px] text-slate-500">{pp.presentaciones?.factor ?? '—'}</td>
                                                            <td className="px-3 py-2.5 text-right text-[11px] font-medium text-slate-500">{fmtP(pp.costo)}</td>
                                                            {PRICE_FIELDS.map(f => {
                                                                const ch = pCh[f.key];
                                                                const m  = calcMargin(pp[f.key], pp.costo);
                                                                return (
                                                                    <td key={f.key} className={`px-3 py-2.5 text-right ${ch ? 'bg-amber-50' : ''}`}>
                                                                        <div className="flex flex-col items-end gap-0.5">
                                                                            <span className={`text-[12px] font-semibold ${ch ? 'text-amber-700' : 'text-slate-700'}`}>
                                                                                {fmtP(pp[f.key])}
                                                                            </span>
                                                                            {ch && (
                                                                                <span className="text-[9px] text-slate-400 line-through whitespace-nowrap">
                                                                                    {fmtP(ch.anterior)}
                                                                                </span>
                                                                            )}
                                                                            <MarginPct pct={m} />
                                                                        </div>
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className="px-3 py-2.5 text-center">
                                                                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${pp.activo !== false ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-400'}`}>
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
                            </div>

                            {/* Changelog */}
                            {prodLog.length > 0 && (
                                <div className="rounded-xl bg-amber-50/50 border border-amber-100 px-3.5 py-3 space-y-1.5">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-1.5">
                                        <History size={9} /> Cambios en el producto
                                    </p>
                                    {prodLog.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                                            <span className="font-mono text-[10px] text-slate-400 shrink-0 bg-white border border-slate-100 px-1.5 py-0.5 rounded">
                                                {new Date(c.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                            </span>
                                            <span className="font-semibold text-slate-600">{c.campo}</span>
                                            <span className="text-slate-400 line-through text-[10px]">{c.valor_anterior || '—'}</span>
                                            <span className="text-slate-300 text-[9px] font-bold">→</span>
                                            <span className="text-slate-800 font-medium">{c.valor_nuevo || '—'}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Principios activos + Ubicaciones side by side ── */}
                    <div className="border-t border-slate-100/80 pt-4 flex flex-col md:flex-row gap-5 items-start">

                        {/* Principios activos */}
                        <div className="shrink-0 min-w-[220px]">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-1.5">
                                <FlaskConical size={9} /> Principios activos
                            </p>
                            <PrincipiosEditor
                                ref={principiosRef}
                                productId={product.id}
                                initial={principles}
                                onSaved={(saved, text) => onPrinciplesUpdated(product.id, saved, text)}
                            />
                        </div>

                        <div className="w-px self-stretch bg-slate-100 hidden md:block shrink-0" />

                        {/* Ubicaciones */}
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-1.5">
                                <MapPin size={9} /> Ubicaciones por sucursal
                            </p>
                            <LocationGrid
                                ref={locationRef}
                                productId={product.id}
                                initial={data?.locations}
                                branches={branches}
                            />
                        </div>
                    </div>

                    {/* ── Guardar / Cancelar ── */}
                    <div className="border-t border-slate-100/80 pt-4 flex items-center justify-end gap-2">
                        <button onClick={onClose}
                            className="px-4 h-9 rounded-full text-[11px] font-bold text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700 transition-all bg-white">
                            Cancelar
                        </button>
                        <button onClick={handleSave} disabled={saving}
                            className="flex items-center gap-1.5 px-5 h-9 rounded-full text-[11px] font-black bg-[#007AFF] text-white shadow-[0_3px_8px_rgba(0,122,255,0.35)] hover:bg-[#0066CC] hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-wait disabled:translate-y-0">
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
                            Guardar
                        </button>
                    </div>

                </div>
            </td>
        </tr>
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
    filterAntibiotico = null,
    setFilterAntibiotico,
    labOptions        = [],
    catOptions        = [],
}) {
    const branches = useStaff(s => s.branches);

    const [products, setProducts]     = useState([]);
    const [total, setTotal]           = useState(0);
    const [loading, setLoading]       = useState(false);
    const [page, setPage]             = useState(1);
    const [pageSize, setPageSize]     = useState(25);
    const [expandedId, setExpandedId] = useState(null);
    const [expandedCache, setExpandedCache] = useState({});
    const [loadingExpandedId, setLoadingExpandedId] = useState(null);

    // Margin filter (controlled by stat cards in body)
    const [filterMargin, setFilterMargin] = useState('all');

    // Sort
    const [sortField, setSortField] = useState('nombre');
    const [sortDir,   setSortDir]   = useState('asc');

    // Per-row indicators
    const [changedIds, setChangedIds] = useState(new Set());
    const [marginMap,  setMarginMap]  = useState({});

    // Margin stats (loaded once, used for stat cards)
    const [marginStats,       setMarginStats]       = useState(null);
    const [statsLoading,      setStatsLoading]      = useState(false);
    const [productStats,      setProductStats]      = useState(null);
    const [productStatsLoading, setProductStatsLoading] = useState(false);

    // Prefetch
    const prefetchTimerRef = useRef(null);
    const prefetchingRef   = useRef(new Set());

    // ── Load margin stats once ──────────────────────────────────────────────
    useEffect(() => {
        setStatsLoading(true);
        supabase.from('product_precios')
            .select(`product_id, costo, ${PRICE_SELECT}`)
            .eq('activo', true)
            .gt('costo', 0)
            .limit(10000)
            .then(({ data }) => {
                const perdidaIds = new Set();
                const bajoIds    = new Set();
                (data || []).forEach(pp => {
                    const w = worstMarginOf(pp);
                    if (w === null) return;
                    if (w < 0)  perdidaIds.add(pp.product_id);
                    if (w < 15) bajoIds.add(pp.product_id);
                });
                setMarginStats({ perdidaIds, bajoIds });
                setStatsLoading(false);
            });
    }, []);

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

    // ── loadProducts ────────────────────────────────────────────────────────
    const loadProducts = useCallback(async (q, pg, ps, fa, bids, lab, cat, anti, sField, sDir) => {
        setLoading(true);
        try {
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, foto_url, laboratorios(nombre)', { count: 'exact' })
                .range((pg - 1) * ps, pg * ps - 1);

            // Filters
            if (q.trim()) qb = qb.ilike('nombre', `%${q.trim()}%`);
            if (fa === 'activos') qb = qb.eq('activo', true);
            if (lab)  qb = qb.eq('laboratorio_id', lab);
            if (cat)  qb = qb.eq('tipo_medicamento', cat);
            if (anti !== null) qb = qb.eq('es_antibiotico', anti);
            if (bids !== null) {
                if (bids.length === 0) { setProducts([]); setTotal(0); setLoading(false); return; }
                qb = qb.in('id', bids);
            }

            // Sort
            if (sField === 'nombre')          qb = qb.order('nombre', { ascending: sDir === 'asc' });
            else if (sField === 'activo')      qb = qb.order('activo', { ascending: sDir === 'asc' }).order('nombre');
            else if (sField === 'categoria')   qb = qb.order('tipo_medicamento', { ascending: sDir === 'asc', nullsFirst: false }).order('nombre');
            else                               qb = qb.order('nombre');

            const { data, count, error } = await qb;
            if (error) throw error;
            const rows = data || [];
            setProducts(rows);
            setTotal(count || 0);

            if (rows.length > 0) {
                const ids = rows.map(r => r.id);
                const [{ data: pc }, { data: prc }, { data: pp }] = await Promise.all([
                    supabase.from('product_precios_changelog').select('product_id').in('product_id', ids),
                    supabase.from('products_changelog').select('product_id').in('product_id', ids),
                    supabase.from('product_precios').select(`product_id, costo, ${PRICE_SELECT}`).in('product_id', ids).eq('activo', true).gt('costo', 0),
                ]);
                setChangedIds(new Set([...(pc || []).map(c => c.product_id), ...(prc || []).map(c => c.product_id)]));
                const mm = {};
                (pp || []).forEach(row => {
                    const w = worstMarginOf(row);
                    if (w === null) return;
                    if (mm[row.product_id] === undefined || w < mm[row.product_id]) mm[row.product_id] = w;
                });
                setMarginMap(mm);
            } else {
                setChangedIds(new Set());
                setMarginMap({});
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    // Reset page on filter/sort changes
    useEffect(() => { setPage(1); }, [searchTerm, pageSize, filterActivo, filterMargin, filterLab, filterCategoria, filterAntibiotico, sortField]);

    // Trigger load
    useEffect(() => {
        if (filterMargin !== 'all' && marginStats === null && !statsLoading) return;
        if (filterMargin !== 'all' && statsLoading) return;

        const bids = filterMargin === 'all'    ? null
                   : filterMargin === 'perdida' ? [...(marginStats?.perdidaIds || [])]
                   :                              [...(marginStats?.bajoIds    || [])];

        const t = setTimeout(() =>
            loadProducts(searchTerm, page, pageSize, filterActivo, bids, filterLab, filterCategoria, filterAntibiotico, sortField, sortDir),
            200
        );
        return () => clearTimeout(t);
    }, [searchTerm, page, pageSize, filterActivo, filterMargin, marginStats, statsLoading, filterLab, filterCategoria, filterAntibiotico, sortField, sortDir, loadProducts]);

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
                const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: locations }, { data: principles }] = await Promise.all([
                    supabase.from('product_precios').select(`id_presentacion, activo, costo, ${PRICE_SELECT}, presentaciones(tipo, descripcion, factor)`).eq('product_id', productId).order('activo', { ascending: false }),
                    supabase.from('product_precios_changelog').select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                    supabase.from('products_changelog').select('campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }).limit(20),
                    supabase.from('product_locations').select('branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano').eq('product_id', productId),
                    supabase.from('product_active_principles').select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden'),
                ]);
                setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], locations: locations || [], principles: principles || [] } }));
            } catch { /* silent */ }
        }, 120);
    }, [expandedCache]);

    const cancelPrefetch = useCallback(() => { clearTimeout(prefetchTimerRef.current); }, []);

    const toggleRow = useCallback(async (productId) => {
        cancelPrefetch();
        if (expandedId === productId) { setExpandedId(null); return; }
        setExpandedId(productId);
        if (expandedCache[productId]) return;
        setLoadingExpandedId(productId);
        prefetchingRef.current.add(productId);
        try {
            const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: locations }, { data: principles }] = await Promise.all([
                supabase.from('product_precios').select(`id_presentacion, activo, costo, ${PRICE_SELECT}, presentaciones(tipo, descripcion, factor)`).eq('product_id', productId).order('activo', { ascending: false }),
                supabase.from('product_precios_changelog').select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }),
                supabase.from('products_changelog').select('campo, valor_anterior, valor_nuevo, detected_at').eq('product_id', productId).order('detected_at', { ascending: false }).limit(20),
                supabase.from('product_locations').select('branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano').eq('product_id', productId),
                supabase.from('product_active_principles').select('id, nombre, concentracion, orden').eq('product_id', productId).order('orden'),
            ]);
            setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], locations: locations || [], principles: principles || [] } }));
        } finally { setLoadingExpandedId(null); }
    }, [expandedId, expandedCache, cancelPrefetch]);

    const handlePhotoUpdated = useCallback((productId, url) => {
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, foto_url: url } : p));
    }, []);

    const handlePrinciplesUpdated = useCallback((productId, saved, text) => {
        setExpandedCache(c => ({ ...c, [productId]: { ...(c[productId] || {}), principles: saved } }));
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, principio_activo: text } : p));
    }, []);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const selectedLab = labOptions.find(o => o.value === String(filterLab));
    const labW = selectedLab ? Math.max(150, Math.min(260, 90 + selectedLab.label.length * 7)) : 150;
    const catW = filterCategoria ? Math.max(140, Math.min(220, 90 + filterCategoria.length * 7)) : 140;
    const hasActiveFilters = filterLab !== null || filterCategoria !== null
                           || filterAntibiotico !== null || filterActivo === 'todos';
    const resetFilters = () => {
        setFilterLab?.(null); setFilterCategoria?.(null);
        setFilterAntibiotico?.(null); setFilterActivo?.('activos');
    };

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

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
                    />
                    {!loading && total > 0 && (
                        <span className="text-[10px] text-slate-400 ml-1">{total.toLocaleString()} productos</span>
                    )}
                </div>

                {/* Filter pill — desktop only, same style as Ventas */}
                <div className="hidden lg:flex group items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">

                    {/* Activos / Todos */}
                    <div className="flex items-center gap-0.5 px-2.5 py-2">
                        {[['activos', 'Activos'], ['todos', 'Todos']].map(([v, label]) => (
                            <button key={v} onClick={() => setFilterActivo?.(v)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                    filterActivo === v
                                        ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                }`}>{label}</button>
                        ))}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Laboratorio */}
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: labW + 'px' }}>
                            <LiquidSelect
                                value={filterLab ? String(filterLab) : ''}
                                onChange={v => setFilterLab?.(v ? parseInt(v) : null)}
                                options={labOptions}
                                placeholder="Laboratorio"
                                icon={Building2}
                                compact
                            />
                        </div>
                        {filterLab && (
                            <button onClick={() => setFilterLab?.(null)} title="Quitar laboratorio"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Categoría */}
                    <div className="flex items-center">
                        <div className="px-2 py-2 overflow-visible transition-all duration-200" style={{ width: catW + 'px' }}>
                            <LiquidSelect
                                value={filterCategoria || ''}
                                onChange={v => setFilterCategoria?.(v || null)}
                                options={catOptions}
                                placeholder="Categoría"
                                icon={Tag}
                                compact
                            />
                        </div>
                        {filterCategoria && (
                            <button onClick={() => setFilterCategoria?.(null)} title="Quitar categoría"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    <div className="h-5 w-px bg-slate-100 shrink-0" />

                    {/* Antibiótico */}
                    <div className="flex items-center">
                        <button onClick={() => setFilterAntibiotico?.(v => v === true ? null : true)}
                            className={`mx-3 my-2 px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                                filterAntibiotico === true
                                    ? 'bg-orange-100 text-orange-700 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            }`}>Antibiótico</button>
                        {filterAntibiotico && (
                            <button onClick={() => setFilterAntibiotico?.(null)} title="Quitar filtro"
                                className="mr-1.5 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-50 hover:bg-red-500 text-red-400 hover:text-white transition-all shrink-0 hover:scale-110">
                                <X size={9} strokeWidth={3} />
                            </button>
                        )}
                    </div>

                    {/* Clear all */}
                    {hasActiveFilters && (
                        <>
                            <div className="h-5 w-px bg-slate-100 shrink-0" />
                            <button onClick={resetFilters} title="Limpiar todos los filtros"
                                className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all duration-200 shrink-0 hover:scale-110">
                                <X size={11} strokeWidth={3} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Table ── */}
            {loading ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <table className="min-w-full">
                        <tbody>
                            {Array.from({ length: 8 }).map((_, i) => (
                                <tr key={i} className="border-b border-slate-50 last:border-0">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-slate-100 animate-pulse shrink-0" />
                                            <div className="space-y-1.5">
                                                <div className="h-3 w-40 rounded-full bg-slate-100 animate-pulse" />
                                                <div className="h-2.5 w-24 rounded-full bg-slate-100 animate-pulse" />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-28 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 hidden sm:table-cell"><div className="h-5 w-14 rounded-full bg-slate-100 animate-pulse" /></td>
                                    <td className="px-4 py-3 w-10" />
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : products.length === 0 ? (
                <div className="rounded-2xl border border-black/[0.07] bg-white shadow-sm py-20 text-center text-slate-400">
                    <Package size={32} className="opacity-30 mx-auto mb-3" />
                    <p className="text-sm">No se encontraron productos</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                    <SortTh field="nombre"    label="Producto"    sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                                    <SortTh field="lab"       label="Laboratorio" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="hidden md:table-cell" />
                                    <SortTh field="categoria" label="Categoría"   sortField={sortField} sortDir={sortDir} onSort={handleSort} className="hidden lg:table-cell" />
                                    <SortTh field="activo"    label="Estado"      sortField={sortField} sortDir={sortDir} onSort={handleSort} className="hidden sm:table-cell" />
                                    <th className="px-4 py-3 w-10" />
                                </tr>
                            </thead>
                            <tbody>
                                {products.map(p => {
                                    const isExpanded    = expandedId === p.id;
                                    const isLoadingThis = loadingExpandedId === p.id;
                                    const hasChanges    = changedIds.has(p.id);
                                    const worstM        = marginMap[p.id];
                                    const mInfo         = worstM !== undefined ? marginLabel(worstM) : null;
                                    const isInactive    = !p.activo && filterActivo === 'todos';
                                    return (
                                        <React.Fragment key={p.id}>
                                            <tr
                                                onClick={() => toggleRow(p.id)}
                                                onMouseEnter={() => prefetchRow(p.id)}
                                                onMouseLeave={cancelPrefetch}
                                                className={`border-t border-black/[0.04] cursor-pointer transition-colors ${
                                                    isExpanded   ? 'bg-blue-50/50' :
                                                    isInactive   ? 'hover:bg-slate-50/60 opacity-55' :
                                                    'hover:bg-slate-50/70'
                                                }`}>

                                                {/* Producto */}
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-3">
                                                        {p.foto_url ? (
                                                            <img src={p.foto_url} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" />
                                                        ) : (
                                                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                                                                <Package size={14} className="text-slate-300" />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className={`text-[12px] font-bold leading-tight ${isInactive ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700'}`}>
                                                                    {p.nombre}
                                                                </span>
                                                                {mInfo && (
                                                                    <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold border px-1.5 py-0.5 rounded-full shrink-0 ${mInfo.cls}`}>
                                                                        {worstM < 0 ? <ShieldAlert size={7} /> : <TrendingDown size={7} />}
                                                                        {mInfo.label}
                                                                    </span>
                                                                )}
                                                                {hasChanges && (
                                                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                                                                        <AlertTriangle size={7} /> cambios
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {p.principio_activo && (
                                                                <p className="text-[10px] text-violet-500/70 flex items-center gap-1 mt-0.5">
                                                                    <FlaskConical size={8} className="shrink-0" />
                                                                    <span className="truncate max-w-[240px]">{p.principio_activo}</span>
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Laboratorio */}
                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    <span className="text-[11px] text-slate-500">{p.laboratorios?.nombre || '—'}</span>
                                                </td>

                                                {/* Categoría */}
                                                <td className="px-4 py-2.5 hidden lg:table-cell">
                                                    <div className="flex flex-wrap gap-1">
                                                        {p.tipo_medicamento && (
                                                            <span className="text-[9px] font-semibold px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full whitespace-nowrap">
                                                                {p.tipo_medicamento}
                                                            </span>
                                                        )}
                                                        {p.es_antibiotico && (
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full">
                                                                Antibiótico
                                                            </span>
                                                        )}
                                                        {p.requiere_receta && (
                                                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full">
                                                                Receta
                                                            </span>
                                                        )}
                                                        {!p.tipo_medicamento && !p.es_antibiotico && !p.requiere_receta && (
                                                            <span className="text-slate-300 text-[11px]">—</span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Estado */}
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide border ${
                                                        p.activo
                                                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                            : 'bg-slate-100 text-slate-400 border-slate-200'
                                                    }`}>
                                                        {p.activo ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </td>

                                                {/* Chevron */}
                                                <td className="px-4 py-2.5">
                                                    {isLoadingThis
                                                        ? <Loader2 size={13} className="animate-spin text-blue-400 mx-auto" />
                                                        : <ChevronDown size={13} className={`text-slate-300 transition-transform duration-200 mx-auto ${isExpanded ? 'rotate-180 text-blue-400' : ''}`} />
                                                    }
                                                </td>
                                            </tr>

                                            {isExpanded && (
                                                <ExpandedProductRow
                                                    product={p}
                                                    data={expandedCache[p.id]}
                                                    loadingRow={isLoadingThis && !expandedCache[p.id]}
                                                    branches={branches}
                                                    onPhotoUpdated={handlePhotoUpdated}
                                                    onPrinciplesUpdated={handlePrinciplesUpdated}
                                                    onClose={() => setExpandedId(null)}
                                                />
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Pagination ── */}
            {!loading && products.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        {PAGE_SIZES.map(size => (
                            <button key={size}
                                onClick={() => { setPageSize(size); setPage(1); }}
                                className={`px-3 h-7 rounded-full text-[10px] font-bold transition-all border ${
                                    pageSize === size
                                        ? 'bg-[#007AFF] text-white border-[#007AFF] shadow-sm'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                                }`}>
                                {size}
                            </button>
                        ))}
                    </div>
                    <SmartPagination page={page} total={totalPages} onChange={setPage} />
                    <span className="text-[10px] text-slate-400 font-semibold w-[80px] text-right">
                        {total.toLocaleString()} total
                    </span>
                </div>
            )}
        </div>
    );
}
