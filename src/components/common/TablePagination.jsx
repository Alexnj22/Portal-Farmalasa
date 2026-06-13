import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [25, 50, 100];

const navCls = (disabled) =>
    `w-8 h-8 flex items-center justify-center rounded-xl text-[11px] font-bold border transition-colors duration-150 ${
        disabled
            ? 'bg-white/30 border-white/40 text-slate-200 cursor-not-allowed'
            : 'bg-white/70 backdrop-blur-sm border-white/80 text-slate-500 hover:border-[#0052CC]/30 hover:text-[#0052CC] hover:bg-white shadow-sm'
    }`;

function NavBtn({ disabled, onClick, title, children }) {
    return (
        <motion.button
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
    const [editing, setEditing] = useState(false);
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
        setEditing(false);
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
                        ? <button
                            key={`e${i}`}
                            onClick={() => {
                                setEditing(true);
                                setInputVal('');
                                requestAnimationFrame(() => inputRef.current?.focus());
                            }}
                            className="w-7 h-8 flex items-center justify-center transition-all duration-200 hover:scale-110 select-none group"
                          >
                            <span className="text-[9px] tracking-[3px] text-slate-300 group-hover:text-[#0052CC] transition-colors leading-none translate-y-[-1px]">
                                •••
                            </span>
                          </button>
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
                                    className="absolute inset-0 rounded-xl bg-[#0052CC]"
                                    style={{ boxShadow: '0 4px 14px rgba(0,82,204,0.40)' }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                                />
                            )}
                            <span className={`relative z-10 text-[12px] font-black transition-colors duration-150 ${
                                p === page ? 'text-white' : 'text-slate-500 group-hover:text-slate-800'
                            }`}>
                                {p}
                            </span>
                          </motion.button>
                )}
            </div>

            {/* Manual page input */}
            <AnimatePresence>
                {editing && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.88, x: -6 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.88, x: -6 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        className="flex items-center gap-1.5 ml-0.5"
                    >
                        <span className="text-[9px] text-slate-400 font-semibold whitespace-nowrap">Ir a</span>
                        <input
                            ref={inputRef}
                            type="number" min={1} max={total}
                            value={inputVal}
                            onChange={e => setInputVal(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') commit();
                                if (e.key === 'Escape') { setEditing(false); setInputVal(''); }
                            }}
                            onBlur={commit}
                            placeholder={String(page)}
                            className="w-12 h-7 text-center text-[12px] font-bold text-slate-700 bg-white border border-[#0052CC]/30 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0052CC]/25 focus:border-[#0052CC] shadow-sm transition-shadow"
                        />
                        <span className="text-[9px] text-slate-400 tabular-nums">/ {total}</span>
                    </motion.div>
                )}
            </AnimatePresence>

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
    const isFiltered = filteredTotal != null && filteredTotal !== total;

    return (
        <div className="flex items-center justify-between gap-3 flex-wrap">

            {/* Page-size pills */}
            <div className="flex items-center gap-0.5 p-1 rounded-2xl bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_2px_8px_rgba(0,82,204,0.07)]">
                {PAGE_SIZE_OPTIONS.map(size => (
                    <motion.button
                        key={size}
                        onClick={() => { onPageSizeChange(size); onPageChange(1); }}
                        whileHover={pageSize !== size ? { scale: 1.05 } : {}}
                        whileTap={pageSize !== size ? { scale: 0.95 } : {}}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className={`px-3 h-7 rounded-xl text-[10px] font-bold transition-all duration-200 ${
                            pageSize === size
                                ? 'bg-[#0052CC] text-white shadow-[0_2px_8px_rgba(0,82,204,0.30)] scale-[1.04]'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-white/70'
                        }`}
                    >
                        {size}
                    </motion.button>
                ))}
            </div>

            {/* Navigation */}
            <SmartPagination page={page} total={totalPages} onChange={onPageChange} />

            {/* Total badge */}
            <div className="flex items-center gap-1 px-3 h-8 rounded-2xl bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_2px_8px_rgba(0,82,204,0.07)] min-w-[90px] justify-end">
                {isFiltered ? (
                    <>
                        <span className="text-[11px] font-black text-[#0052CC] tabular-nums">{(filteredTotal ?? 0).toLocaleString()}</span>
                        <span className="text-[9px] text-slate-300 mx-0.5">/</span>
                        <span className="text-[10px] font-semibold text-slate-400 tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-slate-400 ml-0.5">{unit}</span>
                    </>
                ) : (
                    <>
                        <span className="text-[11px] font-bold text-slate-600 tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-slate-400 ml-0.5">{unit}</span>
                    </>
                )}
            </div>
        </div>
    );
}
