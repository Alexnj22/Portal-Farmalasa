import React, { memo } from 'react';

/**
 * Badge — pastilla de estado o categoría.
 *
 * Set canónico definido en D2.5 (2026-07-26) a partir de la medición real:
 * 1,258 badges escritos a mano usaban 11 radios, 9 tamaños de texto, 5 pesos
 * y 20 combinaciones de padding. Pero el 85% del texto caía en dos tamaños
 * (9px y 10px) y el 79% del peso en uno solo (font-black). El canónico ya
 * estaba ahí; faltaba nombrarlo.
 *
 *   size   sm (9px)  · md (10px, default)
 *   tone   soft (teñido, default) · solid (relleno)
 *   variant  success · warning · danger · info · neutral
 *            + chart-1…chart-9 para categorías sin significado de severidad
 *
 * SOFT vs SOLID no es decoración: son los dos patrones de contraste que el
 * sistema resolvió por separado. `soft` es `bg-X/10 + text-X-text`, que pasa
 * AA porque el texto tiene su propia variante por tema (T7). `solid` es
 * `bg-X-solid + text-white`, y usa los tokens -solid que creó N2 justamente
 * porque el blanco sobre el color base fallaba AA en 11 de 13 tokens
 * (warning 2.35:1, success 2.62:1) — y fallaba también en los temas claros.
 * Nunca mezclar: `bg-X + text-white` es el bug que N2 corrigió en 268 usos.
 *
 * La forma sale de `rounded-badge`, así que sigue al tema (redonda en Liquid,
 * tensa en Solid desde N3).
 */

const SOFT = {
    success: 'text-success-text bg-success/[0.12] border-success/30',
    warning: 'text-warning-text bg-warning/[0.14] border-warning/30',
    danger:  'text-danger-text  bg-danger/[0.12]  border-danger/30',
    info:    'text-brand-text   bg-brand/[0.12]   border-brand/30',
    neutral: 'text-content-2    bg-surface-card-hover border-border-card',
};

const SOLID = {
    success: 'text-white bg-success-solid border-transparent',
    warning: 'text-white bg-warning-solid border-transparent',
    danger:  'text-white bg-danger-solid  border-transparent',
    info:    'text-white bg-brand         border-transparent',
    neutral: 'text-white bg-chart-8-solid border-transparent',
};

// Categóricos: un color por categoría, sin significado de severidad. Cubren
// el caso real que llevó a inventar un color Tailwind distinto por vista.
//
// ESCRITOS LITERALES A PROPÓSITO, no generados en un bucle. Tailwind escanea
// strings literales en el código fuente: con `bg-chart-${i}-solid` no ve nada
// y no emite la clase. Se detectó en vivo — con el bucle, chart-2, chart-5 y
// chart-7 no existían en el CSS compilado (solo sobrevivían los que ya usaba
// otro archivo), así que esas tres variantes se habrían renderizado sin
// fondo y en silencio.
Object.assign(SOFT, {
    'chart-1': 'text-chart-1-text bg-chart-1/[0.12] border-chart-1/30',
    'chart-2': 'text-chart-2-text bg-chart-2/[0.12] border-chart-2/30',
    'chart-3': 'text-chart-3-text bg-chart-3/[0.12] border-chart-3/30',
    'chart-4': 'text-chart-4-text bg-chart-4/[0.12] border-chart-4/30',
    'chart-5': 'text-chart-5-text bg-chart-5/[0.12] border-chart-5/30',
    'chart-6': 'text-chart-6-text bg-chart-6/[0.12] border-chart-6/30',
    'chart-7': 'text-chart-7-text bg-chart-7/[0.12] border-chart-7/30',
    'chart-8': 'text-chart-8-text bg-chart-8/[0.12] border-chart-8/30',
    'chart-9': 'text-chart-9-text bg-chart-9/[0.12] border-chart-9/30',
});
Object.assign(SOLID, {
    'chart-1': 'text-white bg-chart-1-solid border-transparent',
    'chart-2': 'text-white bg-chart-2-solid border-transparent',
    'chart-3': 'text-white bg-chart-3-solid border-transparent',
    'chart-4': 'text-white bg-chart-4-solid border-transparent',
    'chart-5': 'text-white bg-chart-5-solid border-transparent',
    'chart-6': 'text-white bg-chart-6-solid border-transparent',
    'chart-7': 'text-white bg-chart-7-solid border-transparent',
    'chart-8': 'text-white bg-chart-8-solid border-transparent',
    'chart-9': 'text-white bg-chart-9-solid border-transparent',
});

const DOT = {
    success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger',
    info: 'bg-brand', neutral: 'bg-content-3',
};
Object.assign(DOT, {
    'chart-1': 'bg-chart-1', 'chart-2': 'bg-chart-2', 'chart-3': 'bg-chart-3',
    'chart-4': 'bg-chart-4', 'chart-5': 'bg-chart-5', 'chart-6': 'bg-chart-6',
    'chart-7': 'bg-chart-7', 'chart-8': 'bg-chart-8', 'chart-9': 'bg-chart-9',
});

const SIZE = {
    sm: 'text-micro px-2 py-0.5 gap-1',
    md: 'text-caption px-2.5 py-1 gap-1.5',
};
const ICON_PX = { sm: 10, md: 11 };
const DOT_PX  = { sm: 'w-[5px] h-[5px]', md: 'w-[6px] h-[6px]' };

const Badge = memo(({
    variant = 'neutral',
    tone = 'soft',
    size = 'md',
    dot = false,
    icon: Icon,
    uppercase = true,
    className = '',
    children,
    // Sin este `...rest` el componente TRAGABA en silencio cualquier atributo
    // extra. Se descubrió al migrar los chips de TabSinVenta (2026-07-28): los
    // escritos a mano llevaban `title={detalle}` con la explicación de por qué
    // el producto está en esa categoría, y al pasar al canónico el tooltip
    // habría desaparecido sin que nada fallara.
    ...rest
}) => {
    const palette = tone === 'solid' ? SOLID : SOFT;
    return (
        <span className={`inline-flex items-center rounded-badge border font-black leading-none
            ${uppercase ? 'uppercase tracking-widest' : 'tracking-[-0.005em]'}
            ${SIZE[size] || SIZE.md}
            ${palette[variant] || palette.neutral}
            ${className}`}
            {...rest}>
            {dot && <span className={`${DOT_PX[size] || DOT_PX.md} rounded-full ${DOT[variant] || DOT.neutral}`} />}
            {Icon && <Icon size={ICON_PX[size] || 11} strokeWidth={2.5} />}
            {children}
        </span>
    );
});

export default Badge;
