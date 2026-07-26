import { useRef, useState, useEffect } from 'react';
import { Search, Loader2, X } from 'lucide-react';

/**
 * Buscador inline para widgets, modales y tabs internos (Tipo 2).
 * Para el buscador principal de vista usar ViewTabBar.
 *
 * Props:
 *   value        – string
 *   onChange     – (value: string) => void
 *   placeholder  – string
 *   size         – 'sm' | 'md'  (default: 'md') — ignorado si expandable
 *   loading      – bool, muestra un spinner en vez del ícono de lupa
 *   autoFocus    – bool
 *   className    – string extra para el wrapper
 *   expandable   – bool. Toolbar de widget con filtros (ej. dashboard
 *                  Operación): arranca colapsado a un cuadrado de 32px y
 *                  crece HACIA LA IZQUIERDA al tocarlo. El caller debe
 *                  ponerlo dentro de una fila `justify-content: flex-end`
 *                  con los chips de filtro DESPUÉS en el DOM — así los
 *                  filtros quedan siempre anclados a la derecha y el
 *                  buscador crece hacia el espacio vacío sin taparlos.
 *                  Ver DESIGN.md §24 "Buscador expandible de widget" para
 *                  cuándo usar esto vs. un SearchInput normal vs. el
 *                  buscador de ViewTabBar (header de vista).
 *   accentColor  – hex de categoría (CATEGORY_META) para el ícono cuando
 *                  está colapsado — nunca azul genérico, se integra con el
 *                  color del propio widget. Solo aplica con expandable.
 */
export default function SearchInput({
    value = '',
    onChange,
    placeholder = 'Buscar...',
    size = 'md',
    loading = false,
    autoFocus = false,
    className = '',
    expandable = false,
    accentColor,
}) {
    const inputRef = useRef(null);
    const wrapRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);

    // text-[16px] obligatorio en TODO input de texto (§25 DESIGN.md) — por
    // debajo de 16px, Safari/iOS hace zoom automático al enfocar. sm/md solo
    // difieren en padding/ícono, nunca en tamaño de fuente.
    const sizeMap = {
        sm: { text: 'text-[16px]', icon: 14, px: 'pl-8 pr-7 py-1.5', iconLeft: 'left-2.5', clearRight: 'right-2' },
        md: { text: 'text-[16px]', icon: 15, px: 'pl-9 pr-8 py-2',   iconLeft: 'left-3',   clearRight: 'right-2.5' },
    };
    const s = sizeMap[size] ?? sizeMap.md;

    // Colapsa al clickear afuera — pero no si hay texto: una búsqueda activa
    // se queda abierta hasta que el usuario la borre explícitamente (mismo
    // criterio que el mockup aprobado: no perder el resultado por accidente).
    useEffect(() => {
        if (!expandable) return;
        const onDocClick = (e) => {
            if (!wrapRef.current?.contains(e.target) && !value) setIsOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [expandable, value]);

    if (expandable) {
        const open = isOpen || !!value;
        return (
            <div
                ref={wrapRef}
                {...(open ? { 'data-surface': 'input' } : {})}
                onClick={() => { if (!open) { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 120); } }}
                className={`flex items-center h-8 transition-[flex-grow,flex-basis,background-color,border-color] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden ${
                    open
                        ? 'flex-1 min-w-0 cursor-text'
                        : 'flex-none w-8 rounded-[0.65rem] bg-surface-card-hover border border-border-card cursor-pointer'
                } ${className}`}
            >
                <div className="w-8 h-8 flex items-center justify-center shrink-0" style={accentColor ? { color: accentColor } : undefined}>
                    {loading
                        ? <Loader2 size={14} className={`animate-spin ${accentColor ? '' : 'text-content-3'}`} />
                        : <Search size={14} strokeWidth={2.5} className={accentColor ? '' : 'text-content-3'} />}
                </div>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    tabIndex={open ? 0 : -1}
                    className={`min-w-0 flex-1 bg-transparent border-none outline-none text-[16px] font-semibold text-content placeholder:text-content-3 transition-opacity duration-200 ${
                        open ? 'opacity-100 pr-1' : 'opacity-0 w-0 pointer-events-none'
                    }`}
                />
                {open && value && (
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); onChange?.(''); inputRef.current?.focus(); }}
                        className="w-5 h-5 mr-1.5 shrink-0 flex items-center justify-center rounded-full text-content-3 hover:text-danger hover:bg-danger/10 transition-colors"
                    >
                        <X size={12} strokeWidth={2.5} />
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={`relative flex items-center ${className}`}>
            {loading
                ? <Loader2 size={s.icon} className={`absolute ${s.iconLeft} top-1/2 -translate-y-1/2 text-brand animate-spin pointer-events-none shrink-0`} />
                : <Search size={s.icon} strokeWidth={2.5} className={`absolute ${s.iconLeft} top-1/2 -translate-y-1/2 text-brand pointer-events-none shrink-0`} />}
            <input
                ref={inputRef}
                type="text"
                data-surface="input"
                value={value}
                onChange={e => onChange?.(e.target.value)}
                placeholder={placeholder}
                autoFocus={autoFocus}
                className={`w-full ${s.px} ${s.text} font-semibold
                    text-content placeholder:text-content-3
                    outline-none transition-[outline-color,outline-width,outline-offset] duration-200
                    focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-brand/30`}
            />
            {value && (
                <button
                    onClick={() => { onChange?.(''); inputRef.current?.focus(); }}
                    className={`absolute ${s.clearRight} top-1/2 -translate-y-1/2
                        p-0.5 text-content-3 hover:text-danger transition-colors`}
                >
                    <X size={s.icon - 1} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
}
