import React from 'react';
import { Clock } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import { nombreDeCliente } from '@nucleo/utils/chatClientes';
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
//
// «En atención» lleva la FOTO y el nombre de quien atiende («que se
// identifique mejor, con la foto»), y mientras el cliente siga sin respuesta
// —nuevo o tomada, da igual: tomarla no es contestarle— cuánto lleva: gris,
// ámbar pasados 15 minutos, rojo pasada la hora. Corto («espera 26 min»):
// con «sin respuesta» el nombre de quien atiende no cabía en el panel.
const PUNTO = { info: 'bg-brand', 'chart-6': 'bg-chart-6', neutral: 'bg-content-3', success: 'bg-success' };
const ESPERA = { neutral: 'text-content-3', warning: 'text-warning bg-warning/12 px-1.5 rounded-full', danger: 'text-danger bg-danger/12 px-1.5 rounded-full' };
export function EstadoEnTexto({ conversacion: c, atiende, ahora }) {
    const clave = estadoDeConversacion(c);
    const estado = ESTADOS[clave];
    const espera = esperaDe(c, ahora);
    const conFoto = clave === 'atencion' && atiende;
    return (
        <span className="inline-flex items-center gap-1.5 min-w-0 text-micro font-semibold text-content-2">
            {conFoto ? (
                <>
                    <AvatarConEstado emp={atiende} px={16} mostrarChip={false} />
                    <span className="shrink-0 text-content" title={`Atiende ${nombreDeCliente(shortEmployeeName(atiende))}`}>{nombreDeCliente(shortEmployeeName(atiende))}</span>
                </>
            ) : (
                <>
                    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${PUNTO[estado.variant] ?? 'bg-content-3'}`} />
                    <span className="truncate">{estado.label}</span>
                </>
            )}
            {espera && (
                <span className={`inline-flex items-center gap-0.5 shrink-0 tabular-nums ${ESPERA[espera.tono] ?? ESPERA.neutral}`}
                    aria-label={`Sin respuesta desde hace ${espera.label}`}>
                    <Clock size={10} aria-hidden="true" /> {espera.min < 1 ? 'ahora' : `espera ${espera.label}`}
                </span>
            )}
        </span>
    );
}
