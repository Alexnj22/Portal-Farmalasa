import React, { useEffect, useState } from 'react';
import Button from './Button';
import { MessageSquarePlus } from 'lucide-react';
import ModalShell from './ModalShell';
import PortalTextarea from './PortalTextarea';

// Mismo shell visual que ConfirmModal/AlertModal (glass modal, glow, footer
// con 2 botones) — extendido con un textarea para pedir una nota corta antes
// de confirmar una acción. Canónico nuevo (DESIGN.md §14, ver también §9.0
// "regla cero-nativo"): reemplaza `window.prompt()`, que no respeta tema ni
// estilo del proyecto.
//
// 2026-07-29: montaba su propio `createPortal` + `fixed inset-0` + lock de
// scroll. Eso lo dejaba sin `role="dialog"`, sin `aria-modal` y sin cierre con
// Escape — o sea que para un lector de pantalla no era un diálogo, y con
// teclado no había forma de salir. Ahora lo compone `ModalShell`, igual que
// `AlertModal`.
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
    const [text, setText] = useState('');

    // El texto se limpia al ABRIR, no al cerrar: durante la animación de salida
    // el panel sigue montado y vaciarlo ahí se ve como un parpadeo del campo.
    useEffect(() => {
        if (isOpen) setText(''); // eslint-disable-line react-hooks/set-state-in-effect -- reinicia el campo en respuesta a la apertura
    }, [isOpen]);

    const canConfirm = !isProcessing && (!required || text.trim().length > 0);

    return (
        <ModalShell
            open={isOpen}
            onClose={isProcessing ? undefined : onClose}
            maxWidthClass="max-w-sm"
            zClass="z-confirm"
            closeOnEsc={!isProcessing}
            closeOnBackdrop={!isProcessing}
            ariaLabel={title}
        >
            <div className="overflow-hidden relative">
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

                    <PortalTextarea
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={placeholder}
                        readOnly={isProcessing}
                        rows={3}
                    />
                </div>

                <div className="p-4 sm:p-5 border-t border-divider flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 relative z-base bg-surface-card-hover">
                    <Button variant="secondary" disabled={isProcessing} onClick={onClose}>{cancelText}</Button>

                    <Button
                        variant="primary"
                        className="flex-1"
                        loading={isProcessing}
                        disabled={!canConfirm}
                        onClick={() => onConfirm(text.trim())}
                    >
                        {confirmText}
                    </Button>
                </div>
            </div>
        </ModalShell>
    );
};

export default PromptModal;
