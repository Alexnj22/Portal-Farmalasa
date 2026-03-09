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
    theme = 'light' // 🚨 NUEVA PROPIEDAD: 'light' o 'dark'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    
    const selectRef = useRef(null);
    const inputRef = useRef(null);
    const dropdownRef = useRef(null);
    
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

    const isDark = theme === 'dark';

    const selectedOption = useMemo(() => 
        options.find(opt => String(opt.value) === String(value)), 
    [options, value]);

    const updateCoords = () => {
        if (selectRef.current) {
            const rect = selectRef.current.getBoundingClientRect();
            setCoords({
                top: rect.bottom + window.scrollY + 8,
                left: rect.left + window.scrollX,
                width: rect.width
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
                inputRef.current?.blur();
            }
        };
        
        const handleScroll = (e) => {
            if (dropdownRef.current && (dropdownRef.current === e.target || dropdownRef.current.contains(e.target))) {
                return;
            }
            if (isOpen) {
                setIsOpen(false);
                inputRef.current?.blur();
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
        updateCoords(); 
        setIsOpen(true);
        setSearchTerm('');
        setTimeout(() => inputRef.current?.focus(), 50); 
    };

    const handleClear = (e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange('');
        setSearchTerm('');
        if (isOpen) {
            inputRef.current?.focus();
        }
    };

    const handleToggle = (e) => {
        e.stopPropagation();
        if (disabled) return;
        if (isOpen) {
            setIsOpen(false);
            setSearchTerm('');
            inputRef.current?.blur();
        } else {
            handleOpen();
        }
    };

    const handleSelect = (val) => {
        onChange(val);
        setIsOpen(false);
        setSearchTerm('');
        inputRef.current?.blur();
    };

    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options;
        return options.filter(opt => 
            opt.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [options, searchTerm]);

    const dropdownContent = isOpen && (
        <div 
            ref={dropdownRef}
            style={{ 
                top: coords.top, 
                left: coords.left, 
                width: coords.width
            }}
            className={`absolute z-[9999] origin-top transition-all duration-300 rounded-[2rem] max-h-[300px] overflow-y-auto p-3 animate-in fade-in slide-in-from-top-2 duration-200 transform-gpu scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
            ${isDark 
                ? 'bg-[#0A0F1C]/90 backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 shadow-[0_24px_50px_rgba(0,0,0,0.5),inset_0_2px_15px_rgba(255,255,255,0.05)]' 
                : 'bg-white/40 hover:bg-white/60 backdrop-blur-[10px] backdrop-saturate-[80%] border border-white/90 shadow-[0_30px_80px_rgba(0,0,0,0.15),0_15px_30px_rgba(0,0,0,0.1),inset_0_2px_15px_rgba(255,255,255,0.8)] hover:shadow-[0_40px_100px_rgba(0,0,0,0.2),inset_0_2px_15px_rgba(255,255,255,0.9)] hover:-translate-y-0.5'
            }`}
        >
            <div className="flex flex-col gap-1 w-full">
                {!searchTerm && (
                    <button
                        type="button"
                        onClick={() => handleSelect('')}
                        className={`w-full text-left px-5 py-3.5 text-[12px] font-bold rounded-[1.25rem] transition-colors duration-200 border ${
                            value === '' 
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
                            onClick={() => handleSelect(opt.value)}
                            className={`w-full text-left px-5 py-3 text-[13px] font-bold rounded-[1.25rem] transition-all duration-200 truncate border ${
                                String(value) === String(opt.value) 
                                    ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)] border-transparent' 
                                    : isDark
                                        ? 'bg-transparent text-white/80 border-transparent hover:bg-white/10 hover:text-white hover:shadow-sm'
                                        : 'bg-transparent text-slate-700 border-transparent hover:bg-white/80 hover:text-slate-900 hover:shadow-sm'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))
                ) : (
                    <div className={`px-4 py-8 text-[12px] font-bold text-center flex flex-col items-center justify-center gap-3 opacity-80 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-sm ${isDark ? 'bg-white/5 text-white/40' : 'bg-white/60'}`}>
                            <Search size={20} strokeWidth={2}/>
                        </div>
                        No se encontraron resultados
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div 
            className={`relative group w-full transition-all duration-300 transform-gpu ${isOpen || disabled ? '' : 'hover:-translate-y-0.5'}`} 
            ref={selectRef}
        >
            <div className={`absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-[0.8rem] flex items-center justify-center shadow-sm transition-colors duration-300 z-10 pointer-events-none ${
                isOpen 
                    ? 'text-white bg-[#007AFF]' 
                    : isDark
                        ? 'bg-black/40 text-[#007AFF] border border-white/10 shadow-[inset_0_2px_10px_rgba(255,255,255,0.05)]'
                        : 'bg-white/80 text-[#007AFF] border border-white'
            }`}>
                {isOpen ? <Search size={14} strokeWidth={2.5}/> : (Icon ? <Icon size={14} strokeWidth={2.5}/> : <Search size={14} strokeWidth={2.5}/>)}
            </div>
            
            <input
                ref={inputRef}
                type="text"
                disabled={disabled}
                readOnly={!isOpen}
                onClick={handleOpen}
                onChange={(e) => setSearchTerm(e.target.value)}
                value={isOpen ? searchTerm : (selectedOption ? selectedOption.label : '')}
                placeholder={isOpen ? (selectedOption ? selectedOption.label : placeholder) : placeholder}
                className={`w-full pl-[3.5rem] pr-10 py-3.5 rounded-[1.5rem] text-[13px] font-bold transition-all duration-300 outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                    isDark
                        ? isOpen 
                            ? 'bg-black/50 border border-[#007AFF] shadow-[0_0_0_4px_rgba(0,122,255,0.15)] text-white placeholder-white/40'
                            : 'bg-black/30 backdrop-blur-xl border border-white/10 text-white placeholder-white/30 group-hover:bg-black/40 group-hover:border-white/20 cursor-pointer shadow-[inset_0_2px_15px_rgba(0,0,0,0.5)]'
                        : isOpen 
                            ? 'bg-white border-[#007AFF] shadow-[0_0_0_4px_rgba(0,122,255,0.15)] border text-slate-700 placeholder-slate-400' 
                            : 'bg-white/50 border border-white/60 group-hover:bg-white group-hover:border-white/90 cursor-pointer shadow-[inset_0_2px_10px_rgba(255,255,255,0.5)] group-hover:shadow-[0_8px_24px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.5)] text-slate-700 placeholder-slate-400'
                }`}
            />
            
            {/* BOTÓN DERECHO (Limpiar "X" o Flecha) */}
            {value && !isOpen ? (
                <button 
                    type="button"
                    onClick={handleClear}
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 outline-none p-1 cursor-pointer"
                    title="Quitar selección"
                >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 group-hover:shadow-sm ${
                        isDark 
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
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-10 outline-none p-1 cursor-pointer"
                >
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300 ${
                        isOpen 
                            ? isDark ? 'bg-blue-500/20' : 'bg-blue-50' 
                            : isDark ? 'bg-transparent group-hover:bg-white/10 hover:bg-white/20' : 'bg-transparent group-hover:bg-slate-100 hover:bg-slate-200'
                    }`}>
                        <ChevronDown size={14} strokeWidth={3} className={`transition-transform duration-300 ${
                            isOpen 
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