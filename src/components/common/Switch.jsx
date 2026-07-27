import React, { memo } from 'react';

/**
 * Switch — control de encendido/apagado.
 *
 * Canónico creado en D3 (2026-07-27) tras revisar los `bg-white` que quedaban
 * en el gate. El blanco de la perilla resultó **correcto y necesario**: una
 * perilla es blanca sobre su riel en los cuatro temas, igual que en iOS, sea
 * el riel claro u oscuro. No es deuda de superficie, es la pieza que indica
 * el estado.
 *
 * Lo que sí era deuda es todo lo demás. Los 18 switches escritos a mano usaban
 * **8 tamaños distintos** (`w-3`, `w-3.5`, `w-4`, `w-[14px]`, `w-[22px]`…),
 * **6 sombras** (`shadow-sm`, `shadow-md`, `glass-1`, `glass-3`,
 * `elevation-md/sm/xl`, y uno sin ninguna) y **8 offsets verticales**. Nadie
 * decidió eso: es lo que pasa cuando un control no tiene componente.
 *
 * Tres tamaños, porque los 18 usos caían en tres grupos de altura real:
 *   sm  riel 16px · perilla 12px   — dentro de una fila o celda
 *   md  riel 24px · perilla 18px   — el default, en formularios
 *   lg  riel 32px · perilla 26px   — ajuste destacado, pantallas de config
 *
 * El riel apagado usa `--surface-card-hover` (no un gris fijo) para que siga
 * al tema; el encendido usa el color semántico que se le pase.
 */

const SIZE = {
    sm: { track: 'w-8 h-4',   knob: 'w-3 h-3',     off: 'translate-x-0.5', on: 'translate-x-[18px]' },
    md: { track: 'w-11 h-6',  knob: 'w-[18px] h-[18px]', off: 'translate-x-[3px]', on: 'translate-x-[26px]' },
    lg: { track: 'w-14 h-8',  knob: 'w-[26px] h-[26px]', off: 'translate-x-[3px]', on: 'translate-x-[33px]' },
};

const ON_BG = {
    brand:   'bg-brand',
    success: 'bg-success-solid',
    warning: 'bg-warning-solid',
    danger:  'bg-danger-solid',
};

const Switch = memo(({
    checked = false,
    onChange,
    size = 'md',
    variant = 'brand',
    disabled = false,
    label,
    className = '',
    ...rest
}) => {
    const s = SIZE[size] || SIZE.md;
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => !disabled && onChange?.(!checked)}
            className={`relative shrink-0 rounded-full border border-border-card
                transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
                disabled:opacity-45 disabled:cursor-not-allowed
                ${s.track}
                ${checked ? (ON_BG[variant] || ON_BG.brand) : 'bg-surface-card-hover'}
                ${className}`}
            {...rest}
        >
            {/* La perilla es blanca en los 4 temas — ver nota del componente. */}
            <span className={`absolute top-1/2 -translate-y-1/2 left-0 rounded-full bg-white
                shadow-[var(--shadow-elevation-sm)]
                transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
                ${s.knob} ${checked ? s.on : s.off}`} />
        </button>
    );
});

export default Switch;
