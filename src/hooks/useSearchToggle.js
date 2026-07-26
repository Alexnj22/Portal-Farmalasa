import { useEffect, useRef } from 'react';

// Contrato estándar para TODO buscador toggleable (Tipo 1 header, Tipo 2b
// widget, o cualquier buscador hand-rolled con su propio show/hide): Escape
// cierra Y limpia; click afuera cierra SOLO si está vacío (con texto se
// queda abierto — no se pierde un resultado por accidente). El autofocus al
// abrir queda a cargo de cada caller (autoFocus prop o
// `inputRef.current?.focus()` tras el timeout de su propia animación de
// apertura), porque el timing exacto depende de cada transición.
export function useSearchToggle({ active, value, onClear, onClose }) {
    const containerRef = useRef(null);
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
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                onCloseRef.current?.();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [active]);

    return { containerRef };
}
