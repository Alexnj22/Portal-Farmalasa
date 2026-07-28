import React, { memo, Children } from 'react';
import { X } from 'lucide-react';
import Button from './Button';

/**
 * FilterBar — la píldora donde vive TODO el filtro de la vista actual.
 *
 * Canónico creado el 2026-07-27, a pedido del usuario: *"esa píldora es donde
 * está todo el filtro de la página actual, sea este de fecha, categoría, etc."*
 *
 * Ya existía uno llamado `FilterPill`, pero vivía en
 * `views/pedidos/tabpedidos/` y estaba **clavado a los filtros de Pedidos**
 * (sucursal, fecha, estado). No era un contenedor, era esa barra concreta. Por
 * eso las otras 13 vistas no podían usarlo y lo reescribieron.
 *
 * Medido sobre esas 14 barras:
 *   radio     rounded-2xl ×13 · rounded-header ×1   → clavado, no del token
 *   contenido LiquidSelect ×9 · Button ×9 · PeriodPicker ×2 · fechas ×1
 *   divisor   `<div className="h-5 w-px bg-divider" />` repetido a mano
 *             entre cada par de secciones, en las 14
 *
 * El divisor es lo que más se repetía y lo que más se olvidaba: acá lo pone el
 * contenedor entre hijos, así que no se puede quedar de menos ni de más.
 *
 * Uso:
 *   <FilterBar onClear={limpiar} activo={hayFiltro}>
 *       <FilterBar.Section><LiquidSelect …/></FilterBar.Section>
 *       <FilterBar.Section><PeriodPicker …/></FilterBar.Section>
 *       <FilterBar.Section compact><SegmentedControl …/></FilterBar.Section>
 *   </FilterBar>
 */

const Section = memo(({ children, compact = false, className = '' }) => (
    <div className={`flex items-center min-w-0 ${compact ? 'px-1.5 py-1.5 gap-1' : 'px-2 py-2 gap-1.5'} ${className}`}>
        {children}
    </div>
));
Section.displayName = 'FilterBar.Section';

const FilterBar = memo(({
    children,
    // `onClear` + `activo`: el botón de limpiar aparece SOLO cuando hay algo que
    // limpiar. Estaba escrito a mano en 6 de las 14, y en las otras 8 no existía
    // —o sea que en esas vistas no había forma de volver al estado sin filtros
    // más que recargar—. Al ser parte del contenedor deja de ser opcional por
    // olvido: si la vista pasa `onClear`, el botón está.
    onClear,
    activo = false,
    className = '',
    ...rest
}) => {
    const secciones = Children.toArray(children).filter(Boolean);

    return (
        <div
            // `rounded-card` y no `rounded-2xl`: las 14 lo tenían clavado, así
            // que en el tema sólido seguían siendo tan redondeadas como en
            // vidrio. La forma la decide el tema, igual que en `Button`.
            className={`inline-flex items-center flex-wrap rounded-card border border-border-card
                bg-surface-card shadow-[var(--shadow-glass-1)] max-w-full
                transition-[border-color,box-shadow] duration-200 ${className}`}
            {...rest}
        >
            {secciones.map((s, i) => (
                <React.Fragment key={i}>
                    {/* El divisor lo pone el contenedor, no cada vista. Es lo
                        que más se repetía a mano y lo que más quedaba de más
                        (un divisor colgando al final cuando una sección se
                        ocultaba por permisos). */}
                    {i > 0 && <span aria-hidden="true" className="h-5 w-px bg-divider shrink-0" />}
                    {s}
                </React.Fragment>
            ))}

            {onClear && activo && (
                <>
                    <span aria-hidden="true" className="h-5 w-px bg-divider shrink-0" />
                    <span className="px-1.5 py-1.5">
                        <Button variant="ghost" size="xs" iconOnly icon={X}
                            title="Quitar todos los filtros" onClick={onClear} />
                    </span>
                </>
            )}
        </div>
    );
});

FilterBar.Section = Section;
FilterBar.displayName = 'FilterBar';

export default FilterBar;
