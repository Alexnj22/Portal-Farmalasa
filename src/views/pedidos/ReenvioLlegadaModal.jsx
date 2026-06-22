import React, { useState } from 'react';
import { PackageCheck, PackageX, AlertTriangle, X, Loader2, Truck } from 'lucide-react';
import PedidoModal from './PedidoModal';

const TOGGLE_CFG = {
    ok:       { Icon: PackageCheck,  label: 'OK',      active: 'bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.45)]', idle: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200' },
    danada:   { Icon: AlertTriangle, label: 'Dañada',  active: 'bg-amber-500 text-white shadow-[0_2px_8px_rgba(245,158,11,0.45)]',   idle: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200' },
    faltante: { Icon: PackageX,      label: 'No llegó',active: 'bg-rose-500 text-white shadow-[0_2px_8px_rgba(239,68,68,0.45)]',    idle: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200' },
};

/**
 * Modal que se abre cuando llega el reenvío de cajas faltantes.
 * Por cada caja del ciclo de reenvío, el usuario elige: OK / Dañada / Aún falta.
 *
 * Props:
 *   open           – boolean
 *   onClose        – () => void
 *   onConfirm      – ({ cajasOk, cajasDanadas, cajasFaltantes, nota }) => void
 *   pedidoNumero   – number
 *   cajasCiclo     – number[] — cajas que vienen en este reenvío
 *   cicloNum       – number — número de ciclo (1, 2, …)
 */
const pageHint = (cajaMap, num) => {
    const pages = cajaMap?.[String(num)] ?? [];
    if (!pages.length) return null;
    return pages.length === 1 ? `pág. ${pages[0]}` : `págs. ${pages[0]}–${pages[pages.length - 1]}`;
};

export default function ReenvioLlegadaModal({ open, onClose, onConfirm, pedidoNumero, cajasCiclo = [], cicloNum = 1, cajaMap = {} }) {
    const [estados,    setEstados]    = useState({});
    const [nota,       setNota]       = useState('');
    const [submitting, setSubmitting] = useState(false);

    const getEst = (num) => estados[num] ?? 'ok';
    const setEst = (num, val) => setEstados(prev => ({ ...prev, [num]: val }));

    const cajasOk        = cajasCiclo.filter(n => getEst(n) === 'ok');
    const cajasDanadas   = cajasCiclo.filter(n => getEst(n) === 'danada');
    const cajasFaltantes = cajasCiclo.filter(n => getEst(n) === 'faltante');
    const hayProblemas   = cajasDanadas.length > 0 || cajasFaltantes.length > 0;

    const handleConfirm = () => {
        setSubmitting(true);
        onConfirm({ cajasOk, cajasDanadas, cajasFaltantes, nota: nota.trim() });
    };

    const handleClose = () => {
        if (submitting) return;
        setEstados({}); setNota(''); setSubmitting(false);
        onClose();
    };

    if (!open) return null;

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-indigo-500 shadow-[0_2px_10px_rgba(99,102,241,0.4)] flex items-center justify-center shrink-0">
                    <Truck size={16} className="text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                        Pedido #{pedidoNumero} · Reenvío {cicloNum > 1 ? cicloNum : ''}
                    </p>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-tight">¿Cómo llegó el reenvío?</h3>
                </div>
                <button onClick={handleClose} disabled={submitting} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X size={15} />
                </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold mb-3">
                    {cajasCiclo.length} caja{cajasCiclo.length !== 1 ? 's' : ''} esperadas en este reenvío
                </p>

                {cajasCiclo.map(num => {
                    const est   = getEst(num);
                    const rowBg = est === 'ok'     ? 'bg-emerald-50/60 border-emerald-200/70'
                                : est === 'danada' ? 'bg-amber-50/60 border-amber-200/70'
                                :                    'bg-rose-50/60 border-rose-200/70';
                    const numBg = est === 'ok'     ? 'bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.4)]'
                                : est === 'danada' ? 'bg-amber-500 shadow-[0_2px_8px_rgba(245,158,11,0.4)]'
                                :                    'bg-rose-500 shadow-[0_2px_8px_rgba(239,68,68,0.4)]';
                    return (
                        <div key={num} className={`flex items-center gap-2.5 p-2.5 rounded-2xl border transition-all ${rowBg}`}>
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-[14px] tabular-nums text-white transition-all ${numBg}`}>
                                {num}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-bold text-slate-700 leading-tight">Caja #{num}</p>
                                <p className="text-[10px] font-medium text-slate-400 mt-0.5">
                                    {pageHint(cajaMap, num) ?? `Reenvío ${cicloNum}`}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {(['ok', 'danada', 'faltante']).map(e => {
                                    const { Icon, label, active, idle } = TOGGLE_CFG[e];
                                    return (
                                        <button key={e} onClick={() => setEst(num, e)}
                                            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl border transition-all active:scale-95 ${est === e ? active : idle}`}>
                                            <Icon size={14} />
                                            <span className="text-[9px] font-bold leading-none">{label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}

                {hayProblemas && (
                    <div className="pt-2">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Nota (opcional)</label>
                        <textarea
                            value={nota} onChange={e => setNota(e.target.value)} rows={2}
                            placeholder="Ej. caja dañada en el fondo, caja 4 nunca llegó…"
                            className="mt-1 w-full text-[11px] rounded-xl border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-3">
                {hayProblemas && (
                    <div className="flex flex-wrap gap-1.5">
                        {cajasDanadas.length > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                ⚠ Dañada{cajasDanadas.length > 1 ? 's' : ''}: {cajasDanadas.map(n => `#${n}`).join(', ')}
                            </span>
                        )}
                        {cajasFaltantes.length > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                                ✗ Aún falta{cajasFaltantes.length > 1 ? 'n' : ''}: {cajasFaltantes.map(n => `#${n}`).join(', ')} — se solicitará otro reenvío
                            </span>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <button onClick={handleClose} disabled={submitting}
                        className="text-[11px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} disabled={submitting}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5">
                        {submitting && <Loader2 size={11} className="animate-spin" />}
                        Confirmar reenvío
                    </button>
                </div>
            </div>
        </PedidoModal>
    );
}
