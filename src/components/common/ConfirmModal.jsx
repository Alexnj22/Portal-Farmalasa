import React from 'react';
import { AlertTriangle, Trash2, CheckCircle2, Loader2, Info } from 'lucide-react';
import ModalShell from './ModalShell';

const ConfirmModal = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title = "¿Estás seguro?", 
    message = "Esta acción no se puede deshacer.",
    confirmText = "Eliminar",
    cancelText = "Cancelar",
    isDestructive = true,
    isProcessing = false 
}) => {
    
    return (
        <ModalShell open={isOpen} onClose={onClose} maxWidthClass="max-w-sm" zClass="z-[9999]">
            {/* 🚨 Efecto de zoom out ligero en el contenedor cuando está procesando */}
            <div className={`bg-white/90 backdrop-blur-3xl backdrop-saturate-150 border border-white/80 rounded-[2.5rem] shadow-[0_40px_80px_rgba(0,0,0,0.15),inset_0_2px_15px_rgba(255,255,255,0.8)] overflow-hidden relative transition-all duration-500 transform-gpu ${
                isProcessing ? 'scale-[0.98]' : 'scale-100'
            }`}>
                
                {/* 🚨 Glow dinámico: Cambia de una mancha superior a un fondo envolvente palpitante */}
                <div className={`absolute left-1/2 -translate-x-1/2 blur-[40px] rounded-full pointer-events-none transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                    isProcessing 
                        ? `top-1/2 -translate-y-1/2 w-full h-64 opacity-20 animate-pulse ${isDestructive ? 'bg-red-500' : 'bg-[#007AFF]'}` 
                        : `top-0 w-32 h-32 opacity-100 ${isDestructive ? 'bg-red-500/15' : 'bg-[#007AFF]/15'}`
                }`}></div>

                <div className="p-8 text-center flex flex-col items-center relative z-10">
                    {/* ÍCONO SQUIRCLE: Crece y emite luz al procesar */}
                    <div className={`w-20 h-20 rounded-[1.5rem] flex items-center justify-center mb-6 border bg-white/50 backdrop-blur-md transition-all duration-500 transform-gpu ${
                        isProcessing
                            ? `scale-110 shadow-[0_0_30px_rgba(0,0,0,0.15),inset_0_2px_10px_rgba(255,255,255,1)] border-white/90 ${isDestructive ? 'text-red-500 shadow-red-500/40' : 'text-[#007AFF] shadow-blue-500/40'}`
                            : `shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.9)] border-white/80 hover:scale-105 ${isDestructive ? 'text-red-500' : 'text-[#007AFF]'}`
                    }`}>
                        {isProcessing ? (
                            <Loader2 size={36} strokeWidth={2.5} className="animate-spin" />
                        ) : isDestructive ? (
                            <AlertTriangle size={36} strokeWidth={2.5} className="animate-pulse" />
                        ) : (
                            <Info size={36} strokeWidth={2.5} />
                        )}
                    </div>
                    
                    <h3 className="text-[20px] font-black text-slate-800 uppercase tracking-tight mb-2 leading-none drop-shadow-sm transition-opacity duration-300">
                        {isProcessing ? "Procesando..." : title}
                    </h3>
                    <p className={`text-[13px] font-medium text-slate-500 leading-relaxed px-2 mb-2 transition-opacity duration-300 ${isProcessing ? 'opacity-60' : 'opacity-100'}`}>
                        {isProcessing ? "Por favor, no cierres esta ventana." : message}
                    </p>
                </div>

                {/* FOOTER ANIMADO */}
                <div className="p-5 bg-white/40 backdrop-blur-md border-t border-white/60 flex gap-3 relative z-10">
                    {/* Botón Cancelar: Se colapsa y desaparece al procesar */}
                    <button 
                        onClick={onClose}
                        disabled={isProcessing}
                        className={`py-3.5 rounded-2xl font-black text-[11px] uppercase tracking-widest text-slate-500 bg-white/60 border transition-all duration-500 transform-gpu overflow-hidden whitespace-nowrap ${
                            isProcessing 
                                ? 'max-w-0 opacity-0 px-0 border-transparent shadow-none mx-0' 
                                : 'max-w-[200px] flex-1 px-4 border-white/90 hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md active:scale-95'
                        }`}
                    >
                        {cancelText}
                    </button>
                    
                    {/* Botón Confirmar: Ocupa el ancho total y palpita al procesar */}
                    <button 
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className={`flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-500 transform-gpu border-none flex-1 overflow-hidden whitespace-nowrap disabled:opacity-90 ${
                            isProcessing 
                                ? 'scale-[1.02] shadow-[0_0_25px_rgba(0,0,0,0.2)] animate-pulse ' + (isDestructive ? 'bg-red-500 shadow-red-500/50' : 'bg-[#007AFF] shadow-blue-500/50')
                                : 'hover:-translate-y-0.5 hover:shadow-lg active:scale-95 ' + (isDestructive ? 'bg-red-500 hover:bg-red-600 shadow-[0_4px_15px_rgba(239,68,68,0.3)]' : 'bg-[#007AFF] hover:bg-[#0066CC] shadow-[0_4px_15px_rgba(0,122,255,0.3)]')
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
        </ModalShell>
    );
};

export default ConfirmModal;