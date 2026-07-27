import React, { memo } from 'react';
import { Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

/**
 * Notice — aviso inline dentro de una vista o un formulario.
 *
 * Canónico creado en D3.5 (2026-07-27). Al auditar los "badges" escritos a mano
 * aparecieron **316 chips**, y al separarlos por forma resultaron ser tres cosas
 * distintas:
 *
 *   249  chip inline corto        → eso sí es `Badge`
 *    58  **aviso con ícono**      → no tenía canónico: esto
 *     9  contador flotante        → viven pegados a su ícono, quedan aparte
 *
 * El aviso es el que no existía. Lo que había: `AlertModal` (que interrumpe),
 * `OfflineBanner`/`SyncHealthBanner` (que van a nivel de página). Faltaba lo del
 * medio: decir algo *acá*, junto al campo o la lista de la que se habla, sin
 * tapar la pantalla.
 *
 * Medido sobre los 58: 22 eran de aviso (`warning`), y el radio se repartía en
 * `rounded-xl` 44 · `lg` 8 · `full` 6. Otra vez tres radios para una sola idea:
 * acá va uno solo, del token.
 */

const VARIANTES = {
    info:    { caja: 'bg-brand/10 border-brand/25 text-brand-text',       icono: Info },
    success: { caja: 'bg-success/10 border-success/30 text-success',      icono: CheckCircle2 },
    warning: { caja: 'bg-warning/10 border-warning/30 text-warning',      icono: AlertTriangle },
    danger:  { caja: 'bg-danger/10 border-danger/30 text-danger-text',    icono: XCircle },
    neutral: { caja: 'bg-surface-card-hover border-border-card text-content-2', icono: Info },
};

const Notice = memo(({
    variant = 'info',
    icon: IconoPropio,
    children,
    action,
    compact = false,
    className = '',
    ...rest
}) => {
    const v = VARIANTES[variant] || VARIANTES.info;
    const Icono = IconoPropio ?? v.icono;

    return (
        // `role="status"` y no `alert`: un aviso inline informa, no interrumpe.
        // `alert` obliga al lector de pantalla a cortar lo que esté leyendo, y
        // eso es para errores de verdad, no para una nota al pie de un campo.
        <div role="status"
            className={`flex items-start gap-2 rounded-btn border font-bold
                ${compact ? 'px-2.5 py-1.5 text-micro' : 'px-3 py-2 text-label'}
                ${v.caja} ${className}`}
            {...rest}>
            {Icono && <Icono size={compact ? 12 : 14} strokeWidth={2.5} className="shrink-0 mt-px" />}
            <span className="min-w-0 flex-1 leading-snug">{children}</span>
            {action && <span className="shrink-0 -my-0.5">{action}</span>}
        </div>
    );
});

export default Notice;
