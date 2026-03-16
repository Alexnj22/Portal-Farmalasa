import React, { useMemo } from 'react';
import { UploadCloud, Users, ShieldCheck, FileText, AlertCircle } from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import LiquidSelect from '../common/LiquidSelect';

const FormPharmacovigilance = ({ formData, setFormData, onClose }) => {
    const employees = useStaff(state => state.employees);
    const legalData = formData?.settings?.legal || {};

    const possibleReferents = useMemo(() => {
        return employees.filter(emp => (emp.role || '').toUpperCase().includes('REFERENTE'));
    }, [employees]);

    // Convertimos a formato para LiquidSelect
    const referentOptions = useMemo(() => {
        return possibleReferents.map(emp => ({
            value: emp.id,
            label: `${emp.name} ${emp.branchId && String(emp.branchId) !== String(formData.id) ? '(En otra sede)' : ''}`
        }));
    }, [possibleReferents, formData.id]);

    const updateLegalField = (field, value) => {
        setFormData({
            ...formData,
            settings: {
                ...(formData.settings || {}),
                legal: { ...legalData, [field]: value }
            }
        });
    };

    // ==========================================
    // ESTADO VACÍO (SIN REFERENTES)
    // ==========================================
    if (possibleReferents.length === 0) {
        return (
            <div className="bg-amber-50/80 backdrop-blur-xl border border-amber-200/80 p-8 rounded-[2rem] flex flex-col items-center text-center shadow-[0_8px_30px_rgba(245,158,11,0.12)] animate-in fade-in slide-in-from-bottom-4 duration-500 m-2">
                <div className="w-16 h-16 bg-white rounded-[1.5rem] shadow-sm border border-amber-100 flex items-center justify-center text-amber-500 mb-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-amber-400/10 animate-pulse"></div>
                    <AlertCircle size={28} strokeWidth={2} className="relative z-10" />
                </div>
                <h3 className="text-[16px] font-black text-amber-900 mb-2 tracking-tight">Ningún Referente Disponible</h3>
                <p className="text-[12px] font-bold text-amber-700/80 max-w-[300px] mb-6 leading-relaxed">
                    Debes registrar la contratación del Referente de Farmacovigilancia en el módulo de Personal antes de poder asignarlo a esta sucursal.
                </p>
                <button 
                    type="button" 
                    onClick={onClose} 
                    className="px-8 py-3.5 bg-white text-amber-600 font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-amber-500 hover:text-white border border-amber-200 hover:border-amber-500 transition-all duration-300 shadow-sm hover:shadow-[0_8px_20px_rgba(245,158,11,0.3)] hover:-translate-y-0.5 active:scale-95"
                >
                    Entendido, Cerrar
                </button>
            </div>
        );
    }

    // ==========================================
    // FORMULARIO PRINCIPAL
    // ==========================================
    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2 pt-2">
            
            {/* TARJETA CONTENEDOR PADRE */}
            <div className="bg-white/40 backdrop-blur-xl border border-white/80 p-6 md:p-8 rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(147,51,234,0.08)] hover:-translate-y-1 hover:bg-white/60 transition-all duration-500 transform-gpu space-y-6">
                
                {/* CABECERA DE LA TARJETA */}
                <div className="flex items-center gap-3 mb-2 border-b border-white/60 pb-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-100 flex items-center justify-center shadow-sm">
                        <ShieldCheck size={20} strokeWidth={2.5}/>
                    </div>
                    <div>
                        <h4 className="text-[13px] font-black uppercase tracking-widest text-slate-800 leading-none mb-1">
                            Control de Farmacovigilancia
                        </h4>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Asignación y Autorización SRS
                        </p>
                    </div>
                </div>

                {/* SELECT DEL REFERENTE */}
                <div className="group/select">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-1.5 block group-focus-within/select:text-purple-600 transition-colors">
                        Referente Técnico Asignado
                    </label>
                    <div className="transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md rounded-[1.5rem]">
                        <LiquidSelect 
                            value={legalData.farmacovigilanciaId || ""} 
                            onChange={(val) => updateLegalField('farmacovigilanciaId', val)} 
                            options={referentOptions} 
                            placeholder="Seleccionar referente..."
                            icon={Users}
                        />
                    </div>
                    
                    {/* NOTA INFORMATIVA */}
                    <div className="mt-3 flex items-start gap-2.5 bg-purple-50/60 p-3.5 rounded-2xl border border-purple-100/60 shadow-[inset_0_1px_4px_rgba(255,255,255,0.5)]">
                         <FileText size={14} className="text-purple-500 shrink-0 mt-0.5" strokeWidth={2.5}/>
                         <p className="text-[10px] text-purple-800 font-bold leading-relaxed">
                            El referente elabora y envía los reportes semestrales a la Dirección General de Medicamentos.
                         </p>
                    </div>
                </div>

                {/* UPLOAD FILE ESTILO LIQUID GLASS */}
                <div>
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">
                        Autorización de la SRS (PDF/IMG)
                    </label>
                    <div className={`relative group border-2 border-dashed rounded-[1.5rem] p-4 transition-all duration-300 transform-gpu hover:-translate-y-0.5 hover:shadow-md flex items-center gap-4 cursor-pointer overflow-hidden ${legalData.farmacovigilanciaAuthFile || legalData.farmacovigilanciaAuthUrl ? 'bg-purple-50/50 border-purple-300 hover:bg-purple-50/80' : 'bg-slate-50/50 border-slate-300 hover:bg-purple-50/30 hover:border-purple-300/60'}`}>
                        <input 
                            type="file" 
                            accept="application/pdf,image/*" 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                            onChange={(e) => updateLegalField('farmacovigilanciaAuthFile', e.target.files?.[0] || null)} 
                        />
                        
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 transition-all duration-300 group-hover:scale-105 ${legalData.farmacovigilanciaAuthFile || legalData.farmacovigilanciaAuthUrl ? 'bg-white text-purple-600 border border-purple-200' : 'bg-white text-slate-400 border border-slate-100 group-hover:text-purple-500 group-hover:border-purple-200'}`}>
                             {legalData.farmacovigilanciaAuthFile || legalData.farmacovigilanciaAuthUrl ? <ShieldCheck size={20} strokeWidth={2}/> : <UploadCloud size={20} strokeWidth={1.5} />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-black tracking-tight truncate ${legalData.farmacovigilanciaAuthFile || legalData.farmacovigilanciaAuthUrl ? 'text-purple-700' : 'text-slate-600'}`}>
                                {legalData.farmacovigilanciaAuthFile ? legalData.farmacovigilanciaAuthFile.name : legalData.farmacovigilanciaAuthUrl ? "Autorización guardada" : "Toca para subir documento"}
                            </p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                                {legalData.farmacovigilanciaAuthFile || legalData.farmacovigilanciaAuthUrl ? 'Reemplazar archivo' : 'PDF, JPG o PNG (Máx 5MB)'}
                            </p>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default FormPharmacovigilance;