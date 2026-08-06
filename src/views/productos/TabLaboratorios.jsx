import React, { useState, useEffect, useCallback } from 'react';
import ListRow from '../../components/common/ListRow';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { useToastStore } from '../../store/toastStore';
import { fetchLaboratoriosBasic, fetchLabLocations, upsertLabLocation } from '../../data/laboratorios';
import {
    FlaskConical, MapPin, Check, X, Pencil, Loader2,
    ChevronDown, Building2, Package, ShoppingBag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import SegmentedControl from '../../components/common/SegmentedControl';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalInput from '../../components/common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

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
    { key: 'principales', label: 'Laboratorios principales',    dot: 'bg-chart-9',   pill: 'bg-chart-9/10 text-chart-9-text border-chart-9/30'   },
    { key: 'insumos',     label: 'Insumos',                     dot: 'bg-chart-3', pill: 'bg-chart-3/10 text-chart-3-text border-chart-3/30' },
    { key: 'cosmeticos',  label: 'Cosméticos / Conveniencia',   dot: 'bg-chart-6',   pill: 'bg-chart-6/10 text-chart-6-text border-chart-6/30'    },
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
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return false; }
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
            <div className="py-24"><SkeletonText lines={5} /></div>
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
                                    aria-expanded={isOpen}
                                    className="w-full flex items-center gap-2.5 mb-3 group"
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sec.dot}`} />
                                    <span className="text-sm font-bold text-content-2 group-hover:text-content transition-colors">
                                        {sec.label}
                                    </span>
                                    <span className={`text-label font-semibold px-2 py-0.5 rounded-full border ${sec.pill}`}>
                                        {sectionLabs.length}
                                    </span>
                                    <div className="flex-1 h-px bg-divider ml-1" />
                                    <ChevronDown className={`w-4 h-4 text-content-3 flex-shrink-0 transition-transform duration-[var(--dur-base)] ${isOpen ? 'rotate-180' : ''}`} />
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
    teal:   { bg: 'from-chart-9/10 to-surface-card',     border: 'border-chart-9/30',   icon: 'bg-chart-9/10 text-chart-9-text',    glow: 'shadow-chart-9/20',   text: 'text-chart-9-text'   },
    indigo: { bg: 'from-chart-3/10 to-surface-card',   border: 'border-chart-3/30', icon: 'bg-chart-3/10 text-chart-3-text',glow: 'shadow-chart-3/20', text: 'text-chart-3-text' },
    slate:  { bg: 'from-surface-card-hover to-surface-card',    border: 'border-divider',  icon: 'bg-surface-card-hover text-content-3',  glow: 'shadow-content-3/10',  text: 'text-content-3'  },
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
                <p className={`text-label mt-1 font-semibold uppercase tracking-wide ${c.text}`}>{label}</p>
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
            className={`rounded-2xl border transition-all duration-[var(--dur-base)] overflow-hidden ${
                isOpen
                    ? 'border-chart-9/30 shadow-lg shadow-chart-9/10 bg-surface-card'
                    : 'border-border-card hover:border-chart-9/30 hover:shadow-md bg-surface-card backdrop-blur-sm'
            }`}
        >
            <ListRow
                density="lg"
                onClick={onToggle}
                icon={FlaskConical}
                iconBoxClass={isOpen ? 'bg-chart-9 border-transparent' : 'bg-surface-card-hover border-border-card'}
                iconClass={isOpen ? 'text-white' : 'text-content-3'}
                title={lab.nombre}
                subtitle={filledCount === 0
                    ? 'Sin ubicaciones registradas'
                    : `${filledCount} de ${branches.length} sucursal${branches.length !== 1 ? 'es' : ''} con ubicación`}
                trailing={
                    <>
                        <span className="hidden sm:flex items-center gap-1 mr-2">
                            {branches.map(b => (
                                <span key={b.id} role="img" title={b.name}
                                    className={`w-2 h-2 rounded-full transition-all duration-[var(--dur-slow)] ${
                                        hasAny(locationMap[b.id] || {})
                                            ? b.type === 'BODEGA' ? 'bg-warning' : 'bg-chart-9'
                                            : 'bg-surface-card-hover'}`} />
                            ))}
                        </span>
                        <ChevronDown size={16} strokeWidth={2.5}
                            className={`transition-transform duration-[var(--dur-base)] ${isOpen ? 'rotate-180 text-chart-9-text' : 'text-content-3'}`} />
                    </>
                }
            />

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
                        <div className="mx-3 mb-3 rounded-xl bg-surface-card-hover/80 border border-divider p-3">
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
        ? { bar: 'from-warning to-warning/70', variante: 'warning', dot: 'bg-warning' }
        : { bar: 'from-chart-9 to-chart-9',   badge: 'bg-chart-9/10 text-chart-9-text',   dot: 'bg-chart-9'  };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.2, delay: index * 0.035, ease: [0.4, 0, 0.2, 1] }}
            className={`relative rounded-xl overflow-hidden transition-shadow duration-[var(--dur-base)] ${
                editing
                    ? isBodegaBranch
                        ? 'shadow-lg shadow-warning/10 ring-1 ring-warning/30'
                        : 'shadow-lg shadow-chart-9/10 ring-1 ring-chart-9/30'
                    : 'shadow-sm hover:shadow-md cursor-pointer'
            } bg-surface-card border border-border-card`}
            onClick={editing ? undefined : () => setEditing(true)}
        >
            {/* Top accent bar */}
            <div className={`absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r ${accent.bar}`} />

            <div className="px-3.5 pt-4 pb-3.5">
                {/* Branch header */}
                <div className="flex items-center gap-2 mb-3">
                    <Badge variant={accent.variante} size="sm">{isBodegaBranch ? <Package className="w-2.5 h-2.5" /> : <ShoppingBag className="w-2.5 h-2.5" />}{isBodegaBranch ? 'Bodega' : 'Sala'}</Badge>
                    <span className="text-label font-bold text-content-2 truncate flex-1">{branch.name}</span>
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
                                <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-dashed border-divider bg-surface-card-hover/50">
                                    <MapPin className="w-3 h-3 text-content-3 flex-shrink-0" />
                                    <span className="text-label text-content-3 italic">Sin ubicación — clic para agregar</span>
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
                                        { key: 'sala',   label: 'Sala de ventas',  active: 'text-chart-9-text  bg-surface-card shadow-sm shadow-chart-9/20'  },
                                        <SegmentedControl
                                            size="sm" tone="chart-9"
                                            options={[
                                                { value: 'sala',   label: 'Sala de ventas' },
                                                { value: 'bodega', label: 'Bodega interna', tone: 'warning' },
                                            ]}
                                            value={section} onChange={setSection} label="Sección" className="flex-1" />,
                                    ].map(t => (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="flex-1"
                                            key={t.key}
                                            onClick={() => setSection(t.key)}
                                        >{t.label}</Button>
                                    ))}
                                </div>
                            )}

                            {/* Fields */}
                            {(isBodegaBranch || section === 'bodega') ? (
                                <div className="space-y-2">
                                    <GlassInput label="Estante" value={draft.bodega_numero}  onChange={v => setF('bodega_numero',  v)} placeholder="Ej: B3" />
                                    <GlassInput label="Peldaño" value={draft.bodega_peldano} onChange={v => setF('bodega_peldano', v)} placeholder="Ej: 2" />
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {/* Vitrina / Estante pill toggle */}
                                    <div className="flex gap-1.5 mb-0.5">
                                        {[
                                            { key: 'vitrina', label: 'Vitrina' },
                                            { key: 'estante', label: 'Estante' },
                                        ].map(t => (
                                            <Button
                                                size="sm"
                                                tone="chart-9"
                                                className="flex-1"
                                                key={t.key}
                                                onClick={() => setSalaType(t.key)}
                                            >{t.label}</Button>
                                        ))}
                                    </div>
                                    <GlassInput
                                        label="N°"
                                        value={salaType === 'vitrina' ? draft.vitrina : draft.estante}
                                        onChange={v => setF(salaType, v)}
                                        placeholder={salaType === 'vitrina' ? 'Ej: V2' : 'Ej: A3'}
                                    />
                                    <GlassInput label="Peldaño" value={draft.peldano} onChange={v => setF('peldano', v)} placeholder="Ej: 3" />
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-2 mt-3">
                                <motion.button
                                    whileTap={{ scale: 0.96 }}
                                    onClick={save}
                                    disabled={saving}
                                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl bg-chart-9-solid hover:bg-chart-9/80 text-white text-xs font-bold shadow-md shadow-chart-9/30 transition-all disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                    Guardar
                                </motion.button>
                                <motion.button
                                    whileTap={{ scale: 0.96 }}
                                    onClick={cancel}
                                    disabled={saving}
                                    className="flex items-center justify-center w-9 rounded-xl border border-divider bg-surface-card hover:bg-danger/10 hover:border-danger/30 text-content-3 hover:text-danger transition-all"
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
        ? 'bg-gradient-to-r from-warning/10 to-warning/5 border-warning/30 text-warning-text'
        : 'bg-gradient-to-r from-chart-9/10 to-chart-9/5 border-chart-9/30 text-chart-9-text';
    return (
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-label font-semibold ${cls}`}>
            <span className="opacity-60">{icon}</span>
            <span>{label}</span>
            {sub && <span className="opacity-60 font-medium">· {sub}</span>}
        </div>
    );
}

// `accent` se fue el 2026-07-28. Solo teñía el borde AL ENFOCAR —ámbar en
// bodega, teal en sala— y el canónico enfoca con el azul de marca en todo el
// portal. Que dos campos se enfoquen de distinto color según la columna es
// justo la divergencia por vista que esta auditoría vino a quitar; la
// diferencia bodega/sala ya la comunica el encabezado de su sección.
function GlassInput({ label, value, onChange, placeholder }) {
    return (
        <div className="flex items-center gap-2.5">
            <span className="text-label font-bold text-content-3 w-12 flex-shrink-0 text-right">{label}</span>
            <PortalInput
                aria-label={label} className="flex-1" compact
                value={value} onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
            />
        </div>
    );
}
