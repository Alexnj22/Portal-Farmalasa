import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    Package, Building2, FlaskConical, Tag,
    DollarSign, TrendingUp, TrendingDown, AlertTriangle, Info,
    MapPin, Check, Loader2, Plus, Trash2, X,
} from 'lucide-react';

const TIPOS_MEDICAMENTO = [
    'Analgésico', 'Antibiótico', 'Antiinflamatorio', 'Antihipertensivo',
    'Antidiabético', 'Antiácido', 'Antialérgico', 'Vitamina / Suplemento',
    'Dermatológico', 'Oftalmológico', 'Respiratorio', 'Gastrointestinal',
    'Cardiovascular', 'Neurológico', 'Oncológico', 'Otro',
];

const PAGE_SIZE = 60;

function MarginBadge({ costo, precio }) {
    const c = parseFloat(costo);
    const p = parseFloat(precio);
    if (!c || !p || p === 0) return <span className="text-slate-300 text-[10px]">—</span>;
    const m = (p - c) / p * 100;
    const cls = m < 5
        ? 'bg-red-50 text-red-600 border-red-100'
        : m < 15
        ? 'bg-amber-50 text-amber-600 border-amber-100'
        : 'bg-emerald-50 text-emerald-600 border-emerald-100';
    return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cls}`}>{m.toFixed(1)}%</span>;
}

function ProfitSuggestion({ costs }) {
    const with_data = (costs || []).filter(c => c.costo && c.precio_venta && parseFloat(c.precio_venta) > 0);
    if (!costs?.length || !with_data.length) return (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
            <Info size={13} className="shrink-0 mt-0.5" />
            <span>Agrega el costo y precio de venta para analizar la rentabilidad de este producto.</span>
        </div>
    );
    const avg = with_data.reduce((s, c) => s + (parseFloat(c.precio_venta) - parseFloat(c.costo)) / parseFloat(c.precio_venta) * 100, 0) / with_data.length;
    if (avg < 5) return (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span><strong>Margen crítico ({avg.toFixed(1)}%).</strong> Probable pérdida neta considerando gastos operativos. Revisa el precio o negocia menor costo con el proveedor.</span>
        </div>
    );
    if (avg < 15) return (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
            <TrendingDown size={13} className="shrink-0 mt-0.5" />
            <span><strong>Margen bajo ({avg.toFixed(1)}%).</strong> Estándar farmacéutico: 20–35%. Considera ajustar el precio o renegociar con el proveedor.</span>
        </div>
    );
    if (avg < 25) return (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
            <TrendingUp size={13} className="shrink-0 mt-0.5" />
            <span><strong>Margen estándar ({avg.toFixed(1)}%).</strong> Dentro del rango esperado para el sector farmacéutico.</span>
        </div>
    );
    return (
        <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs text-emerald-700">
            <TrendingUp size={13} className="shrink-0 mt-0.5" />
            <span><strong>Excelente margen ({avg.toFixed(1)}%).</strong> Producto muy rentable. Asegura disponibilidad constante.</span>
        </div>
    );
}

function Toggle({ value, onChange, color = 'bg-[#007AFF]' }) {
    return (
        <button type="button" onClick={() => onChange(!value)}
            className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${value ? color : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
    );
}

export default function TabCatalogo({ searchTerm = '' }) {
    const branches = useStaff(s => s.branches);

    const [products, setProducts] = useState([]);
    const [total, setTotal]       = useState(0);
    const [loading, setLoading]   = useState(false);
    const [labs, setLabs]         = useState([]);

    const [selected, setSelected]   = useState(null);
    const [editTab, setEditTab]     = useState('info');
    const [editData, setEditData]   = useState({});
    const [locations, setLocations] = useState([]);
    const [costs, setCosts]         = useState([]);
    const [saving, setSaving]       = useState(false);

    useEffect(() => {
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
    }, []);

    const loadProducts = useCallback(async (q) => {
        setLoading(true);
        try {
            let qb = supabase
                .from('products')
                .select('id, nombre, principio_activo, tipo_medicamento, es_antibiotico, requiere_receta, activo, laboratorio_id, laboratorios(nombre)', { count: 'exact' })
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

    const openProduct = async (p) => {
        setSelected(p);
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
        const [{ data: locs }, { data: costData }, { data: salesPres }] = await Promise.all([
            supabase.from('product_locations').select('branch_id, ubicacion').eq('product_id', p.id),
            supabase.from('product_costs').select('presentacion, costo, precio_venta').eq('product_id', p.id),
            supabase.from('sales_invoice_items').select('presentacion').eq('erp_product_id', p.id).not('presentacion', 'is', null).limit(300),
        ]);
        setLocations(farmBranches.map(b => ({
            branch_id: b.id, branch_name: b.name,
            ubicacion: (locs || []).find(l => l.branch_id === b.id)?.ubicacion || '',
        })));
        const savedMap = new Map((costData || []).map(c => [c.presentacion, c]));
        const salesUniq = [...new Set((salesPres || []).map(s => s.presentacion).filter(Boolean))];
        const merged = [...savedMap.values()];
        salesUniq.forEach(pres => { if (!savedMap.has(pres)) merged.push({ presentacion: pres, costo: '', precio_venta: '' }); });
        setCosts(merged);
    };

    const saveInfo = async () => {
        setSaving(true);
        try {
            const { error } = await supabase.from('products').update({
                nombre:           editData.nombre.trim(),
                principio_activo: editData.principio_activo?.trim() || null,
                tipo_medicamento: editData.tipo_medicamento || null,
                laboratorio_id:   editData.laboratorio_id ? parseInt(editData.laboratorio_id) : null,
                es_antibiotico:   editData.es_antibiotico,
                requiere_receta:  editData.requiere_receta,
                activo:           editData.activo,
                updated_at:       new Date().toISOString(),
            }).eq('id', selected.id);
            if (error) throw error;
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_INFO', String(selected.id), { nombre: editData.nombre });
            useToastStore.getState().showToast('Guardado', 'Información actualizada.', 'success');
            loadProducts(searchTerm);
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const saveLocations = async () => {
        setSaving(true);
        try {
            const toUpsert = locations.filter(l => l.ubicacion.trim()).map(l => ({
                product_id: selected.id, branch_id: l.branch_id,
                ubicacion: l.ubicacion.trim(), updated_at: new Date().toISOString(),
            }));
            const toDelete = locations.filter(l => !l.ubicacion.trim()).map(l => l.branch_id);
            if (toUpsert.length > 0) await supabase.from('product_locations').upsert(toUpsert, { onConflict: 'product_id,branch_id' });
            if (toDelete.length > 0) await supabase.from('product_locations').delete().eq('product_id', selected.id).in('branch_id', toDelete);
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_LOCATIONS', String(selected.id), { branches: toUpsert.length });
            useToastStore.getState().showToast('Guardado', 'Ubicaciones actualizadas.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const saveCosts = async () => {
        setSaving(true);
        try {
            const toSave = costs.filter(c => c.presentacion?.trim()).map(c => ({
                product_id: selected.id, presentacion: c.presentacion.trim(),
                costo:        c.costo !== '' && c.costo != null ? parseFloat(c.costo) : null,
                precio_venta: c.precio_venta !== '' && c.precio_venta != null ? parseFloat(c.precio_venta) : null,
                updated_at: new Date().toISOString(),
            }));
            await supabase.from('product_costs').delete().eq('product_id', selected.id);
            if (toSave.length > 0) { const { error } = await supabase.from('product_costs').insert(toSave); if (error) throw error; }
            useStaff.getState().appendAuditLog('UPDATE_PRODUCT_COSTS', String(selected.id), { count: toSave.length });
            useToastStore.getState().showToast('Guardado', 'Precios y costos actualizados.', 'success');
        } catch (e) {
            useToastStore.getState().showToast('Error', e.message, 'error');
        } finally { setSaving(false); }
    };

    const handleSave = editTab === 'info' ? saveInfo : editTab === 'ubicaciones' ? saveLocations : saveCosts;

    return (
        <>
            {/* ── Product table ────────────────────────────────────────── */}
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
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Nombre</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Laboratorio</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell">Principio Activo</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell">Tipo</th>
                                <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400">Flags</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {products.map(p => (
                                <tr key={p.id}
                                    onClick={() => openProduct(p)}
                                    className={`cursor-pointer transition-colors ${selected?.id === p.id ? 'bg-blue-50/60' : 'hover:bg-blue-50/30'}`}>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                            <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors
                                                ${selected?.id === p.id ? 'bg-[#007AFF]/15' : 'bg-slate-100'}`}>
                                                <Package size={13} className={selected?.id === p.id ? 'text-[#007AFF]' : 'text-slate-400'} />
                                            </div>
                                            <span className="text-[13px] font-semibold text-slate-800 leading-tight">{p.nombre}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell">
                                        {p.laboratorios?.nombre
                                            ? <span className="flex items-center gap-1 text-[12px] text-slate-500"><Building2 size={10} />{p.laboratorios.nombre}</span>
                                            : <span className="text-slate-300 text-[12px]">—</span>}
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell">
                                        {p.principio_activo
                                            ? <span className="flex items-center gap-1 text-[12px] text-slate-500"><FlaskConical size={10} />{p.principio_activo}</span>
                                            : <span className="text-slate-300 text-[12px]">—</span>}
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell">
                                        {p.tipo_medicamento
                                            ? <span className="flex items-center gap-1 text-[12px] text-slate-500"><Tag size={10} />{p.tipo_medicamento}</span>
                                            : <span className="text-slate-300 text-[12px]">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                            {p.requiere_receta && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-100 rounded-full">RX</span>}
                                            {p.es_antibiotico  && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-orange-50 text-orange-600 border border-orange-100 rounded-full">ATB</span>}
                                            {p.activo === false && <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 bg-slate-100 text-slate-400 border border-slate-200 rounded-full">Inactivo</span>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="px-4 py-3 border-t border-slate-100 text-center">
                        <span className="text-[11px] text-slate-400">
                            {products.length < PAGE_SIZE
                                ? `${products.length} producto${products.length !== 1 ? 's' : ''}`
                                : `Mostrando ${products.length} de ${total?.toLocaleString()} — refina la búsqueda para ver más`}
                        </span>
                    </div>
                </div>
            )}

            {/* ── Edit drawer ────────────────────────────────────────── */}
            {selected && (
                <div className="fixed inset-0 z-50 flex">
                    <div className="flex-1 bg-black/15 backdrop-blur-[2px]" onClick={() => setSelected(null)} />
                    <div className="w-full max-w-[420px] h-full bg-white/96 backdrop-blur-2xl border-l border-slate-200/80 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        {/* Header */}
                        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
                            <div className="flex-1 min-w-0">
                                <h3 className="text-[15px] font-bold text-slate-800 leading-snug">{selected.nombre}</h3>
                                <p className="text-xs text-slate-400 mt-0.5">ID ERP #{selected.id}</p>
                            </div>
                            <button onClick={() => setSelected(null)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all shrink-0">
                                <X size={17} />
                            </button>
                        </div>

                        {/* Drawer tabs */}
                        <div className="flex border-b border-slate-100 px-4">
                            {[
                                { key: 'info',        label: 'Información', icon: Package    },
                                { key: 'ubicaciones', label: 'Ubicaciones', icon: MapPin     },
                                { key: 'precios',     label: 'Precios',     icon: DollarSign },
                            ].map(({ key, label, icon: Icon }) => (
                                <button key={key} onClick={() => setEditTab(key)}
                                    className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 transition-all -mb-px
                                        ${editTab === key ? 'border-[#007AFF] text-[#007AFF]' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                                    <Icon size={12} />{label}
                                </button>
                            ))}
                        </div>

                        {/* Drawer body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">

                            {editTab === 'info' && (
                                <>
                                    <div>
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Nombre</label>
                                        <input value={editData.nombre} onChange={e => setEditData(d => ({ ...d, nombre: e.target.value }))}
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Principio Activo</label>
                                        <input value={editData.principio_activo} onChange={e => setEditData(d => ({ ...d, principio_activo: e.target.value }))}
                                            placeholder="Ej: Amoxicilina 500mg"
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Tipo de Medicamento</label>
                                        <select value={editData.tipo_medicamento} onChange={e => setEditData(d => ({ ...d, tipo_medicamento: e.target.value }))}
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white">
                                            <option value="">— Sin clasificar —</option>
                                            {TIPOS_MEDICAMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block">Laboratorio</label>
                                        <select value={editData.laboratorio_id} onChange={e => setEditData(d => ({ ...d, laboratorio_id: e.target.value }))}
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white">
                                            <option value="">— Sin laboratorio —</option>
                                            {labs.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-3 pt-1">
                                        {[
                                            { key: 'es_antibiotico', label: 'Antibiótico (venta controlada)', color: 'bg-orange-500' },
                                            { key: 'requiere_receta', label: 'Requiere receta médica',         color: 'bg-red-500'    },
                                            { key: 'activo',          label: 'Producto activo en catálogo',   color: 'bg-emerald-500' },
                                        ].map(({ key, label, color }) => (
                                            <div key={key} className="flex items-center gap-3">
                                                <Toggle value={editData[key]} onChange={v => setEditData(d => ({ ...d, [key]: v }))} color={color} />
                                                <span className="text-sm text-slate-700">{label}</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {editTab === 'ubicaciones' && (
                                <>
                                    <p className="text-xs text-slate-500 leading-relaxed">Registra el pasillo, estante o área donde se encuentra este producto en cada sucursal.</p>
                                    <div className="space-y-2.5">
                                        {locations.map((loc, i) => (
                                            <div key={loc.branch_id} className="flex items-center gap-3">
                                                <span className="w-28 text-xs font-semibold text-slate-600 truncate shrink-0">{loc.branch_name}</span>
                                                <input value={loc.ubicacion}
                                                    onChange={e => setLocations(ls => ls.map((l, j) => j === i ? { ...l, ubicacion: e.target.value } : l))}
                                                    placeholder="Ej: Pasillo 3, Estante B"
                                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#007AFF]/30 bg-white" />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {editTab === 'precios' && (
                                <>
                                    <ProfitSuggestion costs={costs} />
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-[1fr_72px_72px_44px_24px] gap-1.5 px-1">
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Presentación</span>
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right">Costo $</span>
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-right">Precio $</span>
                                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 text-center">Margen</span>
                                            <span />
                                        </div>
                                        {costs.map((c, i) => (
                                            <div key={i} className="grid grid-cols-[1fr_72px_72px_44px_24px] gap-1.5 items-center bg-white border border-slate-100 rounded-xl px-2 py-1.5">
                                                <input value={c.presentacion} onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, presentacion: e.target.value } : x))}
                                                    placeholder="Ej: 500mg x 10"
                                                    className="text-xs text-slate-800 bg-transparent focus:outline-none min-w-0 truncate" />
                                                <input type="number" step="0.01" min="0" value={c.costo ?? ''}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, costo: e.target.value } : x))}
                                                    placeholder="0.00" className="text-xs text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                                <input type="number" step="0.01" min="0" value={c.precio_venta ?? ''}
                                                    onChange={e => setCosts(cs => cs.map((x, j) => j === i ? { ...x, precio_venta: e.target.value } : x))}
                                                    placeholder="0.00" className="text-xs text-right text-slate-700 bg-transparent focus:outline-none w-full" />
                                                <div className="flex justify-center">
                                                    <MarginBadge costo={c.costo} precio={c.precio_venta} />
                                                </div>
                                                <button onClick={() => setCosts(cs => cs.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-400 transition-colors flex items-center justify-center">
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        ))}
                                        <button onClick={() => setCosts(cs => [...cs, { presentacion: '', costo: '', precio_venta: '' }])}
                                            className="flex items-center gap-1.5 text-xs text-[#007AFF] hover:text-[#0055CC] font-semibold py-1 transition-colors">
                                            <Plus size={13} /> Agregar presentación
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Save */}
                        <div className="p-5 border-t border-slate-100">
                            <button onClick={handleSave} disabled={saving}
                                className="w-full py-2.5 rounded-xl bg-[#007AFF] text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#0055CC] transition-colors disabled:opacity-50 shadow-[0_4px_14px_rgba(0,122,255,0.3)]">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                                {saving ? 'Guardando...' : 'Guardar cambios'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
