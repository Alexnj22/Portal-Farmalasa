import React from 'react';
import { createPortal } from 'react-dom';
import { PartyPopper, AlertCircle, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const LiquidToast = () => {
    // 🚨 AHORA EXTRAEMOS EL "theme" DEL STORE
    const { isOpen, title, message, type, theme, hideToast } = useToastStore();

    if (!isOpen) return null;

    // 🚨 DETECTAMOS EL MODO OSCURO
    const isDark = theme === 'dark';

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
            iconContainer: isDark ? 'bg-slate-600 shadow-[0_4px_12px_rgba(71,85,105,0.4)]' : 'bg-slate-700 shadow-[0_4px_12px_rgba(51,65,85,0.4)]'
        }
    }[type] || {
        icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
        iconContainer: 'bg-slate-700 shadow-[0_4px_12px_rgba(51,65,85,0.4)]'
    };

    const toastContent = (
        <div 
            className={`fixed bottom-6 right-6 md:bottom-8 md:right-8 z-[9999] flex items-center gap-4 p-3 pr-12 rounded-[2rem] backdrop-blur-[25px] backdrop-saturate-[300%] border animate-in slide-in-from-bottom-10 fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu max-w-[400px] transition-colors ${
                isDark 
                    ? 'bg-[#0A0F1C]/80 border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_2px_10px_rgba(255,255,255,0.05)]' 
                    : 'bg-white/20 border-white/90 shadow-[0_24px_50px_rgba(0,0,0,0.1),inset_0_2px_10px_rgba(255,255,255,0.5)]'
            }`}
        >
            <div className={`w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/20 transition-all ${config.iconContainer}`}>
                {config.icon}
            </div>
            
            <div className="flex flex-col justify-center py-1">
                <p className={`font-black text-[12px] md:text-[13px] uppercase tracking-widest leading-none mb-1.5 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                    {title}
                </p>
                <p className={`text-[11px] md:text-[12px] font-medium leading-tight ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                    {message}
                </p>
            </div>

            <button 
                onClick={hideToast}
                className={`absolute top-1/2 -translate-y-1/2 right-3 w-8 h-8 flex items-center justify-center rounded-full border transition-all duration-300 hover:shadow-sm hover:scale-105 active:scale-95 ${
                    isDark 
                        ? 'bg-white/5 border-white/10 text-white/40 hover:text-red-400 hover:bg-red-500/20 hover:border-red-500/30' 
                        : 'bg-white/50 border-white/80 text-slate-400 hover:text-red-500 hover:bg-red-50 hover:border-red-200'
                }`}
            >
                <X size={14} strokeWidth={2.5} />
            </button>
        </div>
    );

    return createPortal(toastContent, document.body);
};

export default LiquidToast;