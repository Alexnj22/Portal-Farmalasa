import React from 'react';
import { BellRing, ShieldAlert } from 'lucide-react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

/**
 * A quién quedó asignada la conversación (2026-10-14): el primero del equipo
 * que le contestó al cliente. NO bloquea —cualquiera con el chat puede
 * contestar—; sólo dice quién la tiene y si el servidor ya escaló la espera:
 *   - «Avisado a la sala» (ámbar): 15 minutos sin respuesta, se avisó a la
 *     sucursal de la persona asignada.
 *   - «Sin respuesta · registrado» (rojo): 20 minutos, quedó en el registro de
 *     incumplimientos y se avisó a supervisión.
 * La asignación se libera al resolver. `equipo` es el mapa de fichas de la
 * bandeja (`useEquipoDelChat`); si la ficha todavía no llegó, va sin foto.
 */
export default function AsignadoA({ conversacion: c, equipo, className = '' }) {
    if (!c?.asignada_a) return null;
    const emp = equipo?.get?.(c.asignada_a) ?? { id: c.asignada_a };
    const nombre = emp.name || emp.first_names ? shortEmployeeName(emp) : 'alguien del equipo';
    return (
        <span className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`}>
            <span className="inline-flex items-center gap-1.5 min-w-0 text-label text-content-2">
                <AvatarConEstado emp={emp} px={18} mostrarChip={false} />
                <span className="truncate">Asignado a <span className="font-semibold text-content">{nombre}</span></span>
            </span>
            {c.escalada_supervision_at ? (
                <Badge variant="danger" size="sm" uppercase={false} icon={ShieldAlert}
                    title="Pasaron 20 minutos sin respuesta: quedó registrado y se avisó a supervisión">
                    Sin respuesta · registrado
                </Badge>
            ) : c.escalada_sala_at ? (
                <Badge variant="warning" size="sm" uppercase={false} icon={BellRing}
                    title="Pasaron 15 minutos sin respuesta: se avisó a la sala de la persona asignada">
                    Avisado a la sala
                </Badge>
            ) : null}
        </span>
    );
}
