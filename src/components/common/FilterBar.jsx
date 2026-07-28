import React, { memo, Children, isValidElement, useState, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { X, SlidersHorizontal } from 'lucide-react';
import useMediaQuery from '../../hooks/useMediaQuery';

/**
 * FilterBar — la píldora donde vive TODO el filtro de la vista actual.
 *
 * Canónico creado el 2026-07-27. Ya existía un `FilterPill`, pero vivía en
 * `views/pedidos/tabpedidos/` y estaba **clavado a los filtros de Pedidos**
 * (sucursal, fecha, estado): no era un contenedor, era esa barra concreta. Por
 * eso las otras 13 vistas lo reescribieron.
 *
 * ── Reglas de uso (ver DESIGN.md §17) ────────────────────────────────────
 * Va SIEMPRE a la derecha, en la fila del título. Una sola por vista. Nunca
 * dentro de una tarjeta ni de una tabla — filtra la vista entera.
 *
 * El ORDEN de las ranuras no es libre. De ámbito más amplio a más angosto:
 *   1 ámbito (sucursal)  2 entidad (laboratorio, categoría)
 *   3 tiempo (período)   4 estado (chips)   5 limpiar
 * Es el orden en que una persona lo diría en voz alta: "las ventas de La
 * Popular, de Bayer, de julio, sin las anuladas". Si la vista tiene selector
 * de sucursal, va primero SIEMPRE: es el filtro que cambia el significado de
 * todos los demás — "julio" no quiere decir lo mismo en una sucursal que en
 * toda la red.
 *
 * ── Lo que se corrigió en v2, sobre la revisión del usuario ───────────────
 * · El filtro aplicado era un fondo teñido que llegaba hasta el divisor con la
 *   esquina recta: leía como "un botón cortado". Ahora es un CHIP completo, con
 *   su propio radio y aire alrededor — la misma forma que badges, segmentados y
 *   botones, así que pertenece.
 * · Faltaba limpiar todo. Ahora aparece con 2+ filtros aplicados.
 * · El alto NO era fijo: de las 14 barras del portal, 12 tenían alto automático,
 *   una `h-14` y otra `h-[4rem]`, así que se veía distinta en cada vista. Ahora
 *   son 52px pase lo que pase, y la barra se alinea con el título en todas.
 *
 * ── Móvil ────────────────────────────────────────────────────────────────
 * Bajo 720px colapsa a un botón con la cuenta de filtros aplicados y se abre
 * como hoja inferior, que es donde llega el pulgar. Antes se partía en tres
 * filas y empujaba la tabla fuera de la pantalla.
 */

const Section = memo(({
    children,
    // `active` + `onClear` son lo que convierte la ranura en chip. No se
    // deducen solos a propósito: solo la vista sabe cuál es el valor "sin
    // filtrar" de su propio control (a veces es '', a veces 'all', a veces el
    // mes en curso).
    active = false,
    onClear,
    label,
    className = '',
}) => (
    <div className={`flex items-center h-full px-2 min-w-0 ${className}`}>
        <div className={`flex items-center gap-1.5 h-9 px-1 rounded-btn border transition-[background-color,border-color] duration-200
            ${active ? 'bg-brand/10 border-brand/30' : 'border-transparent'}`}>
            {children}
            {active && onClear && (
                <button type="button" onClick={onClear}
                    title={label ? `Quitar ${label.toLowerCase()}` : 'Quitar este filtro'}
                    aria-label={label ? `Quitar ${label.toLowerCase()}` : 'Quitar este filtro'}
                    className="w-[18px] h-[18px] mr-1 shrink-0 rounded-full flex items-center justify-center
                        text-brand-text/60 hover:text-danger-text hover:bg-danger/15 transition-colors duration-150">
                    <X size={11} strokeWidth={3} />
                </button>
            )}
        </div>
    </div>
));
Section.displayName = 'FilterBar.Section';

const FilterBar = memo(({
    children,
    onClear,
    // Cuántos filtros hay aplicados. Lo pasa la vista porque es la única que
    // sabe qué cuenta como "aplicado" en su dominio.
    activeCount = 0,
    title = 'Filtros',
    className = '',
    ...rest
}) => {
    const compacto = useMediaQuery('(max-width: 719px)');
    const [abierto, setAbierto] = useState(false);
    const idHoja = useId();

    const secciones = Children.toArray(children).filter(isValidElement);

    // Escape cierra la hoja, y mientras está abierta el fondo no scrollea:
    // sin esto, arrastrar dentro de la hoja mueve la tabla de atrás y al
    // cerrarla el usuario quedó en otra parte de la lista sin haberlo pedido.
    useEffect(() => {
        if (!abierto) return;
        const alTeclear = e => { if (e.key === 'Escape') setAbierto(false); };
        const previo = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', alTeclear);
        return () => {
            document.body.style.overflow = previo;
            window.removeEventListener('keydown', alTeclear);
        };
    }, [abierto]);

    // ── Móvil: botón + hoja inferior ──────────────────────────────────────
    if (compacto) {
        return (
            <>
                <button type="button" onClick={() => setAbierto(true)}
                    aria-expanded={abierto} aria-controls={idHoja}
                    className={`inline-flex items-center gap-2 h-10 px-3.5 rounded-card border shrink-0
                        text-body-sm font-bold transition-[background-color,border-color] duration-200
                        ${activeCount > 0
                            ? 'bg-brand/10 border-brand/30 text-brand-text'
                            : 'bg-surface-card border-border-card text-content-2'} ${className}`}
                    {...rest}>
                    <SlidersHorizontal size={14} strokeWidth={2.5} />
                    {title}
                    {activeCount > 0 && (
                        <span className="min-w-[17px] h-[17px] px-1 rounded-full bg-brand text-white
                            text-micro font-black flex items-center justify-center tabular-nums">
                            {activeCount}
                        </span>
                    )}
                </button>

                {abierto && createPortal(
                    <div className="fixed inset-0 z-modal flex flex-col justify-end">
                        <button type="button" aria-label="Cerrar filtros"
                            onClick={() => setAbierto(false)}
                            className="absolute inset-0 bg-scrim animate-in fade-in duration-200" />

                        <div id={idHoja} role="dialog" aria-modal="true" aria-label={title}
                            data-surface="modal"
                            className="relative w-full max-h-[80vh] overflow-y-auto rounded-t-modal rounded-b-none
                                px-4 pt-3 pb-[max(20px,env(safe-area-inset-bottom))]
                                animate-in slide-in-from-bottom duration-300 ease-out">
                            {/* Tirador: no es decorativo, es lo que dice que la
                                hoja se arrastra para cerrar. */}
                            <div aria-hidden="true" className="w-9 h-1 rounded-full bg-content-3/40 mx-auto mb-3" />

                            <div className="flex items-center justify-between gap-3 mb-3">
                                <h2 className="text-body-lg font-black text-content">{title}</h2>
                                {onClear && activeCount > 1 && (
                                    <button type="button"
                                        onClick={() => { onClear(); setAbierto(false); }}
                                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-btn
                                            bg-danger/12 ring-1 ring-inset ring-danger/30 text-danger-text
                                            text-micro font-black uppercase tracking-widest">
                                        Limpiar {activeCount}
                                    </button>
                                )}
                            </div>

                            {/* Cada ranura es una fila de 44px: el mínimo del dedo. */}
                            <div className="flex flex-col gap-2">
                                {secciones.map((s, i) => (
                                    <div key={i} className="[&_*]:!max-w-full">{s}</div>
                                ))}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
            </>
        );
    }

    // ── Escritorio: la píldora ────────────────────────────────────────────
    return (
        <div
            // `h-[52px]` fijo. No es un número al azar: 36 del chip + 8 de aire
            // arriba y abajo. El divisor mide 22 y todo se centra, así que la
            // barra mide lo mismo tenga una ranura o cinco.
            className={`inline-flex items-center h-[52px] px-1 rounded-card border border-border-card
                bg-surface-card shadow-[var(--shadow-glass-1)] max-w-full
                transition-[border-color,box-shadow] duration-200 ${className}`}
            {...rest}
        >
            {secciones.map((s, i) => (
                <React.Fragment key={i}>
                    {/* El divisor lo pone el contenedor, no cada vista. Era lo
                        que más se repetía a mano y lo que más quedaba de más:
                        un divisor colgando al final cuando una sección se
                        ocultaba por permisos. */}
                    {i > 0 && <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />}
                    {s}
                </React.Fragment>
            ))}

            {onClear && activeCount > 1 && (
                <>
                    <span aria-hidden="true" className="h-[22px] w-px bg-divider shrink-0" />
                    <div className="flex items-center h-full px-2">
                        {/* Ícono solo, a pedido del usuario, para ahorrar
                            espacio. El rótulo se conserva en `title` y
                            `aria-label` con la CUENTA adentro, que es lo que lo
                            desambigua de las × chicas de cada chip: acá dice
                            "Quitar los 3 filtros", no "quitar el último". */}
                        <button type="button" onClick={onClear}
                            title={`Quitar los ${activeCount} filtros`}
                            aria-label={`Quitar los ${activeCount} filtros`}
                            className="w-9 h-9 rounded-btn flex items-center justify-center shrink-0
                                text-danger-text/70 bg-danger/10 ring-1 ring-inset ring-danger/25
                                hover:bg-danger/20 hover:text-danger-text
                                transition-[background-color,color] duration-200">
                            <X size={15} strokeWidth={2.75} />
                        </button>
                    </div>
                </>
            )}
        </div>
    );
});

FilterBar.Section = Section;
FilterBar.displayName = 'FilterBar';

export default FilterBar;
