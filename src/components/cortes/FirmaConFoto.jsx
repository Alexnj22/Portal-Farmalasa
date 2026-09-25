import React from 'react';
import AvatarConEstado from '../common/AvatarConEstado';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * Quién hizo un paso de una diferencia de caja: su foto y su nombre, siempre
 * juntos (usuario, 2026-09-25: «siempre la foto con los nombres»).
 *
 * `id` es el de la FICHA (`employees.id`). El avatar resuelve la foto contra
 * el store por ese id; con otro id —el de la fila de asignación, por ejemplo—
 * cae a la inicial sin avisar, que es lo que pasó en la primera versión.
 */
export default function FirmaConFoto({ id, nombre, accion = '', px = 20, className = '' }) {
    if (!nombre && !id) return null;
    return (
        <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
            <AvatarConEstado emp={{ id, name: nombre }} px={px} radio="rounded-full" mostrarChip={false} />
            <span className="truncate">
                {accion && <span className="text-content-3">{accion} </span>}
                <span className="text-content-2 font-bold">{nombre ? shortEmployeeName(nombre) : 'sin nombre'}</span>
            </span>
        </span>
    );
}
