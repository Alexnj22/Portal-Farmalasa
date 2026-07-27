import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';

// Botón compartido — Fase T3 (AUDITORIA-TEMA-2026-07.md, aprobado en la
// lámina de componentes T2.3: normal-case en vez de mayúsculas con tracking,
// comparado lado a lado — las mayúsculas leían "dashboard 2016"). Antes cada
// vista tenía su propio patrón inline (DESIGN.md §15). Variantes:
// primary/secondary/ghost/destructive/icon, tamaños sm/md.
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
            className={`inline-flex items-center justify-center rounded-btn font-bold tracking-[-0.005em]
                transition-[transform,box-shadow,background-color,color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] whitespace-nowrap
                disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none
                ${VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary}
                ${iconOnly ? (ICON_ONLY_SIZE[size] || ICON_ONLY_SIZE.md) : (SIZE_CLASSES[size] || SIZE_CLASSES.md)}
                ${className}`}
            {...rest}
        >
            {loading ? (
                <Loader2 size={ICON_PX[size] ?? 15} className="animate-spin" />
            ) : (
                Icon && <Icon size={ICON_PX[size] ?? 15} strokeWidth={2.25} />
            )}
            {!iconOnly && children}
        </button>
    );
});

export default Button;
