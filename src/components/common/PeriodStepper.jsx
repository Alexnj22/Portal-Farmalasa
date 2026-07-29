import React, { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from './Button';

/**
 * PeriodStepper — «‹ etiqueta ›»: mover el período que se está mirando.
 *
 * Canónico creado el 2026-07-27 (§17). Apareció midiendo, no de una idea
 * previa: siete copias a mano con CINCO anatomías distintas para el mismo
 * control —quincena en `AttendanceAuditView`, semana en `SchedulesView` y
 * `EmployeeScheduleView`, año en `VacationPlanView`, y en `DashboardView` la
 * tendencia, el calendario y los cumpleaños—. Cada una con su tamaño de
 * flecha, su ancho de etiqueta y su forma de contenedor.
 *
 * NO es paginación (`TablePagination`) ni un rango (`PeriodPicker`): acá el
 * período dura lo mismo siempre y solo se corre hacia atrás o hacia adelante.
 *
 * ── Por qué la etiqueta es un botón ──────────────────────────────────────
 * En las tres vistas donde el usuario podía alejarse del período actual, las
 * tres tenían una forma distinta de volver —un botón aparte, una × de reset,
 * nada—. Acá el propio rótulo es el atajo: `onReset` lo vuelve clickeable y
 * el subrótulo dice a dónde lleva. Sin `onReset` es un `<span>`, no un botón
 * muerto.
 *
 * ── Accesibilidad ────────────────────────────────────────────────────────
 * `unit` ("quincena", "semana", "año") arma los nombres accesibles de las dos
 * flechas. Sin él, un lector de pantalla anuncia "botón, botón" y no hay
 * forma de saber qué mueven. Es obligatorio a propósito.
 */

const SIZES = {
    // `sm` es el de la cabecera de un widget, donde el control comparte fila
    // con el título. `md` es el de una barra de filtros.
    sm: { btn: 'xs', label: 'text-label',   sub: 'text-micro', min: 'min-w-[104px]', gap: 'gap-0.5' },
    md: { btn: 'sm', label: 'text-body-sm', sub: 'text-micro', min: 'min-w-[132px]', gap: 'gap-1'   },
};

const PeriodStepper = memo(({
    label,
    // `children` reemplaza al rótulo cuando el centro NO es texto sino un
    // control — el caso real es el calendario del Inicio, donde el mes es un
    // selector que se abre. Va como hijo y no como `label` a propósito: si se
    // envolviera en el botón de `onReset` quedaría un `<button>` dentro de otro.
    children,
    unit = 'período',
    onPrev,
    onNext,
    // `onReset` + `isCurrent` son el par que hace del rótulo un atajo de
    // vuelta. Solo la vista sabe cuál es su período "actual".
    onReset,
    isCurrent = true,
    resetLabel = 'Ir a hoy',
    prevDisabled = false,
    nextDisabled = false,
    size = 'md',
    className = '',
}) => {
    const s = SIZES[size] || SIZES.md;

    const cuerpo = (
        <>
            <span className={`${s.label} font-black leading-none whitespace-nowrap
                ${isCurrent ? 'text-content' : 'text-warning'}`}>
                {label}
            </span>
            {onReset && (
                <span className={`${s.sub} font-black uppercase tracking-widest leading-none mt-0.5
                    ${isCurrent ? 'text-content-3' : 'text-brand-text'}`}>
                    {isCurrent ? 'Actual' : `← ${resetLabel}`}
                </span>
            )}
        </>
    );

    return (
        <div className={`flex items-center ${s.gap} shrink-0 ${className}`}>
            <Button variant="ghost" size={s.btn} icon={ChevronLeft} iconOnly
                disabled={prevDisabled} onClick={onPrev}
                title={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} anterior`}
                aria-label={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} anterior`} />

            {children ? (
                <span className="flex items-center justify-center px-1 min-w-0">{children}</span>
            ) : onReset ? (
                <button type="button" onClick={onReset} disabled={isCurrent}
                    title={isCurrent ? undefined : `Volver a ${unit === 'período' ? 'el período actual' : `la ${unit} actual`}`}
                    // El rótulo es un atajo real ("volver al período actual"),
                    // así que es un target: medido en iPhone 13 daba 104x23.
                    // `--tap-min` lo sube a 44 solo en táctil.
                    className={`flex flex-col items-center justify-center px-2 ${s.min} min-h-[var(--tap-min)] rounded-btn
                        transition-colors duration-150 disabled:cursor-default
                        ${isCurrent ? '' : 'hover:bg-surface-card-hover'}`}>
                    {cuerpo}
                </button>
            ) : (
                <span className={`flex flex-col items-center justify-center px-2 ${s.min} select-none`}>
                    {cuerpo}
                </span>
            )}

            <Button variant="ghost" size={s.btn} icon={ChevronRight} iconOnly
                disabled={nextDisabled} onClick={onNext}
                title={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} siguiente`}
                aria-label={`${unit.charAt(0).toUpperCase()}${unit.slice(1)} siguiente`} />
        </div>
    );
});

PeriodStepper.displayName = 'PeriodStepper';

export default PeriodStepper;
