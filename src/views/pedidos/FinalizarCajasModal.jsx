import React, { useState, useEffect } from 'react';
import { ChevronLeft, Loader2, X, Box } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getExactPageGroups } from '../../utils/pedidoPrint';

export default function FinalizarCajasModal({ open, onClose, onConfirm, items = [], sucId, pedidoNumero, paginas = null }) {
    const [screen,          setScreen]          = useState(1);
    const [totalCajasInput, setTotalCajasInput] = useState('');
    const [pageAssignments, setPageAssignments] = useState([]);  // [boxNum[]] por página
    const [submitting,      setSubmitting]      = useState(false);
    const [pageGroups,      setPageGroups]      = useState([]);
    const [loadingPages,    setLoadingPages]    = useState(false);

    useEffect(() => {
        if (!open) return;
        if (paginas) {
            // Pre-calculado al generar el PDF — sin espera
            setPageGroups(paginas);
            setLoadingPages(false);
            return;
        }
        // Fallback: calcular ahora con pdfmake (pageBreakBefore)
        if (!items.length || !sucId) return;
        setLoadingPages(true);
        setPageGroups([]);
        getExactPageGroups(sucId, items)
            .then(groups => setPageGroups(groups))
            .catch(() => setPageGroups([]))
            .finally(() => setLoadingPages(false));
    }, [open, items, sucId, paginas]);

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
                if (cur.length === 1) return next;  // no dejar sin caja
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
        setScreen(1); setTotalCajasInput(''); setPageAssignments([]);
        setSubmitting(false); setPageGroups([]); setLoadingPages(false);
        onClose();
    };

    if (!open) return null;

    const boxes = Array.from({ length: cajaCount }, (_, b) => b + 1);

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
                {screen === 2 && (
                    <button onClick={() => setScreen(1)} disabled={submitting}
                        className="text-slate-400 hover:text-slate-600 transition-colors">
                        <ChevronLeft size={16} />
                    </button>
                )}
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Pedido #{pedidoNumero}</p>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-tight">
                        {screen === 1 ? 'Finalizar — Asignar cajas' : 'Asignar páginas a cajas'}
                    </h3>
                </div>
                <button onClick={handleClose} disabled={submitting}
                    className="text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                    <X size={15} />
                </button>
            </div>

            {/* Screen 1 */}
            {screen === 1 && (
                <div className="px-5 py-5 space-y-4">
                    <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100">
                        <Box size={14} className="text-slate-400 shrink-0 mt-0.5" />
                        {loadingPages ? (
                            <div className="flex items-center gap-2">
                                <Loader2 size={12} className="animate-spin text-violet-400" />
                                <p className="text-[11px] text-slate-400">Calculando páginas del PDF…</p>
                            </div>
                        ) : (
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                El pedido tiene <span className="font-bold text-slate-700">{totalPages} página{totalPages !== 1 ? 's' : ''}</span> en el PDF.
                                En la siguiente pantalla asignarás cada página a su caja física.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                            ¿Cuántas cajas salen con el pedido?
                        </label>
                        <input
                            type="number" min={1} max={99}
                            value={totalCajasInput}
                            onChange={e => setTotalCajasInput(e.target.value)}
                            placeholder="Ej. 4"
                            autoFocus
                            className="mt-1.5 w-full text-[14px] font-bold rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        />
                    </div>
                </div>
            )}

            {/* Screen 2 */}
            {screen === 2 && (
                <div className="px-5 py-3 max-h-[58vh] overflow-y-auto space-y-1.5">
                    <p className="text-[10px] text-slate-400 pb-1">
                        Toca las cajas donde va cada página. Una página puede ir en más de una caja.
                    </p>
                    {pageGroups.map((pg, idx) => {
                        const assigned = pageAssignments[idx] ?? [];
                        return (
                            <div key={idx} className="flex items-center gap-2 py-1 border-b border-slate-50 last:border-0">
                                <span className="text-[10px] font-bold text-slate-400 w-9 shrink-0 tabular-nums">
                                    Pág.{idx + 1}
                                </span>
                                <div className="flex gap-1 flex-wrap">
                                    {boxes.map(box => {
                                        const sel = assigned.includes(box);
                                        return (
                                            <button key={box} onClick={() => toggleBox(idx, box)}
                                                className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition-all active:scale-95
                                                    ${sel
                                                        ? 'bg-violet-500 border-violet-500 text-white shadow-sm'
                                                        : 'bg-white border-slate-200 text-slate-400 hover:border-violet-300 hover:text-violet-500'
                                                    }`}>
                                                C{box}
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex-1 min-w-0 text-right">
                                    <p className="text-[9px] text-slate-500 font-medium truncate" title={pg.firstItem}>{pg.firstItem}</p>
                                    <p className="text-[8px] text-slate-400 truncate" title={pg.firstLab}>{pg.firstLab} · {pg.itemCount} prod.</p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 flex items-center justify-between gap-2 border-t border-slate-100">
                <button onClick={handleClose} disabled={submitting}
                    className="text-[11px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all">
                    Cancelar
                </button>
                {screen === 1 ? (
                    <button onClick={handleGoScreen2}
                        disabled={loadingPages || !totalCajasInput || parseInt(totalCajasInput, 10) < 1 || totalPages === 0}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-95 transition-all">
                        {loadingPages ? <Loader2 size={11} className="animate-spin" /> : 'Siguiente →'}
                    </button>
                ) : (
                    <button onClick={handleConfirm} disabled={submitting || !isValid}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5">
                        {submitting ? <Loader2 size={11} className="animate-spin" /> : null}
                        Confirmar y Finalizar
                    </button>
                )}
            </div>
        </PedidoModal>
    );
}
