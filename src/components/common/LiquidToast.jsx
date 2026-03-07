import React from 'react';
import { createPortal } from 'react-dom';
import { PartyPopper, AlertCircle, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const LiquidToast = () => {
    const { isOpen, title, message, type, hideToast } = useToastStore();

    if (!isOpen) return null;

    // Configuraciones dinámicas según el tipo (con brillos Liquidglass)
    const config = {
        success: {
            icon: <PartyPopper size={20} strokeWidth={2.5} className="text-white animate-[bounce_2s_infinite]" />,
            iconContainer: 'bg-[#007AFF] shadow-[0_4px_12px_rgba(0,122,255,0.4)]'
        },
        error: {
            icon: <AlertCircle size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-red-500 shadow-[0_4px_12px_rgba(239,68,68,0.4)]'
        },
        info: {
            icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-slate-700 shadow-[0_4px_12px_rgba(51,65,85,0.4)]'
        }
    }[type];

    const toastContent = (
        <div 
            // 🚨 CONTENEDOR LIQUIDGLASS: Cristal profundo, sombra grande para despegarlo del fondo y curva de animación premium.
            className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-[9999] flex items-center gap-4 p-3 pr-12 rounded-[2rem] bg-white/20 backdrop-blur-[25px] backdrop-saturate-[300%] border border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.1),inset_0_2px_10px_rgba(255,255,255,0.5)] animate-in slide-in-from-bottom-10 fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu max-w-[400px]"
        >
            
            {/* Contenedor del Icono (Squircle flotante) */}
            <div className={`w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/20 transition-all ${config.iconContainer}`}>
                {config.icon}
            </div>
            
            {/* Contenido de Texto */}
            <div className="flex flex-col justify-center py-1">
                <p className="font-black text-[12px] md:text-[13px] uppercase tracking-widest text-slate-800 leading-none mb-1.5">
                    {title}
                </p>
                <p className="text-slate-500 text-[11px] md:text-[12px] font-medium leading-tight">
                    {message}
                </p>
            </div>

            {/* Botón de Cerrar (Estilo Píldora Mini) */}
            <button 
                onClick={hideToast}
                className="absolute top-1/2 -translate-y-1/2 right-3 w-8 h-8 flex items-center justify-center rounded-full bg-white/50 border border-white/80 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200 transition-all duration-300 hover:shadow-sm hover:scale-105 active:scale-95"
                title="Cerrar"
            >
                <X size={14} strokeWidth={2.5} />
            </button>
        </div>
    );

    // Usamos un portal para que flote por encima de TODO, sin importar dónde se llame
    return createPortal(toastContent, document.body);
};

export default LiquidToast;