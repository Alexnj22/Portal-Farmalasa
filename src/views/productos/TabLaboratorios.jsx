import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    FlaskConical, MapPin, Check, X, Pencil, Loader2,
    ChevronDown, Building2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Fields fetched and stored per branch
const LOC_FIELDS = 'lab_id, branch_id, vitrina, estante, peldano, bodega_numero, bodega_peldano';

function emptyLoc() {
    return { vitrina: '', estante: '', peldano: '', bodega_numero: '', bodega_peldano: '' };
}

function hasAnySala(d)   { return !!(d.vitrina?.trim() || d.estante?.trim() || d.peldano?.trim()); }
function hasAnyBodega(d) { return !!(d.bodega_numero?.trim() || d.bodega_peldano?.trim()); }
function hasAny(d)       { return hasAnySala(d) || hasAnyBodega(d); }

// ── Section classification ────────────────────────────────────────────────────
// Insumos   : nombre starts with digit (e.g. "1.", "2-", "10.")
// Cosméticos: nombre starts with Z/z
// Principales: everything else
function classifyLab(nombre) {
    if (/^\d/.test(nombre))  return 'insumos';
    if (/^z/i.test(nombre))  return 'cosmeticos';
    return 'principales';
}

const SECTIONS = [
    {
        key:   'principales',
        label: 'Laboratorios principales',
        color: 'teal',
        dot:   'bg-teal-500',
        pill:  'bg-teal-50 text-teal-700 border-teal-200',
        ring:  'ring-teal-100',
    },
    {
        key:   'insumos',
        label: 'Insumos',
        color: 'indigo',
        dot:   'bg-indigo-500',
        pill:  'bg-indigo-50 text-indigo-700 border-indigo-200',
        ring:  'ring-indigo-100',
    },
    {
        key:   'cosmeticos',
        label: 'Cosméticos / Conveniencia',
        color: 'rose',
        dot:   'bg-rose-400',
        pill:  'bg-rose-50 text-rose-700 border-rose-200',
        ring:  'ring-rose-100',
    },
];

export default function TabLaboratorios({ searchTerm = '' }) {
    const branches     = useStaff(s => s.branches);
    const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));

    const [labs,      setLabs]      = useState([]);
    const [locations, setLocations] = useState({}); // { lab_id: { branch_id: locObj } }
    const [loading,   setLoading]   = useState(true);
    const [expanded,  setExpanded]  = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: labData }, { data: locData }] = await Promise.all([
            supabase.from('laboratorios').select('id, nombre').order('nombre'),
            supabase.from('lab_locations').select(LOC_FIELDS),
        ]);
        setLabs(labData || []);
        const map = {};
        for (const row of (locData || [])) {
            if (!map[row.lab_id]) map[row.lab_id] = {};
            map[row.lab_id][row.branch_id] = {
                vitrina:        row.vitrina        ?? '',
                estante:        row.estante        ?? '',
                peldano:        row.peldano        ?? '',
                bodega_numero:  row.bodega_numero  ?? '',
                bodega_peldano: row.bodega_peldano ?? '',
            };
        }
        setLocations(map);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleSave = async (labId, branchId, fields) => {
        const payload = {
            lab_id:         labId,
            branch_id:      branchId,
            vitrina:        fields.vitrina?.trim()        || null,
            estante:        fields.estante?.trim()        || null,
            peldano:        fields.peldano?.trim()        || null,
            bodega_numero:  fields.bodega_numero?.trim()  || null,
            bodega_peldano: fields.bodega_peldano?.trim() || null,
            updated_at:     new Date().toISOString(),
        };
        const { error } = await supabase
            .from('lab_locations')
            .upsert(payload, { onConflict: 'lab_id,branch_id' });
        if (error) {
            useToastStore.getState().showToast('Error', error.message, 'error');
            return false;
        }
        setLocations(prev => ({
            ...prev,
            [labId]: {
                ...(prev[labId] || {}),
                [branchId]: {
                    vitrina:        payload.vitrina        ?? '',
                    estante:        payload.estante        ?? '',
                    peldano:        payload.peldano        ?? '',
                    bodega_numero:  payload.bodega_numero  ?? '',
                    bodega_peldano: payload.bodega_peldano ?? '',
                },
            },
        }));
        const lab = labs.find(l => l.id === labId);
        useStaff.getState().appendAuditLog('UPDATE_LAB_LOCATION', String(labId), { lab: lab?.nombre, branch_id: branchId });
        useToastStore.getState().showToast('Guardado', 'Ubicación actualizada.', 'success');
        return true;
    };

    const toggle      = (id)  => setExpanded(prev => prev === id ? null : id);
    const [openSecs, setOpenSecs] = useState({ principales: true, insumos: true, cosmeticos: true });
    const toggleSec   = (key) => setOpenSecs(prev => ({ ...prev, [key]: !prev[key] }));

    const filtered = searchTerm.trim()
        ? labs.filter(l => {
            const q = searchTerm.toLowerCase();
            if (l.nombre.toLowerCase().includes(q)) return true;
            const labLocs = locations[l.id] || {};
            return Object.values(labLocs).some(loc =>
                Object.values(loc).some(v => (v || '').toLowerCase().includes(q))
            );
          })
        : labs;

    // Group filtered labs into sections
    const grouped = {};
    for (const sec of SECTIONS) grouped[sec.key] = [];
    for (const lab of filtered) grouped[classifyLab(lab.nombre)].push(lab);

    const totalWithLocation = labs.filter(l => {
        const labLocs = locations[l.id] || {};
        return Object.values(labLocs).some(hasAny);
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
            {/* ── Summary cards ──────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6 pt-2">
                <SummaryCard icon={FlaskConical} label="Laboratorios"  value={labs.length}        color="teal"   />
                <SummaryCard icon={MapPin}       label="Con ubicación" value={totalWithLocation}   color="indigo" />
                <SummaryCard icon={Building2}    label="Sucursales"    value={farmBranches.length} color="slate"  className="col-span-2 sm:col-span-1" />
            </div>

            {/* ── Sections ───────────────────────────────────────────────── */}
            {filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400 text-sm">
                    {searchTerm ? 'Sin resultados para la búsqueda.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <div className="space-y-6">
                    {SECTIONS.map(sec => {
                        const sectionLabs = grouped[sec.key];
                        if (!sectionLabs.length) return null;
                        const isOpen = openSecs[sec.key];
                        return (
                            <div key={sec.key}>
                                {/* Section header */}
                                <button
                                    onClick={() => toggleSec(sec.key)}
                                    className="w-full flex items-center gap-2.5 mb-3 group"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sec.dot}`} />
                                    <span className="text-sm font-bold text-slate-700 group-hover:text-slate-900 transition-colors">
                                        {sec.label}
                                    </span>
                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${sec.pill}`}>
                                        {sectionLabs.length}
                                    </span>
                                    <div className="flex-1 h-px bg-slate-200 ml-1" />
                                    <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {/* Labs in this section */}
                                <AnimatePresence initial={false}>
                                    {isOpen && (
                                        <motion.div
                                            key={sec.key + '-body'}
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                            className="overflow-hidden"
                                        >
                                            <div className="space-y-2">
                                                {sectionLabs.map(lab => (
                                                    <LabRow
                                                        key={lab.id}
                                                        lab={lab}
                                                        branches={farmBranches}
                                                        locationMap={locations[lab.id] || {}}
                                                        isOpen={expanded === lab.id}
                                                        onToggle={() => toggle(lab.id)}
                                                        onSave={(branchId, fields) => handleSave(lab.id, branchId, fields)}
                                                    />
                                                ))}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Summary card ──────────────────────────────────────────────────────────────

const COLOR = {
    teal:   { bg: 'bg-teal-50',   border: 'border-teal-100',   icon: 'bg-teal-100 text-teal-600',    text: 'text-teal-700'   },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', icon: 'bg-indigo-100 text-indigo-600', text: 'text-indigo-700' },
    slate:  { bg: 'bg-slate-50',  border: 'border-slate-100',  icon: 'bg-slate-100 text-slate-500',  text: 'text-slate-600'  },
    rose:   { bg: 'bg-rose-50',   border: 'border-rose-100',   icon: 'bg-rose-100 text-rose-500',    text: 'text-rose-700'   },
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

// ── Lab row ───────────────────────────────────────────────────────────────────

function LabRow({ lab, branches, locationMap, isOpen, onToggle, onSave }) {
    const filledCount = branches.filter(b => hasAny(locationMap[b.id] || {})).length;

    return (
        <div className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
            isOpen
                ? 'border-teal-200 shadow-md shadow-teal-50 bg-white'
                : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm bg-white/60'
        }`}>
            {/* Header */}
            <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left group">
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
                            : `${filledCount} de ${branches.length} sucursal${branches.length !== 1 ? 'es' : ''} con ubicación`}
                    </p>
                </div>

                {/* Progress dots */}
                <div className="hidden sm:flex items-center gap-1 mr-2">
                    {branches.map(b => (
                        <div
                            key={b.id}
                            title={b.name}
                            className={`w-2 h-2 rounded-full transition-colors ${
                                hasAny(locationMap[b.id] || {})
                                    ? b.type === 'BODEGA' ? 'bg-amber-400' : 'bg-teal-400'
                                    : 'bg-slate-200'
                            }`}
                        />
                    ))}
                </div>

                <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Expanded branch grid */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    >
                        <div className="px-4 pb-5 pt-1 border-t border-slate-100">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mt-3">
                                {branches.map(branch => (
                                    <BranchLocationCard
                                        key={branch.id}
                                        branch={branch}
                                        initial={locationMap[branch.id] || emptyLoc()}
                                        onSave={(fields) => onSave(branch.id, fields)}
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

// ── Branch location card ──────────────────────────────────────────────────────

function BranchLocationCard({ branch, initial, onSave }) {
    const isBodegaBranch = branch.type === 'BODEGA';

    const [editing, setEditing] = useState(false);
    const [saving,  setSaving]  = useState(false);

    // Draft state mirrors the 5 DB fields
    const [draft, setDraft] = useState({ ...emptyLoc(), ...initial });
    // Which sala view: 'vitrina' | 'estante'
    const [salaType, setSalaType] = useState(
        initial.vitrina?.trim() ? 'vitrina' : 'estante'
    );
    // Which section shown: 'sala' | 'bodega' (only for FARMACIA)
    const [section, setSection] = useState('sala');

    useEffect(() => {
        setDraft({ ...emptyLoc(), ...initial });
        setSalaType(initial.vitrina?.trim() ? 'vitrina' : 'estante');
    }, [initial]);

    const setF = (field, value) => setDraft(d => ({ ...d, [field]: value }));

    const save = async () => {
        if (saving) return;
        setSaving(true);
        // Normalise: if tipo=estante, clear vitrina and vice-versa
        const fields = {
            ...draft,
            vitrina: salaType === 'vitrina' ? draft.vitrina : '',
            estante: salaType === 'estante' ? draft.estante : '',
        };
        const ok = await onSave(fields);
        setSaving(false);
        if (ok) setEditing(false);
    };

    const cancel = () => {
        setDraft({ ...emptyLoc(), ...initial });
        setSalaType(initial.vitrina?.trim() ? 'vitrina' : 'estante');
        setSection('sala');
        setEditing(false);
    };

    const hasSala   = hasAnySala(initial);
    const hasBodega = hasAnyBodega(initial);
    const filled    = hasAny(initial);

    // ── Summary view ──
    if (!editing) {
        return (
            <div
                className={`rounded-xl border p-3.5 cursor-pointer group transition-colors ${
                    filled
                        ? isBodegaBranch
                            ? 'bg-amber-50/70 border-amber-100 hover:border-amber-200'
                            : 'bg-teal-50/50 border-teal-100 hover:border-teal-200'
                        : 'bg-slate-50 border-slate-100 hover:border-slate-200'
                }`}
                onClick={() => setEditing(true)}
            >
                {/* Branch name row */}
                <div className="flex items-center gap-2 mb-2.5">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                        isBodegaBranch ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                        {isBodegaBranch ? 'Bodega' : 'Sala'}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 truncate flex-1">{branch.name}</span>
                    <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </div>

                {/* Summary chips */}
                {!filled ? (
                    <p className="text-xs text-slate-300 italic">Sin ubicación — clic para agregar</p>
                ) : (
                    <div className="space-y-1">
                        {hasSala && (
                            <LocationChip
                                label={initial.vitrina ? `Vitrina ${initial.vitrina}` : `Estante ${initial.estante}`}
                                sublabel={initial.peldano ? `Peldaño ${initial.peldano}` : null}
                                color="blue"
                                prefix="Sala"
                            />
                        )}
                        {hasBodega && (
                            <LocationChip
                                label={`Estante ${initial.bodega_numero}`}
                                sublabel={initial.bodega_peldano ? `Peldaño ${initial.bodega_peldano}` : null}
                                color="amber"
                                prefix="Bodega"
                            />
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ── Edit view ──
    return (
        <div className={`rounded-xl border p-3.5 shadow-sm ${
            isBodegaBranch ? 'border-amber-200 bg-amber-50/40' : 'border-teal-200 bg-teal-50/30'
        }`}>
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${
                    isBodegaBranch ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                }`}>
                    {isBodegaBranch ? 'Bodega' : 'Sala'}
                </span>
                <span className="text-xs font-semibold text-slate-700 truncate flex-1">{branch.name}</span>
            </div>

            {/* Section tabs for FARMACIA */}
            {!isBodegaBranch && (
                <div className="flex gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
                    {[{ key: 'sala', label: 'Sala de ventas' }, { key: 'bodega', label: 'Bodega interna' }].map(t => (
                        <button
                            key={t.key}
                            onClick={() => setSection(t.key)}
                            className={`flex-1 text-[11px] font-semibold py-1 rounded-md transition-all ${
                                section === t.key
                                    ? t.key === 'sala'
                                        ? 'bg-white text-blue-600 shadow-sm'
                                        : 'bg-white text-amber-600 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Fields */}
            {(isBodegaBranch || section === 'bodega') ? (
                // Bodega fields: estante + peldaño only
                <div className="space-y-2">
                    <FieldRow
                        label="Estante"
                        value={draft.bodega_numero}
                        onChange={v => setF('bodega_numero', v)}
                        placeholder="Ej: B3"
                        accent="amber"
                    />
                    <FieldRow
                        label="Peldaño"
                        value={draft.bodega_peldano}
                        onChange={v => setF('bodega_peldano', v)}
                        placeholder="Ej: 2"
                        accent="amber"
                    />
                </div>
            ) : (
                // Sala de ventas: vitrina/estante toggle + peldaño
                <div className="space-y-2">
                    {/* Vitrina / Estante toggle */}
                    <div>
                        <div className="flex gap-1 mb-1.5">
                            {['vitrina', 'estante'].map(t => (
                                <button
                                    key={t}
                                    onClick={() => setSalaType(t)}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all capitalize ${
                                        salaType === t
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    {t === 'vitrina' ? 'Vitrina' : 'Estante'}
                                </button>
                            ))}
                        </div>
                        <input
                            value={salaType === 'vitrina' ? draft.vitrina : draft.estante}
                            onChange={e => setF(salaType, e.target.value)}
                            placeholder={salaType === 'vitrina' ? 'Ej: V2' : 'Ej: A3'}
                            className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 text-slate-700 placeholder-slate-300"
                        />
                    </div>
                    <FieldRow
                        label="Peldaño"
                        value={draft.peldano}
                        onChange={v => setF('peldano', v)}
                        placeholder="Ej: 3"
                        accent="blue"
                    />
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-1.5 mt-3">
                <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Guardar
                </button>
                <button
                    onClick={cancel}
                    disabled={saving}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-400 text-xs transition-colors"
                >
                    <X className="w-3.5 h-3.5" />
                    Cancelar
                </button>
            </div>
        </div>
    );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FieldRow({ label, value, onChange, placeholder, accent }) {
    const ring = accent === 'amber'
        ? 'focus:ring-amber-200 focus:border-amber-300'
        : 'focus:ring-blue-200 focus:border-blue-300';
    return (
        <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 w-14 flex-shrink-0">{label}</span>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white outline-none focus:ring-2 ${ring} text-slate-700 placeholder-slate-300`}
            />
        </div>
    );
}

function LocationChip({ label, sublabel, color, prefix }) {
    const cls = color === 'amber'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-blue-100 text-blue-700 border-blue-200';
    return (
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium ${cls}`}>
            <span className="opacity-60">{prefix}:</span>
            <span>{label}</span>
            {sublabel && <span className="opacity-70">· {sublabel}</span>}
        </div>
    );
}
