import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, CheckCircle2, Loader2, Info } from 'lucide-react';

const ConfirmModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = "¿Estás seguro?", 
    message = "Esta acción no se puede deshacer.",
    confirmText = "Eliminar",
    cancelText = "Cancelar",
    isDestructive = true,
    isProcessing = false,
    theme = 'light' 
}) => {
    
    const isDark = theme === 'dark';
    
    // Estado interno para manejar la animación de salida suave
    const [render, setRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setRender(true);
            document.body.style.overflow = 'hidden';
        } else {
            // Espera a que termine la animación de salida antes de desmontar
            const timeout = setTimeout(() => setRender(false), 300);
            document.body.style.overflow = '';
            return () => clearTimeout(timeout);
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!render) return null;

    // Clases dinámicas para la animación
    const overlayClass = isOpen ? 'opacity-100' : 'opacity-0';
    const modalClass = isOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95';

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6">
            
            {/* FONDO BLUR */}
            <div 
                className={`absolute inset-0 transition-opacity duration-300 ease-out ${overlayClass} ${
                    isDark 
                        ? 'bg-[#0A0F1C]/80 backdrop-blur-md' 
                        : 'bg-slate-900/40 backdrop-blur-sm'
                }`}
                onClick={!isProcessing ? onClose : undefined}
            />

            {/* CONTENEDOR DEL MODAL */}
            <div className={`relative w-full max-w-sm backdrop-blur-2xl border rounded-[2rem] overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${modalClass}
                ${isDark 
                    ? 'bg-[#0A0F1C]/90 border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.8)]' 
                    : 'bg-white/95 border-white/80 shadow-[0_30px_80px_rgba(0,0,0,0.2)]'
                }`}
            >
                
                {/* Glow de fondo */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 ${
                    isDestructive ? 'bg-red-500' : 'bg-[#007AFF]'
                }`}></div>

                <div className="p-6 sm:p-8 text-center flex flex-col items-center relative z-10">
                    
                    {/* ÍCONO OPTIMIZADO */}
                    <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-[1.2rem] flex items-center justify-center mb-5 border backdrop-blur-md transition-all duration-300 ${
                        isDark ? 'bg-white/5 border-white/10' : 'bg-white/60 border-white/80 shadow-sm'
                    } ${
                        isDestructive ? 'text-red-500' : 'text-[#007AFF]'
                    }`}>
                        {isProcessing ? (
                            <Loader2 size={28} strokeWidth={2.5} className="animate-spin" />
                        ) : isDestructive ? (
                            <AlertTriangle size={28} strokeWidth={2.5} />
                        ) : (
                            <Info size={28} strokeWidth={2.5} />
                        )}
                    </div>
                    
                    {/* TÍTULO */}
                    <h3 className={`text-[18px] sm:text-[20px] font-black uppercase tracking-tight mb-3 leading-tight ${isDark ? 'text-white' : 'text-slate-800'}`}>
                        {isProcessing ? "Procesando..." : title}
                    </h3>
                    
                    {/* MENSAJE */}
                    <div className={`text-[13px] font-medium leading-relaxed w-full transition-opacity duration-300 ${isProcessing ? 'opacity-60' : 'opacity-100'} ${isDark ? 'text-white/70' : 'text-slate-500'}`}>
                        {isProcessing ? "Por favor, no cierres esta ventana." : message}
                    </div>
                </div>

                {/* FOOTER RESPONSIVO */}
                <div className={`p-4 sm:p-5 backdrop-blur-md border-t flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 relative z-10 ${isDark ? 'bg-white/5 border-white/10' : 'bg-slate-50/50 border-slate-100'}`}>
                    
                    <button 
                        onClick={onClose}
                        disabled={isProcessing}
                        className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest border transition-all duration-300 flex-1 flex items-center justify-center ${
                            isProcessing 
                                ? 'hidden' 
                                : isDark 
                                    ? 'text-white/70 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white' 
                                    : 'text-slate-600 bg-white border-slate-200 hover:bg-slate-50 hover:-translate-y-0.5 shadow-sm'
                        }`}
                    >
                        {cancelText}
                    </button>
                    
                    <button 
                        onClick={onConfirm}
                        disabled={isProcessing}
                        // 🚨 FIX: flex-wrap por si el texto es muy largo, y sintaxis arreglada en bg-[#007AFF]
                        className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-300 flex-1 flex flex-wrap items-center justify-center gap-2 border-transparent shadow-sm ${
                            isProcessing 
                                ? 'cursor-not-allowed opacity-90 ' + (isDestructive ? 'bg-red-500' : 'bg-[#007AFF]')
                                : 'hover:-translate-y-0.5 hover:shadow-md active:scale-95 ' + (isDestructive ? 'bg-red-500 hover:bg-red-600' : 'bg-[#007AFF] hover:bg-[#0066CC]')
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={16} strokeWidth={2.5} className="animate-spin shrink-0" />
                                <span>{isDestructive ? 'Eliminando...' : 'Confirmando...'}</span>
                            </>
                        ) : (
                            <>
                                <span className="text-center leading-tight break-words">{confirmText}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

export default ConfirmModal;