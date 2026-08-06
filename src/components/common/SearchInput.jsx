import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { useSearchToggle } from '../../hooks/useSearchToggle';

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
 *   disabled     – bool
 *   onKeyDown    – (e) => void — pass-through al <input> real (ej. Escape para cerrar)
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
 *   ariaLabel    – nombre accesible del campo. Por defecto usa el
 *                  `placeholder`, que es lo correcto en un buscador (el
 *                  texto ya dice qué se busca) pero NO es un nombre de
 *                  verdad: se pierde en cuanto el campo tiene contenido, y
 *                  varios lectores de pantalla no lo exponen. Pasarlo
 *                  explícito cuando el placeholder es genérico ("Buscar…")
 *                  y hay más de un buscador en la pantalla.
 *   accentColor  – hex de categoría (CATEGORY_META) para el ícono cuando
 *                  está colapsado — nunca azul genérico, se integra con el
 *                  color del propio widget. Solo aplica con expandable.
 *
 * ref — se resuelve al <input> real (forwardRef), para callers que
 * necesitan enfocarlo programáticamente (ej. `searchRef.current?.focus()`
 * al abrir un buscador toggleado por un botón externo).
 */
const SearchInput = forwardRef(function SearchInput({
    value = '',
    onChange,
    placeholder = 'Buscar...',
    size = 'md',
    loading = false,
    autoFocus = false,
    disabled = false,
    onKeyDown,
    className = '',
    expandable = false,
    accentColor,
    ariaLabel,
}, forwardedRef) {
    const inputRef = useRef(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const open = expandable && (isOpen || !!value);

    useImperativeHandle(forwardedRef, () => inputRef.current, []);

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío (con texto se
    // queda abierto — no se pierde un resultado por accidente).
    const { containerProps } = useSearchToggle({
        active: open,
        value,
        onClear: () => onChange?.(''),
        onClose: () => setIsOpen(false),
    });

    // text-body-xl obligatorio en TODO input de texto (§25 DESIGN.md) — por
    // debajo de 16px, Safari/iOS hace zoom automático al enfocar. sm/md solo
    // difieren en padding/ícono, nunca en tamaño de fuente.
    const sizeMap = {
        sm: { text: 'text-body-xl', icon: 14, px: 'pl-8 pr-7 py-1.5', iconLeft: 'left-2.5', clearRight: 'right-2' },
        md: { text: 'text-body-xl', icon: 15, px: 'pl-9 pr-8 py-2',   iconLeft: 'left-3',   clearRight: 'right-2.5' },
    };
    const s = sizeMap[size] ?? sizeMap.md;

    if (expandable) {
        return (
            <div
                {...containerProps}
                {...(open ? { 'data-surface': 'input' } : {})}
                onClick={() => { if (!open && !disabled) { setIsOpen(true); setTimeout(() => inputRef.current?.focus(), 120); } }}
                style={open && isFocused ? { borderColor: accentColor || 'var(--brand)' } : undefined}
                className={`flex items-center h-8 transition-[flex-grow,flex-basis,background-color,border-color] duration-[var(--dur-slow)] ease-[var(--ease-spring)] overflow-hidden ${
                    open
                        ? 'flex-1 min-w-0 cursor-text'
                        : 'flex-none w-8 rounded-lg bg-surface-card-hover border border-border-card cursor-pointer'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
            >
                <div className="w-8 h-8 flex items-center justify-center shrink-0" style={accentColor ? { color: accentColor } : undefined}>
                    {loading
                        ? <Loader2 size={14} className={`animate-spin ${accentColor ? '' : 'text-content-3'}`} />
                        : <Search size={14} strokeWidth={2.5} className={accentColor ? '' : 'text-content-3'} />}
                </div>
                <input inert={!(open) ? true : undefined}
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={e => onChange?.(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={onKeyDown}
                    placeholder={placeholder}
                    aria-label={ariaLabel ?? placeholder}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    disabled={disabled}
                    tabIndex={open ? 0 : -1}
                    className={`min-w-0 flex-1 bg-transparent border-none outline-none text-body-xl font-semibold text-content placeholder:text-content-3 transition-opacity duration-[var(--dur-base)] ${
                        open ? 'opacity-100 pr-1' : 'opacity-0 w-0 pointer-events-none'
                    }`}
                />
                {open && value && (
                    <button
                        type="button"
                        aria-label="Borrar la búsqueda"
                        onClick={e => { e.stopPropagation(); onChange?.(''); inputRef.current?.focus(); }}
                        // El ÁREA TOCABLE llega al piso de §25.6 en táctil; lo
                        // que se ve sigue siendo el círculo de 20px. Sin esto
                        // era 20×20 en el teléfono — y como vive en el
                        // canónico, lo era en TODA vista con buscador
                        // (auditoría 2026-07-29, medido en WebKit iPhone).
                        className="w-[max(1.25rem,var(--tap-min))] h-[max(1.25rem,var(--tap-min))] mr-1.5 shrink-0 flex items-center justify-center rounded-full text-content-3 hover:text-danger hover:bg-danger/10 transition-colors"
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
                ? <Loader2 size={s.icon} className={`absolute ${s.iconLeft} top-1/2 -translate-y-1/2 text-brand-text animate-spin pointer-events-none shrink-0`} />
                : <Search size={s.icon} strokeWidth={2.5} className={`absolute ${s.iconLeft} top-1/2 -translate-y-1/2 text-brand-text pointer-events-none shrink-0`} />}
            <input
                ref={inputRef}
                type="text"
                data-surface="input"
                value={value}
                onChange={e => onChange?.(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                autoComplete="off"
                autoFocus={autoFocus}
                disabled={disabled}
                className={`w-full ${s.px} ${s.text} font-semibold
                    text-content placeholder:text-content-3
                    outline-none transition-[outline-color] duration-[var(--dur-base)]
                    focus:outline-solid focus:outline-1 focus:outline-offset-[-1px] focus:outline-brand/60
                    disabled:opacity-50 disabled:cursor-not-allowed`}
            />
            {value && (
                <button
                    aria-label="Borrar la búsqueda"
                    onClick={() => { onChange?.(''); inputRef.current?.focus(); }}
                    className={`absolute ${s.clearRight} top-1/2 -translate-y-1/2
                        p-0.5 text-content-3 hover:text-danger transition-colors`}
                >
                    <X size={s.icon - 1} strokeWidth={2.5} />
                </button>
            )}
        </div>
    );
});

export default SearchInput;
