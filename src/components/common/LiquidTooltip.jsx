import React, { useState, useCallback, useRef, useId, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * LiquidTooltip — nota flotante sobre un elemento.
 *
 * Canónico desde siempre, adoptado casi nunca: al medirlo (2026-07-27) había
 * **30 tooltips escritos a mano** contra 2 archivos usando este. Y los 30 no
 * coincidían entre sí — cuatro fondos oscuros distintos (`slate-900`,
 * `slate-800`, `slate-950`, y algunos sin fondo explícito), cuatro anchos
 * distintos, tres lados. Otra vez el patrón de la semana: el canónico existía,
 * nadie lo sabía, y cada quien resolvió lo mismo a su manera.
 *
 * **Decisión 1a (2026-07-27): el tooltip es oscuro en los cuatro temas.** No es
 * una superficie de la pantalla, es una nota flotando encima, y esa distancia
 * visual es lo que deja leerla de un vistazo. Antes seguía el tema
 * (`data-surface="dropdown"`), que lo hacía coherente pero indistinguible de un
 * popover.
 *
 * Lo que sí cambia por tema es la forma y el material, igual que en `Button`:
 * en Liquid Glass es redondeado, translúcido y con blur; en Solid es
 * rectangular y opaco. Eso NO se elige por prop — vive en `--tooltip-*` y lo
 * decide el tema (ver `index.css`, `[data-surface="tooltip"]`). Un `rounded-full`
 * fijo acá sería el mismo error que ya cometimos con 54 botones.
 *
 * Accesibilidad: se muestra también con el foco del teclado, no solo con el
 * mouse. Un tooltip que solo aparece al pasar el puntero es invisible para
 * quien navega con Tab y para cualquier dispositivo táctil.
 */

export default function LiquidTooltip({
    children,
    content,
    side = 'top',
    // `rich` es para el contenido que ya venía en bloque (VentasView,
    // TabSinVenta pasan JSX con varias líneas). El default es la nota de una
    // línea, que era el 80% de los 30 escritos a mano — y a esos el relleno
    // viejo (px-5 py-3.5) les quedaba enorme.
    variant = 'text',
    className = '',
}) {
    const [pos, setPos] = useState(null);
    const ref = useRef(null);
    const id = useId();

    const show = useCallback(() => {
        if (!ref.current || !content) return;
        const r = ref.current.getBoundingClientRect();
        const cy = Math.min(Math.max(r.top + r.height / 2, 28), window.innerHeight - 28);
        // `cx` va CENTRADO en el disparador, sin recortar todavía: el recorte
        // necesita el ancho real del tooltip, y ese solo se sabe una vez montado.
        setPos({ cx: r.left + r.width / 2, cy, top: r.top, bottom: r.bottom, left: r.left, right: r.right });
    }, [content]);

    const hide = useCallback(() => setPos(null), []);

    // ── El recorte usa el ancho REAL, no uno supuesto (2026-07-30) ─────────
    // Antes se recortaba contra un medio-ancho fijo —140px para el tooltip de
    // texto, 180 para el rico— sin importar cuánto midiera de verdad. Un tooltip
    // corto cerca del borde derecho se corría hacia adentro **más de 100px** y
    // quedaba flotando lejos de su botón, con la flecha apuntando al aire: el
    // usuario lo vio en el ojo de Ventas. El tooltip es `w-max`, así que su ancho
    // depende del texto y no hay constante que lo represente.
    const cuerpoRef = useRef(null);
    useLayoutEffect(() => {
        if (!pos || !cuerpoRef.current) return;
        const medio = cuerpoRef.current.getBoundingClientRect().width / 2;
        const limitado = Math.min(Math.max(pos.cx, medio + 8), window.innerWidth - medio - 8);
        if (Math.abs(limitado - pos.cx) > 0.5) setPos(p => (p ? { ...p, cx: limitado } : p));
    }, [pos]);

    // Escape cierra, y el scroll también: la posición se calcula una sola vez
    // al abrir, así que si la página se mueve el tooltip queda flotando lejos
    // de su disparador. Cerrarlo es más honesto que dejarlo desalineado.
    useEffect(() => {
        if (!pos) return;
        const alTeclear = e => { if (e.key === 'Escape') hide(); };
        window.addEventListener('keydown', alTeclear);
        window.addEventListener('scroll', hide, true);
        return () => {
            window.removeEventListener('keydown', alTeclear);
            window.removeEventListener('scroll', hide, true);
        };
    }, [pos, hide]);

    const estilo = !pos ? {} : {
        top:    { left: pos.cx,   top: pos.top - 8,     transform: 'translate(-50%, -100%)' },
        bottom: { left: pos.cx,   top: pos.bottom + 8,  transform: 'translateX(-50%)' },
        left:   { left: pos.left - 8, top: pos.cy,      transform: 'translate(-100%, -50%)' },
        right:  { left: pos.right + 8, top: pos.cy,     transform: 'translateY(-50%)' },
    }[side];

    // La flecha va del lado contrario al que se abre el tooltip.
    const anclaFlecha = {
        top:    'left-1/2 -translate-x-1/2 top-full -mt-1.5',
        bottom: 'left-1/2 -translate-x-1/2 bottom-full -mb-1.5',
        left:   'top-1/2 -translate-y-1/2 left-full -ml-1.5',
        right:  'top-1/2 -translate-y-1/2 right-full -mr-1.5',
    }[side];

    return (
        <>
            <span
                ref={ref}
                onMouseEnter={show}
                onMouseLeave={hide}
                onFocus={show}
                onBlur={hide}
                aria-describedby={pos && content ? id : undefined}
                className={`inline-block ${className}`}
            >
                {children}
            </span>

            {pos && content && createPortal(
                <div id={id} role="tooltip"
                    className="fixed z-toast pointer-events-none animate-in fade-in zoom-in-95 duration-150 ease-out"
                    style={estilo}>

                    <div ref={cuerpoRef} data-surface="tooltip"
                        className={`w-max font-semibold leading-snug
                            ${variant === 'rich'
                                ? 'px-4 py-3 max-w-[360px] text-body-sm'
                                : 'px-3 py-2 max-w-[280px] text-label'}`}>
                        {content}
                    </div>

                    {/* Cuadrado rotado, no un borde: es lo único que da la punta
                        sin recortar la sombra del cuerpo. Toma los mismos tokens,
                        así que cambia de color con el tema sin saber cuál es. */}
                    <span aria-hidden="true"
                        className={`absolute w-3 h-3 rotate-45 ${anclaFlecha}`}
                        style={{
                            background: 'var(--tooltip-bg)',
                            borderRight: '1px solid var(--tooltip-border)',
                            borderBottom: '1px solid var(--tooltip-border)',
                            borderRadius: '2px',
                        }} />
                </div>,
                document.body
            )}
        </>
    );
}
