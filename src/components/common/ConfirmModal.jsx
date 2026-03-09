import React, { useEffect } from 'react';
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

    // Bloquear el scroll del fondo cuando el modal está abierto
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!isOpen) return null;

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 sm:p-6">
            
            {/* FONDO BLUR MASIVO CON ANIMACIÓN DE ENTRADA */}
            <div 
                className={`absolute inset-0 transition-opacity duration-1000 animate-in fade-in ${
                    isDark 
                        ? 'bg-[#0A0F1C]/80 backdrop-blur-[24px] backdrop-saturate-50' 
                        : 'bg-slate-900/50 backdrop-blur-[16px]'
                }`}
                onClick={!isProcessing ? onClose : undefined}
            />

            {/* 🚨 CONTENEDOR DEL MODAL: Usamos group/modal y hover puro como en el IdleScanPanel */}
            <div className={`group/modal relative w-full max-w-sm backdrop-blur-3xl backdrop-saturate-150 border rounded-[2.5rem] overflow-hidden transition-all duration-500 transform-gpu animate-in zoom-in-95 fade-in slide-in-from-bottom-4
                ${isProcessing ? 'scale-[0.98]' : 'hover:scale-[1.01] hover:-translate-y-1'} 
                ${isDark 
                    ? 'bg-[#0A0F1C]/90 border-white/10 shadow-[0_40px_100px_rgba(0,0,0,1),inset_0_2px_15px_rgba(255,255,255,0.05)] hover:bg-[#0A0F1C]/80 hover:border-white/20' 
                    : 'bg-white/90 border-white/80 shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)] hover:bg-white/95 hover:border-white/90 hover:shadow-[0_50px_120px_rgba(0,0,0,0.35),inset_0_2px_15px_rgba(255,255,255,0.9)]'
                }`}
            >
                
                {/* Glow dinámico de fondo reactivo al hover del padre */}
                <div className={`absolute left-1/2 -translate-x-1/2 blur-[40px] rounded-full pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                    isProcessing 
                        ? `top-1/2 -translate-y-1/2 w-full h-64 opacity-20 animate-pulse ${isDestructive ? 'bg-red-500' : 'bg-[#007AFF]'}` 
                        : `top-0 opacity-100 w-32 h-32 group-hover/modal:w-40 group-hover/modal:h-40 ${
                            isDestructive 
                                ? 'bg-red-500/15 group-hover/modal:bg-red-500/25' 
                                : 'bg-[#007AFF]/15 group-hover/modal:bg-[#007AFF]/25'
                          }`
                }`}></div>

                <div className="p-8 text-center flex flex-col items-center relative z-10">
                    {/* 🚨 ÍCONO SQUIRCLE: Usa group-hover/modal como en el IdleScanPanel */}
                    <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-6 border backdrop-blur-md transition-all duration-500 transform-gpu ${
                        isProcessing
                            ? `scale-110 shadow-[0_0_30px_rgba(0,0,0,0.15),inset_0_2px_10px_rgba(255,255,255,1)] ${isDark ? 'border-white/20 bg-white/5' : 'border-white/90 bg-white/50'} ${isDestructive ? 'text-red-500 shadow-red-500/40' : 'text-[#007AFF] shadow-blue-500/40'}`
                            : `group-hover/modal:scale-105 group-hover/modal:-translate-y-1 ${isDark ? 'bg-white/5 border-white/10' : 'bg-white/50 border-white/80'} ${
                                isDestructive 
                                    ? 'text-red-500 shadow-[0_0_40px_rgba(239,68,68,0.15)] group-hover/modal:shadow-[0_0_50px_rgba(239,68,68,0.3)]' 
                                    : 'text-[#007AFF] shadow-[0_0_40px_rgba(0,122,255,0.15)] group-hover/modal:shadow-[0_0_50px_rgba(0,122,255,0.3)]'
                              }`
                    }`}>
                        {isProcessing ? (
                            <Loader2 size={36} strokeWidth={2.5} className="animate-spin" />
                        ) : isDestructive ? (
                            <AlertTriangle size={36} strokeWidth={2.5} className={`transition-all duration-500 ${!isProcessing && 'group-hover/modal:drop-shadow-[0_2px_10px_rgba(239,68,68,0.8)]'}`} />
                        ) : (
                            <Info size={36} strokeWidth={2.5} className={`transition-all duration-500 ${!isProcessing && 'group-hover/modal:drop-shadow-[0_2px_10px_rgba(0,122,255,0.8)]'}`} />
                        )}
                    </div>
                    
                    <h3 className={`text-[20px] font-black uppercase tracking-tight mb-2 leading-none drop-shadow-sm transition-opacity duration-300 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                        {isProcessing ? "Procesando..." : title}
                    </h3>
                    <p className={`text-[13px] font-medium leading-relaxed px-2 mb-2 transition-opacity duration-300 ${isProcessing ? 'opacity-60' : 'opacity-100'} ${isDark ? 'text-white/60' : 'text-slate-500'}`}>
                        {isProcessing ? "Por favor, no cierres esta ventana." : message}
                    </p>
                </div>

                {/* FOOTER ANIMADO */}
                <div className={`p-5 backdrop-blur-md border-t flex gap-3 relative z-10 transition-colors duration-500 ${isDark ? `group-hover/modal:bg-white/10 bg-white/5 border-white/10` : `bg-white/40 border-white/60`}`}>
                    {/* Botón Cancelar */}
                    <button 
                        onClick={onClose}
                        disabled={isProcessing}
                        className={`py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest border transition-all duration-500 transform-gpu overflow-hidden whitespace-nowrap ${
                            isProcessing 
                                ? 'max-w-0 opacity-0 px-0 border-transparent shadow-none mx-0' 
                                : `max-w-[200px] flex-1 px-4 active:scale-95 ${
                                    isDark 
                                        ? 'text-white/60 bg-white/5 border-white/10 hover:bg-white/10 hover:text-white' 
                                        : 'text-slate-500 bg-white/60 border-white/90 hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md'
                                  }`
                        }`}
                    >
                        {cancelText}
                    </button>
                    
                    {/* Botón Confirmar */}
                    <button 
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className={`flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-500 transform-gpu border-none flex-1 overflow-hidden whitespace-nowrap disabled:opacity-90 ${
                            isProcessing 
                                ? 'scale-[1.02] shadow-[0_0_25px_rgba(0,0,0,0.2)] animate-pulse ' + (isDestructive ? 'bg-red-500 shadow-red-500/50' : 'bg-[#007AFF] shadow-blue-500/50')
                                : 'hover:-translate-y-0.5 hover:shadow-lg active:scale-95 ' + (isDestructive ? 'bg-red-500 hover:bg-red-600 shadow-[0_4px_15px_rgba(239,68,68,0.3)]' : 'bg-[#007AFF hover:bg-[#0066CC] shadow-[0_4px_15px_rgba(0,122,255,0.3)]')
                        }`}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 size={16} strokeWidth={2.5} className="animate-spin shrink-0" />
                                <span>{isDestructive ? 'Eliminando...' : 'Confirmando...'}</span>
                            </>
                        ) : (
                            <>
                                {isDestructive ? <Trash2 size={16} strokeWidth={2.5} className="shrink-0"/> : <CheckCircle2 size={16} strokeWidth={2.5} className="shrink-0"/>}
                                <span>{confirmText}</span>
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