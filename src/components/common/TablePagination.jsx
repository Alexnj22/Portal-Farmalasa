import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE_OPTIONS = [25, 50, 100];

// ── SmartPagination ───────────────────────────────────────────────────────────

function SmartPagination({ page, total, onChange }) {
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

    const navCls = 'flex items-center gap-1 px-3 h-8 rounded-full text-[11px] font-bold transition-all border bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 shadow-sm disabled:opacity-30 disabled:cursor-not-allowed';

    return (
        <div className="flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => onChange(page - 1)} className={navCls}>
                <ChevronLeft size={12} strokeWidth={2.5} /> Ant.
            </button>
            <div className="flex items-center gap-1">
                {buildPages().map((p, i) =>
                    p === '…'
                        ? <span key={`e${i}`} className="w-6 text-center text-[12px] font-bold select-none text-slate-300">·</span>
                        : <button key={p} onClick={() => onChange(p)}
                            className={`w-8 h-8 rounded-full text-[12px] font-black transition-all duration-200 border ${
                                p === page
                                    ? 'bg-[#0052CC] text-white shadow-md shadow-blue-200/50 scale-110 border-[#0052CC]'
                                    : 'text-slate-500 border-transparent hover:bg-white hover:border-slate-200 hover:shadow-sm hover:text-slate-800'
                            }`}>{p}</button>
                )}
            </div>
            <button disabled={page >= total} onClick={() => onChange(page + 1)} className={navCls}>
                Sig. <ChevronRight size={12} strokeWidth={2.5} />
            </button>
        </div>
    );
}

// ── TablePagination ───────────────────────────────────────────────────────────
//
// Props:
//   pageSize          — current page size (number)
//   onPageSizeChange  — (newSize: number) => void
//   page              — current page (1-indexed)
//   totalPages        — total number of pages
//   onPageChange      — (newPage: number) => void
//   total             — total record count shown in the right badge
//   unit              — label after the count (default 'total')
//   filteredTotal     — if set, shows "filteredTotal / total label" to indicate a filter is active

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
    const glass = 'bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_2px_8px_rgba(0,82,204,0.08)]';

    const isFiltered = filteredTotal != null && filteredTotal !== total;

    return (
        <div className="flex items-center justify-between">

            {/* ── Page-size buttons ── */}
            <div className={`flex items-center gap-0.5 p-1 rounded-2xl ${glass}`}>
                {PAGE_SIZE_OPTIONS.map(size => (
                    <button
                        key={size}
                        onClick={() => { onPageSizeChange(size); onPageChange(1); }}
                        className={`px-3 h-7 rounded-xl text-[10px] font-bold transition-all ${
                            pageSize === size
                                ? 'bg-[#0052CC] text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-700 hover:bg-white/70'
                        }`}
                    >
                        {size}
                    </button>
                ))}
            </div>

            {/* ── Page navigation ── */}
            <SmartPagination page={page} total={totalPages} onChange={onPageChange} />

            {/* ── Total badge ── */}
            <div className={`flex items-center gap-1 px-3 h-8 rounded-2xl min-w-[80px] justify-end ${glass}`}>
                {isFiltered ? (
                    <>
                        <span className="text-[10px] font-bold text-[#0052CC] tabular-nums">{(filteredTotal ?? 0).toLocaleString()}</span>
                        <span className="text-[9px] text-slate-300">/</span>
                        <span className="text-[10px] font-semibold text-slate-400 tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-slate-400">{unit}</span>
                    </>
                ) : (
                    <>
                        <span className="text-[10px] font-bold text-slate-600 tabular-nums">{total.toLocaleString()}</span>
                        <span className="text-[9px] text-slate-400">{unit}</span>
                    </>
                )}
            </div>
        </div>
    );
}
