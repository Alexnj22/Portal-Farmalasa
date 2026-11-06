import React from 'react';

import TituloDeSeccion from '../../components/common/TituloDeSeccion';
// El rótulo de cada bloque de la lista, con su cuenta.
export default function Encabezado({ titulo, n, ayuda }) {
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ml-1">
            <TituloDeSeccion nivel="seccion">{titulo}</TituloDeSeccion>
            <span className="text-caption font-bold tabular-nums text-content-3">{n}</span>
            {ayuda && <span className="text-caption text-content-3">· {ayuda}</span>}
        </div>
    );
}
