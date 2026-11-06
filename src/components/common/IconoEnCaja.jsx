import React from 'react';

/**
 * IconoEnCaja — un ícono dentro de un cuadro o un círculo de color (2026-11-06).
 *
 * Había 78 escritos a mano en 12 tamaños (de 16 a 96px), cuatro radios y
 * fondos de cualquier tono. Quedan:
 *   tamano  sm 32px · md 40px · lg 48px
 *   forma   'cuadro' (rounded-xl, que cada tema redefine) · 'circulo'
 *   tono    'neutro' (la superficie de una tarjeta) o un tono con significado
 *           (brand, success, warning, danger, chart-1/3/4/6/8/9 — 2, 5 y 7
 *           están retirados): fondo teñido
 *           al 10% y el ícono en el `-text` de ese tono.
 *
 * El ícono va como hijo, con su propio `size` (lo decide quien lo usa: un 18
 * en una caja de 40 no es lo mismo en una fila que en un encabezado).
 * `className` es para la disposición, un borde o una sombra; nunca el fondo.
 *
 * Lo que NO es esto: los degradados, los fondos sólidos con ícono blanco y las
 * fotos con marco. Ésos siguen escritos donde están, y el gate
 * `icono-en-caja-a-mano` sólo cuenta los que sí cabían acá.
 */
const TAMANO = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-12 h-12' };

// Las clases van ESCRITAS enteras: Tailwind sólo genera lo que encuentra
// literal en el fuente, y `bg-${tono}/10` no lo encuentra.
const TONO = {
    neutro: 'bg-surface-card-hover text-content-2',
    brand: 'bg-brand/10 text-brand-text',
    success: 'bg-success/10 text-success-text',
    warning: 'bg-warning/10 text-warning-text',
    danger: 'bg-danger/10 text-danger-text',
    'chart-1': 'bg-chart-1/10 text-chart-1-text',
    'chart-3': 'bg-chart-3/10 text-chart-3-text',
    'chart-4': 'bg-chart-4/10 text-chart-4-text',
    'chart-6': 'bg-chart-6/10 text-chart-6-text',
    'chart-8': 'bg-chart-8/10 text-chart-8-text',
    'chart-9': 'bg-chart-9/10 text-chart-9-text',
};

export default function IconoEnCaja({ tamano = 'md', forma = 'cuadro', tono = 'neutro', className = '', children, ...rest }) {
    return (
        <div
            {...rest}
            className={`${TAMANO[tamano] || TAMANO.md} ${forma === 'circulo' ? 'rounded-full' : 'rounded-xl'} ${TONO[tono] || TONO.neutro} flex items-center justify-center shrink-0${className ? ` ${className}` : ''}`}
        >
            {children}
        </div>
    );
}
