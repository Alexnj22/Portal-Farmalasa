import React from 'react';
import AsaHoja from './AsaHoja';
import ModalShell from './ModalShell';
import { usePanelLateral } from '../../hooks/useLayoutCompacto';
import useMediaQuery from '../../hooks/useMediaQuery';

/**
 * Standard glass modal shell for the portal.
 *
 * Usage:
 *   <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-md">
 *     <LiquidModal.Header>…title / icon / close button…</LiquidModal.Header>
 *     <LiquidModal.Body>…content…</LiquidModal.Body>
 *     <LiquidModal.Footer>…action buttons…</LiquidModal.Footer>
 *   </LiquidModal>
 *
 * Props (root):
 *   open      – controlled visibility (default true for inline-rendered modals)
 *   onClose   – called on Escape or backdrop click
 *   maxWidth  – Tailwind max-w-* class (default: max-w-sm)
 *   zClass    – z-index override (default: ModalShell default z-modal)
 *   className – extra classes on the card (e.g. max-h-[90vh] h-fit)
 *   ariaLabel – accessible name announced by screen readers (pass the
 *               modal's actual title — without it every LiquidModal in the
 *               app announces as the generic ModalShell default)
 *
 * ── En táctil es una HOJA (2026-07-30) ────────────────────────────────────
 * `ModalShell` ya la hace entrar desde abajo. Acá se le da la anatomía que le
 * corresponde: asa, esquinas rectas contra el filo, alto tope de 88dvh y el pie
 * con los botones APILADOS a ancho completo y su área segura.
 *
 * No se reescribe sobre `HojaMovil` porque este canónico es de composición
 * —`Header`/`Body`/`Footer` con JSX arbitrario de cada consumidor— y `HojaMovil`
 * es de props. Convertirlo obligaría a reescribir los 6 llamadores; darle la
 * anatomía por dentro los cubre a todos sin tocar ninguno. Las dos formas
 * producen la misma hoja.
 */
export default function LiquidModal({
    open = true,
    onClose,
    maxWidth  = 'max-w-sm',
    zClass,
    className = '',
    ariaLabel,
    children,
}) {
    const enTactil = useMediaQuery('(hover: none)');
    // Acostado, `ModalShell` ancla el panel al costado. El cuerpo tiene que
    // enterarse o sigue calculando su alto contra `88dvh` dentro de un panel que
    // ya mide 100%, y pone el radio en un borde que no está a la vista.
    const lateral = usePanelLateral();
    return (
        <ModalShell
            open={open}
            onClose={onClose}
            maxWidthClass={maxWidth}
            zClass={zClass}
            ariaLabel={ariaLabel}
        >
            <div
                // `data-hoja` le dice a `ModalShell` que no la parchee: el parche
                // es para los cuerpos heredados, y acá la anatomía ya es de hoja.
                data-hoja={enTactil ? 'true' : undefined}
                data-surface="modal"
                className={`w-full flex flex-col overflow-hidden relative
                    ${lateral
                        // Acostado la hoja entra de COSTADO: alto completo y el
                        // radio en el borde izquierdo, que es el único a la
                        // vista. Sin esto el cuerpo seguía calculando su alto
                        // contra `88dvh` dentro de un panel que ya mide 100%, y
                        // el radio quedaba arriba en un panel sin borde arriba.
                        ? 'h-full rounded-l-modal rounded-r-none!'
                        : enTactil
                            // Sin `zoom-in`: una hoja sube, no aparece creciendo. Y
                            // `rounded-b-none!` con importancia porque el radio lo fija
                            // `[data-surface="modal"]`, selector de atributo que le gana
                            // por orden de hoja.
                            ? 'max-h-[88dvh] rounded-t-modal rounded-b-none!'
                            : 'animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]'}
                    ${lateral ? '' : className}`}
            >
                {enTactil && (
                    // El asa acompaña al borde por el que entró: acostada se para
                    // y se corre a la izquierda, igual que en `HojaMovil`.
                    <AsaHoja vertical={lateral}
                        className={lateral
                            ? 'my-auto ml-1 absolute left-0 top-0 bottom-0 z-base'
                            : 'mt-3 -mb-1 relative z-base'} />
                )}
                {/* Glass layer — sits behind all content; color por tema y
                    apagada en solid/solid-dark (ver .modal-glass-layer en index.css) */}
                <div
                    className="modal-glass-layer absolute inset-0 backdrop-blur-[15px] backdrop-saturate-[300%] -z-base pointer-events-none"
                    style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                />
                {children}
            </div>
        </ModalShell>
    );
}

/**
 * Header section — bg-transparent so the glass blur shows through.
 * className merges onto the section div (e.g. for padding overrides).
 */
LiquidModal.Header = function LiquidModalHeader({ children, className = '' }) {
    return (
        <div className={`flex-none bg-transparent px-6 py-5 border-b border-divider shrink-0 relative z-base ${className}`}>
            {children}
        </div>
    );
};

/**
 * Scrollable body section — transparent so the glass blur shows through.
 */
LiquidModal.Body = function LiquidModalBody({ children, className = '' }) {
    return (
        <div className={`relative z-base px-6 py-5 flex-1 overflow-y-auto ${className}`}>
            {children}
        </div>
    );
};

/**
 * Footer section — la zona de acciones.
 *
 * La forma de escritorio es la que **4 de los 6 consumidores ya tenían escrita a
 * mano**, carácter por carácter: `flex-none px-6 md:px-10 py-5 border-t flex
 * justify-between items-center`. El canónico existía y casi nadie lo usaba, así
 * que se adopta la forma real en vez de imponer otra y romperlos.
 */
LiquidModal.Footer = function LiquidModalFooter({ children, className = '' }) {
    // En táctil los botones se APILAN a ancho completo. En fila se reparten los
    // 390px del teléfono y quedan dos blancos apretados; apilados son dos
    // objetivos enteros, que es lo que el pulgar acierta sin mirar. Y el pie
    // toca el filo de la pantalla, así que se reserva el área segura.
    //
    // `flex-col-reverse` y no `flex-col`: en escritorio la acción principal va a
    // la DERECHA, así que es la última del DOM. Apilando en orden natural quedaba
    // abajo del todo —el peor sitio, contra el filo— y "Cancelar" arriba. Al
    // invertir, "la de más a la derecha" se convierte en "la de más arriba", que
    // es la misma jerarquía leída de otra manera.
    const enTactil = useMediaQuery('(hover: none)');
    return (
        <div className={`flex-none border-t border-divider relative z-base shrink-0
            ${enTactil
                ? 'flex flex-col-reverse gap-2 px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] [&>*]:w-full [&_button]:w-full'
                : 'bg-transparent px-6 md:px-10 py-5 flex justify-between items-center'}
            ${className}`}>
            {children}
        </div>
    );
};
