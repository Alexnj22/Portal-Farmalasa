import React, { memo } from 'react';

/**
 * SegmentedControl — elegir UNA opción de un grupo pequeño y fijo.
 *
 * Canónico creado en D3.3 (2026-07-27). Salió de medir los botones que el
 * migrador no podía convertir: de 270 con `className` dinámica, **123 (45%)
 * tenían la forma `X === 'valor' ? activo : inactivo`**. Eso no es un `Button`
 * con estado — es "una de N está seleccionada", que es otro control.
 *
 * Es el cuarto caso de la misma familia en esta semana: los switches, la barra
 * de búsqueda, el filtro de Auditoría y ahora esto. Cada vez, lo que parecía un
 * caso especial resultó ser **un canónico que faltaba**.
 *
 * Cuándo NO usarlo:
 *   · Si las opciones son muchas o vienen de datos → `LiquidSelect`.
 *   · Si es navegación entre secciones de una vista → los `tabs` de `ViewTabBar`.
 *   · Si cada opción dispara una acción distinta → son botones sueltos.
 *
 * Cada opción puede llevar su propio `tone`. No es adorno: en el selector de
 * alcance de permisos, el color distingue "Todos" de "Mi Sucursal" y esa
 * distinción es información, no decoración. El `tone` del grupo queda como
 * valor por defecto.
 *
 * La FORMA no es una prop, igual que en `Button`: `rounded-btn` ya rinde
 * píldora en liquid glass y rectángulo en sólido (`--btn-radius`). Los 54 que
 * estaban escritos con `rounded-full` fijo se veían redondos en el tema sólido,
 * peleando contra su propio lenguaje de forma.
 */

const SIZE = {
    sm: { riel: 'p-0.5 gap-0.5', op: 'h-7 px-3 text-micro',   icono: 11 },
    md: { riel: 'p-1 gap-0.5',   op: 'h-9 px-4 text-caption', icono: 13 },
};

// Literales, no plantilla: Tailwind escanea texto (ver la nota de Badge/Switch).
const ACTIVO = {
    brand:   'bg-brand text-white',
    success: 'bg-success-solid text-white',
    warning: 'bg-warning-solid text-white',
    danger:  'bg-danger-solid text-white',
    neutro:  'bg-surface-tab-active text-content',
    'chart-1': 'bg-chart-1 text-white', 'chart-2': 'bg-chart-2 text-white',
    'chart-3': 'bg-chart-3-solid text-white', 'chart-4': 'bg-chart-4 text-white',
    'chart-5': 'bg-chart-5 text-white', 'chart-6': 'bg-chart-6 text-white',
    'chart-7': 'bg-chart-7 text-white', 'chart-8': 'bg-chart-8-solid text-white',
    'chart-9': 'bg-chart-9-solid text-white',
};

const SegmentedControl = memo(({
    options = [],
    value,
    onChange,
    size = 'md',
    tone = 'brand',
    disabled = false,
    label,
    // `block`: las opciones se estiran y se apilan en grilla, en vez de ir en un
    // riel compacto. Se agregó al revisar los pendientes (2026-07-27): había 8
    // "tarjetas de elección" que dejé fuera diciendo que eran otro control, y
    // al mirarlas de nuevo eran ESTO con otra disposición. La diferencia era el
    // layout, no el concepto — y confundir una cosa con la otra es lo que hace
    // que se escriban controles nuevos sin necesidad.
    layout = 'inline',
    columns = 2,
    // `stacked`: en layout de bloque, el ícono va ARRIBA del texto en vez de al
    // lado. Se agregó el 2026-07-28 al migrar el selector de tipo de solicitud
    // (`EmployeeRequestsView`), que son seis tarjetas verticales. El layout de
    // bloque existía pero solo en horizontal, así que sin esto la migración
    // habría cambiado la forma de las tarjetas — que es justo lo que D3.3
    // intenta NO hacer. Los cuatro usos previos de `block` son horizontales y
    // no cambian.
    stacked = false,
    className = '',
}) => {
    const s = SIZE[size] || SIZE.md;
    const enBloque = layout === 'block';

    return (
        // `radiogroup` y no una fila de botones sueltos: es la semántica real
        // —una sola opción activa— y es lo que un lector de pantalla necesita
        // para anunciar "2 de 3" en vez de leer tres botones sin relación.
        <div role="radiogroup" aria-label={label}
            className={`${enBloque
                    ? `grid gap-2 ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2'}`
                    : `inline-flex items-center rounded-btn border border-border-card
                       bg-surface-card-hover shadow-sm shrink-0 ${s.riel}`}
                ${className} ${disabled ? 'opacity-45 pointer-events-none' : ''}`}>
            {options.map(op => {
                const activa = op.value === value;
                const Icono = op.icon;
                return (
                    <button
                        key={op.value}
                        type="button"
                        role="radio"
                        aria-checked={activa}
                        disabled={disabled || op.disabled}
                        onClick={() => !disabled && !op.disabled && onChange?.(op.value)}
                        className={`inline-flex items-center justify-center gap-1.5
                            ${stacked ? 'rounded-card' : 'rounded-btn'}
                            font-black uppercase tracking-widest
                            transition-[background-color,color,border-color] duration-200
                            disabled:opacity-40 disabled:cursor-not-allowed
                            ${enBloque
                                ? `w-full px-3 text-caption border ${stacked ? 'flex-col gap-1.5 py-3' : 'h-11'}`
                                : `whitespace-nowrap ${s.op}`}
                            ${activa
                                ? (ACTIVO[op.tone || tone] || ACTIVO.brand) + ' shadow-sm'
                                    + (enBloque ? ' border-transparent' : '')
                                : 'text-content-3 hover:text-content-2'
                                    + (enBloque ? ' bg-surface-card border-border-card hover:border-brand/40' : '')}`}>
                        {Icono && <Icono size={stacked ? 18 : s.icono} strokeWidth={stacked ? 1.8 : 2.5} />}
                        {op.label}
                    </button>
                );
            })}
        </div>
    );
});

export default SegmentedControl;
