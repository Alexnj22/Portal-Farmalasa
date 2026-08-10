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

// Las alturas pasan por `max(…, var(--tap-min))`: en escritorio `--tap-min` es
// 0 y quedan en 28/36px como siempre; en táctil sube a 44px, que es el piso del
// dedo (DESIGN.md §25). Medido en iPhone 13 el 2026-07-29, un segmentado de
// "Horas/Días" daba 68x28 y 54x28 — el mismo control que en escritorio está
// bien dimensionado.
const SIZE = {
    sm: { riel: 'p-0.5 gap-0.5', op: 'h-[max(28px,var(--tap-min))] px-3 text-micro',   icono: 11 },
    md: { riel: 'p-1 gap-0.5',   op: 'h-[max(36px,var(--tap-min))] px-4 text-caption', icono: 13 },
};

// Literales, no plantilla: Tailwind escanea texto (ver la nota de Badge/Switch).
const ACTIVO = {
    brand:   'bg-brand text-white',
    success: 'bg-success-solid text-white',
    warning: 'bg-warning-solid text-white',
    danger:  'bg-danger-solid text-white',
    neutro:  'bg-surface-tab-active text-content',
    // Estaba migrado A MEDIAS: chart-3/8/9 usaban `-solid` y chart-1/4/6 el
    // color crudo, que con blanco encima no llega a AA (ver Button.TONE_CLASSES).
    'chart-1': 'bg-chart-1-solid text-white',
    'chart-3': 'bg-chart-3-solid text-white', 'chart-4': 'bg-chart-4-solid text-white',
    'chart-6': 'bg-chart-6-solid text-white',
    'chart-8': 'bg-chart-8-solid text-white',
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
                    // `max-w-full` + `flex-wrap`: con cuatro opciones de rótulo
                    // largo el riel medía más que la pantalla y las últimas se
                    // salían —medido en Comunicados, «Todos·Sucursal·Cargo·
                    // Personal» sobraba 42px—. Envolver en dos renglones es
                    // mejor que un carril: son cuatro opciones cortas, y una
                    // opción que hay que descubrir deslizando es una opción que
                    // no se ve.
                    //
                    // Pero con DOS opciones envolver nunca es la respuesta: es
                    // un interruptor, y partido en dos renglones deja de leerse
                    // como uno —«HORAS» arriba y «DÍAS» abajo, reportado el
                    // 2026-08-10 en el encabezado de Ventas por día, donde
                    // además estiraba la cabecera del widget a 85px—. Con dos
                    // se aprieta el resto de la fila, que es lo que cede.
                    : `inline-flex ${options.length > 2 ? 'flex-wrap' : 'flex-nowrap'} items-center justify-center max-w-full rounded-btn
                       border border-border-card bg-surface-card-hover shadow-sm shrink-0 ${s.riel}`}
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
                        // `active:` — el acuse del toque. En un teléfono no hay
                        // `hover:`: sin esto, lo único que confirmaba el toque
                        // era el destello gris del navegador, que además
                        // `index.css` apaga en cuanto un control declara
                        // `active:`. Este componente solo eran **62 de los 74**
                        // controles mudos de Permisos: el alcance de cada
                        // módulo se elige acá.
                        className={`inline-flex items-center justify-center gap-1.5
                            ${stacked ? 'rounded-card' : 'rounded-btn'}
                            font-black uppercase tracking-widest
                            transition-[background-color,color,border-color,transform] duration-[var(--dur-base)]
                            active:scale-[0.97]
                            disabled:opacity-40 disabled:cursor-not-allowed
                            ${enBloque
                                ? `w-full px-3 text-caption border ${stacked ? 'flex-col gap-1.5 py-3' : 'h-11'}`
                                : `whitespace-nowrap ${s.op}`}
                            ${activa
                                ? (ACTIVO[op.tone || tone] || ACTIVO.brand) + ' shadow-sm'
                                    + (enBloque ? ' border-transparent' : '')
                                /* `content-2` y no `content-3`: en el tono más
                                   tenue, una opción sin elegir casi no se leía
                                   sobre la superficie de la tarjeta —reportado
                                   sobre el selector de forma de pago—. La
                                   jerarquía la sigue marcando el relleno del
                                   activo, no el desvanecerse del resto. */
                                : 'text-content-2 hover:text-content'
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
