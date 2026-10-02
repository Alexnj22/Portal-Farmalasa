import React from 'react';
import { Check } from 'lucide-react';
import { PASOS_DEL_FLUJO, pasoDelFlujo, ROTULO_CORTO } from '@nucleo/utils/marketing';
import { tonoDeEstado } from './iconos';

/**
 * El camino de la pieza, de «Pendiente» a «Publicada», con el paso actual
 * encendido en su color. Lo recorrido lleva ✓; «Con cambios» se pinta en el
 * lugar de «Por revisar», que es de donde volvió.
 *
 * Con `onElegir`, cada paso permitido (`permitidos`) es un botón: así se
 * cambia el estado, sin un select. Sin él, es sólo lectura.
 */
export default function FlujoDePieza({ estado, onElegir, permitidos = [], deshabilitado = false }) {
    const actual = pasoDelFlujo(estado);
    return (
        <ol className="flex items-start w-full" aria-label="Estado de la pieza">
            {PASOS_DEL_FLUJO.map((paso, i) => {
                const enEste = i === actual;
                const valor = enEste ? estado : paso;
                const tono = tonoDeEstado(valor);
                const Icono = tono.icono;
                const hecho = i < actual;
                const puede = !!onElegir && !deshabilitado && !enEste && permitidos.includes(paso);
                const rotulo = enEste ? ROTULO_CORTO[estado] : ROTULO_CORTO[paso];
                const circulo = (
                    <span className={`relative z-base flex items-center justify-center rounded-full transition-all
                        ${enEste ? `w-9 h-9 ${tono.solido} text-white shadow-md ring-4 ring-surface-card` : 'w-7 h-7'}
                        ${hecho ? `${tonoDeEstado(paso).suave} ${tonoDeEstado(paso).texto}` : ''}
                        ${!enEste && !hecho ? 'bg-surface-input text-content-3' : ''}
                        ${puede ? 'group-hover:ring-2 group-hover:ring-brand/40' : ''}`}>
                        {hecho ? <Check size={14} strokeWidth={3} /> : <Icono size={enEste ? 16 : 14} />}
                    </span>
                );
                const etiqueta = (
                    <span className={`mt-1.5 text-center leading-tight text-micro
                        ${enEste ? `font-bold ${tono.texto}` : hecho ? 'font-semibold text-content-2' : 'text-content-3'}`}>
                        {rotulo}
                    </span>
                );
                return (
                    <li key={paso} className="relative flex-1 min-w-0 flex flex-col items-center">
                        {/* El tramo que une con el paso anterior. */}
                        {i > 0 && (
                            <span aria-hidden className={`absolute top-[17px] right-1/2 w-full h-0.5 -translate-y-1/2
                                ${i <= actual ? tonoDeEstado(PASOS_DEL_FLUJO[i - 1]).barra : 'bg-border-card'}`} />
                        )}
                        {puede ? (
                            <button type="button" onClick={() => onElegir(paso)}
                                className="group flex flex-col items-center min-h-[var(--tap-min)] min-w-[var(--tap-min)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-brand rounded-lg"
                                title={`Pasar a ${ROTULO_CORTO[paso]}`} aria-label={`Pasar a ${ROTULO_CORTO[paso]}`}>
                                <span className="h-9 flex items-center">{circulo}</span>
                                {etiqueta}
                            </button>
                        ) : (
                            <div className="flex flex-col items-center" aria-current={enEste ? 'step' : undefined}>
                                <span className="h-9 flex items-center">{circulo}</span>
                                {etiqueta}
                            </div>
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

/** El mismo camino, en una línea fina de seis tramos: para la ficha del calendario. */
export function FlujoMini({ estado }) {
    const actual = pasoDelFlujo(estado);
    const tono = tonoDeEstado(estado);
    return (
        <span className="flex gap-0.5 w-full" aria-hidden>
            {PASOS_DEL_FLUJO.map((paso, i) => (
                <span key={paso} className={`h-1 flex-1 rounded-full ${i <= actual ? tono.barra : 'bg-border-card'}`} />
            ))}
        </span>
    );
}
