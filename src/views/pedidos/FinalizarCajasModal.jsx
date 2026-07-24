import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, X, Package, PackageCheck, RotateCcw } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getExactPageGroups } from '../../utils/pedidoPrint';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';

export default function FinalizarCajasModal({ open, onClose, onConfirm, items = [], sucId, pedidoNumero, paginas = null, draftKey = null }) {
    const [screen,          setScreen]          = useState(1);
    const [totalCajasInput, setTotalCajasInput] = useState('');
    const [pageAssignments, setPageAssignments] = useState([]);
    const [submitting,      setSubmitting]      = useState(false);
    const [pageGroups,      setPageGroups]      = useState([]);
    const [loadingPages,    setLoadingPages]    = useState(false);
    const [hasDraft,        setHasDraft]        = useState(false);

    useEffect(() => {
        if (!open) {
            // Resetear estado al cerrar para que la próxima apertura empiece limpio
            setSubmitting(false); // eslint-disable-line react-hooks/set-state-in-effect
            setScreen(1);
            setTotalCajasInput('');
            setPageAssignments([]);
            setHasDraft(false);
            return;
        }
        // Check for draft on open
        if (draftKey) setHasDraft(!!loadDraft(draftKey));
        if (paginas) {
            setPageGroups(paginas);
            setLoadingPages(false);
            return;
        }
        if (!items.length || !sucId) return;
        setLoadingPages(true);
        setPageGroups([]);
        getExactPageGroups(sucId, items)
            .then(groups => setPageGroups(groups))
            .catch(() => setPageGroups([]))
            .finally(() => setLoadingPages(false));
    }, [open, items, sucId, paginas, draftKey]);

    const totalPages = pageGroups.length;
    const cajaCount  = Math.max(1, parseInt(totalCajasInput, 10) || 1);

    const handleGoScreen2 = () => {
        const defaults = Array.from({ length: totalPages }, (_, i) => {
            const box = cajaCount >= totalPages
                ? i + 1
                : Math.floor(i * cajaCount / totalPages) + 1;
            return [box];
        });
        setPageAssignments(defaults);
        setScreen(2);
    };

    const toggleBox = (pageIdx, boxNum) => {
        setPageAssignments(prev => {
            const next = prev.map(arr => [...arr]);
            const cur  = next[pageIdx] ?? [];
            if (cur.includes(boxNum)) {
                if (cur.length === 1) return next;
                next[pageIdx] = cur.filter(b => b !== boxNum);
            } else {
                next[pageIdx] = [...cur, boxNum].sort((a, b) => a - b);
            }
            return next;
        });
    };

    const isValid = pageAssignments.length === totalPages && pageAssignments.every(a => a.length > 0);

    const handleConfirm = () => {
        if (submitting || !isValid) return;
        setSubmitting(true);
        if (draftKey) clearDraft(draftKey);

        const cajaMap = {};
        for (let i = 1; i <= cajaCount; i++) cajaMap[String(i)] = [];
        pageAssignments.forEach((boxes, idx) => {
            const pg = idx + 1;
            boxes.forEach(b => {
                if (!cajaMap[String(b)]) cajaMap[String(b)] = [];
                cajaMap[String(b)].push(pg);
            });
        });

        const paginaItems = {};
        pageGroups.forEach((pg, idx) => { paginaItems[String(idx + 1)] = pg.ids; });

        onConfirm({ totalCajas: cajaCount, cajaMap, paginaItems });
    };

    const handleClose = () => {
        if (submitting) return;
        if (draftKey && totalCajasInput) {
            saveDraft(draftKey, { totalCajasInput });
        }
        setScreen(1); setTotalCajasInput(''); setPageAssignments([]);
        setSubmitting(false); setPageGroups([]); setLoadingPages(false); setHasDraft(false);
        onClose();
    };

    const handleRestoreDraft = () => {
        if (!draftKey) return;
        const d = loadDraft(draftKey);
        if (!d) return;
        if (d.totalCajasInput) setTotalCajasInput(d.totalCajasInput);
        setHasDraft(false);
        clearDraft(draftKey);
    };

    if (!open) return null;

    const boxes = Array.from({ length: cajaCount }, (_, b) => b + 1);
    const parsedCajas = parseInt(totalCajasInput, 10);

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm">

            {/* ── Header ─────────────────────────────────── */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border-card">
                {screen === 2 && (
                    <button onClick={() => setScreen(1)} disabled={submitting}
                        className="w-7 h-7 flex items-center justify-center rounded-full bg-surface-card-hover/80 text-content-3 hover:bg-surface-card-hover transition-all shrink-0">
                        <ChevronLeft size={14} />
                    </button>
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-wider">Pedido #{pedidoNumero}</p>
                    <h3 className="text-[15px] font-black text-content leading-tight">
                        {screen === 1 ? 'Asignar cajas' : 'Página → Caja'}
                    </h3>
                </div>
                <button onClick={handleClose} disabled={submitting}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-surface-card-hover/80 text-content-3 hover:bg-surface-card-hover transition-all shrink-0">
                    <X size={13} />
                </button>
            </div>

            {/* Draft restore banner */}
            {hasDraft && screen === 1 && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-violet-50 border border-violet-200">
                    <RotateCcw size={12} className="text-violet-500 shrink-0" />
                    <span className="text-[11px] text-violet-700 flex-1">Tenés un borrador guardado</span>
                    <button onClick={handleRestoreDraft} className="text-[11px] font-bold text-violet-700 hover:text-violet-900 underline underline-offset-2">
                        Restaurar
                    </button>
                    <button onClick={() => { if (draftKey) clearDraft(draftKey); setHasDraft(false); }} className="text-violet-400 hover:text-violet-600">
                        <X size={12} />
                    </button>
                </div>
            )}

            {/* ── Screen 1 ───────────────────────────────── */}
            {screen === 1 && (
                <div className="px-5 py-5 space-y-5">
                    {/* Page count card */}
                    <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-violet-50/70 border border-violet-100/80">
                        <div className="w-12 h-12 rounded-2xl bg-violet-500 shadow-[0_4px_14px_rgba(139,92,246,0.4)] flex items-center justify-center shrink-0">
                            {loadingPages
                                ? <Loader2 size={19} className="animate-spin text-white" />
                                : <Package size={19} className="text-white" />
                            }
                        </div>
                        <div className="flex-1 min-w-0">
                            {loadingPages ? (
                                <p className="text-[12px] text-content-3 font-medium">Calculando páginas del PDF…</p>
                            ) : (
                                <>
                                    <p className="text-[26px] font-black text-content leading-none tabular-nums">
                                        {totalPages}
                                        <span className="text-[13px] font-semibold text-content-3 ml-1.5">
                                            {totalPages === 1 ? 'página' : 'páginas'}
                                        </span>
                                    </p>
                                    <p className="text-[11px] text-content-3 mt-0.5">en el PDF del pedido</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Box count input */}
                    <div>
                        <label className="block text-[11px] font-bold text-content-2 mb-2 uppercase tracking-wide">
                            ¿Cuántas cajas salen?
                        </label>
                        <div className="relative">
                            <input
                                type="number" min={1} max={99}
                                value={totalCajasInput}
                                onChange={e => setTotalCajasInput(e.target.value)}
                                placeholder="Ej. 4"
                                autoFocus
                                className="w-full text-[22px] font-black text-content rounded-2xl border-2 border-slate-200 bg-surface-card px-4 py-3 pr-16 focus:outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100 transition-all"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-content-3 pointer-events-none">
                                cajas
                            </span>
                        </div>
                        {totalCajasInput && parsedCajas > 0 && !loadingPages && totalPages > 0 && (
                            <p className="text-[10px] text-content-3 mt-1.5 pl-1">
                                {parsedCajas >= totalPages
                                    ? `1 página por caja`
                                    : `~${(totalPages / parsedCajas).toFixed(1)} páginas por caja`
                                }
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* ── Screen 2 ───────────────────────────────── */}
            {screen === 2 && (
                <div className="px-4 py-3 max-h-[56vh] overflow-y-auto scrollbar-hide">
                    {/* Box legend */}
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <span className="text-[10px] font-semibold text-content-2 uppercase tracking-wide mr-1">Cajas:</span>
                        {boxes.map(b => (
                            <span key={b} className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-violet-100 text-violet-600 border border-violet-200">
                                C{b}
                            </span>
                        ))}
                        <span className="ml-auto text-[10px] text-content-3">{totalPages} pág.</span>
                    </div>

                    {/* Page rows */}
                    <div className="space-y-2">
                        {pageGroups.map((pg, idx) => {
                            const assigned     = pageAssignments[idx] ?? [];
                            const hasAssignment = assigned.length > 0;
                            return (
                                <div key={idx}
                                    className={`rounded-2xl border transition-all ${
                                        hasAssignment
                                            ? 'bg-surface-card border-slate-200/70'
                                            : 'bg-warning/60 border-warning/30'
                                    }`}>
                                    {/* Page info row */}
                                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                                        <div className={`shrink-0 flex flex-col items-center justify-center px-2 py-1.5 rounded-xl min-w-[44px] transition-all ${
                                            hasAssignment
                                                ? 'bg-violet-500 text-white shadow-[0_2px_8px_rgba(139,92,246,0.35)]'
                                                : 'bg-amber-400 text-white'
                                        }`}>
                                            <span className="text-[7px] font-bold opacity-75 uppercase leading-none tracking-wide">Pág.</span>
                                            <span className="text-[15px] font-black tabular-nums leading-tight">{idx + 1}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[8px] font-semibold text-content-2 uppercase tracking-wide leading-none mb-0.5">Primer producto</p>
                                            <p className="text-[11px] font-semibold text-content-2 truncate leading-tight">{pg.firstItem}</p>
                                            <p className="text-[9px] text-content-3 truncate mt-0.5">{pg.firstLab} · {pg.itemCount} prod.</p>
                                        </div>
                                    </div>
                                    {/* Box selector */}
                                    <div className="flex gap-1.5 px-3 pb-3 flex-wrap">
                                        {boxes.map(box => {
                                            const sel = assigned.includes(box);
                                            return (
                                                <button key={box} onClick={() => toggleBox(idx, box)}
                                                    className={`text-[11px] font-bold px-3 py-1.5 rounded-xl border-2 transition-all active:scale-[0.97] ${
                                                        sel
                                                            ? 'bg-violet-500 border-violet-500 text-white shadow-[0_2px_8px_rgba(139,92,246,0.3)]'
                                                            : 'bg-surface-card border-slate-200 text-content-3 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50'
                                                    }`}>
                                                    Caja {box}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Footer ─────────────────────────────────── */}
            <div className="px-5 pb-5 pt-3 flex items-center justify-between gap-2 border-t border-border-card">
                <button onClick={handleClose} disabled={submitting}
                    className="text-[12px] font-semibold px-4 py-2 rounded-xl text-content-3 hover:bg-surface-card-hover/80 transition-all">
                    Cancelar
                </button>
                {screen === 1 ? (
                    <button onClick={handleGoScreen2}
                        disabled={loadingPages || !totalCajasInput || parsedCajas < 1 || totalPages === 0}
                        className="text-[12px] font-bold px-5 py-2.5 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-[0.97] transition-all flex items-center gap-2 shadow-[0_4px_12px_rgba(139,92,246,0.35)]">
                        {loadingPages
                            ? <Loader2 size={12} className="animate-spin" />
                            : <>Siguiente <span className="opacity-60">→</span></>
                        }
                    </button>
                ) : (
                    <button onClick={handleConfirm} disabled={submitting || !isValid}
                        className="text-[12px] font-bold px-5 py-2.5 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-[0.97] transition-all flex items-center gap-2 shadow-[0_4px_12px_rgba(139,92,246,0.35)]">
                        {submitting
                            ? <Loader2 size={12} className="animate-spin" />
                            : <PackageCheck size={13} />
                        }
                        Confirmar y Finalizar
                    </button>
                )}
            </div>
        </PedidoModal>
    );
}
