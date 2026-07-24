import { useRef } from 'react';
import { Search, X } from 'lucide-react';

/**
 * Buscador inline para widgets, modales y tabs internos (Tipo 2).
 * Para el buscador principal de vista usar ViewTabBar.
 *
 * Props:
 *   value       – string
 *   onChange    – (value: string) => void
 *   placeholder – string
 *   size        – 'sm' | 'md'  (default: 'md')
 *   autoFocus   – bool
 *   className   – string extra para el wrapper
 */
export default function SearchInput({
    value = '',
    onChange,
    placeholder = 'Buscar...',
    size = 'md',
    autoFocus = false,
    className = '',
}) {
    const inputRef = useRef(null);

    const sizeMap = {
        sm: { text: 'text-[12px]', icon: 14, px: 'pl-8 pr-7 py-2',   iconLeft: 'left-2.5', clearRight: 'right-2' },
        md: { text: 'text-[13px]', icon: 15, px: 'pl-9 pr-8 py-2.5', iconLeft: 'left-3',   clearRight: 'right-2.5' },
    };
    const s = sizeMap[size] ?? sizeMap.md;

    return (
        <div className={`relative flex items-center ${className}`}>
            <Search
                size={s.icon}
                strokeWidth={2.5}
                className={`absolute ${s.iconLeft} top-1/2 -translate-y-1/2 text-brand pointer-events-none shrink-0`}
            />
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
