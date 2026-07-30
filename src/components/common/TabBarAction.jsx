import React, { memo } from 'react';
import { NOMBRE_POR_ICONO, TONO_POR_ICONO, CLASE_TEXTO_POR_TONO } from './iconNames';

/**
 * TabBarAction — acción dentro de la barra flotante de vista (`ViewTabBar`).
 *
 * Creado en D3.10 (2026-07-27). Al consolidar las 13 barras reescritas a mano
 * quedó a la vista que cada vista también escribía sus botones de acción, y con
 * los mismos tres problemas en todas:
 *
 *   · `shadow-glow-*` fijo — el halo se dibuja igual sobre fondo claro que
 *     oscuro, así que en los temas sólidos no se ve luminoso, se ve sucio.
 *   · `rounded-btn` (14px) dentro de una barra donde todo lo demás es píldora:
 *     dos lenguajes de forma en el mismo control.
 *   · gradiente `from-brand to-brand-hover` a mano, distinto en cada vista.
 *
 * Dos variantes, aprobadas sobre lámina en los 4 temas:
 *
 *   primary  una sola por barra — la acción que más se hace. Relleno plano del
 *            token de marca, sin gradiente ni halo.
 *   quiet    el resto. Superficie neutra y el COLOR solo en el ícono, que es lo
 *            que identifica la categoría sin competir con la primaria.
 *
 * Sobre el modo oscuro: la superficie `quiet` va MÁS OSCURA que la barra, no
 * más clara. Un velo blanco sobre riel oscuro se lee como una pastilla blanca
 * y rompe el modo oscuro — el usuario lo señaló mirando la lámina. Por eso
 * `--tabaction-bg` no es "blanco al N%" sino un valor propio por tema.
 */


const BASE = `rounded-full shrink-0 whitespace-nowrap
    inline-flex items-center justify-center gap-2 border
    text-micro md:text-caption font-black uppercase tracking-widest
    transition-[background-color,border-color,color,transform] duration-200
    ease-[cubic-bezier(0.23,1,0.32,1)]
    hover:-translate-y-px active:translate-y-0 active:scale-[0.97]
    disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0`;

/**
 * `sm` existe desde que las acciones se mudaron a `FilterBar` (2026-07-30). La
 * píldora de filtros mide 52px y esa altura es su contrato con §17 —"son 52px
 * tenga una ranura o cinco"—: 36 del control + 8 de aire arriba y abajo. Un
 * botón de 44 la habría estirado a 60 y desalineado de todas las demás.
 *
 * No baja del mínimo táctil porque en táctil esta píldora NO se dibuja: ahí
 * `FilterBar` es la barra flotante, donde los botones miden 44 y 48.
 */
const SIZE = {
    md: 'h-11 px-4 md:px-[18px]',
    sm: 'h-9 px-3.5',
};

// ── El ícono SOLO va más grande (2026-07-30) ─────────────────────────────
// Los 14px están calibrados para ir al lado de un texto: ahí el ícono acompaña
// y el rótulo es lo que se lee. Sin texto, ese mismo ícono queda perdido dentro
// de un botón de 36 o 44px — el usuario lo reportó del ojo de Ventas: "el ícono
// no se ve, es demasiado pequeño". Sin rótulo el ícono ES el botón, así que
// ocupa la proporción que le corresponde.
const ICONO_PX      = { md: 14, sm: 14 };
const ICONO_PX_SOLO = { md: 20, sm: 18 };

// `soloIcono` REEMPLAZA a SIZE, no lo complementa. Es la misma lección que
// `Button` ya tenía escrita para su `iconOnly`, y volver a tropezarla costó:
// se intentó apagar el relleno con un `px-0` en el `className` del llamador y
// **perdió contra el `px-3.5` del tamaño** — el orden lo decide la hoja de
// estilos, no el atributo `class`. Resultado medido: un botón de 36px con 28 de
// relleno, y el SVG aplastado a **6×18** en vez de 18×18. Que es exactamente lo
// que el usuario veía como "el ícono es demasiado pequeño".
const SIZE_SOLO = {
    md: 'w-11 h-11 px-0',
    sm: 'w-9 h-9 px-0',
};

const TabBarAction = memo(({
    icon: Icon,
    children,
    variant = 'quiet',
    // Sin `tone` explícito lo decide el ÍCONO, no el `brand` por defecto de
    // antes: el ojo se veía de cuatro colores distintos según la pantalla. Ver
    // `TONO_POR_ICONO`. Quien pase `tone` gana el suyo — esto es el piso.
    tone,
    size = 'md',
    // Sin rótulo: el botón se vuelve cuadrado y el ícono crece a su proporción.
    soloIcono = false,
    label,
    className = '',
    // `as="a"` para las acciones que NAVEGAN fuera del portal. Agregado el
    // 2026-07-27 al encontrar en FacturacionView un `<a>` que reconstruía las 9
    // clases de `BASE` a mano, solo porque el canónico estaba clavado a
    // `<button>`. Un enlace que se ve como botón tiene que seguir siendo un
    // enlace: es lo que permite abrirlo en otra pestaña y lo que un lector de
    // pantalla anuncia como "enlace", no como "botón".
    as: Tag = 'button',
    ...rest
}) => {
    const isPrimary = variant === 'primary';
    const esBoton = Tag === 'button';
    const nombreIcono = Icon?.displayName ?? Icon?.name;
    const tonoEfectivo = tone || TONO_POR_ICONO[nombreIcono] || 'brand';

    return (
        <Tag
            type={esBoton ? 'button' : undefined}
            aria-label={label
                || (typeof children === 'string' ? children : undefined)
                // Mismo piso que `Button` (v2.117.0): si no hay etiqueta ni texto,
                // el nombre sale del ícono en vez de quedar en nada.
                || NOMBRE_POR_ICONO[nombreIcono]}
            className={`${BASE} ${soloIcono ? (SIZE_SOLO[size] || SIZE_SOLO.md) : (SIZE[size] || SIZE.md)} ${className}
                ${isPrimary
                    ? 'bg-brand border-brand text-white hover:bg-brand-hover hover:border-brand-hover'
                    : 'bg-[var(--tabaction-bg)] border-[var(--tabaction-border)] text-content-2 hover:bg-[var(--tabaction-hover)] hover:text-content'}`}
            {...rest}
        >
            {/* En `quiet` el color vive solo acá: identifica la categoría sin
                competir con la acción primaria. En `primary` el botón entero ya
                es del color, así que el ícono va en blanco con el texto. */}
            {Icon && <Icon
                size={(soloIcono ? ICONO_PX_SOLO : ICONO_PX)[size] || (soloIcono ? 18 : 14)}
                strokeWidth={2.5}
                // `shrink-0`: un SVG es un elemento flex más y se deja aplastar.
                className={`shrink-0 ${isPrimary ? '' : (CLASE_TEXTO_POR_TONO[tonoEfectivo] || CLASE_TEXTO_POR_TONO.brand)}`} />}
            {children && <span className="hidden sm:inline">{children}</span>}
        </Tag>
    );
});

export default TabBarAction;
