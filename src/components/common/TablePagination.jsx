import { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [25, 50, 100];

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

    const navCls = (disabled) =>
        `w-8 h-8 flex items-center justify-center rounded-xl text-[11px] font-bold transition-all duration-150 border ${
            disabled
                ? 'bg-white/40 border-white/60 text-slate-300 cursor-not-allowed'
                : 'bg-white/70 backdrop-blur-sm border-white/80 text-slate-500 hover:border-[#0052CC]/30 hover:text-[#0052CC] hover:shadow-[0_2px_8px_rgba(0,82,204,0.15)] hover:-translate-y-[1px] active:translate-y-0 active:shadow-none shadow-sm'
        }`;

    return (
        <div className="flex items-center gap-1">
            {/* First */}
            <button disabled={page <= 1} onClick={() => onChange(1)} className={navCls(page <= 1)} title="Primera página">
                <ChevronsLeft size={12} strokeWidth={2.5} />
            </button>
            {/* Prev */}
            <button disabled={page <= 1} onClick={() => onChange(page - 1)} className={navCls(page <= 1)} title="Página anterior">
                <ChevronLeft size={12} strokeWidth={2.5} />
            </button>

            {/* Page numbers */}
            <div className="flex items-center gap-0.5 mx-0.5">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <button key={`e${i}`}
                            onClick={() => { setEditing(true); setInputVal(''); requestAnimationFrame(() => inputRef.current?.focus()); }}
                            className="w-7 h-8 flex items-center justify-center text-[11px] font-bold text-slate-300 hover:text-[#0052CC] transition-colors select-none tracking-widest">
                            ···
                          </button>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-xl text-[12px] font-black transition-all duration-200 border ${
                                p === page
                                    ? 'bg-[#0052CC] text-white shadow-[0_4px_12px_rgba(0,82,204,0.35)] scale-110 border-[#0052CC]'
                                    : 'text-slate-500 border-transparent bg-white/60 hover:bg-white hover:border-[#0052CC]/20 hover:shadow-sm hover:text-slate-800 hover:-translate-y-[1px] active:translate-y-0 active:shadow-none'
                            }`}>
                            {p}
                          </button>
                )}
            </div>

            {/* Manual page input — appears when user clicks ellipsis */}
            {editing && (
                <div className="flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-150 ml-1">
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
                </div>
            )}

            {/* Next */}
            <button disabled={page >= total} onClick={() => onChange(page + 1)} className={navCls(page >= total)} title="Página siguiente">
                <ChevronRight size={12} strokeWidth={2.5} />
            </button>
            {/* Last */}
            <button disabled={page >= total} onClick={() => onChange(total)} className={navCls(page >= total)} title="Última página">
                <ChevronsRight size={12} strokeWidth={2.5} />
            </button>
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
                    <button
                        key={size}
                        onClick={() => { onPageSizeChange(size); onPageChange(1); }}
                        className={`px-3 h-7 rounded-xl text-[10px] font-bold transition-all duration-200 ${
                            pageSize === size
                                ? 'bg-[#0052CC] text-white shadow-[0_2px_8px_rgba(0,82,204,0.30)] scale-[1.04]'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-white/70 hover:scale-[1.03]'
                        }`}
                    >
                        {size}
                    </button>
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
