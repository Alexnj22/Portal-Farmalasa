import React from 'react';

/**
 * TituloDeSeccion — el título de un bloque, en tres niveles (2026-11-06).
 *
 * Antes había 211 `<h3>` con 34 estilos distintos, y 9 usaban `text-h3`, una
 * clase que no existe: salían sin tamaño. Decisión del usuario: tres niveles,
 * cada uno con un estilo fijo.
 *
 *   modal    → el título de un bloque grande: un modal, un panel, una sección
 *              principal de una vista (18px, negro).
 *   tarjeta  → el título de una tarjeta o de un grupo dentro de un panel (14px).
 *              Se probó a 16px y en el teléfono los títulos de las baldosas de
 *              Inicio se cortaban; 14 es la mediana de lo que había.
 *   seccion  → el rótulo en mayúsculas que encabeza un grupo (§7: el rótulo es
 *              uno solo).
 *
 * `className` es para la DISPOSICIÓN (flex, gap, márgenes, truncate), nunca
 * para el tamaño, el peso o el color: eso lo decide el nivel. El gate
 * `titulo-a-mano` vigila que nadie vuelva a escribirlo a mano.
 */
const NIVEL = {
    modal: 'text-title-sm font-black text-content tracking-tight leading-snug',
    tarjeta: 'text-body-lg font-black text-content tracking-tight leading-snug',
    seccion: 'text-label font-black uppercase tracking-widest text-content-2',
};

export default function TituloDeSeccion({ nivel = 'tarjeta', as: Tag = 'h3', className = '', children, ...rest }) {
    return (
        <Tag className={`${NIVEL[nivel] || NIVEL.tarjeta}${className ? ` ${className}` : ''}`} {...rest}>
            {children}
        </Tag>
    );
}
