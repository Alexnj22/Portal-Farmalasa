import React, { useState, useEffect, useCallback, useRef, createPortal } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import LiquidSelect from '../../components/common/LiquidSelect';
import {
    Package, Building2, FlaskConical, DollarSign,
    TrendingUp, TrendingDown, AlertTriangle, Info,
    MapPin, Check, Loader2, Plus, Trash2, X, Camera,
    ChevronLeft, ChevronRight, Eye, EyeOff,
} from 'lucide-react';

const PAGE_SIZE_OPTIONS = [
    { value: '24', label: '24 cards' },
    { value: '48', label: '48 cards' },
    { value: '96', label: '96 cards' },
];

// ── SmartPagination (same as VentasView) ─────────────────────────────────────

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
        <div className="flex items-center gap-1.5 py-2">
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function MarginBadge({ costo, precio }) {
    const c = parseFloat(costo), p = parseFloat(precio);
    if (!c || !p || p === 0) return <span className="text-slate-300 text-[9px]">—</span>;
    const m = (p - c) / p * 100;
    const cls = m < 5
        ? 'bg-red-50 text-red-600 border-red-100'
        : m < 15
        ? 'bg-amber-50 text-amber-600 border-amber-100'
        : 'bg-emerald-50 text-emerald-600 border-emerald-100';
    return <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>{m.toFixed(1)}%</span>;
}

function ProfitSuggestion({ costs }) {
    const wd = (costs || []).filter(c => c.costo && c.precio_venta && parseFloat(c.precio_venta) > 0);
    if (!costs?.length || !wd.length) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-blue-50 border border-blue-100 rounded-xl text-[10px] text-blue-700">
            <Info size={11} className="shrink-0 mt-0.5" />
            <span>Agrega precio de venta para analizar la rentabilidad.</span>
        </div>
    );
    const avg = wd.reduce((s, c) => s + (parseFloat(c.precio_venta) - parseFloat(c.costo)) / parseFloat(c.precio_venta) * 100, 0) / wd.length;
    if (avg < 5) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen crítico ({avg.toFixed(1)}%).</strong> Probable pérdida neta.</span>
        </div>
    );
    if (avg < 15) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 border border-amber-100 rounded-xl text-[10px] text-amber-700">
            <TrendingDown size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen bajo ({avg.toFixed(1)}%).</strong> Estándar: 20–35%.</span>
        </div>
    );
    return (
        <div className="flex items-start gap-1.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-[10px] text-emerald-700">
            <TrendingUp size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen {avg < 25 ? 'estándar' : 'excelente'} ({avg.toFixed(1)}%).</strong></span>
        </div>
    );
}

// ── ProductModal ──────────────────────────────────────────────────────────────

function ProductModal({ p, onClose, onUpdated, branches }) {
    const [editTab, setEditTab]           = useState('ubicacion');
    const [locations, setLocations]       = useState([]);
    const [costs, setCosts]               = useState([]);
    const [saving, setSaving]             = useState(false);
    const [photoLoading, setPhotoLoading] = useState(false);
    const [showInactive, setShowInactive] = useState(false);
    const fileRef = useRef(null);

    useEffect(() => {
        const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));
        Promise.all([
            supabase.from('product_locations').select('branch_id, vitrina, estante, peldano').eq('product_id', p.id),
            supabase.from('product_costs').select('presentacion, costo, precio_venta, activo').eq('product_id', p.id),
            supabase.from('sales_invoice_items').select('presentacion').eq('erp_product_id', p.id).not('presentacion', 'is', null).limit(500),
        ]).then(([{ data: locs }, { data: costData }, { data: salesPres }]) => {
            setLocations(farmBranches.map(b => {
                const saved = (locs || []).find(l => l.branch_id === b.id);
                return {
                    branch_id:   b.id,
                    branch_name: b.name,
                    vitrina:     saved?.vitrina  || '',
                    estante:     saved?.estante  || '',
                    peldano:     saved?.peldano  || '',
                };
            }));

            const savedMap = new Map((costData || []).map(c => [c.presentacion, c]));
            const salesUniq = [...new Set((salesPres || []).map(s => s.presentacion).filter(Boolean))];
            const merged = [...savedMap.values()];
            salesUniq.forEach(pres => {
                if (!savedMap.has(pres)) merged.push({ presentacion: pres, costo: '', precio_venta: '', activo: true });
            });
            setCosts(merged);
        });
    }, [p.id, branches]);

    const handlePhotoUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhotoLoading(true);
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            const path = `${p.id}.${ext}`;
            const { error: upErr } = await supabase.storage.from('product-photos').upload(path, file, { upsert: true });
            if (upErr) throw upErr;
            const { data: { publicUrl } } = supabase.storage.from('product-photos').getPublicUrl(path);
            const { error: dbErr } = await supabase.from('products').update({ foto_url: publicUrl }).eq('id', p.id);
            if (dbErr) throw dbErr;
            onUpdated({ ...p, foto_url: publicUrl });
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally {
            setPhotoLoading(false);
            e.target.value = '';
        }
    };

    const saveLocations = async () => {
        setSaving(true);
        try {
            const toUpsert = locations
                .filter(l => l.vitrina.trim() || l.estante.trim() || l.peldano.trim())
                .map(l => ({
                    product_id:  p.id,
                    branch_id:   l.branch_id,
                    vitrina:     l.vitrina.trim() || null,
                    estante:     l.estante.trim() || null,
                    peldano:     l.peldano.trim() || null,
                    updated_at:  new Date().toISOString(),
                }));
            const toDelete = locations
                .filter(l => !l.vitrina.trim() && !l.estante.trim() && !l.peldano.trim())
                .map(l => l.branch_id);
            if (toUpsert.length > 0)
                await supabase.from('product_locations').upsert(toUpsert, { onConflict: 'product_id,branch_id' });
            if (toDelete.length > 0)
                await supabase.from('product_locations').delete().eq('product_id', p.id).in('branch_id', toDelete);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_LOCATIONS', String(p.id), { branches: toUpsert.length });
            useToastStore.getState().showToast('Guardado', 'Ubicaciones actualizadas.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const saveCosts = async () => {
        setSaving(true);
        try {
            const toSave = costs.filter(c => c.presentacion?.trim()).map(c => ({
                product_id:   p.id,
                presentacion: c.presentacion.trim(),
                costo:        c.costo !== '' && c.costo != null ? parseFloat(c.costo) : null,
                precio_venta: c.precio_venta !== '' && c.precio_venta != null ? parseFloat(c.precio_venta) : null,
                activo:       c.activo !== false,
                updated_at:   new Date().toISOString(),
            }));
            await supabase.from('product_costs').delete().eq('product_id', p.id);
            if (toSave.length > 0) {
                const { error } = await supabase.from('product_costs').insert(toSave);
                if (error) throw error;
            }
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_COSTS', String(p.id), { count: toSave.length });
            useToastStore.getState().showToast('Guardado', 'Precios actualizados.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const handleSave = editTab === 'ubicacion' ? saveLocations : saveCosts;

    const visibleCosts = showInactive ? costs : costs.filter(c => c.activo !== false);

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

            {/* Modal panel */}
            <div
                className="relative z-10 w-full max-w-lg bg-white rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.22)] overflow-hidden flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* ── Header with photo ── */}
                <div className="relative h-36 shrink-0 bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-50/40">
                    {p.foto_url
                        ? <img src={p.foto_url} alt={p.nombre} className="w-full h-full object-cover" />
                        : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                                <div className="w-12 h-12 rounded-2xl bg-white/60 border border-white/80 shadow-inner flex items-center justify-center">
                                    <Package size={22} className="text-slate-300" />
                                </div>
                                <span className="text-[10px] text-slate-300 font-medium">Sin foto</span>
                            </div>
                        )
                    }

                    {/* Camera overlay */}
                    <button
                        onClick={() => fileRef.current?.click()}
                        className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-1.5 opacity-0 hover:opacity-100 transition-opacity duration-200 cursor-pointer">
                        {photoLoading
                            ? <Loader2 size={20} className="text-white animate-spin" />
                            : <>
                                <Camera size={18} className="text-white drop-shadow" />
                                <span className="text-white text-[10px] font-bold drop-shadow">Cambiar foto</span>
                              </>}
                    </button>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />

                    {/* Close */}
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 w-7 h-7 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/65 transition-colors">
                        <X size={13} strokeWidth={2.5} />
                    </button>

                    {/* Inactive badge */}
                    {p.activo === false && (
                        <span className="absolute top-3 left-3 text-[9px] font-black px-2 py-0.5 bg-black/50 text-white/80 rounded-full backdrop-blur-sm uppercase tracking-wide">
                            Inactivo
                        </span>
                    )}
                </div>

                {/* ── Product info (read-only) ── */}
                <div className="px-5 pt-4 pb-3 border-b border-slate-100">
                    <h2 className="text-[15px] font-bold text-slate-800 leading-snug">{p.nombre}</h2>
                    {p.laboratorios?.nombre && (
                        <p className="mt-0.5 text-[11px] text-slate-400 flex items-center gap-1">
                            <Building2 size={10} className="shrink-0" />{p.laboratorios.nombre}
                        </p>
                    )}
                    {/* Read-only pills */}
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {p.tipo_medicamento && (
                            <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full">
                                {p.tipo_medicamento}
                            </span>
                        )}
                        {p.principio_activo && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-teal-50 text-teal-600 border border-teal-100 rounded-full max-w-[160px]">
                                <FlaskConical size={8} className="shrink-0" />
                                <span className="truncate">{p.principio_activo}</span>
                            </span>
                        )}
                        {p.requiere_receta && (
                            <span className="text-[10px] font-black px-2 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full uppercase tracking-wide">
                                Requiere receta
                            </span>
                        )}
                        {p.es_antibiotico && (
                            <span className="text-[10px] font-black px-2 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full uppercase tracking-wide">
                                Antibiótico
                            </span>
                        )}
                        <span className="text-[9px] text-slate-300 italic self-center ml-1">Los datos del ERP no son editables</span>
                    </div>
                </div>

                {/* ── Tabs ── */}
                <div className="flex border-b border-slate-100 shrink-0">
                    {[
                        { key: 'ubicacion', label: 'Ubicación', icon: MapPin     },
                        { key: 'precios',   label: 'Precios',   icon: DollarSign },
                    ].map(({ key, label, icon: Icon }) => (
                        <button key={key} onClick={() => setEditTab(key)}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-bold transition-all border-b-2 -mb-px
                                ${editTab === key ? 'border-[#007AFF] text-[#007AFF]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                            <Icon size={11} />{label}
                        </button>
                    ))}
                </div>

                {/* ── Tab content ── */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">

                    {editTab === 'ubicacion' && (
                        <>
                            <p className="text-[11px] text-slate-400">Indica la ubicación física en cada sucursal.</p>
                            {locations.length === 0
                                ? <p className="text-xs text-slate-300 italic">Sin sucursales configuradas.</p>
                                : locations.map((loc, i) => (
                                    <div key={loc.branch_id}>
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">{loc.branch_name}</p>
                                        <div className="grid grid-cols-3 gap-2">
                                            {[
                                                { field: 'vitrina', placeholder: 'Vitrina' },
                                                { field: 'estante', placeholder: 'Estante' },
                                                { field: 'peldano', placeholder: 'Peldaño' },
                                            ].map(({ field, placeholder }) => (
                                                <div key={field}>
                                                    <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5 block">{placeholder}</label>
                                                    <input
                                                        value={loc[field]}
                                                        onChange={e => setLocations(ls => ls.map((l, j) => j === i ? { ...l, [field]: e.target.value } : l))}
                                                        placeholder={placeholder}
                                                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-slate-50" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            }
                        </>
                    )}

                    {editTab === 'precios' && (
                        <>
                            <ProfitSuggestion costs={visibleCosts} />

                            {/* Active/inactive toggle */}
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-slate-500">Presentaciones</span>
                                <button
                                    onClick={() => setShowInactive(v => !v)}
                                    className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                                        showInactive
                                            ? 'bg-slate-100 text-slate-600 border-slate-200'
                                            : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                                    }`}>
                                    {showInactive ? <Eye size={10} /> : <EyeOff size={10} />}
                                    {showInactive ? 'Mostrando inactivas' : 'Ver inactivas'}
                                </button>
                            </div>

                            <div className="space-y-1.5">
                                <div className="grid grid-cols-[1fr_64px_64px_36px_20px] gap-1 px-1">
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Presentación</span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-right">Costo</span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-right">Precio</span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-center">%</span>
                                    <span />
                                </div>
                                {visibleCosts.map((c, i) => {
                                    const realIdx = costs.indexOf(c);
                                    const isInactive = c.activo === false;
                                    return (
                                        <div key={i} className={`grid grid-cols-[1fr_64px_64px_36px_20px] gap-1 items-center border rounded-xl px-2 py-1.5 ${
                                            isInactive ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-100'
                                        }`}>
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <button
                                                    onClick={() => setCosts(cs => cs.map((x, j) => j === realIdx ? { ...x, activo: !x.activo } : x))}
                                                    className={`shrink-0 w-2.5 h-2.5 rounded-full transition-colors ${isInactive ? 'bg-slate-300' : 'bg-emerald-400'}`}
                                                    title={isInactive ? 'Marcar activa' : 'Marcar inactiva'}
                                                />
                                                <input value={c.presentacion}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === realIdx ? { ...x, presentacion: e.target.value } : x))}
                                                    placeholder="500mg x 10"
                                                    className="text-[11px] text-slate-800 bg-transparent focus:outline-none min-w-0 truncate" />
                                            </div>
                                            <input type="number" step="0.01" min="0" value={c.costo ?? ''}
                                                onChange={e => setCosts(cs => cs.map((x, j) => j === realIdx ? { ...x, costo: e.target.value } : x))}
                                                placeholder="0.00"
                                                className="text-[11px] text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                            <input type="number" step="0.01" min="0" value={c.precio_venta ?? ''}
                                                onChange={e => setCosts(cs => cs.map((x, j) => j === realIdx ? { ...x, precio_venta: e.target.value } : x))}
                                                placeholder="0.00"
                                                className="text-[11px] text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                            <div className="flex justify-center">
                                                <MarginBadge costo={c.costo} precio={c.precio_venta} />
                                            </div>
                                            <button onClick={() => setCosts(cs => cs.filter((_, j) => j !== realIdx))}
                                                className="text-slate-300 hover:text-red-400 transition-colors flex items-center justify-center">
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                    );
                                })}
                                <button onClick={() => setCosts(cs => [...cs, { presentacion: '', costo: '', precio_venta: '', activo: true }])}
                                    className="flex items-center gap-1 text-[11px] text-[#007AFF] hover:text-[#0055CC] font-semibold py-0.5 transition-colors">
                                    <Plus size={10} /> Agregar presentación
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="px-5 pb-5 pt-3 border-t border-slate-100 shrink-0">
                    <button onClick={handleSave} disabled={saving}
                        className="w-full py-2.5 rounded-2xl bg-[#007AFF] text-white text-[12px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#0055CC] transition-colors disabled:opacity-50 shadow-[0_4px_14px_rgba(0,122,255,0.3)]">
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        {saving ? 'Guardando...' : 'Guardar cambios'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ p, onOpen }) {
    return (
        <div
            onClick={() => onOpen(p)}
            className="group/card flex flex-col bg-white/70 backdrop-blur-sm border border-white/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.09)] hover:-translate-y-0.5 cursor-pointer transition-all duration-200 transform-gpu"
        >
            {/* Photo */}
            <div className="relative h-36 shrink-0 overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-50/40">
                {p.foto_url ? (
                    <img src={p.foto_url} alt={p.nombre} className="w-full h-full object-cover transition-transform duration-700 group-hover/card:scale-[1.04]" />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 select-none">
                        <div className="w-12 h-12 rounded-2xl bg-white/60 border border-white/80 shadow-inner flex items-center justify-center">
                            <Package size={20} className="text-slate-300" />
                        </div>
                        <span className="text-[10px] text-slate-300 font-medium">Sin foto</span>
                    </div>
                )}
                {p.activo === false && (
                    <span className="absolute top-2 left-2 text-[9px] font-black px-2 py-0.5 bg-black/50 text-white/80 rounded-full backdrop-blur-sm uppercase tracking-wide">
                        Inactivo
                    </span>
                )}
            </div>

            {/* Info */}
            <div className="p-3">
                <h3 className="text-[13px] font-bold text-slate-800 leading-snug line-clamp-2">{p.nombre}</h3>
                {p.laboratorios?.nombre && (
                    <p className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-0.5 truncate">
                        <Building2 size={9} className="shrink-0 mr-0.5" />{p.laboratorios.nombre}
                    </p>
                )}

                {/* Pills */}
                <div className="mt-2 flex flex-wrap gap-1">
                    {p.tipo_medicamento && (
                        <span className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full max-w-[100px] truncate">
                            {p.tipo_medicamento}
                        </span>
                    )}
                    {p.principio_activo && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 bg-teal-50 text-teal-600 border border-teal-100 rounded-full max-w-[100px]">
                            <FlaskConical size={7} className="shrink-0" />
                            <span className="truncate">{p.principio_activo}</span>
                        </span>
                    )}
                    {p.requiere_receta && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full">
                            Receta
                        </span>
                    )}
                    {p.es_antibiotico && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full">
                            Antibiótico
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── TabCatalogo ───────────────────────────────────────────────────────────────

export default function TabCatalogo({ searchTerm = '' }) {
    const branches = useStaff(s => s.branches);
    const [products, setProducts] = useState([]);
    const [total, setTotal]       = useState(0);
    const [loading, setLoading]   = useState(false);
    const [page, setPage]         = useState(1);
    const [pageSize, setPageSize] = useState(24);
    const [selected, setSelected] = useState(null);

    const loadProducts = useCallback(async (q, pg, ps) => {
        setLoading(true);
        try {
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, laboratorio_id, foto_url, laboratorios(nombre)', { count: 'exact' })
                .order('nombre')
                .range((pg - 1) * ps, pg * ps - 1);
            if (q.trim()) qb = qb.ilike('nombre', `%${q.trim()}%`);
            const { data, count, error } = await qb;
            if (error) throw error;
            setProducts(data || []);
            setTotal(count || 0);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    // Reset to page 1 when search or pageSize changes
    useEffect(() => {
        setPage(1);
    }, [searchTerm, pageSize]);

    useEffect(() => {
        const t = setTimeout(() => loadProducts(searchTerm, page, pageSize), 200);
        return () => clearTimeout(t);
    }, [searchTerm, page, pageSize, loadProducts]);

    const handleUpdated = useCallback((updated) => {
        setProducts(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } : p));
        setSelected(updated);
    }, []);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return (
        <>
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={24} className="animate-spin text-[#007AFF]" />
                </div>
            ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                    <Package size={32} className="opacity-30" />
                    <p className="text-sm">No se encontraron productos</p>
                </div>
            ) : (
                <div className="flex flex-col h-full">
                    {/* Grid */}
                    <div className="flex-1 overflow-auto p-4">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                            {products.map(p => (
                                <ProductCard
                                    key={p.id}
                                    p={p}
                                    onOpen={setSelected}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Pagination bar */}
                    <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-slate-100">
                        <div className="w-[130px]">
                            <LiquidSelect
                                value={String(pageSize)}
                                onChange={v => { setPageSize(Number(v)); setPage(1); }}
                                options={PAGE_SIZE_OPTIONS}
                                clearable={false}
                                compact
                            />
                        </div>
                        <SmartPagination page={page} total={totalPages} onChange={setPage} />
                        <span className="text-[10px] text-slate-400 font-semibold w-[130px] text-right">
                            {total.toLocaleString()} productos
                        </span>
                    </div>
                </div>
            )}

            {/* Edit modal — portaled to body */}
            {selected && (
                <ProductModal
                    p={selected}
                    onClose={() => setSelected(null)}
                    onUpdated={handleUpdated}
                    branches={branches}
                />
            )}
        </>
    );
}
