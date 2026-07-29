import React, { memo } from 'react';

/**
 * Switch — control de encendido/apagado.
 *
 * Canónico creado en D3 (2026-07-27) al revisar los `bg-white` que quedaban en
 * el gate. El blanco de la perilla resultó **correcto y necesario**: una perilla
 * es blanca sobre su riel en los cuatro temas, igual que en iOS, sea el riel
 * claro u oscuro. No es deuda de superficie, es la pieza que indica el estado.
 *
 * Lo que sí era deuda: al contarlos bien no había "18 switches a mano" sino
 * **tres componentes locales compitiendo** —`BranchHelpers.Switch` (5 usos en
 * 3 archivos), `PermissionsView.Toggle` (3 usos) y `FormPlanificador.Switch`
 * (1 uso)— más 5 copias escritas inline. Tres canónicos parciales, ninguno
 * importable desde afuera de su archivo. Entre los tres sumaban 8 tamaños de
 * perilla, 6 sombras y 8 offsets verticales.
 *
 * Tres tamaños, sacados de los tres grupos de altura que existían de verdad:
 *   sm  riel 16px · perilla 12px   — dentro de una fila o celda
 *   md  riel 24px · perilla 18px   — el default, en formularios
 *   lg  riel 32px · perilla 26px   — ajuste destacado, pantallas de config
 *
 * **Sin `onChange` el switch es un INDICADOR, no un control**: renderiza un
 * `<span>` en vez de un `<button>`. Varios usos viven dentro de una fila que ya
 * es clickeable (DashboardView, LabsPanel, FormAddCustomDocument) — ahí un
 * `<button>` anidado sería HTML inválido y una segunda parada de tabulación
 * para la misma acción.
 */

const SIZE = {
    sm: { track: 'w-8 h-4',  knob: 'w-3 h-3',           off: 'translate-x-0.5',  on: 'translate-x-[18px]' },
    md: { track: 'w-11 h-6', knob: 'w-[18px] h-[18px]', off: 'translate-x-[3px]', on: 'translate-x-[26px]' },
    lg: { track: 'w-14 h-8', knob: 'w-[26px] h-[26px]', off: 'translate-x-[3px]', on: 'translate-x-[33px]' },
};

// Literales, NO un bucle: Tailwind escanea texto: `bg-chart-${i}` no emite CSS
// y el riel saldría transparente sin ningún error (ya pasó en Badge, D2.5).
const ON_BG = {
    brand:   'bg-brand',
    success: 'bg-success-solid',
    warning: 'bg-warning-solid',
    danger:  'bg-danger-solid',
    'chart-1': 'bg-chart-1', 'chart-3': 'bg-chart-3',
    'chart-4': 'bg-chart-4', 'chart-9': 'bg-chart-9', 'chart-6': 'bg-chart-6',
    'chart-8': 'bg-chart-8',
};

// Algunos call sites traen el color desde un config (`activeColor: 'bg-chart-1'`).
// Se acepta la clase cruda y se normaliza al mismo mapa, para no obligar a
// reescribir esas tablas ni abrir la puerta a un color libre.
const resolveOn = (variant) => ON_BG[variant] || ON_BG[String(variant).replace(/^bg-/, '')] || ON_BG.brand;

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
    const track = `relative shrink-0 inline-flex rounded-full border border-border-card
        transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
        ${s.track} ${checked ? resolveOn(variant) : 'bg-surface-card-hover'}
        ${disabled ? 'opacity-45' : ''} ${className}`;

    /* La perilla es blanca en los 4 temas — ver nota del componente. */
    const knob = (
        <span className={`absolute top-1/2 -translate-y-1/2 left-0 rounded-full bg-white
            shadow-[var(--shadow-elevation-sm)]
            transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]
            ${s.knob} ${checked ? s.on : s.off}`} />
    );

    if (!onChange) {
        return (
            <span role="switch" aria-checked={checked} aria-label={label}
                aria-disabled={disabled || undefined} className={track} {...rest}>
                {knob}
            </span>
        );
    }

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            className={`${track} disabled:cursor-not-allowed active:scale-[0.97]`}
            {...rest}
        >
            {knob}
        </button>
    );
});

export default Switch;
