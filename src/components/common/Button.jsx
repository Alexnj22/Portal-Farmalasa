import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';

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
const HAS_SWEEP = new Set(['primary', 'destructive']);

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
const SHAPE_CLASSES = {
    box:  'rounded-btn',
    pill: 'rounded-full',
};

// Literales, NO plantilla: Tailwind escanea texto (ver la nota de Badge/Switch).
const TONE_CLASSES = {
    success: 'text-white bg-success-solid hover:brightness-110',
    warning: 'text-white bg-warning-solid hover:brightness-110',
    'chart-1': 'text-white bg-chart-1 hover:brightness-110',
    'chart-3': 'text-white bg-chart-3 hover:brightness-110',
    'chart-4': 'text-white bg-chart-4 hover:brightness-110',
    'chart-6': 'text-white bg-chart-6 hover:brightness-110',
    'chart-8': 'text-white bg-chart-8 hover:brightness-110',
    'chart-9': 'text-white bg-chart-9 hover:brightness-110',
};

const VARIANT_CLASSES = {
    primary: `text-white bg-gradient-to-b from-brand-hover to-brand
        shadow-[var(--shadow-glass-1)]
        hover:from-brand hover:to-brand-dark
        hover:shadow-[var(--shadow-glass-1)]
        hover:-translate-y-px active:translate-y-0 active:scale-[0.98]`,
    secondary: `text-content bg-gradient-to-b from-surface-card to-surface-card-hover
        border border-border-card shadow-sm
        hover:shadow-md hover:-translate-y-px`,
    ghost: `text-content-2 bg-transparent hover:bg-surface-card-hover hover:text-content`,
    destructive: `text-white bg-gradient-to-b from-danger-light to-danger
        shadow-[var(--shadow-glass-1)]
        hover:shadow-[var(--shadow-glass-1)]
        hover:-translate-y-px active:translate-y-0 active:scale-[0.98]`,
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
// tiene piso de 44px en táctil, así que NINGÚN tamaño queda bajo el mínimo
// del dedo — por eso xs y sm usan max() contra su propio piso en vez de un
// alto fijo. Es la diferencia entre una escala de tamaños y una lista de
// números sueltos.
const SIZE_CLASSES = {
    xs: 'h-[max(28px,calc(var(--control-h)-12px))] px-2.5 text-micro gap-1',
    sm: 'h-[max(34px,calc(var(--control-h)-6px))] px-3.5 text-[12.5px] gap-1.5',
    md: 'h-[var(--control-h)] px-[18px] text-body gap-1.5',
    lg: 'h-[max(48px,calc(var(--control-h)+8px))] px-6 text-body-lg gap-2',
};

const ICON_ONLY_SIZE = {
    xs: 'w-[max(28px,calc(var(--control-h)-12px))] px-0',
    sm: 'w-[max(34px,calc(var(--control-h)-6px))] px-0',
    md: 'w-[var(--control-h)] px-0',
    lg: 'w-[max(48px,calc(var(--control-h)+8px))] px-0',
};

const ICON_PX = { xs: 12, sm: 14, md: 15, lg: 17 };

const Button = memo(({
    variant = 'primary',
    shape = 'box',
    tone = null,
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
    return (
        <button
            type={type}
            disabled={isDisabled}
            className={`group relative overflow-hidden inline-flex items-center justify-center font-bold tracking-[-0.005em]
                transition-[transform,box-shadow,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] whitespace-nowrap
                disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none
                ${SHAPE_CLASSES[shape] || SHAPE_CLASSES.box}
                ${tone ? (TONE_CLASSES[tone] || VARIANT_CLASSES.primary)
                       : (VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary)}
                ${iconOnly ? (ICON_ONLY_SIZE[size] || ICON_ONLY_SIZE.md) : (SIZE_CLASSES[size] || SIZE_CLASSES.md)}
                ${className}`}
            {...rest}
        >
            {(tone || HAS_SWEEP.has(variant)) && !isDisabled && <span className="sweep" aria-hidden="true" />}
            {loading ? (
                <Loader2 size={ICON_PX[size] ?? 15} className="relative animate-spin" />
            ) : (
                Icon && <Icon size={ICON_PX[size] ?? 15} strokeWidth={2.25} className="relative" />
            )}
            {!iconOnly && <span className="relative">{children}</span>}
        </button>
    );
});

export default Button;
