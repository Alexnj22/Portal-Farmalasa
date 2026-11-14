import React from 'react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import Button from './Button';

/**
 * POR QUÉ no se puede guardar, al lado del botón apagado — y, si se sabe a qué
 * campo pertenece, un toque lleva hasta él (2026-11-14).
 *
 * Nació de un inventario de los modales del portal: unos 60 apagan el botón
 * de guardar cuando falta algo, y ninguno llevaba al campo. Los más decían el
 * motivo en un texto suelto al pie («Falta el último día que trabajó»), lejos
 * de un campo que había que salir a buscar; otros ni eso. Y el de la ficha del
 * empleado lo escondía en el teléfono (`hidden sm:block`), justo donde no hay
 * cursor para leer el `title` del botón.
 *
 * - `motivo`: el texto. Sin motivo no pinta nada.
 * - `onIr`: qué hacer al tocarlo — normalmente `() => irAlCampo(campo, raiz)`
 *   (src/plataforma/irAlCampo.js), o el navegador propio del formulario si el
 *   campo puede estar en otra pestaña. Sin `onIr`, es texto.
 *
 * Se ve también en el teléfono: ahí es donde más hace falta.
 */
export default function AvisoDeFalta({ motivo, onIr, className = '' }) {
    if (!motivo) return null;
    if (!onIr) {
        return (
            <p className={`flex min-w-0 flex-1 items-start gap-1.5 text-label font-medium leading-snug text-warning-text ${className}`} role="status">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span className="min-w-0">{motivo}</span>
            </p>
        );
    }
    return (
        <Button variant="ghost" size="sm" onClick={onIr} aria-live="polite" title="Ir a ese campo"
            className={`h-auto min-w-0 flex-1 justify-start whitespace-normal py-1.5 text-left text-warning-text hover:text-warning-text ${className}`}>
            <AlertCircle size={14} className="shrink-0 self-start mt-0.5" />
            <span className="min-w-0 text-label font-semibold leading-snug">
                {motivo}{' '}
                <span className="inline-flex items-center gap-0.5 whitespace-nowrap underline underline-offset-2">Ir al campo <ArrowRight size={12} /></span>
            </span>
        </Button>
    );
}
