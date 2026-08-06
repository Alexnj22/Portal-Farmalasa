import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ListRow from '../../components/common/ListRow';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useAuth } from '../../context/AuthContext';
import { tokenMatch } from '../../utils/searchUtils';
import { useToastStore } from '../../store/toastStore';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import {
    FlaskConical, Truck, RotateCcw, Plus, Pencil, Trash2, Check, X, Loader2, ChevronDown, Ban,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    fetchLaboratoriosBasic, fetchProveedores, fetchSuppliersNames, insertProveedor,
    updateProveedor, deleteProveedor, fetchProductCountByLabDevolutivo, updateProductsMarkND,
} from '../../data/laboratorios';
import PortalInput from '../../components/common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';

let rowIdSeq = 0;
const nextRowId = () => `new-${Date.now()}-${rowIdSeq++}`;

// Sentinel para "Otro (no está en la lista)..." — el proveedor/droguería no
// viene del catálogo de compras del ERP (tabla suppliers) ni fue tecleado
// antes. Mismo patrón que OTRA_ESPECIALIDAD (educationCatalogs.js): el select
// muestra este valor mientras no se ha tecleado nada real.
const OTRO_PROVEEDOR = '__OTRO_PROVEEDOR__';
const isOtroProveedor = (nombre, options) =>
    nombre === OTRO_PROVEEDOR || (nombre !== '' && nombre != null && !options.some(o => o.value === nombre));
const isCofarsal = (nombre) => /cofarsal/i.test(nombre || '');

// Devolutivo=true por default — igual que products.devolutivo (TabCatalogo):
// la mayoría de proveedores SÍ aceptan devolución, ND es la excepción.
function emptyDraft() {
    return { nombre: '', devolutivo: true, meses_devolucion: '', notas: '', vineta: '' };
}
const draftKey = (d) => JSON.stringify([d.nombre, d.devolutivo, d.devolutivo ? d.meses_devolucion : '', d.notas, d.vineta]);

// ─── Main component ───────────────────────────────────────────────────────────

export default function TabPoliticaVencimiento({ searchTerm = '' }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('laboratorios', 'can_edit');

    const [labs,          setLabs]          = useState([]);
    const [proveedores,   setProveedores]   = useState({}); // lab_id -> array of proveedores
    const [supplierNames, setSupplierNames] = useState([]); // catálogo base: suppliers (ERP, sync-erp-purchases)
    const [loading,       setLoading]       = useState(true);
    const [expanded,      setExpanded]      = useState(null);
    const [newRows,       setNewRows]       = useState({}); // lab_id -> array of temp row ids being added (autosave, no submit button)
    const [page,          setPage]          = useState(1);
    const [pageSize,      setPageSize]      = useState(25);
    const [deleteTarget,  setDeleteTarget]  = useState(null); // proveedor pending delete confirmation

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data: labData }, { data: provData }, { data: supData }] = await Promise.all([
            fetchLaboratoriosBasic(),
            fetchProveedores(),
            fetchSuppliersNames(),
        ]);
        setLabs(labData || []);
        const map = {};
        for (const p of (provData || [])) {
            if (!map[p.laboratorio_id]) map[p.laboratorio_id] = [];
            map[p.laboratorio_id].push(p);
        }
        setProveedores(map);
        setSupplierNames((supData || []).map(s => s.nombre));
        setLoading(false);
    }, []);

    // Catálogo de proveedores/droguerías para el selector: suppliers (real,
    // sincronizado del ERP vía sync-erp-purchases) + cualquier nombre ya
    // tecleado en "Otro..." y guardado en proveedores — queda disponible
    // como opción real en el siguiente registro, sin tocar la tabla suppliers
    // (es un espejo del ERP, RLS solo permite escritura a service_role).
    const proveedorNameOptions = useMemo(() => {
        const set = new Set(supplierNames);
        for (const arr of Object.values(proveedores)) for (const p of arr) set.add(p.nombre);
        const names = [...set].sort((a, b) => a.localeCompare(b, 'es'));
        return [
            ...names.map(n => ({ value: n, label: n })),
            { value: OTRO_PROVEEDOR, label: 'Otro (no está en la lista)...' },
        ];
    }, [supplierNames, proveedores]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { setPage(1); }, [searchTerm, pageSize]); // eslint-disable-line react-hooks/set-state-in-effect -- resetear paginación al buscar/cambiar tamaño de página

    const toggle = (labId) => setExpanded(prev => (prev === labId ? null : labId));

    const handleCreate = async (labId, draft) => {
        const payload = {
            laboratorio_id:   labId,
            nombre:           draft.nombre.trim(),
            devolutivo:       draft.devolutivo,
            meses_devolucion: draft.devolutivo ? parseInt(draft.meses_devolucion, 10) : null,
            notas:            draft.notas.trim() || null,
            vineta:           draft.vineta !== '' ? parseFloat(draft.vineta) : null,
        };
        const { data, error } = await insertProveedor(payload);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return false; }
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
            meses_devolucion: draft.devolutivo ? parseInt(draft.meses_devolucion, 10) : null,
            notas:            draft.notas.trim() || null,
            vineta:           draft.vineta !== '' ? parseFloat(draft.vineta) : null,
            updated_at:       new Date().toISOString(),
        };
        const { error } = await updateProveedor(proveedor.id, payload);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return false; }
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

    const [deleting, setDeleting] = useState(false);
    const handleDelete = (proveedor) => setDeleteTarget(proveedor);
    const confirmDelete = async () => {
        const proveedor = deleteTarget;
        if (!proveedor) return;
        setDeleting(true);
        const { error } = await deleteProveedor(proveedor.id);
        setDeleting(false);
        setDeleteTarget(null);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return; }
        setProveedores(prev => ({
            ...prev,
            [proveedor.laboratorio_id]: (prev[proveedor.laboratorio_id] || []).filter(p => p.id !== proveedor.id),
        }));
        useStaff.getState().appendAuditLog('ELIMINAR_PROVEEDOR', String(proveedor.id), { proveedor: proveedor.nombre });
        useToastStore.getState().showToast('Eliminado', 'Proveedor eliminado.', 'success');
    };

    // Agregar proveedor: filas inline con autoguardado (sin botón "Guardar"),
    // se pueden abrir varias a la vez — el botón "+ Agregar proveedor" nunca
    // se oculta mientras se está agregando, un laboratorio puede tener varios.
    const addRow = (labId) => setNewRows(prev => ({ ...prev, [labId]: [...(prev[labId] || []), nextRowId()] }));
    const removeRow = (labId, rowId) => setNewRows(prev => ({ ...prev, [labId]: (prev[labId] || []).filter(id => id !== rowId) }));

    // Acción masiva: son raros los laboratorios 100% ND, pero cuando pasa, marcar
    // producto por producto en Catálogo es impráctico — un solo click voltea
    // products.devolutivo=false para todo el laboratorio (mismo campo/convención
    // que TabCatalogo, ND es la excepción).
    const [markingNDFor, setMarkingNDFor] = useState(null);
    const [ndConfirm,    setNdConfirm]    = useState(null); // { lab, count } pending confirmation
    const [ndProcessing, setNdProcessing] = useState(false);

    const handleMarkLabND = async (lab) => {
        setMarkingNDFor(lab.id);
        const { count, error: countError } = await fetchProductCountByLabDevolutivo(lab.id);
        setMarkingNDFor(null);
        if (countError) { useToastStore.getState().showToast('Error', mensajeAmigable(countError), 'error'); return; }
        if (!count) {
            useToastStore.getState().showToast('Sin cambios', `Todos los productos de "${lab.nombre}" ya están marcados ND.`, 'info');
            return;
        }
        setNdConfirm({ lab, count });
    };

    const confirmMarkLabND = async () => {
        if (!ndConfirm) return;
        const { lab, count } = ndConfirm;
        setNdProcessing(true);
        const { data, error } = await updateProductsMarkND(lab.id);
        setNdProcessing(false);
        setNdConfirm(null);
        if (error) { useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error'); return; }
        useStaff.getState().appendAuditLog('LABORATORIO_MARCAR_ND', String(lab.id), { laboratorio: lab.nombre, productos_afectados: data?.length ?? count });
        useToastStore.getState().showToast('Marcado', `${data?.length ?? count} producto${(data?.length ?? count) === 1 ? '' : 's'} de "${lab.nombre}" marcados como ND.`, 'success');
    };

    const filtered = searchTerm.trim()
        ? labs.filter(l => {
            if (tokenMatch(searchTerm, l.nombre)) return true;
            return (proveedores[l.id] || []).some(p => tokenMatch(searchTerm, p.nombre));
          })
        : labs;

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageRows    = filtered.slice((page - 1) * pageSize, page * pageSize);

    const totalProveedores  = Object.values(proveedores).reduce((s, arr) => s + arr.length, 0);
    const totalDevolutivos  = Object.values(proveedores).reduce((s, arr) => s + arr.filter(p => p.devolutivo).length, 0);

    if (loading) {
        return (
            <div className="py-24"><SkeletonText lines={5} /></div>
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
                <div className="text-center py-20 text-content-3 text-sm">
                    {searchTerm ? 'Sin resultados.' : 'No hay laboratorios registrados.'}
                </div>
            ) : (
                <>
                    <div className="space-y-2">
                        {pageRows.map(lab => (
                            <LabProveedoresRow
                                key={lab.id}
                                lab={lab}
                                canEdit={canEdit}
                                proveedorNameOptions={proveedorNameOptions}
                                proveedores={proveedores[lab.id] || []}
                                isOpen={expanded === lab.id}
                                onToggle={() => toggle(lab.id)}
                                onMarkND={() => handleMarkLabND(lab)}
                                markingND={markingNDFor === lab.id}
                                newRowIds={newRows[lab.id] || []}
                                onStartAdd={() => addRow(lab.id)}
                                onCancelAdd={(rowId) => removeRow(lab.id, rowId)}
                                onCreate={async (rowId, draft) => {
                                    const ok = await handleCreate(lab.id, draft);
                                    if (ok) removeRow(lab.id, rowId);
                                    return ok;
                                }}
                                onUpdate={handleUpdate}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                    <div className="mt-4">
                        <TablePagination
                            pageSize={pageSize}
                            onPageSizeChange={setPageSize}
                            page={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                            total={labs.length}
                            unit="laboratorios"
                            filteredTotal={filtered.length !== labs.length ? filtered.length : undefined}
                        />
                    </div>
                </>
            )}

            <ConfirmModal
                isOpen={!!ndConfirm}
                onClose={() => setNdConfirm(null)}
                onConfirm={confirmMarkLabND}
                title="Marcar como No Devolutivo"
                message={ndConfirm ? `Esto marcará los ${ndConfirm.count} producto${ndConfirm.count === 1 ? '' : 's'} de "${ndConfirm.lab.nombre}" como No Devolutivo (ND). ¿Continuar?` : ''}
                confirmText="Marcar ND"
                cancelText="Cancelar"
                isDestructive={false}
                isProcessing={ndProcessing}
            />

            <ConfirmModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={confirmDelete}
                title="Eliminar proveedor"
                message={deleteTarget ? `¿Eliminar el proveedor "${deleteTarget.nombre}"?` : ''}
                confirmText="Eliminar"
                cancelText="Cancelar"
                isDestructive
                isProcessing={deleting}
            />
        </div>
    );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

const SUMMARY_COLOR = {
    teal:   { bg: 'from-chart-9/10 to-surface-card',   border: 'border-chart-9/30',   icon: 'bg-chart-9/10 text-chart-9-text',    glow: 'shadow-chart-9/20',   text: 'text-chart-9-text'   },
    indigo: { bg: 'from-chart-3/10 to-surface-card', border: 'border-chart-3/30', icon: 'bg-chart-3/10 text-chart-3-text',glow: 'shadow-chart-3/20', text: 'text-chart-3-text' },
    amber:  { bg: 'from-warning/10 to-[var(--card-tint-base)]',  border: 'border-warning/30',  icon: 'bg-warning/10 text-warning',  glow: 'shadow-warning/20',  text: 'text-warning'  },
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

// ─── Lab row (accordion) ──────────────────────────────────────────────────────

function LabProveedoresRow({ lab, canEdit, proveedorNameOptions, proveedores, isOpen, onToggle, onMarkND, markingND, newRowIds, onStartAdd, onCancelAdd, onCreate, onUpdate, onDelete }) {
    const devolutivoCount = proveedores.filter(p => p.devolutivo).length;

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
                subtitle={proveedores.length === 0
                    ? 'Sin proveedores registrados'
                    : `${proveedores.length} proveedor${proveedores.length === 1 ? '' : 'es'}${devolutivoCount ? ` · ${devolutivoCount} devolutivo${devolutivoCount === 1 ? '' : 's'}` : ''}`}
                trailing={
                    <ChevronDown size={16} strokeWidth={2.5}
                        className={`transition-transform duration-[var(--dur-base)] ${isOpen ? 'rotate-180 text-chart-9-text' : 'text-content-3'}`} />
                }
            />

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                    >
                        <div className="mx-3 mb-3 rounded-xl bg-surface-card-hover/80 border border-divider p-3 space-y-2">
                            {canEdit && (
                                <div className="flex items-center justify-between gap-2 px-0.5 mb-1">
                                    <span className="text-caption font-bold uppercase tracking-wide text-content-2">Proveedores</span>
                                    <Button tone="warning" disabled={markingND} title="Marca todos los productos de este laboratorio como No Devolutivo (ND) — poco común, la mayoría de laboratorios tienen productos mixtos" onClick={onMarkND}>{markingND ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                                        Marcar todo como ND</Button>
                                </div>
                            )}
                            {proveedores.length === 0 && newRowIds.length === 0 && (
                                <p className="text-label text-content-3 italic px-1 py-2">Este laboratorio aún no tiene proveedores registrados.</p>
                            )}
                            {proveedores.map(p => (
                                <ProveedorRow key={p.id} proveedor={p} canEdit={canEdit} proveedorNameOptions={proveedorNameOptions} onUpdate={onUpdate} onDelete={onDelete} />
                            ))}

                            {newRowIds.map(rowId => (
                                <ProveedorForm
                                    key={rowId}
                                    proveedorNameOptions={proveedorNameOptions}
                                    onCancel={() => onCancelAdd(rowId)}
                                    onSave={(draft) => onCreate(rowId, draft)}
                                />
                            ))}

                            {canEdit && (
                                <Button tone="chart-9" onClick={onStartAdd}><Plus className="w-3.5 h-3.5" /> Agregar proveedor</Button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ─── Proveedor row ────────────────────────────────────────────────────────────

function ProveedorRow({ proveedor, canEdit, proveedorNameOptions, onUpdate, onDelete }) {
    const [editing, setEditing] = useState(false);

    if (editing) {
        return (
            <ProveedorForm
                initial={proveedor}
                proveedorNameOptions={proveedorNameOptions}
                onCancel={() => setEditing(false)}
                onSave={(draft) => onUpdate(proveedor, draft)}
            />
        );
    }

    return (
        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-surface-card border border-divider shadow-sm">
            <Truck className="w-3.5 h-3.5 text-content-3 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="text-body-sm font-semibold text-content-2 truncate flex items-center gap-1.5">
                    {isCofarsal(proveedor.nombre) && (
                        <span role="img" title="COFARSAL" className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                    )}
                    {proveedor.nombre}
                </p>
                {proveedor.notas && <p className="text-caption text-content-3 truncate mt-0.5">{proveedor.notas}</p>}
            </div>
            {proveedor.vineta != null && (
                <Badge title="Viñeta" variant="chart-3" size="sm" uppercase={false}>v{proveedor.vineta}</Badge>
            )}
            {proveedor.devolutivo ? (
                <Badge variant="success" size="sm">Devolutivo{proveedor.meses_devolucion != null ? ` · ${proveedor.meses_devolucion}m` : ''}</Badge>
            ) : (
                <Badge size="sm">No devolutivo</Badge>
            )}
            {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                    <Button tone="chart-9" size="xs" onClick={() => setEditing(true)}><Pencil className="w-3 h-3" /></Button>
                    <Button variant="destructive" size="xs" onClick={() => onDelete(proveedor)}><Trash2 className="w-3 h-3" /></Button>
                </div>
            )}
        </div>
    );
}

// ─── Proveedor form (create/edit) — fila inline con autoguardado ──────────────
// Todo el registro cabe en una sola fila (nombre, meses, ND, notas); no hay
// botón "Guardar" — cada cambio válido se persiste solo (debounce 700ms),
// igual que Devolutivo/Categoría en TabCatalogo (ver memoria del proyecto).

function ProveedorForm({ initial, proveedorNameOptions, onCancel, onSave }) {
    const [draft,     setDraft]     = useState({ ...emptyDraft(), ...initial });
    const [saving,    setSaving]    = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const lastSavedKeyRef = useRef(initial ? draftKey({ ...emptyDraft(), ...initial }) : null);
    const mountedRef = useRef(true);
    useEffect(() => () => { mountedRef.current = false; }, []);

    const setF = (field, value) => setDraft(d => ({ ...d, [field]: value }));

    const options     = proveedorNameOptions || [];
    const isOtro      = isOtroProveedor(draft.nombre, options);
    const nombreValid = draft.nombre.trim() !== '' && draft.nombre !== OTRO_PROVEEDOR;
    const mesesValid  = !draft.devolutivo || (draft.meses_devolucion !== '' && Number(draft.meses_devolucion) >= 0);
    const canSave     = nombreValid && mesesValid;

    useEffect(() => {
        if (!canSave) return;
        const key = draftKey(draft);
        if (key === lastSavedKeyRef.current) return;
        const t = setTimeout(async () => {
            setSaving(true);
            const ok = await onSave(draft);
            if (!mountedRef.current) return;
            setSaving(false);
            if (ok) {
                lastSavedKeyRef.current = key;
                setJustSaved(true);
                setTimeout(() => { if (mountedRef.current) setJustSaved(false); }, 1200);
            }
        }, 700);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft.nombre, draft.devolutivo, draft.meses_devolucion, draft.notas]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl bg-surface-card border border-chart-9/30 shadow-md shadow-chart-9/20 p-2.5"
        >
            <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                <div className="flex-1 min-w-[160px]">
                    <LiquidSelect
                        value={isOtro ? OTRO_PROVEEDOR : draft.nombre}
                        onChange={val => setF('nombre', val)}
                        options={options}
                        placeholder="Proveedor/droguería..."
                        clearable={false}
                        compact
                    />
                </div>

                <div className={`flex items-center gap-1 shrink-0 ${draft.devolutivo ? '' : 'opacity-40 pointer-events-none'}`}>
                    <PortalInput
                        aria-label="Meses para devolución"
                        type="number"
                        min="0"
                        value={draft.meses_devolucion}
                        onChange={e => setF('meses_devolucion', e.target.value)}
                        placeholder="0"
                        title="Meses antes de vencer por política de devolución"
                        readOnly={!draft.devolutivo}
                        compact
                        className="w-12"
                        inputClassName="text-center font-semibold"
                    />
                    <span className="text-micro font-semibold text-content-3 whitespace-nowrap">meses</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <PortalInput
                        aria-label="Viñeta del proveedor"
                        type="number"
                        value={draft.vineta}
                        onChange={e => setF('vineta', e.target.value)}
                        placeholder="—"
                        min="0"
                        step="0.01"
                        title="Viñeta: identifica a este proveedor específico cuando el laboratorio tiene varios — se cruza con el precio-viñeta vigente del producto para resolver la política automáticamente"
                        tono="chart-9"
                        compact
                        inputClassName="text-body-xl font-semibold text-content-2 text-center"
                        className="w-14"
                    />
                    <span className="text-micro font-semibold text-content-3 whitespace-nowrap">viñeta</span>
                </div>

                <Button
                    size="xs"
                    iconOnly
                    aria-pressed={!draft.devolutivo}
                    variant="secondary"
                    tone={!draft.devolutivo ? 'warning' : null}
                    soft
                    icon={!draft.devolutivo ? Ban : RotateCcw}
                    className="shrink-0"
                    title={draft.devolutivo ? 'Marcar como No Devolutivo (ND)' : 'No Devolutivo (ND) — no acepta devolución'}
                    onClick={() => setDraft(d => ({ ...d, devolutivo: !d.devolutivo, meses_devolucion: d.devolutivo ? '' : d.meses_devolucion }))}
                />

                <PortalInput
                    aria-label="Notas de la política"
                    value={draft.notas}
                    onChange={e => setF('notas', e.target.value)}
                    placeholder="Notas (opcional)"
                    tono="chart-9"
                    compact
                    inputClassName="text-body-xl text-content-2"
                    className="flex-1 min-w-[110px]"
                />

                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {saving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-chart-9-text" />
                    ) : justSaved ? (
                        <Check className="w-3.5 h-3.5 text-success" />
                    ) : null}
                </div>

                <Button variant="destructive" size="xs" title="Cerrar" onClick={onCancel}><X className="w-3.5 h-3.5" /></Button>
            </div>

            {isOtro && (
                <PortalInput
                    aria-label="Nombre del proveedor o droguería"
                    value={draft.nombre === OTRO_PROVEEDOR ? '' : draft.nombre}
                    onChange={e => setF('nombre', e.target.value)}
                    placeholder="Nombre del proveedor/droguería"
                    autoFocus
                    tono="chart-9"
                    compact
                    inputClassName="text-body-xl font-semibold text-content-2"
                />
            )}
            {draft.devolutivo && draft.meses_devolucion === '' && (
                <p className="text-micro font-black uppercase text-danger mt-1 px-0.5">Meses requeridos para guardar</p>
            )}
        </motion.div>
    );
}
