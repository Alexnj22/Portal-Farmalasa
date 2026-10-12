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
                    title="Tiempo desde el último mensaje del cliente" aria-label={`Esperando desde hace ${espera.label}`}>
                    {espera.label}
                </Badge>
            )}
        </>
    );
}
