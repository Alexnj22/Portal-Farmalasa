import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

// eslint-disable-next-line react-refresh/only-export-components -- constante chica usada solo junto a este componente; solo afecta Fast Refresh en dev
export const PAGE_SIZE_OPTIONS = [25, 50, 100];

const navCls = (disabled) =>
    `w-8 h-8 flex items-center justify-center text-[11px] font-bold text-content-3 transition-colors duration-150 ${
        disabled
            ? 'opacity-45 cursor-not-allowed'
            : 'hover:text-brand hover:bg-surface-card-hover'
    }`;

function NavBtn({ disabled, onClick, title, children }) {
    return (
        <motion.button
            data-surface="input"
            disabled={disabled}
            onClick={onClick}
            title={title}
            whileHover={!disabled ? { scale: 1.1, y: -1.5 } : {}}
            whileTap={!disabled ? { scale: 0.92 } : {}}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={navCls(disabled)}
        >
            {children}
        </motion.button>
    );
}

function SmartPagination({ page, total, onChange }) {
    const [inputVal, setInputVal] = useState('');
    const inputRef = useRef();

    if (total <= 1) return null;

    const buildPages = () => {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        const pages = [1];
        const left  = Math.max(2, page - 1);
        const right = Math.min(total - 1, page + 1);
        if (left > 2)          pages.push('…');
        for (let i = left; i <= right; i++) pages.push(i);
        if (right < total - 1) pages.push('…');
        pages.push(total);
        return pages;
    };

    const commit = () => {
        const n = parseInt(inputVal, 10);
        if (!isNaN(n) && n >= 1 && n <= total) onChange(n);
        setInputVal('');
    };

    return (
        <div className="flex items-center gap-1.5">
            <NavBtn disabled={page <= 1} onClick={() => onChange(1)} title="Primera página">
                <ChevronsLeft size={12} strokeWidth={2.5} />
            </NavBtn>
            <NavBtn disabled={page <= 1} onClick={() => onChange(page - 1)} title="Página anterior">
                <ChevronLeft size={12} strokeWidth={2.5} />
            </NavBtn>

            {/* Page numbers — sliding blue pill via layoutId */}
            <div className="flex items-center gap-0.5 mx-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <div key={`e${i}`}
                            className="w-7 h-8 flex items-center justify-center select-none"
                          >
                            <span className="text-[13px] font-black text-content-3 leading-none tracking-[2px]">
                                ···
                            </span>
                          </div>
                        : <motion.button
                            key={p}
                            onClick={() => onChange(p)}
                            whileHover={p !== page ? { scale: 1.1, y: -1.5 } : {}}
                            whileTap={p !== page ? { scale: 0.9 } : {}}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            className="relative w-8 h-8 rounded-xl"
                          >
                            {p === page && (
                                <motion.div
                                    layoutId="activePage"
                                    className="absolute inset-0 rounded-xl bg-brand"
                                    style={{ boxShadow: '0 4px 14px rgba(0,82,204,0.40)' }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                                />
                            )}
                            <span className={`relative z-10 text-[12px] font-black transition-colors duration-150 ${
                                p === page ? 'text-white' : 'text-content-3'
                            }`}>
                                {p}
                            </span>
                          </motion.button>
                )}
            </div>

            {/* Always-visible Go-to input when many pages */}
            {total > 7 && (
                <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-divider">
                    <span className="text-[9px] text-content-3 font-black uppercase tracking-wider whitespace-nowrap">Ir a</span>
                    <input
                        ref={inputRef}
                        type="number"
                        min={1}
                        max={total}
                        value={inputVal}
                        onChange={e => setInputVal(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') setInputVal('');
                        }}
                        onBlur={commit}
                        placeholder="—"
                        data-surface="input"
                        className="w-11 h-7 text-center text-[16px] font-bold text-content focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand transition-shadow"
                    />
                    <span className="text-[9px] text-content-3 tabular-nums">/ {total}</span>
                </div>
            )}

            <NavBtn disabled={page >= total} onClick={() => onChange(page + 1)} title="Página siguiente">
                <ChevronRight size={12} strokeWidth={2.5} />
            </NavBtn>
            <NavBtn disabled={page >= total} onClick={() => onChange(total)} title="Última página">
                <ChevronsRight size={12} strokeWidth={2.5} />
            </NavBtn>
        </div>
    );
}

// ── TablePagination ───────────────────────────────────────────────────────────
export default function TablePagination({
    pageSize,
    onPageSizeChange,
    page,
    totalPages,
    onPageChange,
    total,
    unit = 'total',
    filteredTotal,
}) {
    const rootRef = useRef();
    const isFiltered = filteredTotal != null && filteredTotal !== total;

    // After any page/size change, keep pagination visible in the scroll container
    const navigate = useCallback((fn) => {
        fn();
        requestAnimationFrame(() => {
            rootRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
        });
    }, []);

    return (
        <div ref={rootRef} className="flex items-center justify-between gap-3 flex-wrap">

            {/* Page-size pills */}
            {onPageSizeChange && (
            <div data-surface="input" className="flex items-center gap-0.5 p-1">
                {PAGE_SIZE_OPTIONS.map(size => (
                    <motion.button
                        key={size}
                        onClick={() => navigate(() => { onPageSizeChange(size); onPageChange(1); })}
                        whileHover={pageSize !== size ? { scale: 1.05 } : {}}
                        whileTap={pageSize !== size ? { scale: 0.95 } : {}}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className={`px-3 h-7 rounded-xl text-[10px] font-bold transition-all duration-200 ${
                            pageSize === size
                                ? 'bg-brand text-white shadow-[0_2px_8px_rgba(0,82,204,0.30)] scale-[1.04]'
                                : 'text-content-3 hover:text-content hover:bg-surface-card-hover'
                        }`}
                    >
                        {size}
                    </motion.button>
                ))}
            </div>
            )}

            {/* Navigation */}
            <SmartPagination page={page} total={totalPages} onChange={(p) => navigate(() => onPageChange(p))} />

            {/* Total badge */}
            <div data-surface="input" className="flex items-center gap-1 px-3 h-8 min-w-[90px] justify-end">
                {isFiltered ? (
                    <>
                        <span className="text-[11px] font-black text-brand tabular-nums">{(filteredTotal ?? 0).toLocaleString()}</span>
                        <span className="text-[9px] text-content-3 mx-0.5">/</span>
                        <span className="text-[10px] font-semibold text-content-3 tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-content-3 ml-0.5">{unit}</span>
                    </>
                ) : (
                    <>
                        <span className="text-[11px] font-bold text-content tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-content-3 ml-0.5">{unit}</span>
                    </>
                )}
            </div>
        </div>
    );
}
