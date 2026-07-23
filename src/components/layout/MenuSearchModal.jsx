import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, X } from 'lucide-react';
import { smartFilter } from '../../utils/searchUtils';

/**
 * Buscador global del menú (Cmd/Ctrl+K). Indexa los módulos visibles para el
 * usuario (ya filtrados por permiso en AppLayout) contra su label, su grupo
 * y una lista de sinónimos por módulo (menuSearchKeywords.js) — así
 * "venta de productos" encuentra Ventas y "fichas de empleados" encuentra
 * Listado de Personal, sin que el usuario sepa el nombre exacto del módulo.
 */
export default function MenuSearchModal({ isOpen, onClose, items, onNavigate }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const [render, setRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setRender(true); // eslint-disable-line react-hooks/set-state-in-effect -- monta el modal en respuesta a isOpen, dispara animación de entrada
            setQuery('');
            setSelected(0);
            document.body.style.overflow = 'hidden';
            const t = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(t);
        }
        const timeout = setTimeout(() => setRender(false), 200);
        document.body.style.overflow = '';
        return () => clearTimeout(timeout);
    }, [isOpen]);

    const results = useMemo(() => {
        if (!query.trim()) return items;
        const { results } = smartFilter(query, items, (m) => [m.label, m.groupLabel, ...(m.keywords || [])]);
        return results;
    }, [query, items]);

    useEffect(() => { setSelected(0); }, [results.length === 0 ? 0 : query]); // eslint-disable-line react-hooks/set-state-in-effect -- reinicia selección al cambiar el filtro

    useEffect(() => {
        const el = listRef.current?.querySelector(`[data-idx="${selected}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    const navigate = (item) => {
        if (!item) return;
        onNavigate(item.path);
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => (i + 1) % Math.max(results.length, 1)); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => (i - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1)); return; }
        if (e.key === 'Enter') { e.preventDefault(); navigate(results[selected]); }
    };

    if (!render) return null;

    const overlayClass = isOpen ? 'opacity-100' : 'opacity-0';
    const modalClass = isOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95';

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center pt-[10vh] px-4">
            <div
                className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-200 ease-out ${overlayClass}`}
                onClick={onClose}
            />

            <div
                className={`relative w-full max-w-xl backdrop-blur-2xl bg-white/95 border border-white/80 rounded-[1.75rem] shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ${modalClass}`}
                onKeyDown={handleKeyDown}
            >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 blur-[60px] rounded-full pointer-events-none w-56 h-24 opacity-[0.15] bg-[#0052CC]" />

                {/* Input */}
                <div className="relative z-10 flex items-center gap-3 px-5 py-4 border-b border-slate-100/80">
                    <Search size={18} strokeWidth={2.5} className="text-[#0052CC] shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar en el portal… (ej. venta de productos, fichas de empleados)"
                        className="flex-1 bg-transparent outline-none text-[14px] font-semibold text-slate-700 placeholder:text-slate-400 placeholder:font-medium"
                    />
                    <button
                        onClick={onClose}
                        className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Results */}
                <div ref={listRef} className="relative z-10 max-h-[50vh] overflow-y-auto py-2">
                    {results.length === 0 ? (
                        <div className="px-5 py-10 text-center">
                            <div className="text-[13px] font-semibold text-slate-500">Sin resultados para “{query}”</div>
                            <div className="text-[11px] text-slate-400 mt-1">Probá con otra palabra, ej. el nombre de lo que buscás hacer.</div>
                        </div>
                    ) : (
                        results.map((item, idx) => {
                            const Icon = item.icon;
                            const isSelected = idx === selected;
                            return (
                                <button
                                    key={item.key}
                                    data-idx={idx}
                                    type="button"
                                    onMouseEnter={() => setSelected(idx)}
                                    onClick={() => navigate(item)}
                                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                                        isSelected ? 'bg-[#0052CC]/8' : 'hover:bg-slate-50'
                                    }`}
                                >
                                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition-colors ${
                                        isSelected ? 'bg-[#0052CC]/10 border-[#0052CC]/20 text-[#0052CC]' : 'bg-slate-50 border-slate-200/70 text-slate-500'
                                    }`}>
                                        {Icon && <Icon size={16} strokeWidth={2.25} />}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className={`block text-[13px] font-semibold truncate ${isSelected ? 'text-slate-800' : 'text-slate-700'}`}>
                                            {item.label}
                                        </span>
                                        <span className="block text-[11px] text-slate-400 truncate">{item.groupLabel}</span>
                                    </span>
                                </button>
                            );
                        })
                    )}
                </div>

                {/* Footer hint */}
                <div className="relative z-10 hidden sm:flex items-center gap-4 px-5 py-2.5 border-t border-slate-100/80 bg-slate-50/50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="flex items-center gap-1"><ArrowUp size={11} /><ArrowDown size={11} /> Navegar</span>
                    <span className="flex items-center gap-1"><CornerDownLeft size={11} /> Abrir</span>
                    <span className="ml-auto">Esc para cerrar</span>
                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
