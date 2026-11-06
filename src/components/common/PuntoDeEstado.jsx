import React from 'react';

/**
 * PuntoDeEstado — el punto de color que dice el estado de algo (2026-11-06).
 *
 * Había 109 escritos a mano en 10 tamaños (4, 6, 8, 10px y más). Quedan dos:
 *   md → 8px, el de una fila, una leyenda o un encabezado.
 *   sm → 6px, el que va pegado a un texto chico (un rótulo, un chip).
 * Lo de 12px o más no es un punto: es un indicador con aro, un avatar o una
 * muestra de color de un gráfico, y no va por acá.
 *
 * `className` lleva el COLOR (`bg-success`, `bg-chart-3`…) y la disposición
 * (márgenes, `absolute`, `animate-pulse`); el tamaño y la forma los pone el
 * componente. Es decorativo salvo que traiga `title` o `aria-label`.
 */
const TAMANO = { sm: 'w-1.5 h-1.5', md: 'w-2 h-2' };

export default function PuntoDeEstado({ tamano = 'md', className = '', ...rest }) {
    const describe = rest.title || rest['aria-label'];
    return (
        <span
            aria-hidden={describe ? undefined : 'true'}
            {...rest}
            className={`inline-block ${TAMANO[tamano] || TAMANO.md} rounded-full shrink-0${className ? ` ${className}` : ''}`}
        />
    );
}
