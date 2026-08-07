import React, { useRef } from 'react';
import AsaHoja from './AsaHoja';
import ModalShell from './ModalShell';
import { useArrastreHoja } from './arrastreHoja';
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
    // ── El asa ARRASTRA, también acá ──────────────────────────────────────
    // Era decorativa: `AsaHoja` se rendeaba sin las props del gesto, así que
    // TODOS los modales de este canónico —y por él pasa `UnifiedModal`, o sea
    // casi todos los formularios— dibujaban un asa que prometía "esto se cierra
    // arrastrando" y después no cumplía. Reportado.
    //
    // `alCerrar` sale de la prop y no de `EstadoDialogoCtx`: el proveedor vive
    // DENTRO de `ModalShell`, así que un `useContext` acá arriba leería el valor
    // por defecto. `onClose` ya es exactamente lo mismo y está a mano.
    const hojaRef = useRef(null);
    const sinMovimiento = useMediaQuery('(prefers-reduced-motion: reduce)');
    const gesto = useArrastreHoja({
        refPanel: hojaRef,
        alCerrar: onClose,
        activo: enTactil && !sinMovimiento && !!onClose,
    });
    return (
        <ModalShell
            open={open}
            onClose={onClose}
            maxWidthClass={maxWidth}
            zClass={zClass}
            ariaLabel={ariaLabel}
            // ── `surface={null}`: DOS vidrios apilados (2026-08-07) ───────────
            // `ModalShell` declara `data-surface="modal"` por defecto y la hoja
            // de acá abajo lo declara otra vez. Dos capas del mismo material no
            // suman: MULTIPLICAN lo que dejan pasar. Con el token en 0.51, dos
            // apiladas dan 1 − 0.49² ≈ 0.76, así que el modal se veía casi
            // opaco y el desenfoque del fondo apenas se leía — reportado como
            // «les falta el elemento glass».
            //
            // Es exactamente para lo que existe la prop, y `DataTable`,
            // `PromptModal`, `CuerpoDialogo` y `BarraFlotante` ya la pasaban:
            // el único que se lo había olvidado era este canónico, o sea el que
            // usan casi todos los formularios del portal. En los dos temas
            // Solid no se notaba (ahí `--surface-modal` es opaco por diseño),
            // que es por qué sobrevivió tanto.
            surface={null}
        >
            <div
                ref={hojaRef}
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
                            : 'animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-[var(--dur-slow)] ease-[var(--ease-spring)]'}
                    ${lateral
                        // `pl-5` reserva el carril del asa. Sin él, el contenido
                        // se dibuja ENCIMA —los dos llevan `z-base` y gana el que
                        // va después en el DOM—, así que el dedo tocaba el
                        // formulario en vez del asa y el arrastre no arrancaba
                        // nunca. Medido: el `pointerdown` aterrizaba en el cuerpo.
                        // Y `pr` para el área segura, que acostado se come ~59px.
                        ? 'pl-6 pr-[var(--sa-right)]'
                        : className}`}
            >
                {enTactil && (
                    // El asa acompaña al borde por el que entró: acostada se para
                    // y se corre a la izquierda, igual que en `HojaMovil`.
                    <AsaHoja vertical={lateral} {...gesto}
                        className={lateral
                            ? 'absolute left-0 top-1/2 -translate-y-1/2 z-base'
                            : 'mt-3 -mb-1 relative z-base'} />
                )}
                {/* §21 · La capa extra de escarcha se RETIRÓ (2026-08-06). El
                    contenedor ya es `data-surface="modal"`, así que esta capa pintaba
                    `rgba(255,255,255,0.5)` y un segundo `backdrop-filter` ENCIMA del
                    material del tema: el panel nunca llegaba a la opacidad que dice
                    su token. Al cablear §5 y bajar `--surface-modal` a 0.51 el
                    número quedó inerte —el modal seguía viéndose cerca de 0.76— y
                    eso no coincidía con el mockup sobre el que se confirmó.
                    Es el mismo caso que las tarjetas del tablero: vidrio a mano que
                    precede a la superficie canónica y que nadie retiró al llegar
                    ésta. Su propio comentario ya contaba que en oscuro ese blanco
                    al 50% lavaba la tarjeta a lavanda. */}
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
                ? 'flex flex-col-reverse gap-2 px-4 pt-3 pb-[max(16px,var(--sa-bottom))] [&>*]:w-full [&_button]:w-full'
                : 'bg-transparent px-6 md:px-10 py-5 flex justify-between items-center'}
            ${className}`}>
            {children}
        </div>
    );
};
