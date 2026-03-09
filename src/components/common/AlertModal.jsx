import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';
import ModalShell from './ModalShell';

const AlertModal = ({ 
    isOpen, 
    onClose, 
    title, 
    message,
    type = 'success', // 'success' | 'error' | 'info'
    buttonText = 'Entendido',
    theme = 'light' // 🚨 NUEVA PROPIEDAD: 'light' | 'dark'
}) => {

    const isDark = theme === 'dark';
    
    // Configuración dinámica de estilos según el tipo de alerta
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
            <div className={`backdrop-blur-3xl backdrop-saturate-150 border rounded-[2.5rem] overflow-hidden relative transition-colors duration-300 ${
                isDark 
                    ? 'bg-[#0A0F1C]/90 border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.5),inset_0_2px_15px_rgba(255,255,255,0.05)]' 
                    : 'bg-white/90 border-white/80 shadow-[0_40px_80px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.8)]'
            }`}>
                
                {/* 🚨 Glow de fondo dinámico que tiñe el cristal superior */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 blur-[40px] rounded-full pointer-events-none ${currentConfig.glow}`}></div>

                <div className="p-8 text-center flex flex-col items-center relative z-10">
                    {/* ÍCONO SQUIRCLE */}
                    <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-6 backdrop-blur-md transition-transform duration-500 hover:scale-105 border ${
                        isDark
                            ? 'bg-white/5 border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.3),inset_0_2px_10px_rgba(255,255,255,0.05)]'
                            : 'bg-white/50 border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.9)]'
                    } ${currentConfig.iconColor}`}>
                        <Icon size={36} strokeWidth={2.5} />
                    </div>
                    
                    <h3 className={`text-[20px] font-black uppercase tracking-tight mb-2 leading-none drop-shadow-sm ${isDark ? 'text-white' : 'text-slate-800'}`}>
                        {title}
                    </h3>
                    <p className={`text-[13px] font-medium leading-relaxed px-2 mb-2 ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                        {message}
                    </p>
                </div>

                {/* FOOTER */}
                <div className={`p-5 backdrop-blur-md border-t flex relative z-10 ${
                    isDark ? 'bg-black/20 border-white/10' : 'bg-white/40 border-white/60'
                }`}>
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