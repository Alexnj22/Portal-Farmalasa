import React from 'react';
import AvatarConEstado from '../common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

/**
 * Quién lo hizo: la foto y el nombre corto, con una línea de detalle opcional
 * (cuándo, dónde). La regla del portal es «quién lo hizo = foto + nombre
 * corto»; acá vive una vez para la bitácora, las pendientes y el canje de las
 * aplicaciones de inyección, en vez de escribir el par en cada celda.
 */
export default function PersonaConFoto({ id, nombre, detalle, px = 24 }) {
    if (!nombre) return <span className="text-caption text-content-3">—</span>;
    return (
        <span className="inline-flex items-center gap-2 min-w-0">
            <AvatarConEstado emp={{ id, name: nombre }} px={px} radio="rounded-full" marco="" mostrarChip={false} />
            <span className="min-w-0 leading-tight">
                <span className="block text-body-sm font-semibold text-content truncate">{shortEmployeeName(nombre)}</span>
                {detalle && <span className="block text-caption text-content-3 truncate">{detalle}</span>}
            </span>
        </span>
    );
}
