import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    Package, Building2, FlaskConical, DollarSign,
    TrendingUp, TrendingDown, AlertTriangle, Info,
    MapPin, Check, Loader2, Plus, Trash2, X, Camera,
} from 'lucide-react';

const TIPOS_MEDICAMENTO = [
    'Analgésico', 'Antibiótico', 'Antiinflamatorio', 'Antihipertensivo',
    'Antidiabético', 'Antiácido', 'Antialérgico', 'Vitamina / Suplemento',
    'Dermatológico', 'Oftalmológico', 'Respiratorio', 'Gastrointestinal',
    'Cardiovascular', 'Neurológico', 'Oncológico', 'Otro',
];

const PAGE_SIZE = 60;

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
            <span>Agrega costo y precio para analizar la rentabilidad.</span>
        </div>
    );
    const avg = wd.reduce((s, c) => s + (parseFloat(c.precio_venta) - parseFloat(c.costo)) / parseFloat(c.precio_venta) * 100, 0) / wd.length;
    if (avg < 5) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-red-50 border border-red-100 rounded-xl text-[10px] text-red-700">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen crítico ({avg.toFixed(1)}%).</strong> Probable pérdida neta. Revisa precio o costo con el proveedor.</span>
        </div>
    );
    if (avg < 15) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-amber-50 border border-amber-100 rounded-xl text-[10px] text-amber-700">
            <TrendingDown size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen bajo ({avg.toFixed(1)}%).</strong> Estándar farmacéutico: 20–35%. Considera ajustar el precio.</span>
        </div>
    );
    if (avg < 25) return (
        <div className="flex items-start gap-1.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-[10px] text-emerald-700">
            <TrendingUp size={11} className="shrink-0 mt-0.5" />
            <span><strong>Margen estándar ({avg.toFixed(1)}%).</strong> Dentro del rango esperado.</span>
        </div>
    );
    return (
        <div className="flex items-start gap-1.5 p-2.5 bg-emerald-50 border border-emerald-100 rounded-xl text-[10px] text-emerald-700">
            <TrendingUp size={11} className="shrink-0 mt-0.5" />
            <span><strong>Excelente margen ({avg.toFixed(1)}%).</strong> Producto muy rentable.</span>
        </div>
    );
}

function Toggle({ value, onChange, color = 'bg-[#007AFF]' }) {
    return (
        <button type="button" onClick={() => onChange(!value)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${value ? color : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
    );
}

function Field({ label, children }) {
    return (
        <div>
            <label className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1 block">{label}</label>
            {children}
        </div>
    );
}

// ── ProductCard ───────────────────────────────────────────────────────────────

function ProductCard({ p, isSelected, onSelect, onDeselect, onUpdated, branches, labs }) {
    const [editTab, setEditTab]           = useState('info');
    const [editData, setEditData]         = useState({});
    const [locations, setLocations]       = useState([]);
    const [costs, setCosts]               = useState([]);
    const [saving, setSaving]             = useState(false);
    const [photoLoading, setPhotoLoading] = useState(false);
    const fileRef = useRef(null);

    // Populate form when card is opened
    useEffect(() => {
        if (!isSelected) return;
        setEditTab('info');
        setEditData({
            nombre:           p.nombre || '',
            principio_activo: p.principio_activo || '',
            tipo_medicamento: p.tipo_medicamento || '',
            laboratorio_id:   p.laboratorio_id ? String(p.laboratorio_id) : '',
            es_antibiotico:   !!p.es_antibiotico,
            requiere_receta:  !!p.requiere_receta,
            activo:           p.activo !== false,
        });
        const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));
        Promise.all([
            supabase.from('product_locations').select('branch_id, ubicacion').eq('product_id', p.id),
            supabase.from('product_costs').select('presentacion, costo, precio_venta').eq('product_id', p.id),
            supabase.from('sales_invoice_items').select('presentacion').eq('erp_product_id', p.id).not('presentacion', 'is', null).limit(300),
        ]).then(([{ data: locs }, { data: costData }, { data: salesPres }]) => {
            setLocations(farmBranches.map(b => ({
                branch_id: b.id, branch_name: b.name,
                ubicacion: (locs || []).find(l => l.branch_id === b.id)?.ubicacion || '',
            })));
            const savedMap = new Map((costData || []).map(c => [c.presentacion, c]));
            const salesUniq = [...new Set((salesPres || []).map(s => s.presentacion).filter(Boolean))];
            const merged = [...savedMap.values()];
            salesUniq.forEach(pres => { if (!savedMap.has(pres)) merged.push({ presentacion: pres, costo: '', precio_venta: '' }); });
            setCosts(merged);
        });
    }, [isSelected, p.id]);

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
            useToastStore.getState().showToast('Foto guardada', 'Imagen actualizada correctamente.', 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', err.message, 'error');
        } finally {
            setPhotoLoading(false);
            e.target.value = '';
        }
    };

    const saveInfo = async () => {
        setSaving(true);
        try {
            const labId = editData.laboratorio_id ? parseInt(editData.laboratorio_id) : null;
            const { error } = await supabase.from('products').update({
                nombre:           editData.nombre.trim(),
                principio_activo: editData.principio_activo?.trim() || null,
                tipo_medicamento: editData.tipo_medicamento || null,
                laboratorio_id:   labId,
                es_antibiotico:   editData.es_antibiotico,
                requiere_receta:  editData.requiere_receta,
                activo:           editData.activo,
                updated_at:       new Date().toISOString(),
            }).eq('id', p.id);
            if (error) throw error;
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_INFO', String(p.id), { nombre: editData.nombre });
            useToastStore.getState().showToast('Guardado', 'Información actualizada.', 'success');
            const labName = labs.find(l => l.id === labId)?.nombre;
            onUpdated({
                ...p,
                nombre:           editData.nombre.trim(),
                principio_activo: editData.principio_activo?.trim() || null,
                tipo_medicamento: editData.tipo_medicamento || null,
                laboratorio_id:   labId,
                es_antibiotico:   editData.es_antibiotico,
                requiere_receta:  editData.requiere_receta,
                activo:           editData.activo,
                laboratorios:     labName ? { nombre: labName } : null,
            });
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const saveLocations = async () => {
        setSaving(true);
        try {
            const toUpsert = locations.filter(l => l.ubicacion.trim()).map(l => ({
                product_id: p.id, branch_id: l.branch_id,
                ubicacion: l.ubicacion.trim(), updated_at: new Date().toISOString(),
            }));
            const toDelete = locations.filter(l => !l.ubicacion.trim()).map(l => l.branch_id);
            if (toUpsert.length > 0) await supabase.from('product_locations').upsert(toUpsert, { onConflict: 'product_id,branch_id' });
            if (toDelete.length > 0) await supabase.from('product_locations').delete().eq('product_id', p.id).in('branch_id', toDelete);
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
                updated_at:   new Date().toISOString(),
            }));
            await supabase.from('product_costs').delete().eq('product_id', p.id);
            if (toSave.length > 0) {
                const { error } = await supabase.from('product_costs').insert(toSave);
                if (error) throw error;
            }
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_COSTS', String(p.id), { count: toSave.length });
            useToastStore.getState().showToast('Guardado', 'Precios y costos actualizados.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const handleSave = editTab === 'info' ? saveInfo : editTab === 'ubicaciones' ? saveLocations : saveCosts;

    return (
        <div
            className={`group/card relative flex flex-col bg-white/70 backdrop-blur-sm border rounded-2xl overflow-hidden transition-all duration-300 transform-gpu
                ${isSelected
                    ? 'border-[#007AFF]/30 shadow-[0_0_0_2px_rgba(0,122,255,0.12),0_12px_32px_rgba(0,0,0,0.1)] scale-[1.005]'
                    : 'border-white/80 shadow-sm hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 cursor-pointer'}`}
            onClick={!isSelected ? () => onSelect(p) : undefined}
        >
            {/* Close button */}
            {isSelected && (
                <button
                    onClick={e => { e.stopPropagation(); onDeselect(); }}
                    className="absolute top-2 right-2 z-20 w-6 h-6 bg-black/40 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/65 transition-colors">
                    <X size={11} strokeWidth={2.5} />
                </button>
            )}

            {/* ── Photo ── */}
            <div className="relative h-40 shrink-0 overflow-hidden bg-gradient-to-br from-slate-100 via-slate-50 to-indigo-50/40">
                {p.foto_url ? (
                    <img
                        src={p.foto_url}
                        alt={p.nombre}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover/card:scale-[1.04]"
                    />
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 select-none">
                        <div className="w-14 h-14 rounded-2xl bg-white/60 border border-white/80 shadow-inner flex items-center justify-center">
                            <Package size={24} className="text-slate-300" />
                        </div>
                        <span className="text-[10px] text-slate-300 font-medium">Sin foto</span>
                    </div>
                )}

                {/* Camera overlay — only while expanded */}
                {isSelected && (
                    <button
                        onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
                        className="absolute inset-0 bg-black/35 flex flex-col items-center justify-center gap-1.5 opacity-0 hover:opacity-100 transition-opacity duration-200 cursor-pointer">
                        {photoLoading
                            ? <Loader2 size={20} className="text-white animate-spin" />
                            : <>
                                <Camera size={20} className="text-white drop-shadow" />
                                <span className="text-white text-[10px] font-bold tracking-wide drop-shadow">Cambiar foto</span>
                              </>}
                    </button>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoUpload} />

                {/* Activo status badge — top left */}
                {p.activo === false && (
                    <span className="absolute top-2 left-2 text-[9px] font-black px-2 py-0.5 bg-black/50 text-white/80 rounded-full backdrop-blur-sm uppercase tracking-wide">
                        Inactivo
                    </span>
                )}
            </div>

            {/* ── Info ── */}
            <div className="p-3 pb-2">
                <h3 className="text-[13px] font-bold text-slate-800 leading-snug line-clamp-2 pr-4">{p.nombre}</h3>
                {p.laboratorios?.nombre && (
                    <p className="mt-0.5 text-[10px] text-slate-400 flex items-center gap-0.5 truncate">
                        <Building2 size={9} className="shrink-0 mr-0.5" />{p.laboratorios.nombre}
                    </p>
                )}

                {/* Pills */}
                <div className="mt-2 flex flex-wrap gap-1">
                    {p.tipo_medicamento && (
                        <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-full max-w-[96px] truncate">
                            {p.tipo_medicamento}
                        </span>
                    )}
                    {p.principio_activo && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 bg-teal-50 text-teal-600 border border-teal-100 rounded-full max-w-[96px]">
                            <FlaskConical size={7} className="shrink-0" />
                            <span className="truncate">{p.principio_activo}</span>
                        </span>
                    )}
                    {p.requiere_receta && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full uppercase tracking-wide">
                            RX
                        </span>
                    )}
                    {p.es_antibiotico && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full uppercase tracking-wide">
                            ATB
                        </span>
                    )}
                </div>
            </div>

            {/* ── Inline edit form (animated expand) ── */}
            <div
                className={`grid transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${isSelected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                onClick={e => e.stopPropagation()}
            >
                <div className="overflow-hidden min-h-0">
                    <div className="border-t border-slate-100/80">

                        {/* Tab bar */}
                        <div className="flex border-b border-slate-100">
                            {[
                                { key: 'info',        label: 'Info',      icon: Package    },
                                { key: 'ubicaciones', label: 'Ubicación', icon: MapPin     },
                                { key: 'precios',     label: 'Precios',   icon: DollarSign },
                            ].map(({ key, label, icon: Icon }) => (
                                <button key={key} onClick={() => setEditTab(key)}
                                    className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[9px] font-bold transition-all border-b-2 -mb-px
                                        ${editTab === key ? 'border-[#007AFF] text-[#007AFF]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                                    <Icon size={9} />{label}
                                </button>
                            ))}
                        </div>

                        {/* Tab content */}
                        <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto">

                            {editTab === 'info' && (
                                <>
                                    <Field label="Nombre">
                                        <input value={editData.nombre || ''}
                                            onChange={e => setEditData(d => ({ ...d, nombre: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                    </Field>
                                    <Field label="Principio Activo">
                                        <input value={editData.principio_activo || ''}
                                            onChange={e => setEditData(d => ({ ...d, principio_activo: e.target.value }))}
                                            placeholder="Ej: Amoxicilina 500mg"
                                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                    </Field>
                                    <Field label="Tipo de Medicamento">
                                        <select value={editData.tipo_medicamento || ''}
                                            onChange={e => setEditData(d => ({ ...d, tipo_medicamento: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white">
                                            <option value="">— Sin clasificar —</option>
                                            {TIPOS_MEDICAMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </Field>
                                    <Field label="Laboratorio">
                                        <select value={editData.laboratorio_id || ''}
                                            onChange={e => setEditData(d => ({ ...d, laboratorio_id: e.target.value }))}
                                            className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white">
                                            <option value="">— Sin laboratorio —</option>
                                            {labs.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                                        </select>
                                    </Field>
                                    <div className="flex flex-col gap-2 pt-0.5">
                                        {[
                                            { key: 'es_antibiotico', label: 'Antibiótico',        color: 'bg-orange-500' },
                                            { key: 'requiere_receta', label: 'Requiere receta',    color: 'bg-red-500'    },
                                            { key: 'activo',          label: 'Activo en catálogo', color: 'bg-emerald-500' },
                                        ].map(({ key, label, color }) => (
                                            <div key={key} className="flex items-center gap-2.5">
                                                <Toggle value={!!editData[key]} onChange={v => setEditData(d => ({ ...d, [key]: v }))} color={color} />
                                                <span className="text-xs text-slate-600">{label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {editTab === 'ubicaciones' && (
                                <div className="space-y-2">
                                    <p className="text-[10px] text-slate-400 leading-relaxed">Pasillo, estante o área donde se encuentra en cada sucursal.</p>
                                    {locations.length === 0
                                        ? <p className="text-[10px] text-slate-300 italic">Sin sucursales configuradas.</p>
                                        : locations.map((loc, i) => (
                                            <div key={loc.branch_id} className="flex items-center gap-2">
                                                <span className="text-[10px] font-semibold text-slate-500 w-[68px] shrink-0 truncate">{loc.branch_name}</span>
                                                <input value={loc.ubicacion}
                                                    onChange={e => setLocations(ls => ls.map((l, j) => j === i ? { ...l, ubicacion: e.target.value } : l))}
                                                    placeholder="Pasillo 3"
                                                    className="flex-1 min-w-0 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            {editTab === 'precios' && (
                                <>
                                    <ProfitSuggestion costs={costs} />
                                    <div className="space-y-1.5 mt-1">
                                        <div className="grid grid-cols-[1fr_50px_50px_34px_16px] gap-1 px-0.5">
                                            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Presentación</span>
                                            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-right">Costo</span>
                                            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-right">Precio</span>
                                            <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400 text-center">%</span>
                                            <span />
                                        </div>
                                        {costs.map((c, i) => (
                                            <div key={i} className="grid grid-cols-[1fr_50px_50px_34px_16px] gap-1 items-center bg-white border border-slate-100 rounded-lg px-1.5 py-1">
                                                <input value={c.presentacion}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, presentacion: e.target.value } : x))}
                                                    placeholder="500mg x 10"
                                                    className="text-[10px] text-slate-800 bg-transparent focus:outline-none min-w-0 truncate" />
                                                <input type="number" step="0.01" min="0" value={c.costo ?? ''}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, costo: e.target.value } : x))}
                                                    placeholder="0.00"
                                                    className="text-[10px] text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                                <input type="number" step="0.01" min="0" value={c.precio_venta ?? ''}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, precio_venta: e.target.value } : x))}
                                                    placeholder="0.00"
                                                    className="text-[10px] text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                                <div className="flex justify-center">
                                                    <MarginBadge costo={c.costo} precio={c.precio_venta} />
                                                </div>
                                                <button onClick={() => setCosts(cs => cs.filter((_, j) => j !== i))}
                                                    className="text-slate-300 hover:text-red-400 transition-colors flex items-center justify-center">
                                                    <Trash2 size={10} />
                                                </button>
                                            </div>
                                        ))}
                                        <button onClick={() => setCosts(cs => [...cs, { presentacion: '', costo: '', precio_venta: '' }])}
                                            className="flex items-center gap-1 text-[10px] text-[#007AFF] hover:text-[#0055CC] font-semibold py-0.5 transition-colors">
                                            <Plus size={10} /> Agregar presentación
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Save button */}
                        <div className="px-3 pb-3 pt-1">
                            <button onClick={handleSave} disabled={saving}
                                className="w-full py-2 rounded-xl bg-[#007AFF] text-white text-[11px] font-bold flex items-center justify-center gap-1.5 hover:bg-[#0055CC] transition-colors disabled:opacity-50 shadow-[0_3px_10px_rgba(0,122,255,0.25)]">
                                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                                {saving ? 'Guardando...' : 'Guardar cambios'}
                            </button>
                        </div>
                    </div>
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
    const [labs, setLabs]         = useState([]);
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
    }, []);

    const loadProducts = useCallback(async (q) => {
        setLoading(true);
        try {
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, laboratorio_id, foto_url, laboratorios(nombre)', { count: 'exact' })
                .order('nombre')
                .limit(PAGE_SIZE);
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

    useEffect(() => {
        const t = setTimeout(() => loadProducts(searchTerm), 280);
        return () => clearTimeout(t);
    }, [searchTerm, loadProducts]);

    const handleUpdated = useCallback((updated) => {
        setProducts(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } : p));
        setSelected(updated);
    }, []);

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
                <div className="p-4 pb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {products.map(p => (
                            <ProductCard
                                key={p.id}
                                p={p}
                                isSelected={selected?.id === p.id}
                                onSelect={setSelected}
                                onDeselect={() => setSelected(null)}
                                onUpdated={handleUpdated}
                                branches={branches}
                                labs={labs}
                            />
                        ))}
                    </div>
                    <p className="mt-5 text-center text-[11px] text-slate-400">
                        {products.length < PAGE_SIZE
                            ? `${products.length.toLocaleString()} producto${products.length !== 1 ? 's' : ''}`
                            : `Mostrando ${products.length} de ${total.toLocaleString()} — refina la búsqueda para ver más`}
                    </p>
                </div>
            )}
        </>
    );
}
