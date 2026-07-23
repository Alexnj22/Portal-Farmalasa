import React from 'react';
import { createPortal } from 'react-dom';
import { PartyPopper, AlertCircle, Info, X, Cake } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const LiquidToast = () => {
    const { isOpen, title, message, type, hideToast } = useToastStore();

    if (!isOpen) return null;

    const config = {
        success: {
            icon: <PartyPopper size={20} strokeWidth={2.5} className="text-white animate-[bounce_2s_infinite]" />,
            iconContainer: 'bg-brand shadow-[0_4px_12px_rgba(0,82,204,0.4)]'
        },
        error: {
            icon: <AlertCircle size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-danger shadow-[0_4px_12px_rgba(240,68,56,0.4)]'
        },
        info: {
            icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-content-2 shadow-[0_4px_12px_rgba(51,65,85,0.4)]'
        },
        birthday: {
            icon: <Cake size={20} strokeWidth={2.5} className="text-white animate-[bounce_2s_infinite]" />,
            iconContainer: 'bg-pink-500 shadow-[0_4px_12px_rgba(236,72,153,0.4)]'
        }
    }[type] || {
        icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
        iconContainer: 'bg-content-2 shadow-[0_4px_12px_rgba(51,65,85,0.4)]'
    };

    const toastContent = (
        <div
            data-surface="dropdown"
            className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-[9999] flex items-center gap-4 p-3 pr-12 animate-in slide-in-from-bottom-10 fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu max-w-[400px] transition-colors"
        >
            <div className={`w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/20 transition-all ${config.iconContainer}`}>
                {config.icon}
            </div>

            <div className="flex flex-col justify-center py-1">
                <p className="font-black text-[12px] md:text-[13px] uppercase tracking-widest leading-none mb-1.5 text-content">
                    {title}
                </p>
                <p className="text-[11px] md:text-[12px] font-medium leading-tight text-content-3">
                    {message}
                </p>
            </div>

            <button
                onClick={hideToast}
                className="absolute top-1/2 -translate-y-1/2 right-3 w-8 h-8 flex items-center justify-center rounded-full border border-border-card text-content-3 transition-all duration-300 hover:shadow-sm hover:scale-105 active:scale-[0.97] hover:text-danger hover:bg-danger/10 hover:border-danger/30"
            >
                <X size={14} strokeWidth={2.5} />
            </button>
        </div>
    );

    return createPortal(toastContent, document.body);
};

export default LiquidToast;