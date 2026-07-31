import React from 'react';
import { AlertTriangle, Loader2, Info } from 'lucide-react';
import ModalShell from './ModalShell';
import Button from './Button';
import HojaMovil from './HojaMovil';
import useMediaQuery from '../../hooks/useMediaQuery';

// El diálogo de confirmación del portal — el que pregunta antes de borrar.
//
// 2026-07-29: montaba su propio portal, igual que los tres de F1, y tenía tres
// defectos que se tapaban entre sí:
//   1. Sin `role="dialog"` ni `aria-modal`: para un lector de pantalla no era
//      un diálogo sino contenido suelto al final del `<body>`.
//   2. **Sin Escape.** Una confirmación de borrado que solo se puede cancelar
//      con el mouse. Es el peor sitio del portal para no tener salida por
//      teclado.
//   3. Los dos botones eran `<button>` a mano, y el de confirmar era
//      `text-white` sobre `bg-danger` — 3.76:1, bajo el 4.5 de AA. El token
//      `--danger-solid` existe desde N2 justamente para esto, y `Button`
//      variante `destructive` ya lo usa.
// Componerlo sobre los canónicos arregla los tres de una vez.
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
    // En táctil el cuerpo es el canónico de hoja: título a la izquierda, ícono
    // en línea y botones apilados de ancho completo. El de abajo es el cuerpo de
    // escritorio y se queda como está — un panel centrado de 384px SÍ quiere su
    // ícono grande y su título al medio.
    const enTactil = useMediaQuery('(hover: none)');
    const Icono = isProcessing ? Loader2 : isDestructive ? AlertTriangle : Info;

    if (enTactil) {
        return (
            <ModalShell
                open={isOpen}
                onClose={isProcessing ? undefined : onClose}
                closeOnEsc={!isProcessing}
                closeOnBackdrop={!isProcessing}
                zClass="z-confirm"
                surface={null}
                ariaLabel={title}
            >
                <HojaMovil
                    titulo={isProcessing ? 'Procesando…' : title}
                    subtitulo={isProcessing ? 'No cierres esta ventana.' : undefined}
                    icono={Icono}
                    tono={isDestructive ? 'danger' : 'brand'}
                    className={isProcessing ? '[&_svg:first-of-type]:animate-spin' : ''}
                    pie={<>
                        <Button
                            variant={isDestructive ? 'destructive' : 'primary'}
                            loading={isProcessing}
                            onClick={onConfirm}
                        >
                            {isProcessing
                                ? (isDestructive ? 'Eliminando…' : 'Confirmando…')
                                : confirmText}
                        </Button>
                        {!isProcessing && (
                            <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
                        )}
                    </>}
                >
                    {!isProcessing && message}
                </HojaMovil>
            </ModalShell>
        );
    }

    return (
        <ModalShell
            open={isOpen}
            // Mientras procesa no se cierra por ningún lado: el mensaje dice
            // "no cierres esta ventana" y antes eso dependía de que el usuario
            // le hiciera caso.
            onClose={isProcessing ? undefined : onClose}
            closeOnEsc={!isProcessing}
            closeOnBackdrop={!isProcessing}
            maxWidthClass="max-w-sm"
            zClass="z-confirm"
            panelClassName="overflow-hidden"
            ariaLabel={title}
        >
            {/* Glow de fondo */}
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 blur-[50px] rounded-full pointer-events-none w-40 h-40 opacity-20 ${
                isDestructive ? 'bg-danger' : 'bg-brand'
            }`} />

            <div className="p-6 sm:p-8 text-center flex flex-col items-center relative z-base">
                <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-5 border border-border-card bg-surface-card-hover shadow-sm transition-all duration-300 ${
                    isDestructive ? 'text-danger' : 'text-brand-text'
                }`}>
                    {isProcessing ? (
                        <Loader2 size={28} strokeWidth={2.5} className="animate-spin" />
                    ) : isDestructive ? (
                        <AlertTriangle size={28} strokeWidth={2.5} />
                    ) : (
                        <Info size={28} strokeWidth={2.5} />
                    )}
                </div>

                <h3 className="text-title-sm sm:text-title font-black uppercase tracking-tight mb-3 leading-tight text-content">
                    {isProcessing ? "Procesando..." : title}
                </h3>

                <div className={`text-body font-medium leading-relaxed w-full transition-opacity duration-300 text-content-3 ${isProcessing ? 'opacity-60' : 'opacity-100'}`}>
                    {isProcessing ? "No cierres esta ventana." : message}
                </div>
            </div>

            <div className="p-4 sm:p-5 border-t border-divider flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 relative z-base bg-surface-card-hover">
                {!isProcessing && (
                    <Button variant="secondary" className="flex-1" onClick={onClose}>{cancelText}</Button>
                )}
                <Button
                    variant={isDestructive ? 'destructive' : 'primary'}
                    className="flex-1"
                    loading={isProcessing}
                    onClick={onConfirm}
                >
                    {isProcessing
                        ? (isDestructive ? 'Eliminando…' : 'Confirmando…')
                        : confirmText}
                </Button>
            </div>
        </ModalShell>
    );
};

export default ConfirmModal;
