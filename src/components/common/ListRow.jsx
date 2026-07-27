import React, { memo, forwardRef } from 'react';

/**
 * ListRow — fila de una lista: ícono, contenido y algo al final.
 *
 * Canónico creado el 2026-07-27, revisando lo que había quedado pendiente. Yo
 * mismo había dicho que estas filas eran "composición real" y que un canónico
 * sería un cajón de sastre. **Estaba equivocado, y lo dice la medición**: son la
 * misma anatomía repetida, y lo único que cambia es el relleno.
 *
 *   padding vertical   py-3 ×6 · py-2.5 ×5 · py-3.5 ×4 · py-2 ×1 · py-1.5 ×1
 *   caja de ícono      w-7 ×8 · w-8 ×7 · w-9 ×3 · w-6 ×1
 *
 * Y cuatro archivos —`AppLayout`, `CrearRutaModal`, `SidebarSettingsMenu`,
 * `ThemeToggle`— tenían **la cadena de clases idéntica**.
 *
 * Es el mismo hallazgo que con los switches (8 tamaños de perilla), los botones
 * (6 radios) y los aros (171 escritos a mano): no eran seis decisiones, es que
 * nadie había nombrado la fila. Tres densidades, sacadas de los tres grupos
 * reales, no de una escala inventada.
 *
 * Sirve como `<button>` (si recibe `onClick`), como `<a>` (si recibe `href`) o
 * como `<div>` — una fila que no hace nada no debería ser enfocable.
 *
 * `onDark` existe por una razón concreta y no es un capricho: las filas de los
 * flyouts del sidebar viven sobre una superficie **oscura en los cuatro temas**
 * (decisión tomada antes: un popover anclado al sidebar se queda oscuro, si no
 * queda un panel claro colgando de un panel oscuro). Sus colores no pueden
 * salir de los tokens de superficie, que sí cambian por tema. Antes eso
 * obligaba a escribir la fila a mano; ahora el canónico lo sabe.
 */

const DENSIDAD = {
    sm: { fila: 'px-3 py-2 gap-2.5',   caja: 'w-7 h-7',  icono: 13 },
    md: { fila: 'px-3 py-2.5 gap-3',   caja: 'w-8 h-8',  icono: 15 },
    lg: { fila: 'px-4 py-3.5 gap-3',   caja: 'w-9 h-9',  icono: 17 },
};

// `forwardRef` porque varias filas son el disparador de un popover y necesitan
// medir su propia posición (ThemeToggle, SidebarSettingsMenu). Sin esto el ref
// se perdía en silencio y el popover se anclaba mal.
const ListRow = memo(forwardRef(({
    icon: Icono,
    iconClass = 'text-content-2',
    iconBoxClass,
    title,
    subtitle,
    trailing,
    density = 'md',
    active = false,
    disabled = false,
    onClick,
    href,
    onDark = false,
    className = '',
    children,
    ...rest
}, ref) => {
    const d = DENSIDAD[density] || DENSIDAD.md;
    const interactiva = !!(onClick || href);
    const Tag = href ? 'a' : (onClick ? 'button' : 'div');

    return (
        <Tag
            ref={ref}
            {...(Tag === 'button' ? { type: 'button', onClick, disabled } : {})}
            {...(Tag === 'a' ? { href } : {})}
            {...(active && interactiva ? { 'aria-current': 'true' } : {})}
            className={`w-full flex items-center text-left rounded-btn border
                transition-[background-color,border-color,color] duration-200
                ${d.fila}
                ${onDark
                    ? (active
                        ? 'bg-white/10 border-white/15 text-white/90'
                        : `bg-white/5 border-white/[0.08] text-white/80 ${interactiva ? 'hover:bg-white/10 hover:border-white/15' : ''}`)
                    : (active
                        ? 'bg-surface-tab-active border-border-card text-content'
                        : `border-transparent text-content-2 ${interactiva ? 'hover:bg-surface-card-hover' : ''}`)}
                ${disabled ? 'opacity-45 cursor-not-allowed' : (interactiva ? 'cursor-pointer' : '')}
                ${className}`}
            {...rest}
        >
            {Icono && (
                <span className={`${d.caja} shrink-0 rounded-btn border flex items-center justify-center
                    ${iconBoxClass ?? (onDark ? 'bg-white/10 border-white/[0.08]' : 'bg-surface-card-hover border-border-card')}
                    ${onDark ? 'text-white/70' : iconClass}`}>
                    <Icono size={d.icono} strokeWidth={2.25} />
                </span>
            )}

            {/* `min-w-0` es lo que permite que el texto se trunque en vez de
                empujar el elemento final fuera de la fila. Sin esto, un nombre
                largo saca el badge de la derecha fuera del contenedor. */}
            <span className="min-w-0 flex-1">
                {title && <span className="block text-body-sm font-bold truncate">{title}</span>}
                {subtitle && <span className={`block text-label font-medium truncate ${onDark ? 'text-white/45' : 'text-content-3'}`}>{subtitle}</span>}
                {children}
            </span>

            {trailing && <span className="shrink-0 flex items-center gap-2">{trailing}</span>}
        </Tag>
    );
}));

ListRow.displayName = 'ListRow';

export default ListRow;
