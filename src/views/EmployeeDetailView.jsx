import React, { useState } from 'react';
import { 
    ArrowRightLeft, Edit, Mail, Phone, Shield, 
    Clock, FileText, Paperclip, 
    CheckCircle, Plus, UploadCloud, Activity, ShieldAlert,
    CalendarClock, MapPin, Briefcase 
} from 'lucide-react';
import { EVENT_TYPES } from '../data/constants';
import { formatDate } from '../utils/helpers';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import ShiftExceptionModal from '../components/ShiftExceptionModal';

const EmployeeDetailView = ({ activeEmployee, setView, activeTab, setActiveTab, openModal }) => {
    // Usamos el hook useStaff para tener siempre la lista de empleados actualizada (Live Update)
    const { employees, branches } = useStaff();
    const { user, isAdmin } = useAuth();
    
    const [showExceptionModal, setShowExceptionModal] = useState(false);

    // Lógica para obtener el empleado más fresco
    const targetId = activeEmployee?.id || user?.id;
    const emp = employees.find(e => String(e.id) === String(targetId)) || (activeEmployee || user);

    if (!emp) return null;

    const branch = branches.find(b => b.id === emp.branchId);

    // Permisos (asistencia)
    const permissions = (emp.attendance || [])
        .filter(a => a.type === 'OUT_EARLY')
        .reverse();

    // --- LÓGICA DE HISTORIAL AUTOMÁTICO ---
    // Combinamos los eventos reales de la base de datos con eventos calculados (como la contratación)
    const rawHistory = emp.history || [];
    const syntheticEvents = [];

    // Generamos el evento de contratación si existe la fecha
    if (emp.hireDate) {
        syntheticEvents.push({
            id: 'hiring-event',
            type: 'HIRING', // Tipo especial interno
            date: emp.hireDate,
            note: `Inicio de labores en ${branch ? branch.name : 'la empresa'}.`,
            isSystem: true
        });
    }

    // Unimos y ordenamos por fecha (el más reciente primero)
    const timeline = [...rawHistory, ...syntheticEvents].sort((a, b) => new Date(b.date) - new Date(a.date));

    return (
        <div className="p-4 md:p-8 min-h-full animate-in fade-in duration-500 font-sans relative z-10">
            <div className="max-w-6xl mx-auto">
                
                {/* --- HEADER SUPERIOR --- */}
                <div className="flex justify-between items-center mb-8">
                    {/* Botón Volver: Solo visible si eres Admin (para no atrapar al empleado) */}
                    {isAdmin ? (
                        <button 
                            onClick={() => setView('dashboard')} 
                            className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-white/40 hover:bg-white/60 backdrop-blur-md border border-white/50 text-slate-600 font-bold text-[10px] uppercase tracking-[0.2em] transition-all shadow-sm"
                        >
                            <ArrowRightLeft className="rotate-180 transition-transform group-hover:-translate-x-1" size={16}/> Volver
                        </button>
                    ) : (
                        <div></div> /* Espacio vacío para mantener el layout */
                    )}
                    
                    {isAdmin && (
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowExceptionModal(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white/40 hover:bg-white/60 backdrop-blur-md border border-white/50 text-slate-700 rounded-2xl font-bold text-[11px] uppercase tracking-widest hover:text-orange-600 transition-all shadow-sm active:scale-[0.98]"
                            >
                                <CalendarClock size={14}/> Excepciones
                            </button>

                            <button 
                                onClick={() => openModal('editEmployee', emp)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white/40 hover:bg-white/60 backdrop-blur-md border border-white/50 text-slate-700 rounded-2xl font-bold text-[11px] uppercase tracking-widest hover:text-[#007AFF] transition-all shadow-sm active:scale-[0.98]"
                            >
                                <Edit size={14}/> Editar Datos
                            </button>
                            <button 
                                onClick={() => openModal('newEvent', { type: 'TRANSFER' })}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white rounded-2xl font-bold text-[11px] uppercase tracking-widest hover:bg-[#0066CC] transition-all shadow-[0_8px_20px_rgba(0,122,255,0.3)] active:scale-[0.98]"
                            >
                                <Plus size={14}/> Registrar Acción
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    
                    {/* --- TARJETA DE PERFIL (Glass Style) --- */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="relative w-full overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/30 shadow-[0_8px_32px_rgba(0,0,0,0.05)] backdrop-blur-2xl">
                            
                            {/* Fondo decorativo superior */}
                            <div className="absolute top-0 h-40 w-full bg-gradient-to-b from-[#007AFF]/10 to-transparent"></div>
                            
                            <div className="px-8 pb-10 pt-12 flex flex-col items-center relative z-10">
                                {/* FOTO DE PERFIL (Limpia, sin cámara) */}
                                <div className="h-40 w-40 rounded-full p-1.5 bg-white/50 border border-white/60 shadow-2xl backdrop-blur-sm mb-6">
                                    <div className="h-full w-full rounded-full overflow-hidden bg-slate-100 relative">
                                        {emp.photo ? (
                                            <img src={emp.photo} className="w-full h-full object-cover" alt="Perfil" />
                                        ) : (
                                            <span className="text-5xl font-black text-slate-300 flex h-full items-center justify-center italic">
                                                {emp.name.charAt(0)}
                                            </span>
                                        )}
                                        {/* Brillo overlay */}
                                        <div className="absolute inset-0 bg-gradient-to-tr from-black/10 to-transparent pointer-events-none"></div>
                                    </div>
                                </div>
                                
                                <h2 className="text-3xl font-bold text-slate-800 text-center leading-tight mb-2 tracking-tight">
                                    {emp.name}
                                </h2>
                                <div className="px-4 py-1.5 rounded-full bg-[#007AFF]/10 border border-[#007AFF]/20 text-[#007AFF] font-black text-[10px] uppercase tracking-[0.15em] mb-8">
                                    {emp.role}
                                </div>
                                
                                {/* Info Cards */}
                                <div className="w-full space-y-3">
                                    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 transition-colors">
                                        <div className="p-2.5 bg-white rounded-xl shadow-sm text-blue-500">
                                            <Mail size={18}/>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Correo</p>
                                            <p className="text-xs font-semibold text-slate-700 truncate">{emp.email || 'No registrado'}</p>
                                        </div>
                                    </div>

                                    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 transition-colors">
                                        <div className="p-2.5 bg-white rounded-xl shadow-sm text-purple-500">
                                            <Phone size={18}/>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Teléfono</p>
                                            <p className="text-xs font-semibold text-slate-700">{emp.phone || 'Sin Teléfono'}</p>
                                        </div>
                                    </div>

                                    <div className="group flex items-center gap-4 p-4 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 transition-colors">
                                        <div className="p-2.5 bg-white rounded-xl shadow-sm text-emerald-500">
                                            <Shield size={18}/>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Identificación</p>
                                            <p className="text-xs font-semibold text-slate-700 uppercase">DUI: {emp.dui || 'N/A'}</p>
                                        </div>
                                    </div>

                                    {branch && (
                                        <div className="group flex items-center gap-4 p-4 rounded-2xl bg-white/40 border border-white/50 hover:bg-white/60 transition-colors">
                                            <div className="p-2.5 bg-white rounded-xl shadow-sm text-orange-500">
                                                <MapPin size={18}/>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sucursal</p>
                                                <p className="text-xs font-semibold text-slate-700 truncate">{branch.name}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* --- CONTENIDO PRINCIPAL (DERECHA) --- */}
                    <div className="lg:col-span-8 space-y-6">
                        
                        {/* Tabs Glass */}
                        <div className="relative flex bg-white/30 backdrop-blur-md p-1.5 rounded-2xl border border-white/40 shadow-sm w-full">
                            <div 
                                className="absolute top-1.5 bottom-1.5 w-[calc(33.333%-4px)] bg-white rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                                style={{ 
                                    transform: activeTab === 'history' ? 'translateX(0%)' : 
                                               activeTab === 'documents' ? 'translateX(100%)' : 
                                               'translateX(200%)' 
                                }}
                            ></div>

                            <button onClick={() => setActiveTab('history')} className={`flex-1 flex items-center justify-center gap-2 py-3 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 z-10 ${activeTab === 'history' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                                <Clock size={14}/> Historial
                            </button>
                            <button onClick={() => setActiveTab('documents')} className={`flex-1 flex items-center justify-center gap-2 py-3 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 z-10 ${activeTab === 'documents' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                                <FileText size={14}/> Expediente
                            </button>
                            <button onClick={() => setActiveTab('permissions')} className={`flex-1 flex items-center justify-center gap-2 py-3 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 z-10 ${activeTab === 'permissions' ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}>
                                <Activity size={14}/> Permisos
                            </button>
                        </div>

                        {/* Contenedor Glass Contenido */}
                        <div className="bg-white/40 backdrop-blur-2xl rounded-[2.5rem] border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.05)] p-6 md:p-8 min-h-[500px]">
                            
                            {/* PESTAÑA 1: HISTORIAL */}
                            {activeTab === 'history' && (
                                <div className="space-y-8 animate-in fade-in zoom-in-[0.98] duration-500">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Línea de Tiempo</h3>
                                        <div className="px-3 py-1 bg-white/50 text-slate-500 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-white/60">
                                            {timeline.length} Eventos
                                        </div>
                                    </div>

                                    <div className="relative border-l-[2px] border-slate-200/60 ml-6 space-y-10">
                                        {timeline.length > 0 ? timeline.map((ev, idx) => {
                                            // Renderizado especial para el evento de contratación
                                            const isHiring = ev.type === 'HIRING';
                                            const type = isHiring 
                                                ? { label: 'Contratación', color: 'bg-emerald-100 text-emerald-700' }
                                                : (EVENT_TYPES[ev.type] || { label: ev.type, color: 'bg-slate-100 text-slate-600' });
                                            
                                            // Clave única (usamos idx para eventos sintéticos si no tienen id único)
                                            const key = ev.id || `evt-${idx}`;

                                            return (
                                                <div key={key} className="relative pl-8 group">
                                                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-white border-[3px] shadow-sm group-hover:scale-125 transition-transform duration-300 ${isHiring ? 'border-emerald-500' : 'border-[#007AFF]'}`}></div>
                                                    
                                                    <div className="bg-white/60 hover:bg-white/80 rounded-3xl p-6 border border-white/60 hover:border-blue-200 transition-all duration-300 shadow-sm">
                                                        <div className="flex justify-between items-start mb-3">
                                                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${type.color}`}>{type.label}</span>
                                                            <span className="text-[11px] font-bold text-slate-400">{formatDate(ev.date)}</span>
                                                        </div>
                                                        <p className="text-sm text-slate-700 leading-relaxed font-medium mb-4">{ev.note}</p>
                                                        
                                                        {/* Solo mostramos botón de adjuntar si NO es evento de sistema (Contratación) */}
                                                        {!ev.isSystem && (
                                                            <div className="pt-4 border-t border-slate-100/50 flex justify-between items-center">
                                                                {ev.documentId ? (
                                                                    <button className="flex items-center gap-2 text-[#007AFF] font-bold text-[10px] uppercase tracking-widest hover:underline">
                                                                        <FileText size={14}/> Ver Soporte
                                                                    </button>
                                                                ) : (
                                                                    <button 
                                                                        onClick={() => openModal('uploadDocument', {}, ev.id)}
                                                                        className="flex items-center gap-2 text-slate-400 hover:text-orange-500 font-bold text-[10px] uppercase tracking-widest transition-colors"
                                                                    >
                                                                        <Paperclip size={14}/> Adjuntar
                                                                    </button>
                                                                )}
                                                            </div>
                                                        )}
                                                        {isHiring && (
                                                            <div className="pt-2 flex items-center gap-2 text-emerald-600 opacity-60">
                                                                <Briefcase size={14}/> <span className="text-[10px] font-bold uppercase tracking-widest">Hito Inicial</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }) : (
                                            <div className="text-center py-24 opacity-40">
                                                <Clock size={48} className="mx-auto mb-4 text-slate-400"/>
                                                <p className="font-bold uppercase tracking-widest text-xs text-slate-500">Historial Vacío</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                            
                            {/* ... (Las pestañas de Documentos y Permisos siguen igual que antes) ... */}
                            {activeTab === 'documents' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in zoom-in-[0.98] duration-500">
                                    {emp.documents?.map(doc => (
                                        <div key={doc.id} className="p-4 bg-white/50 hover:bg-white/80 rounded-2xl border border-white/60 flex items-center justify-between group cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-white rounded-xl text-[#007AFF] shadow-sm"><FileText size={20}/></div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-800 truncate max-w-[150px]">{doc.name}</p>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{doc.type}</p>
                                                </div>
                                            </div>
                                            <button className="p-2 opacity-0 group-hover:opacity-100 text-[#007AFF] bg-blue-50 rounded-full transition-all duration-300">
                                                <ArrowRightLeft size={16}/>
                                            </button>
                                        </div>
                                    ))}
                                    {(!emp.documents || emp.documents.length === 0) && (
                                        <div className="col-span-full py-24 text-center opacity-40">
                                            <FileText size={48} className="mx-auto mb-4 text-slate-400"/>
                                            <p className="font-bold uppercase tracking-widest text-xs text-slate-500">Sin Documentos</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'permissions' && (
                                <div className="space-y-6 animate-in fade-in zoom-in-[0.98] duration-500">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="font-black text-slate-800 uppercase tracking-tight text-lg">Permisos y Ausencias</h3>
                                        <div className="px-3 py-1 bg-orange-50/50 text-orange-600 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-orange-100">
                                            {permissions.length} Registros
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {permissions.length > 0 ? permissions.map((perm, idx) => (
                                            <div key={idx} className="bg-white/50 border border-white/60 rounded-[1.5rem] p-5 flex flex-col md:flex-row gap-5 justify-between items-start md:items-center hover:bg-white/80 transition-all duration-300 shadow-sm">
                                                <div className="space-y-3 flex-1">
                                                    <div className="flex items-center gap-3">
                                                        <span className="px-3 py-1.5 bg-white border border-orange-100 text-orange-600 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-sm">
                                                            {perm.details?.reason || 'Salida Especial'}
                                                        </span>
                                                        <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                                                            <Clock size={14}/> 
                                                            {new Date(perm.timestamp).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm font-medium text-slate-600 border-l-[3px] border-orange-200 pl-4 py-1">
                                                        {perm.details?.notes || 'Sin justificación adicional.'}
                                                    </p>
                                                </div>
                                                
                                                <div className="flex-shrink-0">
                                                    {perm.details?.requiresAttachment ? (
                                                        perm.details?.attachmentUrl ? (
                                                            <button className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 border border-green-200 rounded-xl font-bold text-[10px] uppercase tracking-widest">
                                                                <CheckCircle size={14}/> Ver Constancia
                                                            </button>
                                                        ) : (
                                                            <button 
                                                                onClick={() => openModal('uploadConstancia', { employeeId: emp.id, punchTimestamp: perm.timestamp })}
                                                                className="flex items-center gap-2 px-4 py-2 bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-xl font-bold text-[10px] uppercase tracking-widest shadow-sm"
                                                            >
                                                                <UploadCloud size={14}/> Subir Constancia
                                                            </button>
                                                        )
                                                    ) : (
                                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1">
                                                            <ShieldAlert size={14}/> No requiere anexo
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="text-center py-20 opacity-40">
                                                <Activity size={48} className="mx-auto mb-4 text-slate-400"/>
                                                <p className="font-bold uppercase tracking-widest text-xs text-slate-500">Sin Permisos Registrados</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                </div>

                {showExceptionModal && (
                    <ShiftExceptionModal 
                        employee={emp} 
                        onClose={() => setShowExceptionModal(false)} 
                    />
                )}

            </div>
        </div>
    );
};

export default EmployeeDetailView;