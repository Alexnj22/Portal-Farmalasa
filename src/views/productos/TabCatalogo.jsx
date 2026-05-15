import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    Package, FlaskConical, MapPin, Check, Loader2,
    ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Info,
    Camera, TrendingDown, ShieldAlert,
} from 'lucide-react';

const PAGE_SIZES = [25, 50, 100];

const PRICE_FIELDS = [
    { key: 'vineta',      label: 'Víneta'  },
    { key: 'descuento_1', label: 'Desc. 1' },
    { key: 'vip',         label: 'VIP'     },
    { key: 'clinica',     label: 'Clínica' },
    { key: 'mayoreo',     label: 'Mayoreo' },
    { key: 'premium',     label: 'Premium' },
];

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

// Returns { vineta: %, vip: %, … } — only fields with a valid margin
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

function MarginPct({ pct }) {
    if (pct === null) return <span className="text-[9px] text-slate-300">—</span>;
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

// ── ExpandedProductRow ────────────────────────────────────────────────────────

function ExpandedProductRow({ product, data, loadingRow, branches, onPhotoUpdated }) {
    const [locations, setLocations]       = useState([]);
    const [saving, setSaving]             = useState(false);
    const [photoLoading, setPhotoLoading] = useState(false);
    const [showLocations, setShowLocations] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        if (!data) return;
        const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));
        setLocations(farmBranches.map(b => {
            const saved = (data.locations || []).find(l => l.branch_id === b.id);
            return {
                branch_id:   b.id,
                branch_name: b.name,
                tipo:    saved?.estante ? 'estante' : 'vitrina',
                numero:  saved?.estante || saved?.vitrina || '',
                peldano: saved?.peldano || '',
            };
        }));
        // auto-open if any branch already has a location saved
        if ((data.locations || []).length > 0) setShowLocations(true);
    }, [data, branches]);

    const setLocField = (i, field, value) =>
        setLocations(ls => ls.map((l, j) => j === i ? { ...l, [field]: value } : l));

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoLoading(true);
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            const path = `${product.id}.${ext}`;
            const { error: upErr } = await supabase.storage.from('product-photos').upload(path, file, { upsert: true });
            if (upErr) throw upErr;
            const { data: { publicUrl } } = supabase.storage.from('product-photos').getPublicUrl(path);
            await supabase.from('products').update({ foto_url: publicUrl }).eq('id', product.id);
            onPhotoUpdated(product.id, publicUrl);
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally { setPhotoLoading(false); e.target.value = ''; }
    };

    const saveLocations = async () => {
        setSaving(true);
        try {
            const toUpsert = locations
                .filter(l => l.numero.trim() || l.peldano.trim())
                .map(l => ({
                    product_id: product.id, branch_id: l.branch_id,
                    vitrina:    l.tipo === 'vitrina' ? (l.numero.trim() || null) : null,
                    estante:    l.tipo === 'estante' ? (l.numero.trim() || null) : null,
                    peldano:    l.peldano.trim() || null,
                    updated_at: new Date().toISOString(),
                }));
            const toDelete = locations
                .filter(l => !l.numero.trim() && !l.peldano.trim())
                .map(l => l.branch_id);
            if (toUpsert.length > 0)
                await supabase.from('product_locations').upsert(toUpsert, { onConflict: 'product_id,branch_id' });
            if (toDelete.length > 0)
                await supabase.from('product_locations').delete().eq('product_id', product.id).in('branch_id', toDelete);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_LOCATIONS', String(product.id), { branches: toUpsert.length });
            useToastStore.getState().showToast('Guardado', 'Ubicaciones actualizadas.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    if (loadingRow) {
        return (
            <tr className="border-t border-blue-100/60">
                <td colSpan={5} className="px-5 py-4 bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 backdrop-blur-sm">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <Loader2 size={12} className="animate-spin text-blue-400" /> Cargando detalle...
                    </div>
                </td>
            </tr>
        );
    }

    // Price changelog map: { [id_presentacion]: { [campo]: { anterior } } }
    const changesMap = {};
    (data?.changelog || []).forEach(c => {
        if (!changesMap[c.id_presentacion]) changesMap[c.id_presentacion] = {};
        const ex = changesMap[c.id_presentacion][c.campo];
        if (!ex || new Date(c.detected_at) > new Date(ex.detected_at))
            changesMap[c.id_presentacion][c.campo] = { anterior: c.valor_anterior, detected_at: c.detected_at };
    });

    const precios    = data?.precios  || [];
    const prodLog    = data?.prodLog  || [];
    const hasChanges = Object.keys(changesMap).length > 0 || prodLog.length > 0;

    // Worst margin across all active precios
    const worstOverall = precios.length
        ? precios.reduce((min, pp) => {
            const w = worstMarginOf(pp);
            if (w === null) return min;
            return min === null ? w : Math.min(min, w);
        }, null)
        : null;

    return (
        <tr className="border-t border-blue-100/60">
            <td colSpan={5} className="px-0 py-0 bg-gradient-to-br from-blue-50/40 via-white/60 to-slate-50/30 backdrop-blur-sm">
                <div className="px-5 py-4 space-y-4">

                    {/* ── Alert banner ── */}
                    {worstOverall !== null && worstOverall < 15 && (
                        <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-[11px] ${
                            worstOverall < 0
                                ? 'bg-red-50 border-red-200 text-red-700'
                                : 'bg-amber-50 border-amber-200 text-amber-700'
                        }`}>
                            {worstOverall < 0 ? <ShieldAlert size={14} className="shrink-0 mt-0.5 text-red-500" /> : <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />}
                            <span>
                                {worstOverall < 0
                                    ? <><strong>Pérdida detectada</strong> — alguna presentación tiene precio de venta por debajo del costo.</>
                                    : <><strong>Margen bajo</strong> — alguna presentación tiene margen inferior al 15%. Estándar farmacéutico: 20–35%.</>}
                            </span>
                        </div>
                    )}

                    {/* ── Header: section label + photo button ── */}
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                            Presentaciones y precios
                            {hasChanges && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                    <AlertTriangle size={8} /> cambios
                                </span>
                            )}
                        </span>
                        <button onClick={() => fileRef.current?.click()}
                            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-[#007AFF] transition-colors font-semibold">
                            {photoLoading ? <Loader2 size={10} className="animate-spin" /> : <Camera size={10} />}
                            {product.foto_url ? 'Cambiar foto' : 'Agregar foto'}
                        </button>
                        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />
                    </div>

                    {/* ── Price table ── */}
                    {precios.length === 0 ? (
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 py-2">
                            <Info size={12} className="text-slate-300 shrink-0" />
                            Sin presentaciones en el ERP.
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-xl border border-slate-100">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/95 border-b border-slate-200/60">
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 text-left whitespace-nowrap">Presentación</th>
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 text-center">Factor</th>
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 text-right">Costo</th>
                                        {PRICE_FIELDS.map(f => (
                                            <th key={f.key} className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 text-right whitespace-nowrap">{f.label}</th>
                                        ))}
                                        <th className="px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 text-center">Estado</th>
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
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span className="text-[11px] font-semibold text-slate-700">{pp.presentaciones?.tipo || '—'}</span>
                                                    {pp.presentaciones?.descripcion && (
                                                        <span className="text-[9px] text-slate-400 ml-1">{pp.presentaciones.descripcion}</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[10px] text-slate-500">{pp.presentaciones?.factor ?? '—'}</td>
                                                <td className="px-3 py-2 text-right text-[11px] text-slate-400">{fmtP(pp.costo)}</td>
                                                {PRICE_FIELDS.map(f => {
                                                    const ch = pCh[f.key];
                                                    const m = calcMargin(pp[f.key], pp.costo);
                                                    return (
                                                        <td key={f.key} className={`px-3 py-2 text-right ${ch ? 'bg-amber-50' : ''}`}>
                                                            <div className="flex flex-col items-end gap-0.5">
                                                                <span className={`text-[11px] font-semibold ${ch ? 'text-amber-700' : 'text-slate-700'}`}>
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
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${pp.activo !== false ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
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

                    {/* ── Product-level changelog ── */}
                    {prodLog.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Cambios en el producto</p>
                            {prodLog.map((c, i) => (
                                <div key={i} className="flex items-center gap-2 text-[11px] flex-wrap">
                                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                                        {new Date(c.detected_at).toLocaleDateString('es-SV', { month: 'short', day: 'numeric' })}
                                    </span>
                                    <span className="font-semibold text-slate-600">{c.campo}</span>
                                    <span className="text-slate-400 line-through text-[10px]">{c.valor_anterior || '—'}</span>
                                    <span className="text-slate-300 text-[9px]">→</span>
                                    <span className="text-slate-800 font-medium">{c.valor_nuevo || '—'}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── Ubicación ── */}
                    <div>
                        <button
                            onClick={() => setShowLocations(v => !v)}
                            className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all ${
                                showLocations
                                    ? 'bg-blue-50 border-blue-200 text-[#007AFF]'
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-blue-200 hover:text-[#007AFF]'
                            }`}>
                            <MapPin size={10} />
                            {showLocations ? 'Ocultar ubicación' : 'Ver / agregar ubicación'}
                            <ChevronDown size={10} className={`transition-transform duration-200 ${showLocations ? 'rotate-180' : ''}`} />
                        </button>

                        {showLocations && (
                            <div className="mt-3 rounded-xl border border-slate-100 bg-white overflow-hidden w-full max-w-sm">
                                {locations.length === 0 ? (
                                    <p className="text-[11px] text-slate-300 italic px-3 py-3">Sin sucursales configuradas.</p>
                                ) : (
                                    <>
                                        {locations.map((loc, i) => {
                                            const hasData = loc.numero.trim() || loc.peldano.trim();
                                            return (
                                                <div key={loc.branch_id} className={`flex items-center gap-2 px-3 py-2.5 ${i > 0 ? 'border-t border-slate-50' : ''} ${hasData ? '' : 'opacity-60'}`}>
                                                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-400 w-[54px] shrink-0">{loc.branch_name}</span>
                                                    <div className="flex items-center bg-slate-100 rounded-full p-0.5 shrink-0">
                                                        {['vitrina', 'estante'].map(t => (
                                                            <button key={t}
                                                                onClick={() => setLocField(i, 'tipo', t)}
                                                                className={`px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-wide transition-all ${
                                                                    loc.tipo === t ? 'bg-white text-[#007AFF] shadow-sm' : 'text-slate-400'
                                                                }`}>
                                                                {t.charAt(0).toUpperCase() + t.slice(1)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <input value={loc.numero}
                                                        onChange={e => setLocField(i, 'numero', e.target.value)}
                                                        placeholder="N°"
                                                        className="w-[34px] px-1.5 py-1 border border-slate-200 rounded-lg text-[10px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 bg-slate-50 text-center" />
                                                    <span className="text-[8px] text-slate-300 shrink-0">Peld.</span>
                                                    <input value={loc.peldano}
                                                        onChange={e => setLocField(i, 'peldano', e.target.value)}
                                                        placeholder="—"
                                                        className="w-[34px] px-1.5 py-1 border border-slate-200 rounded-lg text-[10px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/20 bg-slate-50 text-center" />
                                                </div>
                                            );
                                        })}
                                        <div className="px-3 py-2.5 border-t border-slate-50">
                                            <button onClick={saveLocations} disabled={saving}
                                                className="w-full py-1.5 rounded-lg bg-[#007AFF] text-white text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-[#0055CC] transition-colors disabled:opacity-50">
                                                {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                                {saving ? 'Guardando...' : 'Guardar ubicaciones'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                </div>
            </td>
        </tr>
    );
}

// ── TabCatalogo ───────────────────────────────────────────────────────────────

const PRICE_SELECT = PRICE_FIELDS.map(f => f.key).join(', ');

export default function TabCatalogo({ searchTerm = '' }) {
    const branches = useStaff(s => s.branches);

    const [products, setProducts]           = useState([]);
    const [total, setTotal]                 = useState(0);
    const [loading, setLoading]             = useState(false);
    const [page, setPage]                   = useState(1);
    const [pageSize, setPageSize]           = useState(25);
    const [expandedId, setExpandedId]       = useState(null);
    const [expandedCache, setExpandedCache] = useState({});
    const [loadingExpandedId, setLoadingExpandedId] = useState(null);
    const [filterActivo, setFilterActivo]   = useState('activos');
    const [filterMargin, setFilterMargin]   = useState('all'); // 'all' | 'perdida' | 'bajo'
    const [changedIds, setChangedIds]       = useState(new Set());
    const [marginMap, setMarginMap]         = useState({});
    const [badMarginIds, setBadMarginIds]   = useState(null);
    const [loadingBadIds, setLoadingBadIds] = useState(false);

    const prefetchTimerRef = useRef(null);
    const prefetchingRef   = useRef(new Set());

    // Load bad margin IDs when filter changes
    useEffect(() => {
        if (filterMargin === 'all') { setBadMarginIds(null); return; }
        setLoadingBadIds(true);
        // Fetch ALL product_precios rows (limit 10000 to bypass Supabase 1000 default)
        supabase.from('product_precios')
            .select(`product_id, costo, ${PRICE_SELECT}`)
            .eq('activo', true)
            .gt('costo', 0)
            .limit(10000)
            .then(({ data }) => {
                const seen = new Map();
                (data || []).forEach(pp => {
                    const w = worstMarginOf(pp);
                    if (w === null) return;
                    const prev = seen.get(pp.product_id);
                    if (prev === undefined || w < prev) seen.set(pp.product_id, w);
                });
                const ids = [];
                seen.forEach((m, pid) => {
                    const isBad = filterMargin === 'perdida' ? m < 0 : m < 15;
                    if (isBad) ids.push(pid);
                });
                setBadMarginIds(ids);
                setLoadingBadIds(false);
            });
    }, [filterMargin]);

    const loadProducts = useCallback(async (q, pg, ps, fa, bids) => {
        setLoading(true);
        try {
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, foto_url, laboratorios(nombre)', { count: 'exact' })
                .order('nombre')
                .range((pg - 1) * ps, pg * ps - 1);
            if (q.trim()) qb = qb.ilike('nombre', `%${q.trim()}%`);
            if (fa === 'activos') qb = qb.eq('activo', true);
            if (bids !== null) {
                if (bids.length === 0) { setProducts([]); setTotal(0); setLoading(false); return; }
                qb = qb.in('id', bids);
            }
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
                    supabase.from('product_precios')
                        .select(`product_id, costo, ${PRICE_SELECT}`)
                        .in('product_id', ids)
                        .eq('activo', true)
                        .gt('costo', 0),
                ]);
                setChangedIds(new Set([...(pc || []).map(c => c.product_id), ...(prc || []).map(c => c.product_id)]));

                const newMarginMap = {};
                (pp || []).forEach(row => {
                    const w = worstMarginOf(row);
                    if (w === null) return;
                    if (newMarginMap[row.product_id] === undefined || w < newMarginMap[row.product_id])
                        newMarginMap[row.product_id] = w;
                });
                setMarginMap(newMarginMap);
            } else {
                setChangedIds(new Set());
                setMarginMap({});
            }
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { setPage(1); }, [searchTerm, pageSize, filterActivo, filterMargin]);

    useEffect(() => {
        if (filterMargin !== 'all' && badMarginIds === null && !loadingBadIds) return;
        if (filterMargin !== 'all' && loadingBadIds) return;
        const t = setTimeout(() => loadProducts(searchTerm, page, pageSize, filterActivo, filterMargin === 'all' ? null : (badMarginIds || null)), 200);
        return () => clearTimeout(t);
    }, [searchTerm, page, pageSize, filterActivo, filterMargin, badMarginIds, loadingBadIds, loadProducts]);

    const prefetchRow = useCallback((productId) => {
        if (expandedCache[productId] || prefetchingRef.current.has(productId)) return;
        prefetchTimerRef.current = setTimeout(async () => {
            prefetchingRef.current.add(productId);
            try {
                const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: locations }] = await Promise.all([
                    supabase.from('product_precios')
                        .select(`id_presentacion, activo, costo, ${PRICE_SELECT}, presentaciones(tipo, descripcion, factor)`)
                        .eq('product_id', productId).order('activo', { ascending: false }),
                    supabase.from('product_precios_changelog')
                        .select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at')
                        .eq('product_id', productId).order('detected_at', { ascending: false }),
                    supabase.from('products_changelog')
                        .select('campo, valor_anterior, valor_nuevo, detected_at')
                        .eq('product_id', productId).order('detected_at', { ascending: false }).limit(20),
                    supabase.from('product_locations')
                        .select('branch_id, vitrina, estante, peldano')
                        .eq('product_id', productId),
                ]);
                setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], locations: locations || [] } }));
            } catch { /* silent */ }
        }, 120);
    }, [expandedCache]);

    const cancelPrefetch = useCallback(() => {
        clearTimeout(prefetchTimerRef.current);
    }, []);

    const toggleRow = useCallback(async (productId) => {
        cancelPrefetch();
        if (expandedId === productId) { setExpandedId(null); return; }
        setExpandedId(productId);
        if (expandedCache[productId]) return;
        setLoadingExpandedId(productId);
        prefetchingRef.current.add(productId);
        try {
            const [{ data: precios }, { data: changelog }, { data: prodLog }, { data: locations }] = await Promise.all([
                supabase.from('product_precios')
                    .select(`id_presentacion, activo, costo, ${PRICE_SELECT}, presentaciones(tipo, descripcion, factor)`)
                    .eq('product_id', productId).order('activo', { ascending: false }),
                supabase.from('product_precios_changelog')
                    .select('id_presentacion, campo, valor_anterior, valor_nuevo, detected_at')
                    .eq('product_id', productId).order('detected_at', { ascending: false }),
                supabase.from('products_changelog')
                    .select('campo, valor_anterior, valor_nuevo, detected_at')
                    .eq('product_id', productId).order('detected_at', { ascending: false }).limit(20),
                supabase.from('product_locations')
                    .select('branch_id, vitrina, estante, peldano')
                    .eq('product_id', productId),
            ]);
            setExpandedCache(c => ({ ...c, [productId]: { precios: precios || [], changelog: changelog || [], prodLog: prodLog || [], locations: locations || [] } }));
        } finally { setLoadingExpandedId(null); }
    }, [expandedId, expandedCache, cancelPrefetch]);

    const handlePhotoUpdated = useCallback((productId, url) => {
        setProducts(ps => ps.map(p => p.id === productId ? { ...p, foto_url: url } : p));
    }, []);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Filter chips ── */}
            <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-white/70 border border-slate-200 rounded-full p-0.5 gap-0.5">
                    {[['activos', 'Activos'], ['todos', 'Todos']].map(([v, label]) => (
                        <button key={v} onClick={() => setFilterActivo(v)}
                            className={`px-3 py-1 rounded-full text-[11px] font-bold transition-all ${
                                filterActivo === v ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'
                            }`}>{label}
                        </button>
                    ))}
                </div>

                <button onClick={() => setFilterMargin(v => v === 'perdida' ? 'all' : 'perdida')}
                    className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all select-none ${
                        filterMargin === 'perdida'
                            ? 'bg-red-100 border-red-300 text-red-700 ring-1 ring-red-200 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${filterMargin === 'perdida' ? 'bg-red-500' : 'bg-slate-300'}`} />
                    {loadingBadIds && filterMargin === 'perdida' ? <Loader2 size={9} className="animate-spin" /> : <ShieldAlert size={9} />}
                    Pérdida
                </button>

                <button onClick={() => setFilterMargin(v => v === 'bajo' ? 'all' : 'bajo')}
                    className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-full border transition-all select-none ${
                        filterMargin === 'bajo'
                            ? 'bg-amber-100 border-amber-300 text-amber-700 ring-1 ring-amber-200 shadow-sm'
                            : 'bg-white border-slate-200 text-slate-500 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600'
                    }`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${filterMargin === 'bajo' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                    {loadingBadIds && filterMargin === 'bajo' ? <Loader2 size={9} className="animate-spin" /> : <TrendingDown size={9} />}
                    Margen bajo
                </button>

                {!loading && total > 0 && (
                    <span className="text-[10px] text-slate-400 ml-1">{total.toLocaleString()} productos</span>
                )}
            </div>

            {/* ── Table card ── */}
            {loading ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">
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
                </div>
            ) : products.length === 0 ? (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm py-20 text-center text-slate-400">
                    <Package size={32} className="opacity-30 mx-auto mb-3" />
                    <p className="text-sm">No se encontraron productos</p>
                </div>
            ) : (
                <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                    <div className="overflow-x-auto w-full">
                        <table className="min-w-full text-sm">
                            <thead className="sticky top-0 z-10">
                                <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Producto</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Laboratorio</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell">Categoría</th>
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden sm:table-cell">Estado</th>
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
                                    return (
                                        <React.Fragment key={p.id}>
                                            <tr
                                                onClick={() => toggleRow(p.id)}
                                                onMouseEnter={() => prefetchRow(p.id)}
                                                onMouseLeave={cancelPrefetch}
                                                className={`border-t border-black/[0.04] cursor-pointer transition-colors ${
                                                    isExpanded ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'
                                                }`}>

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
                                                                <span className="text-[12px] font-bold text-slate-700 leading-tight">{p.nombre}</span>
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
                                                                <p className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                                                                    <FlaskConical size={8} className="shrink-0" />
                                                                    <span className="truncate max-w-[200px]">{p.principio_activo}</span>
                                                                </p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    <span className="text-[11px] text-slate-500">{p.laboratorios?.nombre || '—'}</span>
                                                </td>

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

                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-wide border ${
                                                        p.activo
                                                            ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                            : 'bg-slate-100 text-slate-400 border-slate-200'
                                                    }`}>
                                                        {p.activo ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </td>

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
