import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Popover — el panel flotante que abre un botón (2026-11-06).
 *
 * Va junto con `useAnclaje` (`@plataforma/useAnclaje`), que mide el botón y
 * cierra con Escape y con un clic afuera:
 *
 *   const [abierto, setAbierto] = useState(false);
 *   const cerrar = useCallback(() => setAbierto(false), []);
 *   const id = useId();
 *   const { btnRef, caja } = useAnclaje(abierto, cerrar, id);
 *   …
 *   <button ref={btnRef} onClick={() => setAbierto(v => !v)}
 *       aria-expanded={abierto} aria-haspopup="dialog">…</button>
 *   <Popover abierto={abierto} caja={caja} id={id} ariaLabel="Más filtros"
 *       className="w-[280px] p-3 flex flex-col gap-3">…</Popover>
 *
 * Había cuatro paneles así escritos uno por uno —los dos de FilterBar, los
 * borradores de MIN·MAX y la matriz ABC—, y la matriz llevaba además su propia
 * copia de la lógica de cierre. Este componente pone lo que tenían en común:
 * portal al `body` (dentro de la píldora de filtros, con su `overflow`, un
 * panel queda recortado), `data-panel={id}` (sin él, `useAnclaje` toma un clic
 * ADENTRO como un clic afuera y cierra), el material `dropdown`, la capa y la
 * entrada.
 *
 * `lado`: 'derecha' alinea el borde derecho del panel con el del botón (lo
 * normal al final de una barra); 'izquierda', el izquierdo.
 * `className` es para el ancho, el relleno y la disposición.
 */
export default function Popover({ abierto, caja, id, ariaLabel, lado = 'derecha', className = '', children }) {
    if (!abierto || !caja) return null;
    const style = lado === 'izquierda' ? { top: caja.top, left: caja.left } : { top: caja.top, right: caja.right };
    return createPortal(
        <div data-panel={id} role="dialog" aria-label={ariaLabel}
            data-surface="dropdown"
            style={style}
            className={`fixed z-dropdown animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] ease-out${className ? ` ${className}` : ''}`}>
            {children}
        </div>,
        document.body,
    );
}
