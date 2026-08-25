import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import Button from './Button';
import ConfirmModal from './ConfirmModal';
import {
    actualizarAhora,
    iniciarVigilanciaDeVersion,
    posponerAviso,
    suscribirVersionNueva,
} from '../../utils/versionNueva';

/**
 * «Hay una versión nueva» — el aviso que reemplazó a la recarga sola.
 *
 * Antes, cuando salía una versión nueva el portal se recargaba SIN PREGUNTAR, y
 * se llevaba con él todo lo escrito y no guardado. Pedido del usuario, textual:
 * *«si hay nueva versión que salte un toast o algo, y le diga que se debe
 * actualizar, no que se haga de un solo, imagina que se esté trabajando o
 * llenando algo y se pierda por eso»*.
 *
 * ── Por qué NO es un toast, aunque así se pidió ───────────────────────────
 * El toast del portal se va solo a los 3.5 segundos y no tiene dónde apretar.
 * Un aviso que hay que atender y desaparece antes de que uno levante la vista
 * es peor que no avisar: la próxima señal vuelve a ser la pantalla trabada. Así
 * que es una franja que se queda hasta que alguien decide, con su botón.
 *
 * ── Dos formas, porque son dos situaciones distintas ──────────────────────
 *  · **Franja** (`hay`): se detectó una versión nueva y no pasó nada malo. Es
 *    un aviso cortés, se puede posponer y no interrumpe. La persona sigue
 *    llenando lo que estaba llenando y actualiza cuando termine.
 *  · **Diálogo** (`bloqueado`): además YA falló algo por eso —una pantalla que
 *    no abrió—. Ahí la franja no alcanza, porque hay que explicar por qué el
 *    toque no hizo nada. Aun así el botón de cancelar existe y no recarga: se
 *    vuelve a la franja y la persona se queda donde estaba, con su formulario
 *    intacto.
 *
 * En los dos casos: **nadie recarga salvo la persona**. Es la regla entera.
 */
export default function AvisoVersionNueva() {
    const [v, setV] = useState(() => ({ hay: false, bloqueado: false, callado: false, version: null }));

    useEffect(() => suscribirVersionNueva(setV), []);
    useEffect(() => iniciarVigilanciaDeVersion(), []);

    if (!v.hay) return null;

    if (v.bloqueado) {
        return (
            <ConfirmModal
                isOpen
                // Escape y el clic afuera son «ahora no». Que la salida barata
                // sea la que NO recarga es a propósito: la que se ejecuta sin
                // querer tiene que ser la que no se lleva nada.
                onClose={() => posponerAviso()}
                onConfirm={actualizarAhora}
                title="Hay una versión nueva"
                message={
                    <>
                        Esta pantalla no puede abrirse hasta que actualices el portal.
                        <br />
                        Si estás llenando algo, guardalo primero: al actualizar,
                        lo que no esté guardado se pierde.
                    </>
                }
                confirmText="Actualizar"
                cancelText="Ahora no"
                isDestructive={false}
            />
        );
    }

    // `callado` y no una comparación de horas: leer el reloj durante el render
    // es impuro y encima no despertaría solo cuando el plazo venciera. Quien
    // cuenta el tiempo es `posponerAviso`, que vuelve a avisar al terminar.
    if (v.callado) return null;

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            data-surface="dropdown"
            className="fixed left-1/2 -translate-x-1/2 z-banner
                top-[calc(var(--sa-top)+1rem)]
                flex items-center gap-3 pl-4 pr-2 py-2
                max-w-[min(92vw,30rem)]
                animate-in fade-in slide-in-from-top-2 duration-[var(--dur-lento)]"
        >
            {/* `RefreshCw` y no otro: ya viaja en el paquete de arranque por
                `ErrorBoundary`, así que este aviso no le suma un ícono nuevo a
                lo que TODO el mundo baja en cada entrada. */}
            <RefreshCw size={16} strokeWidth={2.5} className="shrink-0 text-brand" />

            <div className="flex flex-col min-w-0">
                <span className="text-label font-black uppercase tracking-widest text-content leading-none">
                    Hay una versión nueva
                </span>
                <span className="text-micro font-medium text-content-3 leading-tight mt-1">
                    Actualizá cuando termines lo que estás haciendo.
                </span>
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-auto">
                <Button variant="ghost" size="sm" onClick={() => posponerAviso()}>
                    Ahora no
                </Button>
                <Button variant="primary" size="sm" onClick={actualizarAhora}>
                    Actualizar
                </Button>
            </div>
        </div>,
        document.body,
    );
}
