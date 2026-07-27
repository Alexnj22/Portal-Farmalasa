import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus, Loader2 } from 'lucide-react';

// Mismo shell visual que ConfirmModal/AlertModal (glass modal, glow, footer
// con 2 botones) — extendido con un textarea para pedir una nota corta antes
// de confirmar una acción. Canónico nuevo (DESIGN.md §14, ver también §9.0
// "regla cero-nativo"): reemplaza `window.prompt()`, que no respeta tema ni
// estilo del proyecto.
const PromptModal = ({
    isOpen,
    onClose,
    onConfirm, // (text) => void
    title = 'Agregar nota',
    message,
    placeholder = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    isProcessing = false,
    required = false,
}) => {
    const [render, setRender] = useState(false);
    const [text, setText] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRender(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta el modal en respuesta a isOpen, dispara la animación de entrada
            setText('');
            document.body.style.overflow = 'hidden';
        } else {
            const timeout = setTimeout(() => setRender(false), 300);
            document.body.style.overflow = '';
            return () => clearTimeout(timeout);
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!render) return null;

    const overlayClass = isOpen ? 'opacity-100' : 'opacity-0';
    const modalClass = isOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-95';
    const canConfirm = !isProcessing && (!required || text.trim().length > 0);

    const modalContent = (
        <div className="fixed inset-0 z-confirm flex items-center justify-center p-4 sm:p-6">
            <div
                className={`absolute inset-0 transition-opacity duration-300 ease-out bg-scrim backdrop-blur-sm ${overlayClass}`}
                onClick={!isProcessing ? onClose : undefined}
            />

            <div
                data-surface="modal"
                className={`relative w-full max-w-sm overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${modalClass}`}
            >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 bg-brand" />

                <div className="p-6 sm:p-8 text-center flex flex-col items-center relative z-base">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-5 border border-border-card bg-surface-card-hover shadow-sm text-brand-text">
                        <MessageSquarePlus size={28} strokeWidth={2.5} />
                    </div>

                    <h3 className="text-title-sm sm:text-title font-black uppercase tracking-tight mb-3 leading-tight text-content">
                        {title}
                    </h3>

                    {message && (
                        <p className="text-body font-medium leading-relaxed w-full mb-4 text-content-3">
                            {message}
                        </p>
                    )}

                    <textarea
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={placeholder}
                        disabled={isProcessing}
                        rows={3}
                        className="w-full text-body-lg font-medium text-content bg-surface-card border border-border-input rounded-2xl px-4 py-3 outline-none focus:border-brand/50 focus:ring-4 focus:ring-brand/10 transition-all resize-none placeholder-content-3"
                    />
                </div>

                <div className="p-4 sm:p-5 border-t border-divider flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 relative z-base bg-surface-card-hover">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="py-3 px-4 rounded-xl font-black text-label uppercase tracking-widest border border-border-card transition-all duration-300 flex-1 flex items-center justify-center text-content-2 bg-surface-card hover:bg-surface-card-hover hover:-translate-y-0.5 shadow-sm"
                    >
                        {cancelText}
                    </button>

                    <button
                        onClick={() => onConfirm(text.trim())}
                        disabled={!canConfirm}
                        className={`py-3 px-4 rounded-xl font-black text-label uppercase tracking-widest text-white transition-all duration-300 flex-1 flex items-center justify-center gap-2 border-transparent shadow-sm ${
                            !canConfirm ? 'cursor-not-allowed opacity-60 bg-brand' : 'hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] bg-brand hover:bg-brand-hover'
                        }`}
                    >
                        {isProcessing ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin shrink-0" /> : null}
                        <span>{confirmText}</span>
                    </button>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

export default PromptModal;
