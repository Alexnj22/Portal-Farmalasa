import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import {
    FlaskConical, MapPin, Check, X, Pencil, Loader2,
    ChevronDown, Building2, Package,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TabLaboratorios({ searchTerm = '' }) {
    const branches  = useStaff(s => s.branches);
    const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));

    const [labs,      setLabs]      = useState([]);
    const [locations, setLocations] = useState({}); // { lab_id: { branch_id: ubicacion } }
    const [loading,   setLoading]   = useState(true);
    const [expanded,  setExpanded]  = useState(null); // lab id

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: labData }, { data: locData }] = await Promise.all([
            supabase.from('laboratorios').select('id, nombre').order('nombre'),
            supabase.from('lab_locations').select('lab_id, branch_id, ubicacion'),
        ]);
        setLabs(labData || []);
        const map = {};
        for (const row of (locData || [])) {
            if (!map[row.lab_id]) map[row.lab_id] = {};
            map[row.lab_id][row.branch_id] = row.ubicacion ?? '';
        }
        setLocations(map);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (labId, branchId, value) => {
        const trimmed = value.trim() || null;
        await supabase.from('lab_locations').upsert(
            { lab_id: labId, branch_id: branchId, ubicacion: trimmed, updated_at: new Date().toISOString() },
            { onConflict: 'lab_id,branch_id' }
        );
        setLocations(prev => ({
            ...prev,
            [labId]: { ...(prev[labId] || {}), [branchId]: trimmed ?? '' },
        }));
        const lab = labs.find(l => l.id === labId);
        useStaff.getState().appendAuditLog('UPDATE_LAB_LOCATION', String(labId), {
            lab: lab?.nombre, branch_id: branchId, ubicacion: trimmed,
        });
    };

    const toggle = (id) => setExpanded(prev => prev === id ? null : id);

    const filtered = searchTerm.trim()
        ? labs.filter(l => {
            const q = searchTerm.toLowerCase();
            if (l.nombre.toLowerCase().includes(q)) return true;
            const labLocs = locations[l.id] || {};
            return Object.values(labLocs).some(v => (v || '').toLowerCase().includes(q));
          })
        : labs;

    const totalWithLocation = labs.filter(l => {
        const labLocs = locations[l.id] || {};
        return Object.values(labLocs).some(v => v && v.trim());
    }).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Cargando laboratorios…</span>
            </div>
        );
    }

    return (
        <div className="px-4 pb-10">
            {/* ── Summary cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 pt-2">
                <SummaryCard
                    icon={FlaskConical}
                    label="Laboratorios"
                    value={labs.length}
                    color="teal"
                />
                <SummaryCard
                    icon={MapPin}
                    label="Con ubicación"
                    value={totalWithLocation}
                    color="indigo"
                />
                <SummaryCard
                    icon={Building2}
                    label="Sucursales"
                    value={farmBranches.length}
                    color="slate"
                    className="col-span-2 sm:col-span-1"
                />
            </div>

            {/* ── Lab list ──────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400 text-sm">
                    {searchTerm ? 'Sin resultados para la búsqueda.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map(lab => (
                        <LabRow
                            key={lab.id}
                            lab={lab}
                            branches={farmBranches}
                            locationMap={locations[lab.id] || {}}
                            isOpen={expanded === lab.id}
                            onToggle={() => toggle(lab.id)}
                            onSave={handleSave}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Summary card ─────────────────────────────────────────────────────────────

const COLOR = {
    teal:   { bg: 'bg-teal-50',   border: 'border-teal-100',   icon: 'bg-teal-100 text-teal-600',   text: 'text-teal-700'   },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', icon: 'bg-indigo-100 text-indigo-600',text: 'text-indigo-700' },
    slate:  { bg: 'bg-slate-50',  border: 'border-slate-100',  icon: 'bg-slate-100 text-slate-500',  text: 'text-slate-600'  },
};

function SummaryCard({ icon: Icon, label, value, color, className = '' }) {
    const c = COLOR[color];
    return (
        <div className={`rounded-2xl border ${c.bg} ${c.border} p-4 flex items-center gap-3 ${className}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
                <p className="text-2xl font-bold text-slate-800 leading-none">{value}</p>
                <p className={`text-xs mt-0.5 font-medium ${c.text}`}>{label}</p>
            </div>
        </div>
    );
}

// ── Lab row ──────────────────────────────────────────────────────────────────

function LabRow({ lab, branches, locationMap, isOpen, onToggle, onSave }) {
    const filledCount = Object.values(locationMap).filter(v => v && v.trim()).length;
    const total       = branches.length;

    return (
        <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
            isOpen
                ? 'border-teal-200 shadow-md shadow-teal-50'
                : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm bg-white/60'
        }`}>
            {/* Header */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left group"
            >
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    isOpen ? 'bg-teal-100' : 'bg-slate-100 group-hover:bg-teal-50'
                }`}>
                    <FlaskConical className={`w-4 h-4 transition-colors ${isOpen ? 'text-teal-600' : 'text-slate-400 group-hover:text-teal-500'}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{lab.nombre}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                        {filledCount === 0
                            ? 'Sin ubicaciones registradas'
                            : `${filledCount} de ${total} sucursal${total !== 1 ? 'es' : ''} con ubicación`}
                    </p>
                </div>

                {/* Progress dots */}
                <div className="hidden sm:flex items-center gap-1 mr-2">
                    {branches.slice(0, 7).map(b => (
                        <div
                            key={b.id}
                            title={b.name}
                            className={`w-2 h-2 rounded-full transition-colors ${
                                locationMap[b.id]?.trim()
                                    ? (b.type === 'BODEGA' ? 'bg-amber-400' : 'bg-teal-400')
                                    : 'bg-slate-200'
                            }`}
                        />
                    ))}
                </div>

                <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Expanded branches */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    >
                        <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 mt-3">
                                {branches.map(branch => (
                                    <BranchLocationCell
                                        key={branch.id}
                                        branch={branch}
                                        value={locationMap[branch.id] ?? ''}
                                        onSave={(val) => onSave(lab.id, branch.id, val)}
                                    />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Branch location cell ──────────────────────────────────────────────────────

function BranchLocationCell({ branch, value, onSave }) {
    const [editing, setEditing] = useState(false);
    const [draft,   setDraft]   = useState(value);
    const [saving,  setSaving]  = useState(false);

    useEffect(() => { setDraft(value); }, [value]);

    const commit = async () => {
        if (saving) return;
        if (draft.trim() === (value ?? '').trim()) { setEditing(false); return; }
        setSaving(true);
        await onSave(draft);
        setSaving(false);
        setEditing(false);
    };

    const cancel = () => { setDraft(value); setEditing(false); };

    const isBodega  = branch.type === 'BODEGA';
    const hasValue  = value && value.trim();

    return (
        <div className={`rounded-xl border p-3 transition-colors ${
            hasValue
                ? isBodega
                    ? 'bg-amber-50/60 border-amber-100'
                    : 'bg-teal-50/50 border-teal-100'
                : 'bg-slate-50 border-slate-100'
        }`}>
            {/* Branch name */}
            <div className="flex items-center gap-1.5 mb-2">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                    isBodega ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                }`}>
                    {isBodega ? '📦' : '🏪'} {isBodega ? 'Bodega' : 'Sala'}
                </span>
                <span className="text-xs font-semibold text-slate-700 truncate">{branch.name}</span>
            </div>

            {/* Location */}
            {editing ? (
                <div className="flex flex-col gap-1.5">
                    <input
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') cancel(); }}
                        placeholder="Ej: Estante A3, Peldaño 2"
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-teal-300 bg-white outline-none focus:ring-2 focus:ring-teal-200 text-slate-700 placeholder-slate-300"
                    />
                    <div className="flex gap-1">
                        <button
                            onClick={commit}
                            disabled={saving}
                            className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-[11px] font-medium transition-colors disabled:opacity-50"
                        >
                            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Guardar
                        </button>
                        <button
                            onClick={cancel}
                            disabled={saving}
                            className="px-2 py-1 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-400 text-[11px] transition-colors"
                        >
                            <X className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setEditing(true)}
                    className="w-full text-left group/loc"
                    title="Clic para editar"
                >
                    <div className="flex items-start gap-1">
                        <MapPin className={`w-3 h-3 mt-0.5 flex-shrink-0 ${hasValue ? (isBodega ? 'text-amber-500' : 'text-teal-500') : 'text-slate-300'}`} />
                        <span className={`text-xs leading-snug ${hasValue ? 'text-slate-700' : 'text-slate-300 italic'} group-hover/loc:underline decoration-dotted`}>
                            {value || 'Sin ubicación'}
                        </span>
                        <Pencil className="w-2.5 h-2.5 ml-auto flex-shrink-0 text-slate-300 opacity-0 group-hover/loc:opacity-100 transition-opacity mt-0.5" />
                    </div>
                </button>
            )}
        </div>
    );
}
