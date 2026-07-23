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
}) => {

    // Configuración dinámica de estilos según el tipo de alerta — colores
    // semánticos del tema (--success/--danger/--brand), reactivos por tema.
    const config = {
        success: {
            icon: CheckCircle2,
            glow: 'bg-success/15',
            iconColor: 'text-success',
            btn: 'bg-success hover:bg-success-hover shadow-[0_4px_15px_rgba(18,183,106,0.3)]'
        },
        error: {
            icon: AlertCircle,
            glow: 'bg-danger/15',
            iconColor: 'text-danger animate-pulse',
            btn: 'bg-danger hover:bg-danger-hover shadow-[0_4px_15px_rgba(240,68,56,0.3)]'
        },
        info: {
            icon: Info,
            glow: 'bg-brand/15',
            iconColor: 'text-brand',
            btn: 'bg-brand hover:bg-brand-hover shadow-[0_4px_15px_rgba(0,82,204,0.3)]'
        }
    };

    const currentConfig = config[type] || config.info;
    const Icon = currentConfig.icon;

    return (
        <ModalShell open={isOpen} onClose={onClose} maxWidthClass="max-w-sm" zClass="z-[9999]" ariaLabel={title}>
            <div data-surface="modal" className="overflow-hidden relative">

                {/* 🚨 Glow de fondo dinámico que tiñe el cristal superior */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 blur-[40px] rounded-full pointer-events-none ${currentConfig.glow}`}></div>

                <div className="p-8 text-center flex flex-col items-center relative z-10">
                    {/* ÍCONO SQUIRCLE */}
                    <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-6 transition-transform duration-500 hover:scale-105 border border-border-card bg-surface-card-hover shadow-sm ${currentConfig.iconColor}`}>
                        <Icon size={36} strokeWidth={2.5} />
                    </div>

                    <h3 className="text-[20px] font-black uppercase tracking-tight mb-2 leading-none drop-shadow-sm text-content">
                        {title}
                    </h3>
                    <p className="text-[13px] font-medium leading-relaxed px-2 mb-2 text-content-3">
                        {message}
                    </p>
                </div>

                {/* FOOTER */}
                <div className="p-5 border-t border-divider flex relative z-10 bg-surface-card-hover">
                    <button 
                        onClick={onClose}
                        className={`flex-1 py-3.5 px-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.97] transform-gpu border-none ${currentConfig.btn}`}
                    >
                        {buttonText}
                    </button>
                </div>
            </div>
        </ModalShell>
    );
};

export default AlertModal;