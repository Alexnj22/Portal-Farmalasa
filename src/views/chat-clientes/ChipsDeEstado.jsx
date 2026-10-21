import React from 'react';
import { Clock } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ESTADOS, esperaDe, estadoDeConversacion } from './estados';

// El estado de una conversación como chip —«Nuevo», «En atención · Ana»,
// «Esperando al cliente», «Resuelta»— y, para las nuevas, cuánto llevan
// esperando: ámbar pasados 15 minutos, rojo pasada la hora. `ahora` lo pasa la
// lista (un solo reloj para todas las filas, no uno por fila).
export default function ChipsDeEstado({ conversacion: c, atiende, ahora }) {
    const clave = estadoDeConversacion(c);
    const estado = ESTADOS[clave];
    const quien = clave === 'atencion' && atiende ? shortEmployeeName(atiende) : '';
    const espera = esperaDe(c, ahora);
    return (
        <>
            <Badge variant={estado.variant} size="sm" uppercase={false} dot>
                {estado.label}{quien ? ` · ${quien}` : ''}
            </Badge>
            {espera && (
                <Badge variant={espera.tono} size="sm" uppercase={false} icon={Clock}
                    title="Tiempo desde el primer mensaje del cliente que sigue sin respuesta" aria-label={`Esperando desde hace ${espera.label}`}>
                    {espera.label}
                </Badge>
            )}
        </>
    );
}

// La misma información, como TEXTO de una línea (2026-10-21): es lo que va
// debajo del nombre en el encabezado del hilo, igual que el «en línea» de una
// app de mensajería. Como chip ocupaba dos renglones en el panel de la burbuja.
const PUNTO = { info: 'bg-brand', 'chart-6': 'bg-chart-6', neutral: 'bg-content-3', success: 'bg-success' };
const TONO = { warning: 'text-warning', danger: 'text-danger' };
export function EstadoEnTexto({ conversacion: c, atiende, ahora }) {
    const clave = estadoDeConversacion(c);
    const estado = ESTADOS[clave];
    const quien = clave === 'atencion' && atiende ? shortEmployeeName(atiende) : '';
    const espera = esperaDe(c, ahora);
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0 text-micro font-semibold text-content-2">
            <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${PUNTO[estado.variant] ?? 'bg-content-3'}`} />
            <span className="truncate">{estado.label}{quien ? ` · ${quien}` : ''}</span>
            {espera && (
                <span className={`inline-flex items-center gap-0.5 shrink-0 tabular-nums ${TONO[espera.tono] ?? 'text-content-3'}`}
                    aria-label={`Esperando desde hace ${espera.label}`}>
                    <Clock size={10} aria-hidden="true" /> {espera.label}
                </span>
            )}
        </span>
    );
}
