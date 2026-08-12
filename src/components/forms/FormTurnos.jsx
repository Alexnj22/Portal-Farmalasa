import React, { useState, useMemo, useCallback } from 'react';
import Button from '../common/Button';
import { SkeletonText } from '../common/StateViews';
import {
    BookOpen, Building2, Trash2, ListTodo, Plus, Pencil, Check, X,
    Save, Package, ListFilter, AlertTriangle, Eye, EyeOff, Loader2
} from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import LiquidSelect from '../common/LiquidSelect';
import { formatTime12h } from '../../utils/helpers';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { upsertShift, updateShiftFlags } from '../../data/system';
import PortalInput from '../../components/common/PortalInput';
import { EmptyState } from '../common/StateViews';
import { mensajeAmigable } from '../../utils/errorMessages';

const FormTurnos = ({ branches }) => {
    // 1. Conexión directa con Supabase para acciones de persistencia
    const { fetchShifts } = useStaffStore();
    const { showToast } = useToastStore();

    // 2. Estados de la Interfaz y Filtros
    const [listBranchFilter, setListBranchFilter] = useState('ALL');
    const [statusFilter, setStatusFilter] = useState('ACTIVE'); // ACTIVE / ARCHIVED / ALL
    const [isLoading, setIsLoading] = useState(false);
    const [actionLoading, setActionLoading] = useState(null); // id del turno en acción

    // 3. Estados para el Formulario (Izquierdo) - Unificados
    const [editingShiftId, setEditingShiftId] = useState(null); // null = creando nuevo
    const [currentForm, setCurrentForm] = useState({ name: '', start: '', end: '', branchId: '' });

    // 4. Estado para Confirmación de Archivo (Usaremos LiquidToast o AlertModal después)
    // Por simplicidad en este formulario, usaremos una confirmación en línea en la Card.
    const [confirmingArchiveId, setConfirmingArchiveId] = useState(null);

    // --- LÓGICA DE VALIDACIÓN ---
    const validateTime = (start, end, branchId) => {
        if (!start || !end || !branchId) return "Completa todos los campos obligatorios.";
        const branch = branches.find(b => String(b.id) === String(branchId));
        if (!branch) return "Sucursal inválida.";
        if (start >= end) return "La hora de salida debe ser posterior a la de entrada.";
        // Puedes agregar más reglas de horarios operativos si lo deseas...
        return null; // OK
    };

    // --- ACCIONES DIRECTAS A SUPABASE (Upsert y Archivar) ---
    const handleSaveShift = async () => {
        const errorMsg = validateTime(currentForm.start, currentForm.end, currentForm.branchId);
        if (errorMsg) {
            showToast("Error de Validación", errorMsg, "error");
            return;
        }

        setIsLoading(true);
        try {
            const shiftObject = {
                id: editingShiftId || undefined, // Supabase crea nuevo si no hay ID
                name: currentForm.name.trim(),
                start_time: currentForm.start,
                end_time: currentForm.end,
                branch_id: currentForm.branchId,
                is_archived: false, // Por defecto al crear/editar queda activo
                updated_at: new Date().toISOString()
            };

            const { error } = await upsertShift(shiftObject);

            if (error) throw error;

            showToast(
                editingShiftId ? "Turno Actualizado" : "Turno Creado",
                `El turno "${shiftObject.name}" se guardó con éxito.`,
                "success"
            );

            // Refrescar store y resetear formulario
            if (fetchShifts) await fetchShifts();
            setEditingShiftId(null);
            setCurrentForm({ name: '', start: '', end: '', branchId: '' });

        } catch (err) {
            console.error("Error guardando turno:", err);
            showToast("No se pudo guardar", mensajeAmigable(err, "Error interno al intentar guardar."), "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleArchiveShift = useCallback(async (shift) => {
        setActionLoading(shift.id);
        try {
            // 🚨 SOFT DELETE: Archivar en lugar de eliminar
            const { error } = await updateShiftFlags(shift.id, { is_archived: true, updated_at: new Date().toISOString() });

            if (error) throw error;

            showToast(
                "Turno Archivado",
                `El turno "${shift.name}" ha sido movido al histórico.`,
                "success"
            );

            if (fetchShifts) await fetchShifts();
            setConfirmingArchiveId(null);
        } catch (err) {
            console.error("Error archivando turno:", err);
            showToast("Error", "No se pudo archivar el turno. Revisa la consola.", "error");
        } finally {
            setActionLoading(null);
        }
    }, [fetchShifts, showToast]);

    const handleRestoreShift = useCallback(async (shift) => {
        setActionLoading(shift.id);
        try {
            // Restaurar turno
            const { error } = await updateShiftFlags(shift.id, { is_archived: false, updated_at: new Date().toISOString() });

            if (error) throw error;

            showToast(
                "Turno Restaurado",
                `El turno "${shift.name}" está activo nuevamente.`,
                "success"
            );

            if (fetchShifts) await fetchShifts();
        } catch (err) {
            console.error("Error restaurando turno:", err);
            showToast("Error", "No se pudo restaurar el turno.", "error");
        } finally {
            setActionLoading(null);
        }
    }, [fetchShifts, showToast]);

    // --- MODOS DE EDICIÓN ---
    const startEditing = (shift) => {
        // Hacemos scroll suave al principio del formulario
        document.getElementById('form-turnos-creator').scrollIntoView({ behavior: 'smooth' });
        
        setEditingShiftId(shift.id);
        setCurrentForm({
            name: shift.name || '',
            start: shift.start_time || shift.start || '',
            end: shift.end_time || shift.end || '',
            branchId: shift.branchId || shift.branch_id || ''
        });
    };

    const cancelEditing = () => {
        setEditingShiftId(null);
        setCurrentForm({ name: '', start: '', end: '', branchId: '' });
    };

    // --- FILTRADO DE VISTA ---
    const { shifts: allShifts } = useStaffStore(); // Usamos Zustand para la lectura rápida

    const visibleShifts = useMemo(() => {
        if (!allShifts) return [];
        return allShifts
            .filter(s => {
                // Filtro de Sucursal
                const matchesBranch = listBranchFilter === 'ALL' || String(s.branchId || s.branch_id) === String(listBranchFilter);
                
                // Filtro de Estado (Activo vs Archivado)
                const isArchived = s.is_archived === true;
                const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'ACTIVE' && !isArchived) || (statusFilter === 'ARCHIVED' && isArchived);

                return matchesBranch && matchesStatus;
            })
            .sort((a, b) => {
                const bA = a.branchId || a.branch_id || 0;
                const bB = b.branchId || b.branch_id || 0;
                if (bA !== bB) return bA - bB;
                return (a.start_time || a.start || '').localeCompare(b.start_time || b.start || '');
            });
    }, [allShifts, listBranchFilter, statusFilter]);

    // Componente de Card para evitar re-renders masivos
    const TurnoCard = useCallback(({ shift }) => {
        const isCurrentlyEditing = editingShiftId === shift.id;
        const bName = branches.find(b => String(b.id) === String(shift.branchId || shift.branch_id))?.name || 'Desconocida';
        const isArchived = shift.is_archived === true;
        const isBeingDeleted = confirmingArchiveId === shift.id;
        const isBusy = actionLoading === shift.id;

        return (
            <div className={`bg-surface-card rounded-2xl border shadow-sm transition-all duration-[var(--dur-slow)] relative overflow-hidden group ${isCurrentlyEditing ? 'border-brand shadow-[var(--shadow-glow-brand)] ring-2 ring-brand/45' : 'border-divider'} ${isBeingDeleted ? 'bg-danger/10' : 'hover:border-brand/30 hover:shadow-md'}`}>
                
                {isArchived && <div className="absolute top-0 right-0 w-2 h-full bg-content-3"></div>}
                
                <div className="p-4 md:p-5">
                    <div className="flex items-center justify-between mb-3 gap-2">
                        <div className="flex-1 min-w-0">
                            <h5 className="text-body md:text-body-lg font-black text-content leading-tight mb-1 truncate">{shift.name}</h5>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-card-hover border border-divider text-[8.5px] font-black uppercase tracking-widest text-content-3">
                                <Building2 size={10}/> {bName}
                            </span>
                        </div>
                        
                        {/* CONTROLES DE ACCIÓN · §20.2 · un grupo de controles en una
                            caja redondeada es un CARRIL: el material sale de
                            `data-surface="tab-track"` y acá sólo queda el layout. */}
                        <div data-surface="tab-track" className={`flex items-center gap-1.5 shrink-0 p-1.5 ${isArchived || isBeingDeleted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} transition-opacity`}>
                            {isBusy ? (
                                <Loader2 size={16} className="animate-spin text-content-3" />
                            ) : isBeingDeleted ? (
                                <>
                                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={() => setConfirmingArchiveId(null)} />
                                    <Button variant="destructive" size="xs" icon={Check} iconOnly onClick={() => handleArchiveShift(shift)} />
                                </>
                            ) : isArchived ? (
                                <Button tone="success" size="sm" icon={Plus} title="Restaurar turno" iconOnly onClick={() => handleRestoreShift(shift)} />
                            ) : (
                                <>
                                    <Button size="sm" icon={Pencil} title="Editar Turno" iconOnly onClick={() => startEditing(shift)} />
                                    <Button variant="destructive" size="sm" icon={Package} title="Archivar turno" iconOnly onClick={() => setConfirmingArchiveId(shift.id)} />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="bg-surface-card-hover rounded-xl p-3 flex items-center gap-4 border border-divider">
                        <div className="flex-1">
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1 block">Entrada</label>
                            <p className="text-body-sm md:text-body font-bold text-content-2 font-mono tracking-tighter">{formatTime12h(shift.start_time || shift.start)}</p>
                        </div>
                        <div className="w-px h-8 bg-divider"></div>
                        <div className="flex-1">
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1 block">Salida</label>
                            <p className="text-body-sm md:text-body font-bold text-content-2 font-mono tracking-tighter">{formatTime12h(shift.end_time || shift.end)}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }, [editingShiftId, actionLoading, confirmingArchiveId, branches, handleArchiveShift, handleRestoreShift]);

    return (
        <div id="form-turnos-creator" className="grid grid-cols-1 lg:grid-cols-[40%,1fr] gap-8 h-[75vh] min-h-[500px]">
            
            {/* ================================================================================= */}
            {/* 📝 PANEL IZQUIERDO: CREADOR / EDITOR (Estilo Glassmorphic como el Aviso) */}
            {/* ================================================================================= */}
            <div data-surface="card" className="flex flex-col h-full p-6 sticky top-0">
                <div className="flex items-center gap-3 mb-6 shrink-0 border-b border-divider pb-5">
                    <div className={`w-11 h-11 flex items-center justify-center rounded-2xl shrink-0 border ${editingShiftId ? 'bg-warning/10 text-warning border-warning/30' : 'bg-chart-3/10 text-chart-3-text border-chart-3/30'}`}>
                        {editingShiftId ? <Pencil size={20} strokeWidth={2.5} /> : <BookOpen size={20} strokeWidth={2.5} />}
                    </div>
                    <div>
                        <h4 className="text-body md:text-body-lg font-black text-content uppercase tracking-tightleading-none mb-1">
                            {editingShiftId ? 'Editor de Turno' : 'Creador de Turno'}
                        </h4>
                        <p className="text-caption md:text-label font-bold text-content-2 uppercase tracking-widest">Configuración del Catálogo</p>
                    </div>
                    {editingShiftId && (
                        <Button variant="ghost" size="sm" icon={X} iconOnly onClick={cancelEditing} />
                    )}
                </div>

                <div className="flex-1 space-y-6">
                    <div>
                        <label className="text-caption font-black text-content-3 uppercase tracking-widest">Sucursal Asignada</label>
                        <div className="mt-2">
                            <LiquidSelect
                                value={currentForm.branchId}
                                onChange={val => setCurrentForm({ ...currentForm, branchId: val })}
                                options={branches.map(b => ({ value: b.id, label: b.name }))}
                                placeholder="Seleccionar sucursal"
                                clearable={false}
                            />
                        </div>
                    </div>
                    
                    <PortalInput
                            label="Nombre Identificador del Turno" name="turno-nombre"
                            required
                            placeholder="Ej: Mañana 8am-4pm"
                            value={currentForm.name}
                            onChange={e => setCurrentForm({ ...currentForm, name: e.target.value })}
                        />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-caption font-black text-content-3 uppercase tracking-widest mb-2 block">Hora de Entrada</label>
                            <TimePicker12 value={currentForm.start} onChange={v => setCurrentForm({ ...currentForm, start: v })} />
                        </div>
                        <div>
                            <label className="text-caption font-black text-content-3 uppercase tracking-widest mb-2 block">Hora de Salida</label>
                            <TimePicker12 value={currentForm.end} onChange={v => setCurrentForm({ ...currentForm, end: v })} />
                        </div>
                    </div>
                </div>

                <div className="mt-auto pt-6 border-t border-divider flex justify-end gap-3 shrink-0">
                    {editingShiftId && (
                         <Button variant="secondary" disabled={isLoading} onClick={cancelEditing}>Cancelar</Button>
                    )}
                    <Button
                        onClick={handleSaveShift}
                        loading={isLoading}
                        tone={editingShiftId ? 'warning' : null}
                        icon={Save}
                    >
                        {isLoading ? 'Guardando' : (editingShiftId ? 'Actualizar Turno' : 'Crear Turno')}
                    </Button>
                </div>
            </div>

            {/* ================================================================================= */}
            {/* 📋 PANEL DERECHO: LISTA DE TURNOS (Bento Cards + Scroll) */}
            {/* ================================================================================= */}
            <div data-surface="card" className="flex flex-col h-full bg-surface-card-hover p-6 overflow-hidden">
                <div className="flex items-center justify-between gap-4 mb-6 shrink-0 pb-5 border-b border-divider">
                    <h4 className="text-body-sm font-black text-content-2 uppercase tracking-widest flex items-center gap-2">
                        <ListTodo size={16} className="text-brand-text"/> {listBranchFilter === 'ALL' ? 'Catálogo Completo' : 'Turnos Registrados'}
                    </h4>
                    
                    {/* FILTROS DE SUCURSAL Y ESTADO (Minificados) */}
                    <div className="flex items-center gap-2">
                        <LiquidSelect
                            value={listBranchFilter}
                            onChange={setListBranchFilter}
                            options={[{ value: 'ALL', label: 'Todas' }, ...branches.map(b => ({ value: b.id, label: b.name }))]}
                            clearable={false}
                            compact
                        />

                        <LiquidSelect
                            value={statusFilter}
                            onChange={setStatusFilter}
                            options={[
                                { value: 'ACTIVE', label: 'Activos' },
                                { value: 'ARCHIVED', label: 'Histórico' },
                                { value: 'ALL', label: 'Ver todos' },
                            ]}
                            clearable={false}
                            compact
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide pb-8 relative">
                    {allShifts === null ? (
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             {Array.from({ length: 4 }, (_, i) => (
                                 <div key={i} data-surface="card" className="p-4"><SkeletonText lines={3} /></div>
                             ))}
                         </div>
                    ) : visibleShifts.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {visibleShifts.map(shift => <TurnoCard key={shift.id} shift={shift} />)}
                        </div>
                    ) : (
                        <EmptyState
                            compact
                            icon={statusFilter === 'ARCHIVED' ? Package : BookOpen}
                            title={statusFilter === 'ARCHIVED' ? 'Sin turnos archivados' : 'Sin turnos registrados'}
                            subtitle={statusFilter === 'ARCHIVED' ? 'Los turnos que archives van a aparecer acá.' : 'Crea el primero para empezar a armar los horarios.'}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormTurnos;