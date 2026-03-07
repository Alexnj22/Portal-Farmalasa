import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import ModalShell from './ModalShell';

const AlertModal = ({ 
    isOpen, 
    onClose, 
    title, 
    message,
    type = 'success', // 'success' | 'error' | 'info'
    buttonText = 'Entendido'
}) => {

    // 🚨 ModalShell maneja internamente: portal, bloqueo de scroll y cierre con Escape o clic afuera
    
    // Configuración dinámica de estilos Liquidglass según el tipo de alerta
    const config = {
        success: {
            icon: CheckCircle2,
            glow: 'bg-emerald-500/15',
            iconColor: 'text-emerald-500',
            btn: 'bg-emerald-500 hover:bg-emerald-600 shadow-[0_4px_15px_rgba(16,185,129,0.3)]'
        },
        error: {
            icon: AlertCircle,
            glow: 'bg-red-500/15',
            iconColor: 'text-red-500 animate-pulse',
            btn: 'bg-red-500 hover:bg-red-600 shadow-[0_4px_15px_rgba(239,68,68,0.3)]'
        },
        info: {
            icon: Info,
            glow: 'bg-[#007AFF]/15',
            iconColor: 'text-[#007AFF]',
            btn: 'bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_4px_15px_rgba(0,122,255,0.3)]'
        }
    };

    const currentConfig = config[type] || config.info;
    const Icon = currentConfig.icon;

    return (
        <ModalShell open={isOpen} onClose={onClose} maxWidthClass="max-w-sm" zClass="z-[9999]">
            <div className="bg-white/90 backdrop-blur-3xl backdrop-saturate-150 border border-white/80 rounded-[2.5rem] shadow-[0_40px_80px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.8)] overflow-hidden relative">
                
                {/* 🚨 Glow de fondo dinámico que tiñe el cristal superior */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 blur-[40px] rounded-full pointer-events-none ${currentConfig.glow}`}></div>

                <div className="p-8 text-center flex flex-col items-center relative z-10">
                    {/* ÍCONO SQUIRCLE */}
                    <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-6 shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.9)] border border-white/80 bg-white/50 backdrop-blur-md transition-transform duration-500 hover:scale-105 ${currentConfig.iconColor}`}>
                        <Icon size={36} strokeWidth={2.5} />
                    </div>
                    
                    <h3 className="text-[20px] font-black text-slate-800 uppercase tracking-tight mb-2 leading-none drop-shadow-sm">
                        {title}
                    </h3>
                    <p className="text-[13px] font-medium text-slate-500 leading-relaxed px-2 mb-2">
                        {message}
                    </p>
                </div>

                {/* FOOTER */}
                <div className="p-5 bg-white/40 backdrop-blur-md border-t border-white/60 flex relative z-10">
                    <button 
                        onClick={onClose}
                        className={`flex-1 py-3.5 px-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:scale-95 transform-gpu border-none ${currentConfig.btn}`}
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default AlertModal;