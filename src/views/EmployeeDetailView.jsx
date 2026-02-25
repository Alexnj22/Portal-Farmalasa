import React, { useState } from 'react';
import { 
    ArrowRightLeft, Edit, Mail, Phone, Shield, 
    Clock, FileText, Paperclip, Camera, 
    CheckCircle, Plus, UploadCloud, Activity, ShieldAlert,
    CalendarClock 
} from 'lucide-react';
import { EVENT_TYPES } from '../data/constants';
import { formatDate } from '../utils/helpers';
import { useStaff } from '../context/StaffContext';
import { useAuth } from '../context/AuthContext';
import ShiftExceptionModal from '../components/ShiftExceptionModal';

const EmployeeDetailView = ({ activeEmployee, setView, activeTab, setActiveTab, openModal }) => {
    const { updateEmployee, branches } = useStaff();
    const { user, isAdmin } = useAuth();
    
    const [showExceptionModal, setShowExceptionModal] = useState(false);

    // Priorizamos el seleccionado por el admin, o el perfil propio del usuario
    const emp = activeEmployee || user;
    if (!emp) return null;

    const branch = branches.find(b => b.id === emp.branchId);

    // Filtramos los permisos de las marcaciones de asistencia (OUT_EARLY)
    const permissions = (emp.attendance || [])
        .filter(a => a.type === 'OUT_EARLY')
        .reverse();

    const handlePhotoChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                updateEmployee(emp.id, { photo: reader.result });
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="p-4 md:p-8 bg-[#F2F2F7] min-h-full animate-in fade-in duration-500 font-sans">
            <div className="max-w-6xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <button 
                        onClick={() => setView('dashboard')} 
                        className="flex items-center gap-2 text-slate-400 hover:text-[#007AFF] font-bold text-[10px] uppercase tracking-[0.2em] transition-colors duration-300"
                    >
                        <ArrowRightLeft className="rotate-180" size={16}/> Volver al Panel
                    </button>
                    
                    {isAdmin && (
                        <div className="flex gap-3">
                            <button 
                                onClick={() => setShowExceptionModal(true)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200/60 text-slate-700 rounded-[1rem] font-bold text-[11px] uppercase tracking-widest hover:border-orange-300 hover:text-orange-600 transition-all shadow-sm active:scale-[0.98]"
                            >
                                <CalendarClock size={14}/> Excepciones
                            </button>

                            <button 
                                onClick={() => openModal('editEmployee', emp)}
                                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200/60 text-slate-700 rounded-[1rem] font-bold text-[11px] uppercase tracking-widest hover:text-[#007AFF] transition-all shadow-sm active:scale-[0.98]"
                            >
                                <Edit size={14}/> Editar Datos
                            </button>
                            <button 
                                onClick={() => openModal('newEvent', { type: 'TRANSFER' })}
                                className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white rounded-[1rem] font-bold text-[11px] uppercase tracking-widest hover:bg-[#0066CC] transition-all shadow-[0_4px_12px_rgba(0,122,255,0.2)] active:scale-[0.98]"
                            >
                                <Plus size={14}/> Registrar Acción
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    
                    {/* TARJETA DE PERFIL (LATERAL IZQUIERDO) */}
                    <div className="lg:col-span-4 space-y-6">
                        <div className="bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden relative">
                            {/* Cabecera oscura estilo tarjeta */}
                            <div className="h-32 bg-slate-900 relative">
                                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
                            </div>
                            <div className="px-8 pb-8 -mt-16 flex flex-col items-center relative z-10">
                                <div className="relative group">
                                    <div className="h-32 w-32 rounded-full border-[6px] border-white shadow-xl bg-slate-50 overflow-hidden mb-4 transition-transform duration-500 group-hover:scale-105">
                                        {emp.photo ? (
                                            <img src={emp.photo} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-4xl font-black text-slate-300 flex h-full items-center justify-center italic">
                                                {emp.name.charAt(0)}
                                            </span>
                                        )}
                                    </div>
                                    <label className="absolute bottom-4 right-0 p-2.5 bg-[#007AFF] text-white rounded-full shadow-lg cursor-pointer hover:bg-[#0066CC] transition-transform duration-300 border-[3px] border-white hover:scale-110 active:scale-95">
                                        <Camera size={16}/>
                                        <input type="file" className="hidden" onChange={handlePhotoChange} accept="image/*" />
                                    </label>
                                </div>
                                
                                <h2 className="text-2xl font-bold text-slate-900 text-center leading-tight mb-1">{emp.name}</h2>
                                <p className="text-[#007AFF] font-bold text-[10px] uppercase tracking-[0.2em] mb-6">{emp.role}</p>
                                
                                <div className="w-full space-y-3 bg-slate-50/50 p-5 rounded-[1.5rem] border border-slate-100">
                                    <div className="flex items-center gap-3 text-slate-600">
                                        <Mail size={16} className="text-slate-400"/>
                                        <span className="text-xs font-medium truncate">{emp.email || 'correo@farmacia.com'}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-slate-600">
                                        <Phone size={16} className="text-slate-400"/>
                                        <span className="text-xs font-medium">{emp.phone || 'Sin Teléfono'}</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-slate-600">
                                        <Shield size={16} className="text-slate-400"/>
                                        <span className="text-xs font-medium uppercase">DUI: {emp.dui || 'N/A'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* CONTENIDO PRINCIPAL (DERECHA) */}
                    <div className="lg:col-span-8 space-y-6">
                        
                        {/* 1. ANIMACIÓN DE PESTAÑAS (SEGMENTED CONTROL APPLE) */}
                        <div className="relative flex bg-slate-200/50 p-1.5 rounded-[1.25rem] border border-slate-200/50 shadow-inner w-full">
                            
                            {/* La pastilla blanca que se desliza por detrás */}
                            <div 
                                className="absolute top-1.5 bottom-1.5 w-[calc(33.333%-4px)] bg-white rounded-[1rem] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] transition-transform duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                                style={{ 
                                    transform: activeTab === 'history' ? 'translateX(0%)' : 
                                               activeTab === 'documents' ? 'translateX(100%)' : 
                                               'translateX(200%)' 
                                }}
                            ></div>

                            {/* Botones invisibles por encima de la pastilla */}
                            <button 
                                onClick={() => setActiveTab('history')} 
                                className={`flex-1 flex items-center justify-center gap-2 py-3 text-[12px] font-semibold uppercase tracking-wider transition-colors duration-300 z-10 ${activeTab === 'history' ? 'text-black' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <Clock size={16}/> Historial
                            </button>
                            <button 
                                onClick={() => setActiveTab('documents')} 
                                className={`flex-1 flex items-center justify-center gap-2 py-3 text-[12px] font-semibold uppercase tracking-wider transition-colors duration-300 z-10 ${activeTab === 'documents' ? 'text-black' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <FileText size={16}/> Expediente
                            </button>
                            <button 
                                onClick={() => setActiveTab('permissions')} 
                                className={`flex-1 flex items-center justify-center gap-2 py-3 text-[12px] font-semibold uppercase tracking-wider transition-colors duration-300 z-10 ${activeTab === 'permissions' ? 'text-black' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                <Activity size={16}/> Permisos
                            </button>
                        </div>

                        {/* CONTENEDOR DE PESTAÑAS CON ANIMACIÓN DE ENTRADA */}
                        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 md:p-8 min-h-[500px] overflow-hidden">
                            
                            {/* PESTAÑA 1: HISTORIAL NORMAL */}
                            {activeTab === 'history' && (
                                <div className="space-y-8 animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-out fill-mode-both">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold text-slate-900 uppercase tracking-tight text-xl">Línea de Tiempo</h3>
                                        <div className="px-4 py-1.5 bg-blue-50 text-[#007AFF] rounded-full text-[11px] font-bold uppercase tracking-widest border border-blue-100">
                                            {emp.history?.length || 0} Eventos
                                        </div>
                                    </div>

                                    <div className="relative border-l-[3px] border-slate-100 ml-6 space-y-10">
                                        {emp.history?.length > 0 ? [...emp.history].reverse().map((ev) => {
                                            const type = EVENT_TYPES[ev.type] || { label: ev.type, color: 'bg-slate-100 text-slate-600' };
                                            return (
                                                <div key={ev.id} className="relative pl-10 group">
                                                    <div className="absolute -left-[14px] top-1 w-6 h-6 rounded-full bg-white border-4 border-[#007AFF] shadow-sm group-hover:scale-125 transition-transform duration-300"></div>
                                                    <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100 hover:border-blue-200 transition-colors duration-300 shadow-sm">
                                                        <div className="flex justify-between items-start mb-3">
                                                            <span className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest ${type.color}`}>{type.label}</span>
                                                            <span className="text-[11px] font-medium text-slate-400 font-mono">{formatDate(ev.date)}</span>
                                                        </div>
                                                        <p className="text-[15px] text-slate-700 leading-relaxed font-medium mb-4">{ev.note}</p>
                                                        
                                                        <div className="pt-4 border-t border-slate-200/50 flex justify-between items-center">
                                                            {ev.documentId ? (
                                                                <button className="flex items-center gap-2 text-[#007AFF] font-bold text-[11px] uppercase tracking-widest hover:underline">
                                                                    <FileText size={16}/> Ver Soporte Adjunto
                                                                </button>
                                                            ) : (
                                                                <button 
                                                                    onClick={() => openModal('uploadDocument', {}, ev.id)}
                                                                    className="flex items-center gap-2 text-slate-400 hover:text-orange-500 font-bold text-[11px] uppercase tracking-widest transition-colors"
                                                                >
                                                                    <Paperclip size={16}/> Adjuntar Documento
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        }) : (
                                            <div className="text-center py-24 opacity-30">
                                                <Clock size={48} className="mx-auto mb-4 text-slate-400"/>
                                                <p className="font-bold uppercase tracking-widest text-sm text-slate-500">Historial Vacío</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* PESTAÑA 2: DOCUMENTOS */}
                            {activeTab === 'documents' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-out fill-mode-both">
                                    {emp.documents?.map(doc => (
                                        <div key={doc.id} className="p-4 bg-slate-50/80 rounded-2xl border border-slate-100 flex items-center justify-between group cursor-pointer hover:border-[#007AFF]/30 hover:shadow-md transition-all duration-300">
                                            <div className="flex items-center gap-4">
                                                <div className="p-2.5 bg-white rounded-xl text-[#007AFF] shadow-sm border border-slate-100"><FileText size={20}/></div>
                                                <div>
                                                    <p className="text-[14px] font-semibold text-slate-800 truncate max-w-[150px]">{doc.name}</p>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{doc.type}</p>
                                                </div>
                                            </div>
                                            <button className="p-2 opacity-0 group-hover:opacity-100 text-[#007AFF] hover:bg-blue-50 rounded-full transition-all duration-300 -translate-x-2 group-hover:translate-x-0">
                                                <ArrowRightLeft size={18}/>
                                            </button>
                                        </div>
                                    ))}
                                    {(!emp.documents || emp.documents.length === 0) && (
                                        <div className="col-span-full py-24 text-center opacity-30">
                                            <FileText size={48} className="mx-auto mb-4 text-slate-400"/>
                                            <p className="font-bold uppercase tracking-widest text-sm text-slate-500">Sin Documentos Digitales</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* PESTAÑA 3: PERMISOS Y CONSTANCIAS MÉDICAS */}
                            {activeTab === 'permissions' && (
                                <div className="space-y-6 animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500 ease-out fill-mode-both">
                                    <div className="flex justify-between items-center mb-6">
                                        <h3 className="font-bold text-slate-900 uppercase tracking-tight text-xl">Gestión de Permisos</h3>
                                        <div className="px-4 py-1.5 bg-orange-50 text-orange-700 rounded-full text-[11px] font-bold uppercase tracking-widest border border-orange-100">
                                            {permissions.length} Permisos
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {permissions.length > 0 ? permissions.map((perm, idx) => (
                                            <div key={idx} className="bg-slate-50/80 border border-slate-100 rounded-[1.5rem] p-5 flex flex-col md:flex-row gap-5 justify-between items-start md:items-center hover:border-orange-200 hover:shadow-sm transition-all duration-300">
                                                <div className="space-y-3 flex-1">
                                                    <div className="flex items-center gap-3">
                                                        <span className="px-3 py-1 bg-white border border-orange-100 text-orange-600 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-sm">
                                                            {perm.details?.reason || 'Salida Especial'}
                                                        </span>
                                                        <span className="text-[12px] font-medium text-slate-500 flex items-center gap-1.5 bg-white px-3 py-1 rounded-lg border border-slate-200/60 shadow-sm">
                                                            <Clock size={14}/> 
                                                            {new Date(perm.timestamp).toLocaleDateString()} - {new Date(perm.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                                        </span>
                                                    </div>
                                                    <p className="text-[14px] font-medium text-slate-600 border-l-[3px] border-orange-200 pl-4 py-1 ml-1">
                                                        {perm.details?.notes || 'Sin justificación adicional proporcionada.'}
                                                    </p>
                                                </div>
                                                
                                                <div className="flex-shrink-0 w-full md:w-auto border-t md:border-t-0 md:border-l border-slate-200/60 pt-4 md:pt-0 md:pl-6">
                                                    {perm.details?.requiresAttachment ? (
                                                        perm.details?.attachmentUrl ? (
                                                            <button className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-colors active:scale-[0.98]">
                                                                <CheckCircle size={16}/> Ver Constancia
                                                            </button>
                                                        ) : (
                                                            <button 
                                                                onClick={() => openModal('uploadConstancia', { employeeId: emp.id, punchTimestamp: perm.timestamp })}
                                                                className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 hover:border-orange-300 rounded-xl font-bold text-[11px] uppercase tracking-widest shadow-sm transition-all active:scale-[0.98]"
                                                            >
                                                                <UploadCloud size={16}/> Subir Constancia
                                                            </button>
                                                        )
                                                    ) : (
                                                        <div className="text-center md:text-right px-4">
                                                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center md:justify-end gap-1.5">
                                                                <ShieldAlert size={14}/> No Requiere Anexo
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )) : (
                                            <div className="text-center py-20 opacity-30">
                                                <Activity size={48} className="mx-auto mb-4 text-slate-400"/>
                                                <p className="font-bold uppercase tracking-widest text-sm text-slate-500">Sin salidas médicas ni permisos</p>
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