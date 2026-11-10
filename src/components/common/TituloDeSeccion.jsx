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
 * `tono` (2026-11-10) — el color cuando el título SIGNIFICA algo: el rojo del
 * contacto de emergencia, el verde de un pago, el color de la categoría de un
 * grupo, el blanco sobre la superficie oscura del kiosco. Sin `tono`, el nivel
 * pone el suyo (`text-content` o `text-content-2` en `seccion`). Los doce
 * títulos que quedaron escritos a mano lo estaban sólo por esto.
 *   brand · success · warning · danger · chart-1/3/4/6/9 → su `-text`
 *   tenue   → `text-content-3` (el grupo que ya no pide atención)
 *   inverso → blanco: SÓLO sobre una superficie de color fijo (kiosco, foto)
 *
 * `className` es para la DISPOSICIÓN (flex, gap, márgenes, truncate), nunca
 * para el tamaño, el peso o el color: eso lo deciden el nivel y el tono. El
 * gate `titulo-a-mano` vigila que nadie vuelva a escribirlo a mano.
 */
const NIVEL = {
    modal: 'text-title-sm font-black tracking-tight leading-snug',
    tarjeta: 'text-body-lg font-black tracking-tight leading-snug',
    seccion: 'text-label font-black uppercase tracking-widest',
};

const COLOR_DEL_NIVEL = {
    modal: 'text-content',
    tarjeta: 'text-content',
    seccion: 'text-content-2',
};

// Las clases van ESCRITAS enteras: Tailwind sólo genera lo que encuentra
// literal en el fuente.
const TONO = {
    brand: 'text-brand-text',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
    'chart-1': 'text-chart-1-text',
    'chart-3': 'text-chart-3-text',
    'chart-4': 'text-chart-4-text',
    'chart-6': 'text-chart-6-text',
    'chart-9': 'text-chart-9-text',
    tenue: 'text-content-3',
    inverso: 'text-white',
};

export default function TituloDeSeccion({ nivel = 'tarjeta', tono, as: Tag = 'h3', className = '', children, ...rest }) {
    const n = NIVEL[nivel] ? nivel : 'tarjeta';
    const color = TONO[tono] || COLOR_DEL_NIVEL[n];
    return (
        <Tag className={`${NIVEL[n]} ${color}${className ? ` ${className}` : ''}`} {...rest}>
            {children}
        </Tag>
    );
}
