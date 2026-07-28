import React from 'react';
import Button from './Button';
import { createPortal } from 'react-dom';
import { PartyPopper, AlertCircle, Info, X, Cake } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const LiquidToast = () => {
    const { isOpen, title, message, type, hideToast } = useToastStore();

    if (!isOpen) return null;

    const config = {
        success: {
            icon: <PartyPopper size={20} strokeWidth={2.5} className="text-white animate-[bounce_2s_infinite]" />,
            iconContainer: 'bg-brand shadow-[var(--shadow-glow-brand)]'
        },
        error: {
            icon: <AlertCircle size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-danger shadow-[var(--shadow-glow-danger-md)]'
        },
        info: {
            icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
            iconContainer: 'bg-content-2 shadow-[var(--shadow-elevation-md)]'
        },
        birthday: {
            icon: <Cake size={20} strokeWidth={2.5} className="text-white animate-[bounce_2s_infinite]" />,
            iconContainer: 'bg-chart-6 shadow-[var(--shadow-glow-chart-6-md)]'
        }
    }[type] || {
        icon: <Info size={20} strokeWidth={2.5} className="text-white" />,
        iconContainer: 'bg-content-2 shadow-[var(--shadow-elevation-md)]'
    };

    const toastContent = (
        <div
            data-surface="dropdown"
            className="fixed bottom-6 right-6 md:bottom-8 md:right-8 z-toast flex items-center gap-4 p-3 pr-12 animate-in slide-in-from-bottom-10 fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu max-w-[400px] transition-colors"
        >
            <div className={`w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border border-border-card transition-all ${config.iconContainer}`}>
                {config.icon}
            </div>

            <div className="flex flex-col justify-center py-1">
                <p className="font-black text-body-sm md:text-body uppercase tracking-widest leading-none mb-1.5 text-content">
                    {title}
                </p>
                <p className="text-label md:text-body-sm font-medium leading-tight text-content-3">
                    {message}
                </p>
            </div>

            <Button variant="destructive" size="sm" icon={X} iconOnly onClick={hideToast} />
        </div>
    );

    return createPortal(toastContent, document.body);
};

export default LiquidToast;