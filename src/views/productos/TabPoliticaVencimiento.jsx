import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { tokenMatch } from '../../utils/searchUtils';
import { useToastStore } from '../../store/toastStore';
import {
    FlaskConical, Truck, RotateCcw, Plus, Pencil, Trash2, Check, X, Loader2, ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function emptyDraft() {
    return { nombre: '', devolutivo: false, meses_devolucion: '', notas: '' };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPoliticaVencimiento({ searchTerm = '' }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('laboratorios', 'can_edit');

    const [labs,        setLabs]        = useState([]);
    const [proveedores, setProveedores] = useState({}); // lab_id -> array of proveedores
    const [loading,     setLoading]     = useState(true);
    const [expanded,    setExpanded]    = useState(null);
    const [addingFor,   setAddingFor]   = useState(null); // lab_id currently adding a proveedor

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: labData }, { data: provData }] = await Promise.all([
            supabase.from('laboratorios').select('id, nombre').order('nombre'),
            supabase.from('proveedores')
                .select('id, laboratorio_id, nombre, devolutivo, meses_devolucion, notas')
                .order('nombre'),
        ]);
        setLabs(labData || []);
        const map = {};
        for (const p of (provData || [])) {
            if (!map[p.laboratorio_id]) map[p.laboratorio_id] = [];
            map[p.laboratorio_id].push(p);
        }
        setProveedores(map);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggle = (labId) => setExpanded(prev => (prev === labId ? null : labId));

    const handleCreate = async (labId, draft) => {
        const payload = {
            laboratorio_id:   labId,
            nombre:           draft.nombre.trim(),
            devolutivo:       draft.devolutivo,
            meses_devolucion: draft.devolutivo && draft.meses_devolucion !== '' ? parseInt(draft.meses_devolucion, 10) : null,
            notas:            draft.notas.trim() || null,
        };
        const { data, error } = await supabase.from('proveedores').insert(payload).select().single();
        if (error) { useToastStore.getState().showToast('Error', error.message, 'error'); return false; }
        setProveedores(prev => ({ ...prev, [labId]: [...(prev[labId] || []), data].sort((a, b) => a.nombre.localeCompare(b.nombre)) }));
        const lab = labs.find(l => l.id === labId);
        useStaff.getState().appendAuditLog('CREAR_PROVEEDOR', String(data.id), { proveedor: data.nombre, laboratorio: lab?.nombre });
        useToastStore.getState().showToast('Guardado', 'Proveedor agregado.', 'success');
        return true;
    };

    const handleUpdate = async (proveedor, draft) => {
        const payload = {
            nombre:           draft.nombre.trim(),
            devolutivo:       draft.devolutivo,
            meses_devolucion: draft.devolutivo && draft.meses_devolucion !== '' ? parseInt(draft.meses_devolucion, 10) : null,
            notas:            draft.notas.trim() || null,
            updated_at:       new Date().toISOString(),
        };
        const { error } = await supabase.from('proveedores').update(payload).eq('id', proveedor.id);
        if (error) { useToastStore.getState().showToast('Error', error.message, 'error'); return false; }
        setProveedores(prev => ({
            ...prev,
            [proveedor.laboratorio_id]: (prev[proveedor.laboratorio_id] || [])
                .map(p => p.id === proveedor.id ? { ...p, ...payload } : p)
                .sort((a, b) => a.nombre.localeCompare(b.nombre)),
        }));
        useStaff.getState().appendAuditLog('EDITAR_PROVEEDOR', String(proveedor.id), { proveedor: payload.nombre });
        useToastStore.getState().showToast('Guardado', 'Proveedor actualizado.', 'success');
        return true;
    };

    const handleDelete = async (proveedor) => {
        if (!window.confirm(`¿Eliminar el proveedor "${proveedor.nombre}"?`)) return;
        const { error } = await supabase.from('proveedores').delete().eq('id', proveedor.id);
        if (error) { useToastStore.getState().showToast('Error', error.message, 'error'); return; }
        setProveedores(prev => ({
            ...prev,
            [proveedor.laboratorio_id]: (prev[proveedor.laboratorio_id] || []).filter(p => p.id !== proveedor.id),
        }));
        useStaff.getState().appendAuditLog('ELIMINAR_PROVEEDOR', String(proveedor.id), { proveedor: proveedor.nombre });
        useToastStore.getState().showToast('Eliminado', 'Proveedor eliminado.', 'success');
    };

    const filtered = searchTerm.trim()
        ? labs.filter(l => {
            if (tokenMatch(searchTerm, l.nombre)) return true;
            return (proveedores[l.id] || []).some(p => tokenMatch(searchTerm, p.nombre));
          })
        : labs;

    const totalProveedores  = Object.values(proveedores).reduce((s, arr) => s + arr.length, 0);
    const totalDevolutivos  = Object.values(proveedores).reduce((s, arr) => s + arr.filter(p => p.devolutivo).length, 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Cargando política de vencimiento…</span>
            </div>
        );
    }

    return (
        <div className="px-4 pb-10">
            {/* ── Summary cards ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7 pt-2">
                <SummaryCard icon={FlaskConical} label="Laboratorios" value={labs.length}          color="teal"  />
                <SummaryCard icon={Truck}        label="Proveedores"  value={totalProveedores}      color="indigo" />
                <SummaryCard icon={RotateCcw}    label="Devolutivos"  value={totalDevolutivos}       color="amber" className="col-span-2 sm:col-span-1" />
            </div>

            {filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400 text-sm">
                    {searchTerm ? 'Sin resultados.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(lab => (
                        <LabProveedoresRow
                            key={lab.id}
                            lab={lab}
                            canEdit={canEdit}
                            proveedores={proveedores[lab.id] || []}
                            isOpen={expanded === lab.id}
                            onToggle={() => toggle(lab.id)}
                            isAdding={addingFor === lab.id}
                            onStartAdd={() => setAddingFor(lab.id)}
                            onCancelAdd={() => setAddingFor(null)}
                            onCreate={async (draft) => { const ok = await handleCreate(lab.id, draft); if (ok) setAddingFor(null); }}
                            onUpdate={handleUpdate}
                            onDelete={handleDelete}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

const SUMMARY_COLOR = {
    teal:   { bg: 'from-teal-50 to-white',   border: 'border-teal-100/80',   icon: 'bg-teal-100 text-teal-600',    glow: 'shadow-teal-100',   text: 'text-teal-600'   },
    indigo: { bg: 'from-indigo-50 to-white', border: 'border-indigo-100/80', icon: 'bg-indigo-100 text-indigo-600',glow: 'shadow-indigo-100', text: 'text-indigo-600' },
    amber:  { bg: 'from-amber-50 to-white',  border: 'border-amber-100/80',  icon: 'bg-amber-100 text-amber-600',  glow: 'shadow-amber-100',  text: 'text-amber-600'  },
};

function SummaryCard({ icon: Icon, label, value, color, className = '' }) {
    const c = SUMMARY_COLOR[color];
    return (
        <div className={`relative rounded-2xl border bg-gradient-to-br ${c.bg} ${c.border} p-4 flex items-center gap-3.5 shadow-sm ${c.glow} overflow-hidden ${className}`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon} shadow-sm`}>
                <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
                <p className="text-2xl font-black text-slate-800 leading-none tracking-tight">{value}</p>
                <p className={`text-[11px] mt-1 font-semibold uppercase tracking-wide ${c.text}`}>{label}</p>
            </div>
        </div>
    );
}

// ─── Lab row (accordion) ──────────────────────────────────────────────────────

function LabProveedoresRow({ lab, canEdit, proveedores, isOpen, onToggle, isAdding, onStartAdd, onCancelAdd, onCreate, onUpdate, onDelete }) {
    const devolutivoCount = proveedores.filter(p => p.devolutivo).length;

    return (
        <motion.div
            layout
            className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isOpen
                    ? 'border-teal-200/70 shadow-lg shadow-teal-50 bg-white/95 backdrop-blur-sm'
                    : 'border-slate-200/60 hover:border-teal-200/50 hover:shadow-md bg-white/70 backdrop-blur-sm'
            }`}
        >
            <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left group">
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                    isOpen ? 'bg-gradient-to-br from-teal-400 to-teal-500 shadow-md shadow-teal-200' : 'bg-slate-100 group-hover:bg-teal-50'
                }`}>
                    <FlaskConical className={`w-4 h-4 transition-colors ${isOpen ? 'text-white' : 'text-slate-400 group-hover:text-teal-500'}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{lab.nombre}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {proveedores.length === 0
                            ? 'Sin proveedores registrados'
                            : `${proveedores.length} proveedor${proveedores.length === 1 ? '' : 'es'}${devolutivoCount ? ` · ${devolutivoCount} devolutivo${devolutivoCount === 1 ? '' : 's'}` : ''}`}
                    </p>
                </div>

                <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${
                    isOpen ? 'bg-teal-50 rotate-180' : 'bg-slate-50 group-hover:bg-slate-100'
                }`}>
                    <ChevronDown className={`w-4 h-4 ${isOpen ? 'text-teal-500' : 'text-slate-400'}`} />
                </div>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                        <div className="mx-3 mb-3 rounded-xl bg-slate-50/80 border border-slate-100 p-3 space-y-2">
                            {proveedores.length === 0 && !isAdding && (
                                <p className="text-[11px] text-slate-400 italic px-1 py-2">Este laboratorio aún no tiene proveedores registrados.</p>
                            )}
                            {proveedores.map(p => (
                                <ProveedorRow key={p.id} proveedor={p} canEdit={canEdit} onUpdate={onUpdate} onDelete={onDelete} />
                            ))}

                            {isAdding ? (
                                <ProveedorForm
                                    onCancel={onCancelAdd}
                                    onSubmit={onCreate}
                                />
                            ) : canEdit && (
                                <button
                                    onClick={onStartAdd}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-teal-200 text-teal-600 hover:bg-teal-50 hover:border-teal-300 transition-colors text-[11px] font-bold"
                                >
                                    <Plus className="w-3.5 h-3.5" /> Agregar proveedor
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ─── Proveedor row ────────────────────────────────────────────────────────────

function ProveedorRow({ proveedor, canEdit, onUpdate, onDelete }) {
    const [editing, setEditing] = useState(false);

    if (editing) {
        return (
            <ProveedorForm
                initial={proveedor}
                onCancel={() => setEditing(false)}
                onSubmit={async (draft) => { const ok = await onUpdate(proveedor, draft); if (ok) setEditing(false); }}
            />
        );
    }

    return (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white/80 border border-slate-200/70 shadow-sm">
            <Truck className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-700 truncate">{proveedor.nombre}</p>
                {proveedor.notas && <p className="text-[10px] text-slate-400 truncate mt-0.5">{proveedor.notas}</p>}
            </div>
            {proveedor.devolutivo ? (
                <span className="text-[9px] font-black uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0">
                    Devolutivo{proveedor.meses_devolucion != null ? ` · ${proveedor.meses_devolucion}m` : ''}
                </span>
            ) : (
                <span className="text-[9px] font-black uppercase text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full shrink-0">
                    No devolutivo
                </span>
            )}
            {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing(true)} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-teal-600 hover:bg-teal-50 transition-colors">
                        <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDelete(proveedor)} className="w-6 h-6 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Proveedor form (create/edit) ─────────────────────────────────────────────

function ProveedorForm({ initial, onCancel, onSubmit }) {
    const [draft,  setDraft]  = useState({ ...emptyDraft(), ...initial });
    const [saving, setSaving] = useState(false);

    const setF = (field, value) => setDraft(d => ({ ...d, [field]: value }));

    const save = async () => {
        if (!draft.nombre.trim() || saving) return;
        setSaving(true);
        await onSubmit(draft);
        setSaving(false);
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl bg-white border border-teal-200/70 shadow-md shadow-teal-100/50 p-3 space-y-2.5"
        >
            <input
                autoFocus
                value={draft.nombre}
                onChange={e => setF('nombre', e.target.value)}
                placeholder="Nombre del proveedor"
                className="w-full text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white/90 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 text-slate-700 placeholder-slate-300"
            />
            <div className="flex items-center gap-3">
                <button
                    onClick={() => setF('devolutivo', !draft.devolutivo)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                        draft.devolutivo
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-300'
                    }`}
                >
                    <RotateCcw className="w-3 h-3" /> {draft.devolutivo ? 'Devolutivo' : 'No devolutivo'}
                </button>
                {draft.devolutivo && (
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            min="0"
                            value={draft.meses_devolucion}
                            onChange={e => setF('meses_devolucion', e.target.value)}
                            placeholder="0"
                            className="w-16 text-[12px] font-semibold px-2 py-1.5 rounded-lg border border-slate-200 bg-white/90 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 text-slate-700 text-center"
                        />
                        <span className="text-[10px] font-semibold text-slate-400">meses antes de vencer para poder enviarlo</span>
                    </div>
                )}
            </div>
            <input
                value={draft.notas}
                onChange={e => setF('notas', e.target.value)}
                placeholder="Notas (opcional)"
                className="w-full text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white/90 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 text-slate-600 placeholder-slate-300"
            />
            <div className="flex gap-2">
                <button
                    onClick={save}
                    disabled={saving || !draft.nombre.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white text-[11px] font-bold shadow-sm transition-all disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Guardar
                </button>
                <button
                    onClick={onCancel}
                    disabled={saving}
                    className="flex items-center justify-center w-9 rounded-lg border border-slate-200 bg-white/60 hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-400 transition-all"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        </motion.div>
    );
}
