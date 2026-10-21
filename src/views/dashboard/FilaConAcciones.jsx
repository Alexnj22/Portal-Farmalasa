import React from 'react';
import ListRow from '../../components/common/ListRow';

// ═══════════════════════════════════════════════════════════════════════════
// Una fila de lista que NO pierde nada en ningún ancho (2026-10-21).
//
// Nació del widget de Reservas: «se pierde el contenido, que siempre se vea bien
// en todos los tamaños». Con `ListRow` y `trailing`, la columna de la derecha es
// `shrink-0` y los botones no se parten (`whitespace-nowrap`), así que en una
// baldosa angosta —o en el teléfono— los tres o cuatro badges y botones de una
// reserva se comían todo el ancho: el título y el detalle quedaban truncados a
// dos letras, sin `title`, y el último botón salía por el borde de la tarjeta.
//
// Acá el texto ENVUELVE (no se trunca: en el teléfono no hay hover que muestre
// un `title`) y las acciones van en su propia tira con `flex-wrap`. La decisión
// de ponerlas al lado o debajo la toma el ancho de la FILA, no el de la
// pantalla (`@container`): la misma fila vive en una baldosa de 2 columnas del
// Inicio y en la pantalla completa de Reservas, y en las dos el espacio que
// importa es el suyo.
// ═══════════════════════════════════════════════════════════════════════════
export default function FilaConAcciones({ icon, tone = null, titulo, detalle, acciones, density = 'sm' }) {
    return (
        <ListRow surface="card" density={density} tone={tone} icon={icon}>
            <span className="@container block min-w-0">
                <span className="flex flex-col gap-1.5 @xl:flex-row @xl:items-start @xl:justify-between @xl:gap-3">
                    <span className="block min-w-0 @xl:flex-1">
                        {titulo && <span className="block text-body-sm font-bold text-content break-words">{titulo}</span>}
                        {detalle && <span className="block text-label font-medium text-content-3 break-words">{detalle}</span>}
                    </span>
                    {acciones && (
                        <span className="flex flex-wrap items-center gap-1 min-w-0 @xl:justify-end @xl:max-w-[60%]">
                            {acciones}
                        </span>
                    )}
                </span>
            </span>
        </ListRow>
    );
}
