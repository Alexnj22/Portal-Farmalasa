import { useEffect, useId, useRef } from 'react';

// Contrato estándar para TODO buscador toggleable (Tipo 1 header, Tipo 2b
// widget, o cualquier buscador hand-rolled con su propio show/hide): Escape
// cierra Y limpia; click afuera cierra SOLO si está vacío (con texto se
// queda abierto — no se pierde un resultado por accidente). El autofocus al
// abrir queda a cargo de cada caller (autoFocus prop o
// `inputRef.current?.focus()` tras el timeout de su propia animación de
// apertura), porque el timing exacto depende de cada transición.
//
// Usa un marcador data-* (vía `containerProps`, para spread en el JSX) en
// vez de un `ref` de nodo DOM — bug real encontrado 2026-07-26:
// `GlassViewLayout` renderiza `filtersContent` DOS VECES (copia desktop +
// copia móvil, una oculta por CSS según breakpoint). Si `filtersContent` es
// un valor JSX creado UNA vez en el padre con `ref={containerRef}`, ambas
// copias montadas comparten el MISMO objeto ref — solo la última en
// commitear gana `.current`. El resultado: clickear DENTRO de la copia
// visible se detectaba como "afuera" (porque el ref apuntaba a la copia
// oculta), cerrando el buscador antes de poder escribir — exactamente el
// reporte de "no funciona el buscador" en Nómina/Plan de Vacaciones. Un
// atributo data-* no tiene este problema: ambas copias montadas lo llevan,
// y `closest()` encuentra cualquiera de las dos sin importar cuál se
// clickeó.
export function useSearchToggle({ active, value, onClear, onClose }) {
    const id = useId();
    const selector = `[data-search-toggle-id="${id}"]`;
    // refs para no reatachar listeners en cada render solo porque el caller
    // pasó una arrow function nueva — solo active/value deben reiniciar el efecto.
    // Se actualizan en un efecto (no durante el render) porque el React
    // Compiler de este proyecto prohíbe mutar refs en el cuerpo del render.
    const valueRef = useRef(value);
    const onClearRef = useRef(onClear);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        valueRef.current = value;
        onClearRef.current = onClear;
        onCloseRef.current = onClose;
    }, [value, onClear, onClose]);

    useEffect(() => {
        if (!active) return;

        const handleKeyDown = (e) => {
            if (e.key !== 'Escape') return;
            onClearRef.current?.();
            onCloseRef.current?.();
        };
        const handleClickOutside = (e) => {
            if (valueRef.current) return;
            if (!e.target.closest?.(selector)) {
                onCloseRef.current?.();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [active, selector]);

    return { containerProps: { 'data-search-toggle-id': id } };
}
