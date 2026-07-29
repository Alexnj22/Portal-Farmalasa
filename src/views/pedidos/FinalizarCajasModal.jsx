import React, { useState, useEffect } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { ChevronLeft, Loader2, X, Package, PackageCheck, RotateCcw } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getExactPageGroups } from '../../utils/pedidoPrint';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import FilterBar from '../../components/common/FilterBar';
import PortalInput from '../../components/common/PortalInput';

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
                    <Button variant="secondary" size="xs" icon={ChevronLeft} disabled={submitting} iconOnly onClick={() => setScreen(1)} />
                )}
                <div className="flex-1 min-w-0">
                    <p className="text-caption font-semibold text-chart-3-text uppercase tracking-wider">Pedido #{pedidoNumero}</p>
                    <h3 className="text-subtitle font-black text-content leading-tight">
                        {screen === 1 ? 'Asignar cajas' : 'Página → Caja'}
                    </h3>
                </div>
                <Button variant="secondary" size="xs" icon={X} disabled={submitting} iconOnly onClick={handleClose} />
            </div>

            {/* Draft restore banner */}
            {hasDraft && screen === 1 && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-chart-3/10 border border-chart-3/30">
                    <RotateCcw size={12} className="text-chart-3-text shrink-0" />
                    <span className="text-label text-chart-3-text flex-1">Tenés un borrador guardado</span>
                    <Button variant="ghost" onClick={handleRestoreDraft}>Restaurar</Button>
                    <Button variant="ghost" icon={X} iconOnly onClick={() => { if (draftKey) clearDraft(draftKey); setHasDraft(false); }} />
                </div>
            )}

            {/* ── Screen 1 ───────────────────────────────── */}
            {screen === 1 && (
                <div className="px-5 py-5 space-y-5">
                    {/* Page count card */}
                    <div className="flex items-center gap-4 px-4 py-4 rounded-2xl bg-chart-3/10 border border-chart-3/20">
                        <div className="w-12 h-12 rounded-2xl bg-chart-3 shadow-[var(--shadow-glow-chart-3)] flex items-center justify-center shrink-0">
                            {loadingPages
                                ? <Loader2 size={19} className="animate-spin text-white" />
                                : <Package size={19} className="text-white" />
                            }
                        </div>
                        <div className="flex-1 min-w-0">
                            {loadingPages ? (
                                <p className="text-body-sm text-content-3 font-medium">Calculando páginas del PDF…</p>
                            ) : (
                                <>
                                    <p className="text-display font-black text-content leading-none tabular-nums">
                                        {totalPages}
                                        <span className="text-body font-semibold text-content-3 ml-1.5">
                                            {totalPages === 1 ? 'página' : 'páginas'}
                                        </span>
                                    </p>
                                    <p className="text-label text-content-3 mt-0.5">en el PDF del pedido</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Box count input */}
                    <div>
                        <label className="block text-label font-bold text-content-2 mb-2 uppercase tracking-wide">
                            ¿Cuántas cajas salen?
                        </label>
                        <div className="relative">
                            <PortalInput
                                aria-label="Total de cajas recibidas"
                                type="number"
                                value={totalCajasInput}
                                onChange={e => setTotalCajasInput(e.target.value)}
                                placeholder="Ej. 4"
                                min={1}
                                max={99}
                                autoFocus
                                inputClassName="text-title-lg font-black text-content"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-label font-semibold text-content-3 pointer-events-none">
                                cajas
                            </span>
                        </div>
                        {totalCajasInput && parsedCajas > 0 && !loadingPages && totalPages > 0 && (
                            <p className="text-caption text-content-3 mt-1.5 pl-1">
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
                        <span className="text-caption font-semibold text-content-2 uppercase tracking-wide mr-1">Cajas:</span>
                        {boxes.map(b => (
                            <Badge key={b} variant="chart-3" uppercase={false}>C{b}</Badge>
                        ))}
                        <span className="ml-auto text-caption text-content-3">{totalPages} pág.</span>
                    </div>

                    {/* Page rows */}
                    <div className="space-y-2">
                        {pageGroups.map((pg, idx) => {
                            const assigned     = pageAssignments[idx] ?? [];
                            const hasAssignment = assigned.length > 0;
                            return (
                                <div key={idx}
                                    data-surface={hasAssignment ? 'card' : undefined} className={`rounded-2xl border transition-all ${hasAssignment ? '' : 'bg-warning/10 border-warning/30'}`}>
                                    {/* Page info row */}
                                    <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                                        <div className={`shrink-0 flex flex-col items-center justify-center px-2 py-1.5 rounded-xl min-w-[44px] transition-all ${
                                            hasAssignment
                                                ? 'bg-chart-3-solid text-white shadow-[var(--shadow-glow-chart-3)]'
                                                : 'bg-warning-solid text-white'
                                        }`}>
                                            <span className="text-micro font-bold opacity-75 uppercase leading-none tracking-wide">Pág.</span>
                                            <span className="text-subtitle font-black tabular-nums leading-tight">{idx + 1}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-micro font-semibold text-content-2 uppercase tracking-wide leading-none mb-0.5">Primer producto</p>
                                            <p className="text-label font-semibold text-content-2 truncate leading-tight">{pg.firstItem}</p>
                                            <p className="text-micro text-content-3 truncate mt-0.5">{pg.firstLab} · {pg.itemCount} prod.</p>
                                        </div>
                                    </div>
                                    {/* Box selector */}
                                    <div className="flex gap-1.5 px-3 pb-3 flex-wrap">
                                        {boxes.map(box => {
                                            const sel = assigned.includes(box);
                                            return (
                                                <FilterBar.Chip key={box} tone="brand" active={sel}
                                                    onToggle={() => toggleBox(idx, box)}>
                                                    Caja {box}
                                                </FilterBar.Chip>
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
                <Button variant="secondary" disabled={submitting} onClick={handleClose}>Cancelar</Button>
                {screen === 1 ? (
                    <Button tone="chart-3" disabled={loadingPages || !totalCajasInput || parsedCajas < 1 || totalPages === 0} onClick={handleGoScreen2}>{loadingPages
                            ? <Loader2 size={12} className="animate-spin" />
                            : <>Siguiente <span className="opacity-60">→</span></>
                        }</Button>
                ) : (
                    <Button tone="chart-3" disabled={submitting || !isValid} onClick={handleConfirm}>{submitting
                            ? <Loader2 size={12} className="animate-spin" />
                            : <PackageCheck size={13} />
                        }
                        Confirmar y Finalizar</Button>
                )}
            </div>
        </PedidoModal>
    );
}
