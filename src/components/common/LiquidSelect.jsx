import React, { useState, useRef, useEffect, useMemo, useId } from 'react';
import { ChevronDown, Search, X, Plus, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const LiquidSelect = ({
    value,
    onChange,
    options = [],
    placeholder = 'Seleccionar...',
    icon: Icon,
    disabled = false,
    clearable = true,
    compact = false,
    // Nano: variante ultra-angosta para steppers/celdas de grilla densa
    // (ej. TimePicker12, FormAiSchedulerPreview) — sin ícono izquierdo,
    // texto centrado, altura mínima reducida. No confundir con compact
    // (que sigue reservando espacio para ícono).
    nano = false,
    creatable = false,
    onCreateOption,
    // When options count exceeds this, require the user to type before showing results
    searchThreshold = 80,
    // Max options to render in the dropdown (applied after filtering)
    maxOptions = 100,
    // Server-side search: parent handles filtering, just display options as-is
    serverSearch = false,
    // Called (debounced 300ms) when user types — use to run server queries
    onSearchChange = null,
    // Show loading spinner inside dropdown
    isLoading = false,
    // Bare mode: no background/border/shadow — blends into a parent pill bar
    bare = false,
    // Texto del botón de limpiar selección. Default 'Todos' (uso como filtro
    // de listas); en formularios de datos usar algo como 'Ninguno'.
    clearLabel = 'Todos',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const listboxId = useId();
    const optionId = (idx) => `${listboxId}-option-${idx}`;

    const selectRef = useRef(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const itemRefs = useRef([]);

    // 🚨 ESTADO AMPLIADO PARA POSICIONAMIENTO INTELIGENTE
    const [coords, setCoords] = useState({
        top: 0,
        left: 0,
        width: 0,
        maxHeight: 300,
        transformOrigin: 'origin-top',
        isFlipped: false // Indica si se abrió hacia arriba
    });

    const lastCoordsRef = useRef(null);

    // --- VARIABLES DINÁMICAS SEGÚN MODO COMPACTO/NANO ---
    const textStyle = nano ? 'text-[11px] font-black' : `${compact ? 'text-[12px]' : 'text-[13px]'} font-bold`;
    const paddingStyle = nano ? 'pl-2 pr-4 py-1' : compact ? 'pl-7 pr-6 py-2' : 'pl-[3.5rem] pr-12 py-3.5';
    const leftIconPos = compact ? 'left-1 w-6 h-6' : 'left-4 w-8 h-8';
    const rightIconPos = nano ? 'right-0.5 w-3.5 h-3.5' : compact ? 'right-1 w-5 h-5' : 'right-4 w-6 h-6';
    const iconSize = nano ? 10 : compact ? 11 : 14;
    const minHeightClass = nano ? 'min-h-[26px]' : 'min-h-[40px]';

    const selectedOption = useMemo(() =>
        options.find(opt => String(opt.value) === String(value)),
        [options, value]);

    // 🚨 CEREBRO DE POSICIONAMIENTO Y COLISIÓN DE BORDES
    const updateCoords = () => {
        if (selectRef.current) {
            const rect = selectRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // Constantes de diseño
            const DROPDOWN_IDEAL_HEIGHT = 300;
            const MARGIN = 15; // Margen de seguridad desde los bordes de la pantalla

            // Cálculos de espacio disponible
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;

            // Use viewport coords (fixed positioning via portal — no scroll offset needed)
            let finalTop = rect.bottom + 8;
            let finalMaxHeight = DROPDOWN_IDEAL_HEIGHT;
            let finalOrigin = 'origin-top';
            let flipped = false;

            if (spaceBelow < DROPDOWN_IDEAL_HEIGHT && spaceAbove > spaceBelow) {
                flipped = true;
                finalOrigin = 'origin-bottom';
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceAbove - MARGIN);
                finalTop = rect.top - finalMaxHeight - 8;
            } else {
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceBelow - MARGIN);
            }

            const next = {
                top: finalTop,
                left: rect.left,
                width: rect.width,
                maxHeight: Math.max(finalMaxHeight, 150),
                transformOrigin: finalOrigin,
                isFlipped: flipped
            };

            // Evita re-renders innecesarios cuando el tracking continuo (ver
            // abajo) recalcula cada frame pero la posición no cambió.
            const prev = lastCoordsRef.current;
            if (!prev || prev.top !== next.top || prev.left !== next.left ||
                prev.width !== next.width || prev.maxHeight !== next.maxHeight ||
                prev.transformOrigin !== next.transformOrigin) {
                lastCoordsRef.current = next;
                setCoords(next);
            }
        }
    };

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (
                selectRef.current && !selectRef.current.contains(e.target) &&
                (!dropdownRef.current || !dropdownRef.current.contains(e.target))
            ) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);

    // 🚨 SEGUIMIENTO CONTINUO DE POSICIÓN (fix bug histórico de selects)
    // Antes, la posición se calculaba UNA sola vez al abrir y luego se
    // forzaba el cierre ante CUALQUIER scroll de la página (incluso de
    // contenedores sin relación con este select — window.addEventListener
    // con capture:true recibe el scroll de cualquier elemento anidado).
    // Eso producía dos síntomas reportados como "el select no abre bien":
    //   1) Si el trigger vive dentro de un bloque que recién apareció con
    //      una animación (animate-in zoom-in-95, muy común en el proyecto
    //      para campos condicionales), un click justo durante esos ~200ms
    //      capturaba el rect a mitad de la animación → el dropdown quedaba
    //      flotando en una posición vieja, desconectado del trigger real.
    //   2) Un scroll en cualquier otra parte de la página cerraba el
    //      select recién abierto, percibido como "no abre" o "se oculta".
    // Ahora se recalcula en cada frame mientras está abierto (igual que
    // Popper/Floating UI), así el dropdown sigue al trigger en vivo pase
    // lo que pase (animación, scroll, resize de hermanos), y solo se
    // cierra si el trigger deja de estar visible en el viewport.
    useEffect(() => {
        if (!isOpen) return;
        let rafId;
        const tick = () => {
            if (!selectRef.current) return;
            const rect = selectRef.current.getBoundingClientRect();
            if (rect.bottom < 0 || rect.top > window.innerHeight) {
                setIsOpen(false);
                return;
            }
            updateCoords();
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [isOpen]);

    const handleOpen = () => {
        if (disabled) return;
        updateCoords(); // Calculamos el espacio antes de abrir
        setIsOpen(true);
        setSearchTerm('');
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleClear = (e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange('');
        setSearchTerm('');
    };

    const handleToggle = (e) => {
        e.stopPropagation();
        if (disabled) return;
        if (isOpen) {
            setIsOpen(false);
            setSearchTerm('');
        } else {
            handleOpen();
        }
    };

    const handleSelect = (val) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
    };

    const isLargeList = !serverSearch && options.length > searchThreshold;

    const filteredOptions = useMemo(() => {
        if (serverSearch) {
            // Parent controls data — show everything except separator and empty-value (handled by clearable button)
            return options.filter(opt => !opt.isSeparator && opt.value !== '');
        }
        // Large lists: require typing before showing anything
        if (isLargeList && !searchTerm) return [];
        if (!searchTerm) return options.slice(0, maxOptions);
        const q = normalize(searchTerm);
        return options.filter(opt =>
            !opt.isSeparator &&
            (normalize(opt.label).includes(q) ||
            (opt.sublabel && normalize(opt.sublabel).includes(q)))
        ).slice(0, maxOptions);
    }, [options, searchTerm, isLargeList, maxOptions, serverSearch]);

    // Navigable (non-separator, non-disabled) options — used for keyboard nav
    const selectableOptions = useMemo(() =>
        filteredOptions.filter(o => !o.isSeparator && !o.disabled),
    [filteredOptions]);

    // Reset highlight when options change or dropdown closes
    useEffect(() => { setHighlightedIndex(-1); itemRefs.current = []; }, [filteredOptions, isOpen]); // eslint-disable-line react-hooks/set-state-in-effect

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightedIndex >= 0 && itemRefs.current[highlightedIndex]) {
            itemRefs.current[highlightedIndex].scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex]);

    const dropdownContent = (
        <motion.div
            key="liquid-dropdown"
            ref={dropdownRef}
            data-surface="dropdown"
            id={listboxId}
            role="listbox"
            style={{
                top: coords.top,
                left: coords.left,
                width: Math.max(coords.width, nano ? 120 : compact ? 170 : 200) + 'px',
                maxHeight: coords.maxHeight + 'px',
            }}
            initial={{ opacity: 0, scale: 0.97, y: coords.isFlipped ? 6 : -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: coords.isFlipped ? 6 : -6 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className={`fixed z-[99999] ${coords.transformOrigin} overflow-y-auto p-3
            transform-gpu scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]`}
        >
            {/* Si se abre hacia arriba, mostramos los resultados en el mismo orden, pero invertimos la posición del botón "Limpiar/Placeholder" si es necesario. Por UX, es mejor dejarlo arriba */}
            <div className="flex flex-col gap-1 w-full">
                {!searchTerm && clearable && value != null && value !== '' && (
                    <button
                        type="button"
                        onClick={() => handleSelect('')}
                        className="w-full text-left px-4 py-3 text-[12px] font-bold rounded-[1.25rem] transition-colors duration-200 text-content-3 hover:bg-surface-card-hover hover:text-content"
                    >
                        {clearLabel}
                    </button>
                )}
                {isLoading ? (
                    <div className="px-4 py-6 text-[12px] font-bold text-center flex items-center justify-center gap-2.5 text-content-3">
                        <Loader2 size={15} strokeWidth={2.5} className="animate-spin" />
                        Buscando...
                    </div>
                ) : isLargeList && !searchTerm ? (
                    <div className="px-4 py-8 text-[12px] font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 text-content-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-surface-card-hover">
                            <Search size={20} strokeWidth={2} />
                        </div>
                        Escribe para buscar
                    </div>
                ) : filteredOptions.length > 0 ? (
                    filteredOptions.map((opt) => {
                        const sIdx = selectableOptions.indexOf(opt);
                        const isHighlighted = sIdx >= 0 && sIdx === highlightedIndex;
                        return opt.isSeparator ? (
                            <div
                                key={opt.value}
                                className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-[0.15em] mt-1 border-t border-divider first:border-t-0 first:pt-1 text-content-3"
                            >
                                {opt.label}
                            </div>
                        ) : (
                            <button
                                key={opt.value}
                                ref={sIdx >= 0 ? el => { itemRefs.current[sIdx] = el; } : undefined}
                                type="button"
                                id={sIdx >= 0 ? optionId(sIdx) : undefined}
                                role="option"
                                aria-selected={String(value) === String(opt.value)}
                                onClick={() => !opt.disabled && handleSelect(opt.value)}
                                className={`w-full text-left px-3 py-2.5 ${textStyle} whitespace-normal break-words leading-tight rounded-[1.25rem] transition-all duration-200 border border-transparent flex items-center gap-2.5 ${
                                    opt.disabled
                                        ? 'opacity-40 cursor-not-allowed bg-transparent text-content-3'
                                        : String(value) === String(opt.value)
                                            ? 'bg-brand text-white shadow-[0_4px_12px_rgba(0,82,204,0.3)]'
                                            : isHighlighted
                                                ? 'bg-brand/[0.08] text-content border-brand/20'
                                                : 'bg-transparent text-content-2 hover:bg-surface-card-hover hover:text-content'
                                }`}
                            >
                                {opt.avatar !== undefined && (
                                    <div className="w-6 h-6 rounded-full overflow-hidden bg-surface-card-hover border border-border-card shrink-0 flex items-center justify-center text-[9px] font-black text-content-3">
                                        {opt.avatar
                                            ? <img src={opt.avatar} alt={opt.label} className="w-full h-full object-cover" />
                                            : (opt.label || '?').charAt(0).toUpperCase()
                                        }
                                    </div>
                                )}
                                <span className="flex-1 min-w-0">
                                    <span className="block leading-tight">{opt.label}</span>
                                    {opt.sublabel && (
                                        <span className={`block text-[10px] font-medium leading-tight mt-0.5 ${
                                            String(value) === String(opt.value) && !opt.disabled ? 'text-white/70' : 'text-content-3'
                                        }`}>
                                            {opt.sublabel}
                                        </span>
                                    )}
                                </span>
                            </button>
                        );
                    })
                ) : (
                    <div className="px-4 py-8 text-[12px] font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 text-content-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-sm bg-surface-card-hover">
                            <Search size={20} strokeWidth={2} />
                        </div>
                        Sin resultados
                    </div>
                )}
                {serverSearch && !searchTerm && !isLoading && (
                    <div className="px-4 pt-1 pb-2 text-[10px] font-bold text-center text-content-3">
                        Escribe para buscar
                    </div>
                )}
                {creatable && onCreateOption && searchTerm.trim() &&
                    !filteredOptions.some(o => o.label.toLowerCase() === searchTerm.trim().toLowerCase()) && (
                    <button
                        type="button"
                        onClick={() => {
                            onCreateOption(searchTerm.trim());
                            setIsOpen(false);
                            setSearchTerm('');
                        }}
                        className="w-full text-left px-3 py-2.5 text-[12px] font-bold rounded-[1.25rem] transition-all flex items-center gap-2 mt-1 text-success hover:bg-success/10"
                    >
                        <Plus size={12} strokeWidth={3} className="shrink-0" />
                        Agregar: <span className="font-black ml-0.5">{searchTerm.trim()}</span>
                    </button>
                )}
            </div>
        </motion.div>
    );

    // data-surface="input" (mismo token que dropdown/DataTable) va en este
    // mismo div SOLO si no es bare — bare existe para fundirse en la barra
    // del padre sin fondo propio, y data-surface siempre pinta su bg/border/
    // shadow por cascade layers sin importar las clases Tailwind del mismo
    // elemento, así que no puede convivir con "bg-transparent".
    const pillBaseClasses = `w-full transition-all duration-300 outline-none ${minHeightClass} flex items-center text-content ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    } ${bare ? 'bg-transparent' : ''} ${
        !bare && isOpen ? 'outline outline-2 outline-offset-0 outline-brand/30' : ''
    }`;

    return (
        <div
            className={`relative group w-full transition-all duration-300 transform-gpu ${(!isOpen && !disabled && !bare) ? 'hover:-translate-y-0.5' : ''}`}
            ref={selectRef}
        >
            {/* ICONO IZQUIERDO — omitido en nano (steppers/grillas densas sin espacio) */}
            {!nano && (
                <div className={`absolute ${leftIconPos} top-1/2 -translate-y-1/2 rounded-[0.8rem] flex items-center justify-center transition-colors duration-300 z-10 pointer-events-none ${isOpen
                        ? 'text-white bg-brand shadow-sm'
                        : bare
                            ? 'bg-transparent text-brand'
                            : 'bg-surface-card-hover text-brand border border-border-card shadow-sm'
                    }`}>
                    {isOpen ? <Search size={iconSize} strokeWidth={2.5} /> : (Icon ? <Icon size={iconSize} strokeWidth={2.5} /> : <Search size={iconSize} strokeWidth={2.5} />)}
                </div>
            )}

            {/* CONTENEDOR PRINCIPAL
                Ghost-sizer pattern: the display div is always in flow (determines width).
                When open, it stays invisible so the container width doesn't change.
                The search input is layered on top via absolute positioning.           */}
            <div
                {...(!bare ? { 'data-surface': 'input' } : {})}
                className={`${pillBaseClasses} relative`}
                onClick={handleOpen}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={isOpen ? listboxId : undefined}
                aria-activedescendant={isOpen && highlightedIndex >= 0 ? optionId(highlightedIndex) : undefined}
            >
                {/* Always-rendered display content — keeps container width stable */}
                <div className={`w-full ${nano ? 'text-center justify-center' : 'text-left'} ${textStyle} ${paddingStyle} whitespace-nowrap leading-tight flex items-center gap-2
                    ${isOpen ? 'invisible pointer-events-none select-none' : ''}
                    ${!selectedOption && !isOpen ? 'text-content-3' : ''}`}>
                    {selectedOption ? (
                        <>
                            {selectedOption.avatar !== undefined && (
                                <div className="w-6 h-6 rounded-full overflow-hidden bg-surface-card-hover border border-border-card shrink-0 flex items-center justify-center text-[9px] font-black text-content-3">
                                    {selectedOption.avatar
                                        ? <img src={selectedOption.avatar} alt={selectedOption.label} className="w-full h-full object-cover" />
                                        : (selectedOption.label || '?').charAt(0).toUpperCase()
                                    }
                                </div>
                            )}
                            <span className="flex-1 min-w-0">
                                <span className="block leading-tight truncate" title={selectedOption.label}>{selectedOption.label}</span>
                                {selectedOption.sublabel && (
                                    <span className="block text-[10px] font-medium leading-tight mt-0.5 truncate text-content-3">
                                        {selectedOption.sublabel}
                                    </span>
                                )}
                            </span>
                        </>
                    ) : placeholder}
                </div>

                {/* Search input — overlaid absolutely when open */}
                {isOpen && (
                    <input
                        ref={inputRef}
                        type="text"
                        className={`absolute inset-0 w-full bg-transparent border-none outline-none ${nano ? 'text-center' : ''} ${textStyle} ${paddingStyle} text-content placeholder:text-content-3`}
                        onChange={(e) => {
                            const val = e.target.value;
                            setSearchTerm(val);
                            if (onSearchChange) {
                                clearTimeout(searchDebounceRef.current);
                                searchDebounceRef.current = setTimeout(() => onSearchChange(val), 300);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlightedIndex(i => {
                                    const next = i + 1;
                                    return next >= selectableOptions.length ? 0 : next;
                                });
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlightedIndex(i => {
                                    const next = i - 1;
                                    return next < 0 ? selectableOptions.length - 1 : next;
                                });
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                if (highlightedIndex >= 0 && selectableOptions[highlightedIndex]) {
                                    handleSelect(selectableOptions[highlightedIndex].value);
                                }
                            }
                        }}
                        value={searchTerm}
                        placeholder="Buscar..."
                    />
                )}
            </div>

            {/* BOTÓN DERECHO */}
            {value && clearable && !isOpen ? (
                <button
                    type="button"
                    onClick={handleClear}
                    className={`absolute ${rightIconPos} top-1/2 -translate-y-1/2 z-10 outline-none p-1 cursor-pointer flex items-center justify-center`}
                    title="Quitar selección"
                >
                    <div className="w-full h-full rounded-full flex items-center justify-center transition-colors duration-300 group-hover:shadow-sm bg-danger/10 hover:bg-danger text-danger hover:text-white">
                        <X size={12} strokeWidth={3} className="transition-transform duration-300 hover:rotate-90" />
                    </div>
                </button>
            ) : (
                <button
                    type="button"
                    onClick={handleToggle}
                    className={`absolute ${rightIconPos} top-1/2 -translate-y-1/2 z-10 outline-none p-0.5 cursor-pointer flex items-center justify-center`}
                >
                    <div className={`w-full h-full rounded-full flex items-center justify-center transition-colors duration-300 ${isOpen
                            ? 'bg-brand/[0.12]'
                            : 'bg-transparent group-hover:bg-surface-card-hover hover:bg-surface-card-hover'
                        }`}>
                        <ChevronDown size={iconSize} strokeWidth={3} className={`transition-transform duration-300 ${isOpen
                                ? 'rotate-180 text-brand'
                                : 'text-content-3'
                            }`} />
                    </div>
                </button>
            )}

            {createPortal(
                <AnimatePresence>{isOpen ? dropdownContent : null}</AnimatePresence>,
                document.body
            )}
        </div>
    );
};

export default LiquidSelect;
