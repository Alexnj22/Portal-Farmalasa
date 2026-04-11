import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';

const LiquidSelect = ({
    value,
    onChange,
    options = [],
    placeholder = 'Seleccionar...',
    icon: Icon,
    disabled = false,
    clearable = true,
    theme = 'light',
    compact = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const selectRef = useRef(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);

    // 🚨 ESTADO AMPLIADO PARA POSICIONAMIENTO INTELIGENTE
    const [coords, setCoords] = useState({ 
        top: 0, 
        left: 0, 
        width: 0, 
        maxHeight: 300, 
        transformOrigin: 'origin-top',
        isFlipped: false // Indica si se abrió hacia arriba
    });

    const isDark = theme === 'dark';

    // --- VARIABLES DINÁMICAS SEGÚN MODO COMPACTO ---
    const textStyle = `${compact ? 'text-[12px]' : 'text-[13px]'} font-bold`;
    const paddingStyle = compact ? 'pl-10 pr-9 py-2.5' : 'pl-[3.5rem] pr-10 py-3.5';
    const leftIconPos = compact ? 'left-1.5 w-7 h-7' : 'left-4 w-8 h-8';
    const rightIconPos = compact ? 'right-1.5 w-6 h-6' : 'right-4 w-6 h-6';
    const iconSize = compact ? 13 : 14;

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

            let finalTop = rect.bottom + window.scrollY + 8; // Posición normal (abajo)
            let finalMaxHeight = DROPDOWN_IDEAL_HEIGHT;
            let finalOrigin = 'origin-top';
            let flipped = false;

            // Lógica de decisión: ¿Hacia arriba o hacia abajo?
            if (spaceBelow < DROPDOWN_IDEAL_HEIGHT && spaceAbove > spaceBelow) {
                // Hay más espacio arriba, así que abrimos hacia arriba (Flipped)
                flipped = true;
                finalOrigin = 'origin-bottom';
                
                // El maxHeight es el espacio de arriba menos un margen
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceAbove - MARGIN); 
                
                // La posición Y será exactamente la parte superior del input, menos la altura del dropdown y un margen.
                // Restamos window.scrollY para compensar si el usuario bajó la página.
                finalTop = (rect.top + window.scrollY) - finalMaxHeight - 8; 
            } else {
                // Abrimos hacia abajo normal, pero aseguramos que el scroll interno funcione si roza el piso
                finalMaxHeight = Math.min(DROPDOWN_IDEAL_HEIGHT, spaceBelow - MARGIN);
            }

            setCoords({
                top: finalTop,
                left: rect.left + window.scrollX,
                width: rect.width,
                maxHeight: Math.max(finalMaxHeight, 150), // Nunca dejar que sea más pequeño que 150px
                transformOrigin: finalOrigin,
                isFlipped: flipped
            });
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

        const handleScroll = (e) => {
            if (dropdownRef.current && (dropdownRef.current === e.target || dropdownRef.current.contains(e.target))) {
                return;
            }
            if (isOpen) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
            window.addEventListener('scroll', handleScroll, true);
            window.addEventListener('resize', updateCoords);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', updateCoords);
        };
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

    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options;
        const lower = searchTerm.toLowerCase();
        return options.filter(opt =>
            opt.label.toLowerCase().includes(lower) ||
            (opt.sublabel && opt.sublabel.toLowerCase().includes(lower))
        );
    }, [options, searchTerm]);

    const dropdownContent = isOpen && (
        <div
            ref={dropdownRef}
            style={{
                top: coords.top,
                left: coords.left,
                width: Math.max(coords.width, compact ? 150 : 200) + 'px',
                maxHeight: coords.maxHeight + 'px', // 🚨 EL MAX-HEIGHT DINÁMICO
            }}
            className={`absolute z-[99999] ${coords.transformOrigin} transition-all duration-300 rounded-[1.5rem] overflow-y-auto p-3 
            ${coords.isFlipped ? 'animate-in fade-in slide-in-from-bottom-2' : 'animate-in fade-in slide-in-from-top-2'} 
            duration-200 transform-gpu scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
            ${isDark
                    ? 'bg-[#0A0F1C]/90 backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_2px_15px_rgba(255,255,255,0.05)]'
                    : 'bg-white/60 hover:bg-white/70 backdrop-blur-[20px] backdrop-saturate-[150%] border border-white/90 shadow-[0_30px_80px_rgba(0,0,0,0.15),0_15px_30px_rgba(0,0,0,0.1),inset_0_2px_15px_rgba(255,255,255,0.8)] hover:shadow-[0_40px_100px_rgba(0,0,0,0.2),inset_0_2px_15px_rgba(255,255,255,0.9)] hover:-translate-y-0.5'
                }`}
        >
            {/* Si se abre hacia arriba, mostramos los resultados en el mismo orden, pero invertimos la posición del botón "Limpiar/Placeholder" si es necesario. Por UX, es mejor dejarlo arriba */}
            <div className="flex flex-col gap-1 w-full">
                {!searchTerm && clearable && (
                    <button
                        type="button"
                        onClick={() => handleSelect('')}
                        className={`w-full text-left px-4 py-3 text-[12px] font-bold rounded-[1.25rem] transition-colors duration-200 border ${value === ''
                                ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] border-[#007AFF]'
                                : isDark
                                    ? 'bg-transparent text-white/50 border-transparent hover:bg-white/10 hover:text-white'
                                    : 'bg-transparent text-slate-500 border-transparent hover:bg-white/80 hover:text-slate-800'
                            }`}
                    >
                        {placeholder}
                    </button>
                )}
                {filteredOptions.length > 0 ? (
                    filteredOptions.map((opt) => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => !opt.disabled && handleSelect(opt.value)}
                            className={`w-full text-left px-4 py-3 ${textStyle} whitespace-normal break-words leading-tight rounded-[1.25rem] transition-all duration-200 border ${
                                opt.disabled
                                    ? 'opacity-40 cursor-not-allowed ' + (isDark ? 'bg-transparent text-white/40 border-transparent' : 'bg-transparent text-slate-400 border-transparent')
                                    : String(value) === String(opt.value)
                                        ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] border-transparent'
                                        : isDark
                                            ? 'bg-transparent text-white/80 border-transparent hover:bg-white/10 hover:text-white'
                                            : 'bg-transparent text-slate-700 border-transparent hover:bg-white/80 hover:text-slate-900'
                            }`}
                        >
                            <span className="block leading-tight">{opt.label}</span>
                            {opt.sublabel && (
                                <span className={`block text-[10px] font-medium leading-tight mt-0.5 ${
                                    String(value) === String(opt.value) && !opt.disabled ? 'text-white/70' : 'text-slate-400'
                                }`}>
                                    {opt.sublabel}
                                </span>
                            )}
                        </button>
                    ))
                ) : (
                    <div className={`px-4 py-8 text-[12px] font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${isDark ? 'bg-white/5 text-white/40' : 'bg-white/60'}`}>
                            <Search size={20} strokeWidth={2} />
                        </div>
                        Sin resultados
                    </div>
                )}
            </div>
        </div>
    );

    const pillBaseClasses = `w-full rounded-[1.5rem] transition-all duration-300 outline-none min-h-[40px] flex items-center ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    } ${
        isDark
            ? isOpen
                ? 'bg-black/50 border border-[#007AFF] shadow-[0_0_0_4px_rgba(0,122,255,0.15)] text-white'
                : 'bg-black/30 backdrop-blur-xl border border-white/10 text-white group-hover:bg-black/40 group-hover:border-white/20 shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)]'
            : isOpen
                ? 'bg-white border-[#007AFF] shadow-[0_0_0_4px_rgba(0,122,255,0.15)] border text-slate-700'
                : 'bg-white/50 backdrop-blur-[10px] backdrop-saturate-[80%] border border-white/60 group-hover:bg-white/80 group-hover:border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.5)] text-slate-700'
    }`;

    return (
        <div
            className={`relative group w-full transition-all duration-300 transform-gpu ${isOpen || disabled ? '' : 'hover:-translate-y-0.5'}`}
            ref={selectRef}
        >
            {/* ICONO IZQUIERDO */}
            <div className={`absolute ${leftIconPos} top-1/2 -translate-y-1/2 rounded-[0.8rem] flex items-center justify-center shadow-sm transition-colors duration-300 z-10 pointer-events-none ${isOpen
                    ? 'text-white bg-[#007AFF]'
                    : isDark
                        ? 'bg-black/40 text-[#007AFF] border border-white/10 shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)]'
                        : 'bg-white/80 text-[#007AFF] border border-white'
                }`}>
                {isOpen ? <Search size={iconSize} strokeWidth={2.5} /> : (Icon ? <Icon size={iconSize} strokeWidth={2.5} /> : <Search size={iconSize} strokeWidth={2.5} />)}
            </div>

            {/* CONTENEDOR PRINCIPAL */}
            <div 
                className={pillBaseClasses}
                onClick={handleOpen}
            >
                {isOpen ? (
                    <input
                        ref={inputRef}
                        type="text"
                        className={`w-full bg-transparent border-none outline-none ${textStyle} ${paddingStyle} ${isDark ? 'text-white placeholder-white/40' : 'text-slate-700 placeholder-slate-400'}`}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        value={searchTerm}
                        placeholder="Buscar..."
                    />
                ) : (
                    <div className={`w-full text-left ${textStyle} ${paddingStyle} whitespace-normal break-words leading-tight ${!selectedOption && (isDark ? 'text-white/40' : 'text-slate-400')}`}>
                        {selectedOption ? (
                            <>
                                <span className="block leading-tight">{selectedOption.label}</span>
                                {selectedOption.sublabel && (
                                    <span className={`block text-[10px] font-medium leading-tight mt-0.5 ${isDark ? 'opacity-50' : 'text-slate-400'}`}>
                                        {selectedOption.sublabel}
                                    </span>
                                )}
                            </>
                        ) : placeholder}
                    </div>
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
                    <div className={`w-full h-full rounded-full flex items-center justify-center transition-colors duration-300 group-hover:shadow-sm ${isDark
                            ? 'bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white'
                            : 'bg-red-50 hover:bg-red-500 text-red-400 hover:text-white'
                        }`}>
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
                            ? isDark ? 'bg-blue-500/20' : 'bg-blue-50'
                            : isDark ? 'bg-transparent group-hover:bg-white/10 hover:bg-white/20' : 'bg-transparent group-hover:bg-slate-100 hover:bg-slate-200'
                        }`}>
                        <ChevronDown size={iconSize} strokeWidth={3} className={`transition-transform duration-300 ${isOpen
                                ? 'rotate-180 text-[#007AFF]'
                                : isDark ? 'text-white/40' : 'text-slate-400'
                            }`} />
                    </div>
                </button>
            )}

            {isOpen && createPortal(dropdownContent, document.body)}
        </div>
    );
};

export default LiquidSelect;