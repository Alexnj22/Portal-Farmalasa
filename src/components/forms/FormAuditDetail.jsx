import React from 'react';
import Badge from '../../components/common/Badge';
import { 
    User, Activity, MonitorSmartphone, CalendarClock, 
    ShieldAlert, CheckCircle2, AlertTriangle, Code2
} from 'lucide-react';

const FormAuditDetail = ({ data }) => {
    if (!data) return null;

    const logDate = data.created_at ? new Date(data.created_at) : new Date();

    const getSeverityStyles = (severity) => {
        switch (severity) {
            case 'CRITICAL': return { bg: 'bg-danger-solid', icon: <ShieldAlert size={20} className="text-white" /> };
            case 'WARNING': return { bg: 'bg-warning-solid', icon: <AlertTriangle size={20} className="text-white" /> };
            default: return { bg: 'bg-brand', icon: <CheckCircle2 size={20} className="text-white" /> };
        }
    };

    const sevStyles = getSeverityStyles(data.severity);

    // 🚀 CLEAN UI: Elementos internos ahora son estáticos para evitar sobrecarga visual
    const itemContainerClass = "flex items-start gap-3.5 p-1";
    const iconBoxClass = "w-9 h-9 rounded-full bg-surface-card flex items-center justify-center shrink-0 border border-border-card shadow-sm";

    return (
        <div className="flex flex-col md:flex-row gap-6 h-full animate-in fade-in slide-in-from-bottom-4 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]">
            
            {/* =========================================================
                COLUMNA IZQUIERDA: EL CONTENEDOR ES EL ÚNICO CON HOVER
                ========================================================= */}
            <div className="w-full md:w-5/12 bg-surface-card backdrop-blur-[30px] backdrop-saturate-[180%] rounded-header border border-border-card shadow-[var(--shadow-glass-4)] p-7 flex flex-col relative overflow-hidden shrink-0 transform-gpu backface-hidden transition-all duration-700 hover:shadow-[var(--shadow-elevation-lg)] hover:-translate-y-1 group/main">
                
                {/* Reflejos Dinámicos */}
                <div className="absolute top-0 right-0 w-40 h-40 blur-3xl rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none opacity-50 transform-gpu transition-opacity duration-700 group-hover/main:opacity-80" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }}></div>

                {/* Header */}
                <div className="flex items-center gap-4 mb-10 relative z-base">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg shrink-0 transition-transform duration-700 group-hover/main:scale-105 ${sevStyles.bg}`}>
                        {sevStyles.icon}
                    </div>
                    <div>
                        <h3 className="text-title-sm font-black text-content uppercase tracking-tight leading-none mb-1 drop-shadow-sm">
                            {data.severity}
                        </h3>
                        <p className="text-caption font-bold text-content-3 uppercase tracking-[0.25em]">
                            Nivel de Auditoría
                        </p>
                    </div>
                </div>

                {/* Lista de Detalles (Estática) */}
                <div className="flex flex-col gap-8 relative z-base flex-1">
                    
                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <User size={16} className="text-content-2" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest leading-none mb-1.5">Usuario Ejecutor</p>
                            <p className="text-body-lg font-bold text-content truncate">{data.user_name || 'Sistema / Anónimo'}</p>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={`${iconBoxClass} bg-chart-1/10`}>
                            <Activity size={16} className="text-brand-text" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest leading-none mb-2.5">Acción Realizada</p>
                            <Badge>{data.action}</Badge>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <CalendarClock size={16} className="text-content-2" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest leading-none mb-1.5">Registro Temporal</p>
                            <p className="text-body-lg font-bold text-content-2">{logDate.toLocaleString()}</p>
                        </div>
                    </div>

                    <div className={itemContainerClass}>
                        <div className={iconBoxClass}>
                            <MonitorSmartphone size={16} className="text-content-2" />
                        </div>
                        <div className="min-w-0 pt-0.5">
                            <p className="text-micro font-black text-content-2 uppercase tracking-widest leading-none mb-2.5">Contexto de Origen</p>
                            <div className="flex items-center gap-2">
                                <Badge>{data.source}</Badge>
                                {data.device_name && <span className="text-body font-bold text-content-2 truncate">{data.device_name}</span>}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* =========================================================
                COLUMNA DERECHA: TERMINAL CON HOVER INDEPENDIENTE
                ========================================================= */}
            <div className="w-full md:w-7/12 bg-[#020617] rounded-header shadow-[var(--shadow-elevation-xl)] flex flex-col overflow-hidden border border-border-card min-h-[400px] transform-gpu backface-hidden transition-all duration-700 hover:scale-[1.02] hover:shadow-[var(--shadow-elevation-xl)]">
                
                <div className="h-14 bg-surface-card flex items-center px-6 border-b border-border-card shrink-0">
                    <div className="flex gap-2 mr-6">
                        <div className="w-3 h-3 rounded-full bg-[#FF5F57] shadow-lg"></div>
                        <div className="w-3 h-3 rounded-full bg-[#FFBD2E] shadow-lg"></div>
                        <div className="w-3 h-3 rounded-full bg-[#28C840] shadow-lg"></div>
                    </div>
                    <div className="flex items-center gap-2.5 text-white/40">
                        <Code2 size={16} />
                        <span className="text-label font-black uppercase tracking-[0.25em]">Payload.json</span>
                    </div>
                </div>

                <div className="relative flex-1">
                    <div className="absolute inset-0 p-8 md:p-10 overflow-y-auto scrollbar-hide">
                        <pre className="text-success font-mono text-body leading-relaxed whitespace-pre-wrap selection:bg-success/30 selection:text-white">
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