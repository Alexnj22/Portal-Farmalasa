import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';
import { NOMBRE_POR_ICONO, TONO_POR_ICONO, CLASE_TEXTO_POR_TONO, VARIANTES_RELLENAS } from './iconNames';

// Botón compartido — Fase T3 (AUDITORIA-TEMA-2026-07.md, aprobado en la
// lámina de componentes T2.3: normal-case en vez de mayúsculas con tracking,
// comparado lado a lado — las mayúsculas leían "dashboard 2016"). Antes cada
// vista tenía su propio patrón inline (DESIGN.md §15). Variantes:
// primary/secondary/ghost/destructive/icon, tamaños sm/md.
// ── Barrido especular: la regla (A15, 2026-07-27) ────────────────────────
// Estaba en 3 de los 11 botones de gradiente brand del proyecto, y NO en el
// canónico. No era una decisión de diseño: era dónde alguien escribió el
// botón a mano y copió el span. La regla que faltaba:
//
//   el barrido va en las variantes RELLENAS (primary, destructive) —
//   en una superficie transparente no hay nada que refleje la luz.
//
// Así queda en TODOS los primarios en vez de en 3 al azar, y se apaga solo
// en el tema sólido (que ya desactiva el movimiento decorativo).

// ── D3.3 (2026-07-27): los dos ejes que faltaban ─────────────────────────
// Antes de migrar los 939 botones escritos a mano se midió qué formas existen
// de verdad, y el canónico NO las cubría:
//
//   FORMA   rounded-xl 186 · rounded-full 109 · rounded-2xl 82 · rounded-btn 50
//           · sin radio 48 · rounded-lg 32 · rounded-3xl 6
//   RELLENO secundario 188 · OTRO COLOR 115 · brand 95 · danger 64 · fantasma 55
//
// Migrar a ciegas habría cambiado el radio de 437 botones y borrado el color de
// 115. Dos ejes nuevos, y solo dos: `shape` (el radio real se reparte entre
// "caja" y "píldora"; los seis valores distintos son ruido, no intención) y
// `tone` para los coloreados, que son categorías —éxito, aviso, un color de
// gráfico— y no jerarquía.
// `shape` FUE UN ERROR y se retira (revisado 2026-07-27 a partir de una
// pregunta del usuario: "¿no deberían ser más unificados? ¿o una versión
// redonda para liquid glass y otra rectangular para solid?").
//
// Eso es EXACTAMENTE lo que el sistema ya hacía, y yo no lo había visto:
//
//     --btn-radius   liquid glass → 9999px (píldora)
//                    solid        → 0.5rem (8px, rectangular)
//
// O sea que `rounded-btn` ya rinde píldora en vidrio y rectángulo en sólido:
// la forma la decide el TEMA, no cada botón. Al agregar `` estaba
// clavando `rounded-full` en 114 botones, que en el tema sólido se quedaban
// redondos peleando contra su propio lenguaje de forma.
//
// La forma no es un eje del componente. Los seis radios distintos que había en
// el código no eran seis decisiones: eran seis formas de ignorar el token.
const SHAPE_CLASSES = { box: 'rounded-btn', pill: 'rounded-btn' };

// ── `soft`: el relleno tenue (2026-07-27) ────────────────────────────────
// Aprobado tras medir 37 botones a mano con `bg-success/10`, `bg-danger/10`,
// `bg-warning/10`. No eran capricho: los tonos del canónico eran TODOS sólidos,
// y un relleno sólido grita. Dos botones sólidos juntos compiten por ser el
// principal; el tenue dice "esta acción es de esta categoría, pero no es la
// acción principal de la pantalla". Migrarlos a sólido habría perdido ese dato.
//
// CUÁNDO USARLO (regla, no gusto — ver DESIGN.md §15.2):
//   · Hay DOS O MÁS acciones de categoría juntas y ninguna manda.
//     Aprobar/Rechazar en una fila de solicitud: las dos importan igual.
//   · La acción es de categoría pero secundaria a un primario que ya está
//     en la misma vista. Un `primary` azul y un `soft success` conviven;
//     un `primary` y un `tone success` sólido pelean.
//   · Va dentro de una tarjeta o fila, no en la barra de acciones principal.
//
// CUÁNDO NO:
//   · Es LA acción de la pantalla → `variant="primary"`.
//   · Es destructiva y definitiva (borrar de verdad) → `variant="destructive"`
//     sólido. Atenuar una acción irreversible es mentirle al usuario.
//   · No tiene categoría, solo jerarquía → `secondary` o `ghost`.
//
// El borde va por `inset ring` y no por `border`, para que el alto no cambie
// respecto de las demás variantes (un `border` suma 2px a la caja).
const SOFT_CLASSES = {
    success: 'text-success-text bg-success/12 ring-1 ring-inset ring-success/30 hover:bg-success/20',
    warning: 'text-warning-text bg-warning/12 ring-1 ring-inset ring-warning/30 hover:bg-warning/20',
    danger:  'text-danger-text bg-danger/12 ring-1 ring-inset ring-danger/30 hover:bg-danger/20',
    brand:   'text-brand-text bg-brand/10 ring-1 ring-inset ring-brand/30 hover:bg-brand/18',
    'chart-1': 'text-chart-1-text bg-chart-1/12 ring-1 ring-inset ring-chart-1/30 hover:bg-chart-1/20',
    'chart-3': 'text-chart-3-text bg-chart-3/12 ring-1 ring-inset ring-chart-3/30 hover:bg-chart-3/20',
    'chart-4': 'text-chart-4-text bg-chart-4/12 ring-1 ring-inset ring-chart-4/30 hover:bg-chart-4/20',
    'chart-6': 'text-chart-6-text bg-chart-6/12 ring-1 ring-inset ring-chart-6/30 hover:bg-chart-6/20',
    'chart-8': 'text-chart-8-text bg-chart-8/12 ring-1 ring-inset ring-chart-8/30 hover:bg-chart-8/20',
    'chart-9': 'text-chart-9-text bg-chart-9/12 ring-1 ring-inset ring-chart-9/30 hover:bg-chart-9/20',
};

// Literales, NO plantilla: Tailwind escanea texto (ver la nota de Badge/Switch).
// Relleno sólido + texto blanco → SIEMPRE el token `-solid` (N2, DESIGN.md §6).
// Los `chart-N` crudos están calibrados para teñir (`bg-X/10` + `text-X-text`),
// no para llevar blanco encima: medido el 2026-07-29 con el escáner de D1,
// `tone="chart-3"` daba **4.23:1** contra el 4.5 que pide AA. Los `-solid` son
// el shade 600/700 de la misma familia y van de 4.60 a 5.70.
// El escáner solo encontró 2 de los 82 usos porque el resto vive en modales y
// ramas condicionales — el mismo motivo por el que N2 tuvo que buscarlos por
// código y no por captura.
// `brand` se queda crudo a propósito: mide 6.82:1 con blanco y no tiene `-solid`.
const TONE_CLASSES = {
    success: 'text-white bg-success-solid hover:brightness-110',
    warning: 'text-white bg-warning-solid hover:brightness-110',
    'chart-1': 'text-white bg-chart-1-solid hover:brightness-110',
    'chart-3': 'text-white bg-chart-3-solid hover:brightness-110',
    'chart-4': 'text-white bg-chart-4-solid hover:brightness-110',
    'chart-6': 'text-white bg-chart-6-solid hover:brightness-110',
    'chart-8': 'text-white bg-chart-8-solid hover:brightness-110',
    'chart-9': 'text-white bg-chart-9-solid hover:brightness-110',
    danger:  'text-white bg-danger-solid hover:brightness-110',
    brand:   'text-white bg-brand hover:brightness-110',
};

const VARIANT_CLASSES = {
    primary: `text-white bg-gradient-to-b from-brand-hover to-brand
        shadow-[var(--shadow-glass-1)]
        hover:from-brand hover:to-brand-dark
        hover:shadow-[var(--shadow-glass-1)]
        hover:translate-y-[var(--lift-hover)]`,
    secondary: `text-content bg-gradient-to-b from-surface-card to-surface-card-hover
        border border-border-card shadow-sm
        hover:shadow-md hover:translate-y-[var(--lift-hover)]`,
    ghost: `text-content-2 bg-transparent hover:bg-surface-card-hover hover:text-content`,
    destructive: `text-white bg-gradient-to-b from-danger-light to-danger
        shadow-[var(--shadow-glass-1)]
        hover:shadow-[var(--shadow-glass-1)]
        hover:translate-y-[var(--lift-hover)]`,
};

// ── Tamaños canónicos (D2.5, 2026-07-26) ─────────────────────────────────
// Antes eran 2 (sm/md) contra las 9 alturas distintas que usaban los 291
// botones escritos a mano — migrarlos a un componente con 2 tamaños habría
// cambiado el tamaño de 639 botones de forma arbitraria. Se midieron los
// clusters reales y salieron CUATRO, cada uno con una razón de ser:
//
//   xs  h-6/h-7  (24 usos)  acción inline dentro de una fila o chip
//   sm  h-8/h-9  (25 usos)  toolbar, filtros, acciones secundarias
//   md  h-10/h-11 (20 usos) acción principal — el default
//   lg  h-12/48px (13 usos) CTA de hero y botón full-width de móvil
//
// La altura sale de --control-h (D2.3): reacciona al viewport con mouse y
// tiene piso en táctil, así que NINGÚN tamaño queda bajo el mínimo del dedo
// — por eso cada uno usa max() en vez de un alto fijo. Es la diferencia
// entre una escala de tamaños y una lista de números sueltos.
//
// 2026-07-28: esto ANTES no era cierto, aunque el comentario lo afirmara.
// `--control-h` sí sube a 44px en táctil, pero `sm` y `xs` se derivan
// restándole 6 y 12 — así que daban 38px y 32px en un teléfono. El piso real
// es `--tap-min` (0 en escritorio, 44px en táctil) y va DENTRO del max().
// Medido en iPhone 13 antes del cambio: 20 de 87 controles bajo 44px.
const SIZE_CLASSES = {
    xs: 'h-[max(28px,var(--tap-min),calc(var(--control-h)-12px))] px-2.5 text-micro gap-1',
    sm: 'h-[max(34px,var(--tap-min),calc(var(--control-h)-6px))] px-3.5 text-[12.5px] gap-1.5',
    md: 'h-[max(var(--tap-min),var(--control-h))] px-[18px] text-body gap-1.5',
    lg: 'h-[max(48px,calc(var(--control-h)+8px))] px-6 text-body-lg gap-2',
};

// `iconOnly` REEMPLAZA a SIZE_CLASSES, no lo complementa (ver el `?:` de más
// abajo) — así que estas clases tienen que traer también la ALTURA. Hasta el
// 2026-07-28 solo traían `w-` y `px-0`: el botón salía con el ancho correcto y
// el alto del ícono. Donde el contenedor padre lo estiraba se veía cuadrado y
// nadie lo notó; donde no, quedaba una pastilla de 44×15. Así estaban los tres
// botones de abrir/cerrar el menú, medidos en un iPhone 13.
const ICON_ONLY_SIZE = {
    xs: 'w-[max(28px,var(--tap-min),calc(var(--control-h)-12px))] h-[max(28px,var(--tap-min),calc(var(--control-h)-12px))] px-0',
    sm: 'w-[max(34px,var(--tap-min),calc(var(--control-h)-6px))] h-[max(34px,var(--tap-min),calc(var(--control-h)-6px))] px-0',
    md: 'w-[max(var(--tap-min),var(--control-h))] h-[max(var(--tap-min),var(--control-h))] px-0',
    lg: 'w-[max(48px,calc(var(--control-h)+8px))] h-[max(48px,calc(var(--control-h)+8px))] px-0',
};

const ICON_PX = { xs: 12, sm: 14, md: 15, lg: 17 };


const Button = memo(({
    variant = 'primary',
    shape = 'box',
    tone = null,
    // `soft` solo tiene sentido junto a `tone`: es la MISMA categoría con menos
    // peso, no una categoría distinta. Sin `tone` se ignora.
    soft = false,
    size = 'md',
    icon: Icon,
    iconOnly = false,
    loading = false,
    disabled = false,
    type = 'button',
    className = '',
    children,
    ...rest
}) => {
    const isDisabled = disabled || loading;
    // Solo cuando NO hay texto y nadie dio nombre. Si el llamador pasó
    // `aria-label` o `title`, el suyo manda — este es el piso.
    const nombreIcono = Icon?.displayName ?? Icon?.name;
    const nombreAuto = iconOnly && !rest['aria-label'] && !rest.title
        ? NOMBRE_POR_ICONO[nombreIcono]
        : undefined;

    // ── El tono por ÍCONO, aplicado al ícono y no al relleno (2026-07-30) ──
    // Auditados los 193 `iconOnly` del proyecto: 18 íconos se dibujaban con 2 a
    // 4 colores distintos. El arreglo es un mapa y no N ediciones — mismo
    // principio que `NOMBRE_POR_ICONO`.
    //
    // Se tiñe el ÍCONO, no el botón. `TONE_CLASSES` es relleno sólido con texto
    // blanco, así que aplicar el tono como relleno habría convertido cada fila
    // de acciones discretas en una hilera de bloques de color. En una superficie
    // neutra el color identifica la categoría sin gritar — es la misma regla que
    // `TabBarAction quiet` ya seguía.
    //
    // Tres cosas lo desactivan, y las tres a propósito:
    //   · `tone` explícito — el llamador manda; esto es el piso, no el techo.
    //   · variante RELLENA — el fondo ya es del color y el ícono va en blanco.
    //     Es lo que preserva el `Check` en `destructive` de un "confirmar
    //     borrado", que va en rojo aunque el mapa diga que un check es verde.
    //   · botón CON texto — ahí el color sale del papel del botón en el
    //     formulario, no de su ícono.
    const claseTono = (iconOnly && !tone && !VARIANTES_RELLENAS.has(variant))
        ? CLASE_TEXTO_POR_TONO[TONO_POR_ICONO[nombreIcono]]
        : undefined;
    return (
        <button
            type={type}
            aria-label={nombreAuto}
            disabled={isDisabled}
            // `min-w`/`min-h` y no `w`/`h`: el piso del dedo tiene que sobrevivir
            // a `${className}`, que va ÚLTIMO y por eso puede pisar la clase de
            // tamaño. Medido en WebKit iPhone 13 el 2026-08-06: 29 botones del
            // tablero salían a 42×42 —dos píxeles por debajo del mínimo— porque
            // su llamador pasaba su propio `w-*`/`h-*` y ganaba por orden.
            // `min-width` y `width` son propiedades DISTINTAS, así que acá no hay
            // pelea de especificidad: el mínimo simplemente manda. En escritorio
            // `--tap-min` vale 0 y esto no hace nada.
            //
            // `active:` sube a las clases BASE por el mismo motivo (2026-08-06).
            // Estaba escrito dentro de `primary` y `destructive`, así que
            // `secondary`, `ghost` y los diez `tone` rellenos no tenían NINGÚN
            // acuse de recibo al toque: su única reacción era el `hover:`, que
            // en un teléfono no existe. En escritorio no se notaba porque el
            // puntero sí dispara el hover; en el teléfono el botón parecía
            // muerto hasta que la acción terminaba. Acá cubre a los catorce.
            // `active:translate-y-0` viaja con él porque es lo que cancela el
            // lift del hover en los que sí lo tienen.
            // ── `relative` sólo si quien llama no pidió otra posición ──────
            // `relative` y `absolute` son utilidades de la MISMA especificidad,
            // así que no decide el orden en el string: decide el orden en la
            // hoja generada, y Tailwind emite `.relative` DESPUÉS de
            // `.absolute` (medido en el CSS de producción: 13190 vs 13240).
            // O sea que la base del canónico le ganaba siempre a la del
            // consumidor, y un botón con `className="absolute top-2 right-2"`
            // caía al flujo. Mordió en dos sitios: la ✕ de una notificación
            // —reportado, «no entiendo cuál estoy quitando», porque aterrizaba
            // abajo a la izquierda— y el cerrar del visor de fotos.
            //
            // No alcanza con documentar «no le pases absolute»: es una regla
            // que sólo vive en prosa. El canónico cede la posición cuando se la
            // piden, que es lo que el consumidor espera al escribirla.
            className={`group ${/\b(absolute|fixed|sticky|static)\b/.test(className) ? '' : 'relative'} overflow-hidden inline-flex items-center justify-center font-bold tracking-[-0.005em]
                min-w-[var(--tap-min)] min-h-[var(--tap-min)]
                active:translate-y-0 active:scale-[0.98]
                transition-[transform,box-shadow,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-spring)] whitespace-nowrap
                disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none
                ${SHAPE_CLASSES[shape] || SHAPE_CLASSES.box}
                ${tone
                    ? (soft ? (SOFT_CLASSES[tone] || SOFT_CLASSES.brand)
                            : (TONE_CLASSES[tone] || VARIANT_CLASSES.primary))
                    : (VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary)}
                ${tone && !soft ? 'hover:translate-y-[var(--lift-hover)]' : ''}
                ${iconOnly ? (ICON_ONLY_SIZE[size] || ICON_ONLY_SIZE.md) : (SIZE_CLASSES[size] || SIZE_CLASSES.md)}
                ${className}`}
            {...rest}
        >
            {/* El barrido va solo en superficies RELLENAS. En `soft` el fondo
                es un tinte translúcido: no hay nada que refleje la luz, y el
                barrido se vería como una mancha cruzando. Misma regla que ya
                dejaba fuera a `ghost` y `secondary`. */}
            {loading ? (
                <Loader2 size={ICON_PX[size] ?? 15} className="relative animate-spin" />
            ) : (
                Icon && <Icon size={ICON_PX[size] ?? 15} strokeWidth={2.5}
                    className={`relative ${claseTono || ''}`} />
            )}
            {!iconOnly && <span className="relative">{children}</span>}
        </button>
    );
});

export default Button;
