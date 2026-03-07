import React from 'react';
import { 
    User, Activity, MonitorSmartphone, CalendarClock, 
    ShieldAlert, CheckCircle2, AlertTriangle, Code2
} from 'lucide-react';

const FormAuditDetail = ({ data }) => {
    if (!data) return null;

    const logDate = data.created_at ? new Date(data.created_at) : new Date();

    const getSeverityStyles = (severity) => {
        switch (severity) {
            case 'CRITICAL': return { bg: 'bg-red-500', icon: <ShieldAlert size={20} className="text-white" /> };
            case 'WARNING': return { bg: 'bg-amber-500', icon: <AlertTriangle size={20} className="text-white" /> };
            default: return { bg: 'bg-[#007AFF]', icon: <CheckCircle2 size={20} className="text-white" /> };
        }
    };

    const sevStyles = getSeverityStyles(data.severity);

    // 🚀 CLEAN UI: Elementos internos ahora son estáticos para evitar sobrecarga visual
    const itemContainerClass = "flex items-start gap-3.5 p-1";
    const iconBoxClass = "w-9 h-9 rounded-full bg-white/60 flex items-center justify-center shrink-0 border border-white/80 shadow-sm";

    return (
        <div className="flex flex-col md:flex-row gap-6 h-full animate-in fade-in slide-in-from-bottom-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            
            {/* =========================================================
                COLUMNA IZQUIERDA: EL CONTENEDOR ES EL ÚNICO CON HOVER
                ========================================================= */}
            <div className="w-full md:w-5/12 bg-white/20 backdrop-blur-[30px] backdrop-saturate-[180%] rounded-[2.5rem] border border-white/90 shadow-[0_20px_40px_rgba(0,0,0,0.05),inset_0_2px_20px_rgba(255,255,255,0.8)] p-7 flex flex-col relative overflow-hidden shrink-0 transform-gpu backface-hidden transition-all duration-700 hover:shadow-[0_25px_50px_rgba(0,0,0,0.12)] hover:-translate-y-1 group/main">
                
                {/* Reflejos Dinámicos */}
                <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-white/40 to-transparent blur-3xl rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none opacity-50 transform-gpu transition-opacity duration-700 group-hover/main:opacity-80"></div>

                {/* Header */}
                <div className="flex items-center gap-4 mb-10 relative z-10">
                    <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center shadow-lg shrink-0 transition-transform duration-700 group-hover/main:scale-105 ${sevStyles.bg}`}>
                        {sevStyles.icon}
                    </div>
                    <div>
                        <h3 className="text-[18px] font-black text-slate-800 uppercase tracking-tight leading-none mb-1 drop-shadow-sm">
                            {data.severity}
                        </h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.25em]">
                            Nivel de Auditoría
                        </p>
                    </div>
                </div>

                {/* Lista de Detalles (Estática) */}
                <div className="flex flex-col gap-8 relative z-10 flex-1">
                    
                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <User size={16} className="text-slate-600" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Usuario Ejecutor</p>
                            <p className="text-[14px] font-bold text-slate-800 truncate">{data.user_name || 'Sistema / Anónimo'}</p>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={`${iconBoxClass} bg-blue-50/50`}>
                            <Activity size={16} className="text-[#007AFF]" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2.5">Acción Realizada</p>
                            <span className="text-[11px] font-black text-slate-800 bg-white/80 backdrop-blur-sm border border-white px-3 py-1.5 rounded-xl shadow-sm">
                                {data.action}
                            </span>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <CalendarClock size={16} className="text-slate-600" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Registro Temporal</p>
                            <p className="text-[14px] font-bold text-slate-700">{logDate.toLocaleString()}</p>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <MonitorSmartphone size={16} className="text-slate-600" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none mb-2.5">Contexto de Origen</p>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-[#007AFF] bg-white/90 border border-white px-2 py-1 rounded-lg shadow-sm uppercase tracking-wider">
                                    {data.source}
                                </span>
                                {data.device_name && <span className="text-[13px] font-bold text-slate-700 truncate">{data.device_name}</span>}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* =========================================================
                COLUMNA DERECHA: TERMINAL CON HOVER INDEPENDIENTE
                ========================================================= */}
            <div className="w-full md:w-7/12 bg-[#020617] rounded-[2.5rem] shadow-[0_30px_60px_rgba(0,0,0,0.25)] flex flex-col overflow-hidden border border-white/10 min-h-[400px] transform-gpu backface-hidden transition-all duration-700 hover:scale-[1.02] hover:shadow-[0_40px_80px_rgba(0,0,0,0.35)]">
                
                <div className="h-14 bg-white/5 flex items-center px-6 border-b border-white/10 shrink-0">
                    <div className="flex gap-2 mr-6">
                        <div className="w-3 h-3 rounded-full bg-[#FF5F57] shadow-lg"></div>
                        <div className="w-3 h-3 rounded-full bg-[#FFBD2E] shadow-lg"></div>
                        <div className="w-3 h-3 rounded-full bg-[#28C840] shadow-lg"></div>
                    </div>
                    <div className="flex items-center gap-2.5 text-white/40">
                        <Code2 size={16} />
                        <span className="text-[11px] font-black uppercase tracking-[0.25em]">Payload.json</span>
                    </div>
                </div>

                <div className="relative flex-1">
                    <div className="absolute inset-0 p-8 md:p-10 overflow-y-auto scrollbar-hide">
                        <pre className="text-emerald-400 font-mono text-[13px] leading-relaxed whitespace-pre-wrap selection:bg-emerald-500/30 selection:text-white">
                            {(!data.details || Object.keys(data.details).length === 0) 
                                ? "// No hay metadatos adicionales registrados." 
                                : JSON.stringify(data.details, null, 4)}
                        </pre>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default FormAuditDetail;