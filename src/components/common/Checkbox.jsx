import React, { memo, useId } from 'react';
import { Check, Minus } from 'lucide-react';

/**
 * Checkbox — casilla de verificación del portal.
 *
 * Canónico creado en D3.4 (2026-07-27). Los 16 `input[type=checkbox]` del
 * proyecto eran **la casilla nativa del navegador**, que es el único control
 * que quedaba sin pasar por el tema: se pinta con el azul del sistema
 * operativo, ignora los cuatro temas, y en oscuro queda un cuadrito claro
 * flotando. Es exactamente la regla que el proyecto ya tiene para `<select>`
 * (nunca el nativo, siempre `LiquidSelect`), solo que a la casilla nadie se la
 * había aplicado.
 *
 * El input real sigue existiendo —`sr-only`, no `display:none`— para no perder
 * nada de lo que el navegador ya hace bien: el foco, la barra espaciadora, el
 * `form`, y que un lector de pantalla lo anuncie como casilla. Lo único que se
 * reemplaza es el DIBUJO.
 *
 * `indeterminate` estaba faltando: varias listas tienen un "seleccionar todo"
 * que con selección parcial se mostraba desmarcado, mintiendo sobre el estado.
 *
 * **Sin `onChange` es un INDICADOR, no un control** — misma regla que `Switch`:
 * varias casillas viven dentro de una fila que ya es clickeable (InlineDayEditor),
 * donde el input debe quedar en `readOnly` y fuera del orden de tabulación para
 * no ser una segunda parada hacia la misma acción.
 */

const SIZE = {
    sm: { caja: 'w-4 h-4 rounded-[5px]', icono: 11 },
    md: { caja: 'w-5 h-5 rounded-md',    icono: 13 },
};

const Checkbox = memo(({
    checked = false,
    indeterminate = false,
    onChange,
    label,
    description,
    size = 'md',
    disabled = false,
    name,
    className = '',
    ...rest
}) => {
    const autoId = useId();
    const id = name || autoId;
    const s = SIZE[size] || SIZE.md;
    const activo = checked || indeterminate;

    return (
        <label htmlFor={id}
            className={`group inline-flex items-start gap-2.5 select-none
                ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
            <input
                id={id}
                name={name}
                type="checkbox"
                className="sr-only peer"
                checked={checked}
                disabled={disabled}
                readOnly={!onChange}
                tabIndex={onChange ? undefined : -1}
                aria-checked={indeterminate ? 'mixed' : checked}
                onChange={(e) => !disabled && onChange?.(e.target.checked, e)}
                {...rest}
            />
            {/* El aro de foco sale del canónico de index.css vía `peer-focus-visible`:
                el input real es quien recibe el foco, pero quien se ve es esta caja. */}
            <span aria-hidden="true"
                className={`shrink-0 mt-px flex items-center justify-center border
                    transition-[background-color,border-color,transform] duration-150
                    peer-focus-visible:outline peer-focus-visible:outline-2
                    peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus-ring-color)]
                    ${s.caja}
                    ${activo
                        ? 'bg-brand border-brand text-white'
                        : 'bg-surface-card border-border-card text-transparent group-hover:border-brand/50'}`}>
                {indeterminate
                    ? <Minus size={s.icono} strokeWidth={4} />
                    : <Check size={s.icono} strokeWidth={4} />}
            </span>
            {(label || description) && (
                <span className="min-w-0">
                    {label && <span className="block text-body-sm font-bold text-content-2 leading-snug">{label}</span>}
                    {description && <span className="block text-label text-content-3 font-medium mt-0.5">{description}</span>}
                </span>
            )}
        </label>
    );
});

export default Checkbox;
