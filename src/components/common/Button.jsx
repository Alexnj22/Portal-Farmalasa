import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';

// Botón compartido — Fase T3 (AUDITORIA-TEMA-2026-07.md, aprobado en la
// lámina de componentes T2.3: normal-case en vez de mayúsculas con tracking,
// comparado lado a lado — las mayúsculas leían "dashboard 2016"). Antes cada
// vista tenía su propio patrón inline (DESIGN.md §15). Variantes:
// primary/secondary/ghost/destructive/icon, tamaños sm/md.
const VARIANT_CLASSES = {
    primary: `text-white bg-gradient-to-b from-brand-hover to-brand
        shadow-[0_1px_2px_rgba(0,82,204,0.35),0_4px_10px_rgba(0,82,204,0.28),inset_0_1px_0_rgba(255,255,255,0.22)]
        hover:from-brand hover:to-brand-dark
        hover:shadow-[0_2px_4px_rgba(0,82,204,0.4),0_8px_20px_rgba(0,82,204,0.35),inset_0_1px_0_rgba(255,255,255,0.22)]
        hover:-translate-y-px active:translate-y-0 active:scale-[0.98]`,
    secondary: `text-content bg-gradient-to-b from-surface-card to-surface-card-hover
        border border-border-card shadow-sm
        hover:shadow-md hover:-translate-y-px`,
    ghost: `text-content-2 bg-transparent hover:bg-surface-card-hover hover:text-content`,
    destructive: `text-white bg-gradient-to-b from-[#f65a4d] to-danger
        shadow-[0_1px_2px_rgba(240,68,56,0.35),0_4px_10px_rgba(240,68,56,0.25),inset_0_1px_0_rgba(255,255,255,0.2)]
        hover:shadow-[0_2px_4px_rgba(240,68,56,0.4),0_8px_20px_rgba(240,68,56,0.32),inset_0_1px_0_rgba(255,255,255,0.2)]
        hover:-translate-y-px active:translate-y-0 active:scale-[0.98]`,
};

const SIZE_CLASSES = {
    sm: 'h-[34px] px-3.5 text-[12.5px] gap-1.5',
    md: 'h-[42px] px-[18px] text-[13px] gap-1.5',
};

const ICON_ONLY_SIZE = { sm: 'w-[34px] px-0', md: 'w-[42px] px-0' };

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
                ${iconOnly ? ICON_ONLY_SIZE[size] : SIZE_CLASSES[size]}
                ${className}`}
            {...rest}
        >
            {loading ? (
                <Loader2 size={size === 'sm' ? 14 : 15} className="animate-spin" />
            ) : (
                Icon && <Icon size={size === 'sm' ? 14 : 15} strokeWidth={2.25} />
            )}
            {!iconOnly && children}
        </button>
    );
});

export default Button;
