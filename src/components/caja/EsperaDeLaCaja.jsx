import React, { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import Notice from '../common/Notice';

/**
 * La espera de un corte (o del cierre del día) mientras el sistema de la caja
 * lo registra.
 *
 * Tarda ~10 s y no es el portal: medido el 2026-10-05 sobre 29 cortes, p50
 * 10.2 s y p90 11.7 s, contra <1 s de `operar-caja`, que entra a la misma caja
 * y lee el mismo panel. Lo que se va es lo que hace el sistema de la caja al
 * armar el formulario, guardar el corte y devolver el comprobante.
 *
 * Con sólo el botón apagado, la sala no tenía ninguna señal de que algo
 * pasaba, y «Cancelar» seguía vivo. Cerrar a mitad NO deshace el corte —ya
 * está saliendo en la caja—: lo deja sin resolver y sin papel a la vista. Por
 * eso esta espera dice qué está pasando, cuánto lleva, y que no se cierre.
 *
 * La barra NO es un avance medido —el servidor no informa por dónde va—: se
 * acerca al 95% en la duración típica y se queda ahí hasta que contesta. Los
 * pasos se rotulan por tiempo con el mismo criterio. Es una estimación
 * declarada, no un dato.
 */
export default function EsperaDeLaCaja({ pasos, estimadoSeg = 10, aviso }) {
    const [seg, setSeg] = useState(0);

    useEffect(() => {
        const inicio = Date.now();
        const t = setInterval(() => setSeg((Date.now() - inicio) / 1000), 250);
        /* Recargar o cerrar la pestaña tampoco deshace el corte: pide
         * confirmación igual que la recepción de pedidos. */
        const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', avisar);
        return () => { clearInterval(t); window.removeEventListener('beforeunload', avisar); };
    }, []);

    // Curva que llega a ~85% en el tiempo típico y nunca pasa del 95%.
    const pct = Math.min(95, Math.round(95 * (1 - Math.exp(-2 * seg / estimadoSeg))));
    const paso = [...pasos].reverse().find((p) => seg >= p.desde) ?? pasos[0];
    const demorado = seg > estimadoSeg * 2;

    return (
        <div className="space-y-4" aria-live="polite" aria-busy="true">
            <div className="flex flex-col items-center text-center gap-3 py-2">
                <Loader2 className="text-brand-text animate-spin" size={40} strokeWidth={2.5} />
                <div>
                    <p className="text-body font-bold text-content">{paso.texto}</p>
                    <p className="text-caption text-content-3 tabular-nums mt-0.5">
                        {Math.floor(seg)} s · suele tardar unos {estimadoSeg} s
                    </p>
                </div>
            </div>

            <div className="h-2 rounded-full bg-content-3/20 overflow-hidden"
                role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                aria-label="Avance estimado">
                <div className="h-full rounded-full bg-brand transition-[width] duration-[var(--dur-slow)] ease-out motion-reduce:transition-none"
                    style={{ width: `${pct}%` }} />
            </div>

            <Notice variant="warning" icon={ShieldAlert}>
                <span className="font-bold">No cierres esta ventana ni recargues.</span>
                <span className="block mt-0.5 font-normal text-content-2">
                    {demorado
                        ? 'Está tardando más de lo normal, pero sigue en marcha. Espera la respuesta.'
                        : aviso}
                </span>
            </Notice>
        </div>
    );
}
