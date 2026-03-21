import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
    BookOpen, Building2, Trash2, ListTodo, Plus, Pencil, Check, X,
    Save, Package, ListFilter, AlertTriangle, Eye, EyeOff, Loader2
} from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { formatTime12h } from '../../utils/helpers';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { supabase } from '../../supabaseClient'; // 🚨 Usaremos esta conexión directa

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

            const { data, error } = await supabase
                .from('shifts')
                .upsert(shiftObject)
                .select();

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
            showToast("No se pudo guardar", err.message || "Error interno al intentar guardar.", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleArchiveShift = async (shift) => {
        setActionLoading(shift.id);
        try {
            // 🚨 SOFT DELETE: Archivar en lugar de eliminar
            const { error } = await supabase
                .from('shifts')
                .update({ is_archived: true, updated_at: new Date().toISOString() })
                .eq('id', shift.id);

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
    };

    const handleRestoreShift = async (shift) => {
        setActionLoading(shift.id);
        try {
            // Restaurar turno
            const { error } = await supabase
                .from('shifts')
                .update({ is_archived: false, updated_at: new Date().toISOString() })
                .eq('id', shift.id);

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
    };

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
            <div className={`bg-white rounded-[1.25rem] border shadow-sm transition-all duration-300 relative overflow-hidden group ${isCurrentlyEditing ? 'border-[#007AFF] shadow-[0_8px_30px_rgba(0,122,255,0.1)] ring-2 ring-[#007AFF]/10' : 'border-slate-100'} ${isBeingDeleted ? 'bg-red-50' : 'hover:border-[#007AFF]/30 hover:shadow-md'}`}>
                
                {isArchived && <div className="absolute top-0 right-0 w-2 h-full bg-slate-300"></div>}
                
                <div className="p-4 md:p-5">
                    <div className="flex items-center justify-between mb-3 gap-2">
                        <div className="flex-1 min-w-0">
                            <h5 className="text-[13px] md:text-[14px] font-black text-slate-800 leading-tight mb-1 truncate">{shift.name}</h5>
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[8.5px] font-black uppercase tracking-widest text-slate-500">
                                <Building2 size={10}/> {bName}
                            </span>
                        </div>
                        
                        {/* CONTROLES DE ACCIÓN (Glassmorphic) */}
                        <div className={`flex items-center gap-1.5 shrink-0 bg-white/70 backdrop-blur-md border border-white/90 p-1.5 rounded-full shadow-inner ${isArchived || isBeingDeleted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                            {isBusy ? (
                                <Loader2 size={16} className="animate-spin text-slate-400" />
                            ) : isBeingDeleted ? (
                                <>
                                    <button onClick={() => setConfirmingArchiveId(null)} className="w-7 h-7 rounded-full flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"><X size={14} strokeWidth={3}/></button>
                                    <button onClick={() => handleArchiveShift(shift)} className="w-7 h-7 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors shadow-md"><Check size={14} strokeWidth={3}/></button>
                                </>
                            ) : isArchived ? (
                                <button onClick={() => handleRestoreShift(shift)} title="Restaurar Turno" className="w-8 h-8 rounded-full flex items-center justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-colors"><Plus size={16} strokeWidth={2.5}/></button>
                            ) : (
                                <>
                                    <button onClick={() => startEditing(shift)} title="Editar Turno" className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-600 hover:bg-[#007AFF] hover:text-white hover:shadow-md transition-all active:scale-95"><Pencil size={15} strokeWidth={2.5}/></button>
                                    <button onClick={() => setConfirmingArchiveId(shift.id)} title="Archivar Turno" className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 text-red-500 hover:bg-red-500 hover:text-white hover:shadow-md transition-all active:scale-95"><Package size={15} strokeWidth={2.5}/></button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-4 border border-slate-100">
                        <div className="flex-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Entrada</label>
                            <p className="text-[12px] md:text-[13px] font-bold text-slate-700 font-mono tracking-tighter">{formatTime12h(shift.start_time || shift.start)}</p>
                        </div>
                        <div className="w-px h-8 bg-slate-200"></div>
                        <div className="flex-1">
                            <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Salida</label>
                            <p className="text-[12px] md:text-[13px] font-bold text-slate-700 font-mono tracking-tighter">{formatTime12h(shift.end_time || shift.end)}</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }, [editingShiftId, actionLoading, confirmingArchiveId, branches]);

    return (
        <div id="form-turnos-creator" className="grid grid-cols-1 lg:grid-cols-[40%,1fr] gap-8 h-[75vh] min-h-[500px]">
            
            {/* ================================================================================= */}
            {/* 📝 PANEL IZQUIERDO: CREADOR / EDITOR (Estilo Glassmorphic como el Aviso) */}
            {/* ================================================================================= */}
            <div className="flex flex-col h-full bg-white border border-slate-100 shadow-[0_8px_40px_rgba(0,0,0,0.03)] rounded-[2rem] p-6 sticky top-0">
                <div className="flex items-center gap-3 mb-6 shrink-0 border-b border-slate-100 pb-5">
                    <div className={`w-11 h-11 flex items-center justify-center rounded-2xl shrink-0 border ${editingShiftId ? 'bg-amber-50 text-amber-500 border-amber-100' : 'bg-indigo-50 text-indigo-500 border-indigo-100'}`}>
                        {editingShiftId ? <Pencil size={20} strokeWidth={2.5} /> : <BookOpen size={20} strokeWidth={2.5} />}
                    </div>
                    <div>
                        <h4 className="text-[13px] md:text-[14px] font-black text-slate-800 uppercase tracking-tightleading-none mb-1">
                            {editingShiftId ? 'Editor de Turno' : 'Creador de Turno'}
                        </h4>
                        <p className="text-[10px] md:text-[11px] font-bold text-slate-400 uppercase tracking-widest">Configuración del Catálogo</p>
                    </div>
                    {editingShiftId && (
                        <button onClick={cancelEditing} className="ml-auto w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colorsactive:scale-95"><X size={16} strokeWidth={3}/></button>
                    )}
                </div>

                <div className="flex-1 space-y-6">
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Sucursal Asignada</label>
                        <select 
                            required 
                            className="mt-2 w-full p-3.5 rounded-2xl border border-slate-200 outline-none focus:border-[#007AFF] bg-white shadow-sm text-[12px] md:text-[13px] font-bold text-slate-700 hover:bg-slate-50 transition-colors" 
                            value={currentForm.branchId} 
                            onChange={e => setCurrentForm({ ...currentForm, branchId: e.target.value })}
                        >
                            <option value="" disabled>Seleccionar Sucursal</option>
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </div>
                    
                    <div>
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nombre Identificador del Turno</label>
                        <input 
                            required 
                            type="text"
                            placeholder="Ej: Mañana 8am-4pm" 
                            className="mt-2 w-full p-3.5 rounded-2xl border border-slate-200 outline-none focus:border-[#007AFF] shadow-sm text-[12px] md:text-[13px] font-bold text-slate-700 placeholder:text-slate-300" 
                            value={currentForm.name} 
                            onChange={e => setCurrentForm({ ...currentForm, name: e.target.value })} 
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Hora de Entrada</label>
                            <TimePicker12 value={currentForm.start} onChange={v => setCurrentForm({ ...currentForm, start: v })} />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 block">Hora de Salida</label>
                            <TimePicker12 value={currentForm.end} onChange={v => setCurrentForm({ ...currentForm, end: v })} />
                        </div>
                    </div>
                </div>

                <div className="mt-auto pt-6 border-t border-slate-100 flex justify-end gap-3 shrink-0">
                    {editingShiftId && (
                         <button type="button" onClick={cancelEditing} disabled={isLoading} className="px-5 h-10 rounded-full text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:bg-slate-100 disabled:opacity-50">Cancelar</button>
                    )}
                    <button 
                        type="button" 
                        onClick={handleSaveShift} 
                        disabled={isLoading}
                        className={`h-10 px-6 rounded-full font-black text-[10px] uppercase tracking-widest transition-all shadow-md flex items-center gap-2 ${editingShiftId ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 hover:shadow-lg' : 'bg-[#007AFF] text-white border-[#005CE6] hover:bg-[#0066CC] hover:shadow-lg hover:-translate-y-0.5'} active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isLoading ? (
                            <><Loader2 size={14} className="animate-spin"/> Guardando</>
                        ) : (
                            <><Save size={14} strokeWidth={2.5}/> {editingShiftId ? 'Actualizar Turno' : 'Crear Turno'}</>
                        )}
                    </button>
                </div>
            </div>

            {/* ================================================================================= */}
            {/* 📋 PANEL DERECHO: LISTA DE TURNOS (Bento Cards + Scroll) */}
            {/* ================================================================================= */}
            <div className="flex flex-col h-full bg-slate-50 rounded-[2rem] border border-slate-100 p-6 overflow-hidden">
                <div className="flex items-center justify-between gap-4 mb-6 shrink-0 pb-5 border-b border-slate-100/60">
                    <h4 className="text-[12px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                        <ListTodo size={16} className="text-[#007AFF]"/> {listBranchFilter === 'ALL' ? 'Catálogo Completo' : 'Turnos Registrados'}
                    </h4>
                    
                    {/* FILTROS DE SUCURSAL Y ESTADO (Minificados) */}
                    <div className="flex items-center gap-2">
                        <select 
                            className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none shadow-sm hover:border-[#007AFF]/20 transition-colors"
                            value={listBranchFilter}
                            onChange={(e) => setListBranchFilter(e.target.value)}
                        >
                            <option value="ALL">Todas</option>
                            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                        
                        <select 
                            className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 outline-none shadow-sm hover:border-[#007AFF]/20 transition-colors"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="ACTIVE">Activos</option>
                            <option value="ARCHIVED">Histórico</option>
                            <option value="ALL">Ver Todos</option>
                        </select>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide pb-8 relative">
                    {allShifts === null ? (
                         <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 opacity-60">
                             <Loader2 size={32} strokeWidth={1.5} className="animate-spin text-[#007AFF]" />
                             <p className="text-[10px] font-black uppercase tracking-widest text-center">Conectando a Supabase...</p>
                         </div>
                    ) : visibleShifts.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {visibleShifts.map(shift => <TurnoCard key={shift.id} shift={shift} />)}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3 opacity-60">
                            {statusFilter === 'ARCHIVED' ? <Package size={32} /> : <BookOpen size={32} strokeWidth={1.5} />}
                            <p className="text-[10px] font-black uppercase tracking-widest text-center">No hay turnos registrados en esta vista</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default FormTurnos;