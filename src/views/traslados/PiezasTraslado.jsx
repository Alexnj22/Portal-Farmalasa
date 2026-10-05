import React from 'react';
import { AlertTriangle, ArrowRight, Building2, Clock } from 'lucide-react';
import Badge from '../../components/common/Badge';

// Las piezas que comparten las tarjetas del traslado y las del envío.
//
// Archivo propio y no un export de `FilasTraslado`: las tarjetas de envío viven
// en otro chunk diferido, e importar esto desde allá les habría colgado las 900
// líneas del traslado para dibujar dos chips. Y escritas dos veces, la ruta del
// envío y la del traslado terminan pintándose distinto en la misma pantalla.

/* ─── El trayecto, como dos lugares y no como una frase ───────────────────────
 *
 * Era «Salud 5 → Salud 4» en gris, del mismo peso que el resto: había que leer
 * la línea entera para saber si era de uno. Dos chips con la flecha en medio se
 * leen de un vistazo, y el DESTINO va teñido porque es la sala que tiene que
 * hacer algo.
 *
 * @param nota  Un apunte del origen que no es otra sala —«Área de Vencidos»—:
 *              dos envíos de Bodega se ven idénticos si sólo se nombra la sala.
 */
export function Trayecto({ desde, hasta, nota = null, className = '' }) {
    return (
        <span className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`}>
            <Badge variant="neutral" uppercase={false} icon={Building2} className="min-w-0 gap-1">
                <span className="truncate">{desde ?? 'otra sala'}{nota ? ` · ${nota}` : ''}</span>
            </Badge>
            <ArrowRight size={12} strokeWidth={2.5} className="shrink-0 text-content-3" />
            <Badge variant="info" uppercase={false} icon={Building2} className="min-w-0 gap-1">
                <span className="truncate">{hasta ?? 'destino'}</span>
            </Badge>
        </span>
    );
}

/* ─── Cuánto lleva, como pastilla ─────────────────────────────────────────────
 *
 * Teñida y con aviso pasado el día: es el dato que decide si hay que levantar
 * el teléfono hoy, y en texto suelto rojo se leía como un error. */
export function PildoraEspera({ texto, trabado = false, className = '' }) {
    return (
        <span className={`inline-flex items-center gap-1.5 min-w-0 shrink-0 rounded-full px-2.5 py-1
                          ring-1 ring-inset ${className}
                          ${trabado ? 'bg-danger/10 ring-danger/20 text-danger-text'
                                    : 'bg-surface-input ring-divider text-content-2'}`}>
            {trabado
                ? <AlertTriangle size={12} strokeWidth={2.5} className="shrink-0" />
                : <Clock size={12} strokeWidth={2.5} className="shrink-0" />}
            <span className="text-caption font-black truncate">{texto}</span>
        </span>
    );
}
