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
}) => {

    // Estado interno para manejar la animación de salida suave
    const [render, setRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setRender(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta el modal en respuesta a isOpen, dispara la animación de entrada
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
                className={`absolute inset-0 transition-opacity duration-300 ease-out bg-scrim backdrop-blur-sm ${overlayClass}`}
                onClick={!isProcessing ? onClose : undefined}
            />

            {/* CONTENEDOR DEL MODAL */}
            <div
                data-surface="modal"
                className={`relative w-full max-w-sm overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${modalClass}`}
            >

                {/* Glow de fondo */}
                <div className={`absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 ${
                    isDestructive ? 'bg-danger' : 'bg-brand'
                }`}></div>

                <div className="p-6 sm:p-8 text-center flex flex-col items-center relative z-10">

                    {/* ÍCONO OPTIMIZADO */}
                    <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-[1.2rem] flex items-center justify-center mb-5 border border-border-card bg-surface-card-hover shadow-sm transition-all duration-300 ${
                        isDestructive ? 'text-danger' : 'text-brand'
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
                    <h3 className="text-[18px] sm:text-[20px] font-black uppercase tracking-tight mb-3 leading-tight text-content">
                        {isProcessing ? "Procesando..." : title}
                    </h3>

                    {/* MENSAJE */}
                    <div className={`text-[13px] font-medium leading-relaxed w-full transition-opacity duration-300 text-content-3 ${isProcessing ? 'opacity-60' : 'opacity-100'}`}>
                        {isProcessing ? "Por favor, no cierres esta ventana." : message}
                    </div>
                </div>

                {/* FOOTER RESPONSIVO */}
                <div className="p-4 sm:p-5 border-t border-divider flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 relative z-10 bg-surface-card-hover">

                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest border border-border-card transition-all duration-300 flex-1 flex items-center justify-center ${
                            isProcessing
                                ? 'hidden'
                                : 'text-content-2 bg-surface-card hover:bg-surface-card-hover hover:-translate-y-0.5 shadow-sm'
                        }`}
                    >
                        {cancelText}
                    </button>

                    <button
                        onClick={onConfirm}
                        disabled={isProcessing}
                        className={`py-3 px-4 rounded-xl font-black text-[11px] uppercase tracking-widest text-white transition-all duration-300 flex-1 flex flex-wrap items-center justify-center gap-2 border-transparent shadow-sm ${
                            isProcessing
                                ? 'cursor-not-allowed opacity-90 ' + (isDestructive ? 'bg-danger' : 'bg-brand')
                                : 'hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] ' + (isDestructive ? 'bg-danger hover:bg-danger-hover' : 'bg-brand hover:bg-brand-hover')
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