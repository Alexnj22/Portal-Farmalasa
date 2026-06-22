import React, { useState, useMemo } from 'react';
import { Package, ChevronLeft, Loader2, X, Box } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getPageGroups } from '../../utils/pedidoPrint';

export default function FinalizarCajasModal({ open, onClose, onConfirm, items = [], pedidoNumero }) {
    const [screen,          setScreen]          = useState(1);
    const [totalCajas,      setTotalCajas]      = useState('');
    const [pageAssignments, setPageAssignments] = useState([]); // [boxNum, ...] index=page(0-based)
    const [submitting,      setSubmitting]      = useState(false);

    const pageGroups = useMemo(() => getPageGroups(items), [items]);
    const totalPages = pageGroups.length;
    const cajaCount  = Math.max(1, parseInt(totalCajas, 10) || 1);

    const handleGoScreen2 = () => {
        const n = cajaCount;
        // Default: distribuir páginas uniformemente entre cajas
        const defaults = Array.from({ length: totalPages }, (_, i) => {
            if (n >= totalPages) return i + 1;
            return Math.floor(i * n / totalPages) + 1;
        });
        setPageAssignments(defaults);
        setScreen(2);
    };

    const assignPage = (pageIdx, boxNum) =>
        setPageAssignments(prev => {
            const next = [...prev];
            next[pageIdx] = boxNum;
            return next;
        });

    const handleConfirm = () => {
        if (submitting) return;
        setSubmitting(true);

        // cajaMap: { "1": [1,2,...], "2": [3,...] } — box → pages (1-indexed)
        const cajaMap = {};
        for (let i = 1; i <= cajaCount; i++) cajaMap[String(i)] = [];
        pageAssignments.forEach((box, idx) => {
            const pg = idx + 1;
            if (!cajaMap[String(box)]) cajaMap[String(box)] = [];
            cajaMap[String(box)].push(pg);
        });

        // paginaItems: { "1": [itemId,...], "2": [...] } — page → item IDs
        const paginaItems = {};
        pageGroups.forEach((pg, idx) => {
            paginaItems[String(idx + 1)] = pg.ids;
        });

        onConfirm({ totalCajas: cajaCount, cajaMap, paginaItems });
    };

    const handleClose = () => {
        if (submitting) return;
        setScreen(1); setTotalCajas(''); setPageAssignments([]); setSubmitting(false);
        onClose();
    };

    if (!open) return null;

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
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                        Pedido #{pedidoNumero}
                    </p>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-tight">
                        {screen === 1 ? 'Finalizar — Asignar cajas' : 'Asignar páginas a cajas'}
                    </h3>
                </div>
                <button onClick={handleClose} disabled={submitting}
                    className="text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                    <X size={15} />
                </button>
            </div>

            {/* Screen 1 — cuántas cajas */}
            {screen === 1 && (
                <div className="px-5 py-5 space-y-4">
                    <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100">
                        <Box size={15} className="text-slate-400 shrink-0" />
                        <p className="text-[11px] text-slate-500">
                            El pedido tiene aprox. <span className="font-bold text-slate-700">{totalPages} página{totalPages !== 1 ? 's' : ''}</span> en el PDF.
                            Asignale un número de caja a cada una.
                        </p>
                    </div>
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                            ¿Cuántas cajas salen?
                        </label>
                        <input
                            type="number" min={1} max={99}
                            value={totalCajas}
                            onChange={e => setTotalCajas(e.target.value)}
                            placeholder="Ej. 4"
                            className="mt-1.5 w-full text-[14px] font-bold rounded-xl border border-slate-200 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-violet-300"
                        />
                    </div>
                </div>
            )}

            {/* Screen 2 — asignación página → caja */}
            {screen === 2 && (
                <div className="px-5 py-4 max-h-[55vh] overflow-y-auto space-y-2">
                    <p className="text-[11px] text-slate-400 mb-3">
                        Selecciona a qué caja pertenece cada página. Revisá el PDF impreso para confirmar.
                    </p>
                    {pageGroups.map((pg, idx) => {
                        const assigned = pageAssignments[idx] ?? 1;
                        return (
                            <div key={idx} className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold text-slate-500 w-12 shrink-0">
                                    Pág. {idx + 1}
                                </span>
                                <div className="flex gap-1 flex-wrap flex-1">
                                    {Array.from({ length: cajaCount }, (_, b) => b + 1).map(box => (
                                        <button key={box} onClick={() => assignPage(idx, box)}
                                            className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-all
                                                ${assigned === box
                                                    ? 'bg-violet-500 border-violet-500 text-white'
                                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                                }`}>
                                            C{box}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[9px] text-slate-300 truncate max-w-[90px] text-right" title={pg.firstItem}>
                                    {pg.firstItem}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Footer */}
            <div className="px-5 pb-5 pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                <button onClick={handleClose} disabled={submitting}
                    className="text-[11px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all">
                    Cancelar
                </button>
                {screen === 1 ? (
                    <button
                        onClick={handleGoScreen2}
                        disabled={!totalCajas || parseInt(totalCajas, 10) < 1}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-95 transition-all">
                        Siguiente →
                    </button>
                ) : (
                    <button onClick={handleConfirm} disabled={submitting}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5">
                        {submitting ? <Loader2 size={11} className="animate-spin" /> : <Package size={11} />}
                        Confirmar y Finalizar
                    </button>
                )}
            </div>
        </PedidoModal>
    );
}
