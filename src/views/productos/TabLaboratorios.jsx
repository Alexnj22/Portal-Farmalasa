import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { FlaskConical, MapPin, Check, X, Pencil, Loader2, RefreshCw } from 'lucide-react';

export default function TabLaboratorios({ searchTerm = '' }) {
    const [labs,    setLabs]    = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // lab id being edited
    const [draft,   setDraft]   = useState('');
    const [saving,  setSaving]  = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const { data } = await supabase
            .from('laboratorios')
            .select('id, nombre, ubicacion')
            .order('nombre');
        setLabs(data || []);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const startEdit = (lab) => {
        setEditing(lab.id);
        setDraft(lab.ubicacion ?? '');
    };

    const cancelEdit = () => { setEditing(null); setDraft(''); };

    const saveEdit = async (lab) => {
        if (saving) return;
        setSaving(true);
        const value = draft.trim() || null;
        const { error } = await supabase
            .from('laboratorios')
            .update({ ubicacion: value })
            .eq('id', lab.id);
        if (!error) {
            setLabs(prev => prev.map(l => l.id === lab.id ? { ...l, ubicacion: value } : l));
            useStaff.getState().appendAuditLog('UPDATE_LAB_UBICACION', String(lab.id), { nombre: lab.nombre, ubicacion: value });
            setEditing(null);
            setDraft('');
        }
        setSaving(false);
    };

    const filtered = searchTerm.trim()
        ? labs.filter(l => l.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           (l.ubicacion ?? '').toLowerCase().includes(searchTerm.toLowerCase()))
        : labs;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Cargando laboratorios…</span>
            </div>
        );
    }

    return (
        <div className="px-4 pb-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 pt-2">
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                    <FlaskConical className="w-4 h-4 text-teal-500" />
                    <span>{filtered.length} laboratorio{filtered.length !== 1 ? 's' : ''}</span>
                </div>
                <button
                    onClick={load}
                    className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Actualizar
                </button>
            </div>

            {filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400 text-sm">
                    {searchTerm ? 'Sin resultados para la búsqueda.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filtered.map(lab => (
                        <LabCard
                            key={lab.id}
                            lab={lab}
                            isEditing={editing === lab.id}
                            draft={draft}
                            saving={saving}
                            onDraftChange={setDraft}
                            onEdit={() => startEdit(lab)}
                            onSave={() => saveEdit(lab)}
                            onCancel={cancelEdit}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function LabCard({ lab, isEditing, draft, saving, onDraftChange, onEdit, onSave, onCancel }) {
    const hasLocation = Boolean(lab.ubicacion);

    return (
        <div className={`
            group relative rounded-2xl border bg-white/70 backdrop-blur-sm
            transition-all duration-200
            ${isEditing
                ? 'border-teal-300 shadow-[0_0_0_3px_rgba(20,184,166,0.12)] shadow-md'
                : 'border-slate-200/80 hover:border-slate-300 hover:shadow-md shadow-sm'
            }
        `}>
            <div className="p-4">
                {/* Lab name */}
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center">
                            <FlaskConical className="w-3.5 h-3.5 text-teal-600" />
                        </div>
                        <p className="text-sm font-semibold text-slate-800 leading-tight line-clamp-2">
                            {lab.nombre}
                        </p>
                    </div>
                    {!isEditing && (
                        <button
                            onClick={onEdit}
                            className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
                            title="Editar ubicación"
                        >
                            <Pencil className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {/* Location */}
                <div className="flex items-start gap-1.5">
                    <MapPin className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${hasLocation || isEditing ? 'text-teal-500' : 'text-slate-300'}`} />
                    {isEditing ? (
                        <div className="flex-1 flex flex-col gap-2">
                            <input
                                autoFocus
                                value={draft}
                                onChange={e => onDraftChange(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') onSave(); if (e.key === 'Escape') onCancel(); }}
                                placeholder="Ej: Bodega A, Estante 3"
                                className="w-full text-xs px-2 py-1.5 rounded-lg border border-teal-300 bg-white outline-none focus:ring-2 focus:ring-teal-200 text-slate-700 placeholder-slate-300"
                            />
                            <div className="flex gap-1.5">
                                <button
                                    onClick={onSave}
                                    disabled={saving}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                    Guardar
                                </button>
                                <button
                                    onClick={onCancel}
                                    disabled={saving}
                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 text-xs transition-colors"
                                >
                                    <X className="w-3 h-3" />
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    ) : (
                        <span
                            className={`text-xs leading-snug cursor-pointer ${hasLocation ? 'text-slate-600' : 'text-slate-300 italic'}`}
                            onClick={onEdit}
                            title="Clic para editar"
                        >
                            {lab.ubicacion ?? 'Sin ubicación'}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
