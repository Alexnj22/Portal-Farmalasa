import React, { useState, useEffect, useCallback } from 'react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { useToastStore } from '../../store/toastStore';
import { fetchLaboratoriosBasic, fetchLabLocations, upsertLabLocation } from '../../data/laboratorios';
import {
    FlaskConical, MapPin, Check, X, Pencil, Loader2,
    ChevronDown, Building2, Package, ShoppingBag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function emptyLoc() {
    return { vitrina: '', estante: '', peldano: '', bodega_numero: '', bodega_peldano: '' };
}

function hasAnySala(d)   { return !!(d.vitrina?.trim() || d.estante?.trim() || d.peldano?.trim()); }
function hasAnyBodega(d) { return !!(d.bodega_numero?.trim() || d.bodega_peldano?.trim()); }
function hasAny(d)       { return hasAnySala(d) || hasAnyBodega(d); }

function classifyLab(nombre) {
    if (/^\d/.test(nombre)) return 'insumos';
    if (/^z/i.test(nombre)) return 'cosmeticos';
    return 'principales';
}

const SECTIONS = [
    { key: 'principales', label: 'Laboratorios principales',    dot: 'bg-teal-500',   pill: 'bg-teal-50 text-teal-700 border-teal-200'   },
    { key: 'insumos',     label: 'Insumos',                     dot: 'bg-indigo-500', pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { key: 'cosmeticos',  label: 'Cosméticos / Conveniencia',   dot: 'bg-rose-400',   pill: 'bg-rose-50 text-rose-700 border-rose-200'    },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabLaboratorios({ searchTerm = '' }) {
    const branches     = useStaff(s => s.branches);
    const farmBranches = (branches || []).filter(b => ['FARMACIA', 'BODEGA'].includes(b.type));

    const [labs,      setLabs]      = useState([]);
    const [locations, setLocations] = useState({});
    const [loading,   setLoading]   = useState(true);
    const [expanded,  setExpanded]  = useState(null);
    const [openSecs,  setOpenSecs]  = useState({ principales: true, insumos: true, cosmeticos: true });

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: labData }, { data: locData }] = await Promise.all([
            fetchLaboratoriosBasic(),
            fetchLabLocations(),
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

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

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
        const { error } = await upsertLabLocation(payload);
        if (error) { useToastStore.getState().showToast('Error', error.message, 'error'); return false; }
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

    const toggle    = (id)  => setExpanded(prev => prev === id ? null : id);
    const toggleSec = (key) => setOpenSecs(prev => ({ ...prev, [key]: !prev[key] }));

    const filtered = searchTerm.trim()
        ? labs.filter(l => {
            if (tokenMatch(searchTerm, l.nombre)) return true;
            const labLocs = locations[l.id] || {};
            return Object.values(labLocs).some(loc =>
                Object.values(loc).some(v => tokenMatch(searchTerm, v))
            );
          })
        : labs;

    const grouped = {};
    for (const sec of SECTIONS) grouped[sec.key] = [];
    for (const lab of filtered) grouped[classifyLab(lab.nombre)].push(lab);

    const totalWithLocation = labs.filter(l =>
        Object.values(locations[l.id] || {}).some(hasAny)
    ).length;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 gap-2 text-content-3">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Cargando laboratorios…</span>
            </div>
        );
    }

    return (
        <div className="px-4 pb-10">
            {/* ── Summary cards ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-7 pt-2">
                <SummaryCard icon={FlaskConical} label="Laboratorios"  value={labs.length}        color="teal"   />
                <SummaryCard icon={MapPin}       label="Con ubicación" value={totalWithLocation}   color="indigo" />
                <SummaryCard icon={Building2}    label="Sucursales"    value={farmBranches.length} color="slate"  className="col-span-2 sm:col-span-1" />
            </div>

            {/* ── Sections ───────────────────────────────────────────── */}
            {filtered.length === 0 ? (
                <div className="text-center py-20 text-content-3 text-sm">
                    {searchTerm ? 'Sin resultados.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <div className="space-y-7">
                    {SECTIONS.map(sec => {
                        const sectionLabs = grouped[sec.key];
                        if (!sectionLabs.length) return null;
                        const isOpen = openSecs[sec.key];
                        return (
                            <div key={sec.key}>
                                <button
                                    onClick={() => toggleSec(sec.key)}
                                    className="w-full flex items-center gap-2.5 mb-3 group"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sec.dot}`} />
                                    <span className="text-sm font-bold text-content-2 group-hover:text-content transition-colors">
                                        {sec.label}
                                    </span>
                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${sec.pill}`}>
                                        {sectionLabs.length}
                                    </span>
                                    <div className="flex-1 h-px bg-surface-card-hover ml-1" />
                                    <ChevronDown className={`w-4 h-4 text-content-3 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                </button>

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

// ─── Summary card ─────────────────────────────────────────────────────────────

const SUMMARY_COLOR = {
    teal:   { bg: 'from-teal-50 to-white',     border: 'border-teal-100/80',   icon: 'bg-teal-100 text-teal-600',    glow: 'shadow-teal-100',   text: 'text-teal-600'   },
    indigo: { bg: 'from-indigo-50 to-white',   border: 'border-indigo-100/80', icon: 'bg-indigo-100 text-indigo-600',glow: 'shadow-indigo-100', text: 'text-indigo-600' },
    slate:  { bg: 'from-slate-50 to-white',    border: 'border-slate-100/80',  icon: 'bg-surface-card-hover text-content-3',  glow: 'shadow-slate-100',  text: 'text-content-3'  },
};

function SummaryCard({ icon: Icon, label, value, color, className = '' }) {
    const c = SUMMARY_COLOR[color];
    return (
        <div className={`relative rounded-2xl border bg-gradient-to-br ${c.bg} ${c.border} p-4 flex items-center gap-3.5 shadow-sm ${c.glow} overflow-hidden ${className}`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon} shadow-sm`}>
                <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
                <p className="text-2xl font-black text-content leading-none tracking-tight">{value}</p>
                <p className={`text-[11px] mt-1 font-semibold uppercase tracking-wide ${c.text}`}>{label}</p>
            </div>
        </div>
    );
}

// ─── Lab row ──────────────────────────────────────────────────────────────────

function LabRow({ lab, branches, locationMap, isOpen, onToggle, onSave }) {
    const filledCount = branches.filter(b => hasAny(locationMap[b.id] || {})).length;

    return (
        <motion.div
            layout
            className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isOpen
                    ? 'border-teal-200/70 shadow-lg shadow-teal-50 bg-surface-card backdrop-blur-sm'
                    : 'border-slate-200/60 hover:border-teal-200/50 hover:shadow-md bg-surface-card backdrop-blur-sm'
            }`}
        >
            <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3.5 text-left group">
                <div className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 ${
                    isOpen
                        ? 'bg-gradient-to-br from-teal-400 to-teal-500 shadow-md shadow-teal-200'
                        : 'bg-surface-card-hover group-hover:bg-teal-50'
                }`}>
                    <FlaskConical className={`w-4 h-4 transition-colors ${isOpen ? 'text-white' : 'text-content-3 group-hover:text-teal-500'}`} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-content truncate">{lab.nombre}</p>
                    <p className="text-xs text-content-3 mt-0.5">
                        {filledCount === 0
                            ? 'Sin ubicaciones registradas'
                            : `${filledCount} de ${branches.length} sucursal${branches.length !== 1 ? 'es' : ''} con ubicación`}
                    </p>
                </div>

                <div className="hidden sm:flex items-center gap-1 mr-2">
                    {branches.map(b => (
                        <div
                            key={b.id}
                            title={b.name}
                            className={`w-2 h-2 rounded-full transition-all duration-300 ${
                                hasAny(locationMap[b.id] || {})
                                    ? b.type === 'BODEGA'
                                        ? 'bg-amber-400 shadow-sm shadow-amber-200'
                                        : 'bg-teal-400 shadow-sm shadow-teal-200'
                                    : 'bg-surface-card-hover'
                            }`}
                        />
                    ))}
                </div>

                <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 ${
                    isOpen ? 'bg-teal-50 rotate-180' : 'bg-surface-card-hover group-hover:bg-surface-card-hover'
                }`}>
                    <ChevronDown className={`w-4 h-4 ${isOpen ? 'text-teal-500' : 'text-content-3'}`} />
                </div>
            </button>

            {/* Expanded branch grid */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                        {/* Inner panel with subtle glass bg */}
                        <div className="mx-3 mb-3 rounded-xl bg-surface-card-hover/80 border border-slate-100 p-3">
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                                {branches.map((branch, idx) => (
                                    <BranchLocationCard
                                        key={branch.id}
                                        branch={branch}
                                        index={idx}
                                        initial={locationMap[branch.id] || emptyLoc()}
                                        onSave={(fields) => onSave(branch.id, fields)}
                                    />
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ─── Branch location card ─────────────────────────────────────────────────────

function BranchLocationCard({ branch, index, initial, onSave }) {
    const isBodegaBranch = branch.type === 'BODEGA';

    const [editing,  setEditing]  = useState(false);
    const [saving,   setSaving]   = useState(false);
    const [draft,    setDraft]    = useState({ ...emptyLoc(), ...initial });
    const [salaType, setSalaType] = useState(initial.vitrina?.trim() ? 'vitrina' : 'estante');
    const [section,  setSection]  = useState('sala');

    useEffect(() => {
        setDraft({ ...emptyLoc(), ...initial }); // eslint-disable-line react-hooks/set-state-in-effect -- sincroniza el draft desde el prop `initial`
        setSalaType(initial.vitrina?.trim() ? 'vitrina' : 'estante');
    }, [initial]);

    const setF = (field, value) => setDraft(d => ({ ...d, [field]: value }));

    const save = async () => {
        if (saving) return;
        setSaving(true);
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

    // Accent colours based on branch type
    const accent = isBodegaBranch
        ? { bar: 'from-amber-400 to-amber-300', badge: 'bg-warning/10 text-amber-700', dot: 'bg-amber-400' }
        : { bar: 'from-teal-400 to-cyan-300',   badge: 'bg-teal-100 text-teal-700',   dot: 'bg-teal-400'  };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, delay: index * 0.035, ease: [0.4, 0, 0.2, 1] }}
            className={`relative rounded-xl overflow-hidden transition-shadow duration-200 ${
                editing
                    ? isBodegaBranch
                        ? 'shadow-lg shadow-amber-100/60 ring-1 ring-amber-200'
                        : 'shadow-lg shadow-teal-100/60 ring-1 ring-teal-200'
                    : 'shadow-sm hover:shadow-md cursor-pointer'
            } bg-surface-card backdrop-blur-md border border-border-card`}
            onClick={editing ? undefined : () => setEditing(true)}
        >
            {/* Top accent bar */}
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${accent.bar}`} />

            <div className="px-3.5 pt-4 pb-3.5">
                {/* Branch header */}
                <div className="flex items-center gap-2 mb-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}>
                        {isBodegaBranch ? <Package className="w-2.5 h-2.5" /> : <ShoppingBag className="w-2.5 h-2.5" />}
                        {isBodegaBranch ? 'Bodega' : 'Sala'}
                    </span>
                    <span className="text-[11px] font-bold text-content-2 truncate flex-1">{branch.name}</span>
                    {!editing && (
                        <Pencil className="w-3 h-3 text-content-3 group-hover:text-content-3 transition-opacity opacity-0 hover:opacity-100 flex-shrink-0" />
                    )}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                    {!editing ? (
                        // ── View mode ──────────────────────────────────────
                        <motion.div
                            key="view"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12 }}
                        >
                            {!filled ? (
                                <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-dashed border-slate-200 bg-surface-card-hover/50">
                                    <MapPin className="w-3 h-3 text-content-3 flex-shrink-0" />
                                    <span className="text-[11px] text-content-3 italic">Sin ubicación — clic para agregar</span>
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {hasSala && (
                                        <GlassChip
                                            icon={<ShoppingBag className="w-3 h-3" />}
                                            label={initial.vitrina ? `Vitrina ${initial.vitrina}` : `Estante ${initial.estante}`}
                                            sub={initial.peldano ? `Peldaño ${initial.peldano}` : null}
                                            color="blue"
                                        />
                                    )}
                                    {hasBodega && (
                                        <GlassChip
                                            icon={<Package className="w-3 h-3" />}
                                            label={`Estante ${initial.bodega_numero}`}
                                            sub={initial.bodega_peldano ? `Peldaño ${initial.bodega_peldano}` : null}
                                            color="amber"
                                        />
                                    )}
                                </div>
                            )}
                        </motion.div>
                    ) : (
                        // ── Edit mode ──────────────────────────────────────
                        <motion.div
                            key="edit"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            {/* Section toggle for FARMACIA */}
                            {!isBodegaBranch && (
                                <div className="flex p-0.5 bg-surface-card-hover/80 rounded-xl mb-3 gap-0.5">
                                    {[
                                        { key: 'sala',   label: 'Sala de ventas',  active: 'text-teal-700  bg-white shadow-sm shadow-teal-100'  },
                                        { key: 'bodega', label: 'Bodega interna',  active: 'text-amber-700 bg-white shadow-sm shadow-amber-100' },
                                    ].map(t => (
                                        <button
                                            key={t.key}
                                            onClick={() => setSection(t.key)}
                                            className={`flex-1 text-[11px] font-semibold py-1.5 px-2 rounded-[10px] transition-all duration-150 ${
                                                section === t.key ? t.active : 'text-content-3 hover:text-content-2'
                                            }`}
                                        >
                                            {t.label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Fields */}
                            {(isBodegaBranch || section === 'bodega') ? (
                                <div className="space-y-2">
                                    <GlassInput label="Estante" value={draft.bodega_numero}  onChange={v => setF('bodega_numero',  v)} placeholder="Ej: B3"  accent="amber" />
                                    <GlassInput label="Peldaño" value={draft.bodega_peldano} onChange={v => setF('bodega_peldano', v)} placeholder="Ej: 2"   accent="amber" />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {/* Vitrina / Estante pill toggle */}
                                    <div className="flex gap-1.5 mb-0.5">
                                        {[
                                            { key: 'vitrina', label: 'Vitrina' },
                                            { key: 'estante', label: 'Estante' },
                                        ].map(t => (
                                            <button
                                                key={t.key}
                                                onClick={() => setSalaType(t.key)}
                                                className={`flex-1 py-1 rounded-lg text-[11px] font-bold border transition-all duration-150 ${
                                                    salaType === t.key
                                                        ? 'bg-teal-500 text-white border-teal-500 shadow-sm shadow-teal-200'
                                                        : 'bg-surface-card text-content-3 border-slate-200 hover:border-teal-200 hover:text-teal-500'
                                                }`}
                                            >
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>
                                    <GlassInput
                                        label="N°"
                                        value={salaType === 'vitrina' ? draft.vitrina : draft.estante}
                                        onChange={v => setF(salaType, v)}
                                        placeholder={salaType === 'vitrina' ? 'Ej: V2' : 'Ej: A3'}
                                        accent="teal"
                                    />
                                    <GlassInput label="Peldaño" value={draft.peldano} onChange={v => setF('peldano', v)} placeholder="Ej: 3" accent="teal" />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 mt-3">
                                <motion.button
                                    whileTap={{ scale: 0.96 }}
                                    onClick={save}
                                    disabled={saving}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white text-xs font-bold shadow-md shadow-teal-200/60 transition-all disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    Guardar
                                </motion.button>
                                <motion.button
                                    whileTap={{ scale: 0.96 }}
                                    onClick={cancel}
                                    disabled={saving}
                                    className="flex items-center justify-center w-9 rounded-xl border border-slate-200 bg-surface-card hover:bg-danger/10 hover:border-danger/30 text-content-3 hover:text-danger transition-all"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </motion.button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function GlassChip({ icon, label, sub, color }) {
    const cls = color === 'amber'
        ? 'bg-gradient-to-r from-amber-50 to-amber-50/60 border-warning/70 text-amber-700'
        : 'bg-gradient-to-r from-teal-50 to-teal-50/60 border-teal-200/70 text-teal-700';
    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold backdrop-blur-sm ${cls}`}>
            <span className="opacity-60">{icon}</span>
            <span>{label}</span>
            {sub && <span className="opacity-60 font-medium">· {sub}</span>}
        </div>
    );
}

function GlassInput({ label, value, onChange, placeholder, accent }) {
    const focus = accent === 'amber'
        ? 'focus:ring-2 focus:ring-amber-100 focus:border-amber-300'
        : 'focus:ring-2 focus:ring-teal-100 focus:border-teal-300';
    return (
        <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-bold text-content-3 w-12 flex-shrink-0 text-right">{label}</span>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`flex-1 text-xs px-2.5 py-1.5 rounded-xl border border-slate-200/80 bg-surface-card backdrop-blur-sm outline-none ${focus} text-content-2 placeholder-slate-300 transition-all font-medium`}
            />
        </div>
    );
}
