import React, { useState } from 'react';
import { PackageCheck, PackageX, AlertTriangle, X, Loader2, Truck, Zap, Package } from 'lucide-react';
import PedidoModal from './PedidoModal';

const TOGGLE_CFG = {
    ok:       { Icon: PackageCheck,  label: 'OK',      active: 'bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.45)]', idle: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200' },
    danada:   { Icon: AlertTriangle, label: 'Dañada',  active: 'bg-amber-500 text-white shadow-[0_2px_8px_rgba(245,158,11,0.45)]',   idle: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200' },
    faltante: { Icon: PackageX,      label: 'No llegó',active: 'bg-rose-500 text-white shadow-[0_2px_8px_rgba(239,68,68,0.45)]',    idle: 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200' },
};

const pageHint = (cajaMap, num) => {
    const pages = cajaMap?.[String(num)] ?? [];
    if (!pages.length) return null;
    return pages.length === 1 ? `pág. ${pages[0]}` : `págs. ${pages[0]}–${pages[pages.length - 1]}`;
};

export default function ReenvioLlegadaModal({
    open, onClose, onConfirm, pedidoNumero,
    cajasCiclo     = [],
    electrolitCount = 0,
    especialesList  = [],
    cicloNum = 1, cajaMap = {},
}) {
    const [estados,         setEstados]         = useState({});
    const [nota,            setNota]            = useState('');
    const [electrolitOk,    setElectrolitOk]    = useState(null); // null=sin responder, true=todas ok, false=aun faltan
    const [espEstados,      setEspEstados]       = useState({});   // label → 'ok' | 'faltante'
    const [submitting,      setSubmitting]       = useState(false);

    const getEst = (num) => estados[num] ?? 'ok';
    const setEst = (num, val) => setEstados(prev => ({ ...prev, [num]: val }));

    const cajasOk        = cajasCiclo.filter(n => getEst(n) === 'ok');
    const cajasDanadas   = cajasCiclo.filter(n => getEst(n) === 'danada');
    const cajasFaltantes = cajasCiclo.filter(n => getEst(n) === 'faltante');
    const espFaltantes   = especialesList.filter(l => espEstados[l] === 'faltante');
    const hayProblemas   = cajasDanadas.length > 0 || cajasFaltantes.length > 0;

    // ¿Hay algo que confirmar? cajas, electrolits o especiales
    const hasContent = cajasCiclo.length > 0 || electrolitCount > 0 || especialesList.length > 0;
    // Electrolit debe ser respondido antes de poder confirmar
    const electrolitPending = electrolitCount > 0 && electrolitOk === null;

    const handleConfirm = () => {
        setSubmitting(true);
        onConfirm({
            cajasOk,
            cajasDanadas,
            cajasFaltantes,
            nota: nota.trim(),
            electrolitOk:  electrolitCount > 0 ? (electrolitOk === true) : true,
            especialesAun: especialesList.length > 0 ? espFaltantes : [],
        });
    };

    const handleClose = () => {
        if (submitting) return;
        setEstados({}); setNota(''); setElectrolitOk(null);
        setEspEstados({}); setSubmitting(false);
        onClose();
    };

    if (!open) return null;

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm" className="max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-500 shadow-[0_2px_10px_rgba(99,102,241,0.4)] flex items-center justify-center shrink-0">
                    <Truck size={16} className="text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-600 uppercase tracking-wide">
                        Pedido #{pedidoNumero} · Reenvío {cicloNum > 1 ? cicloNum : ''}
                    </p>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-tight">¿Cómo llegó el reenvío?</h3>
                </div>
                <button onClick={handleClose} disabled={submitting} className="text-slate-500 hover:text-slate-600 transition-colors">
                    <X size={15} />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-3">

                {/* Cajas regulares */}
                {cajasCiclo.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-[10px] text-slate-600 uppercase tracking-wide font-semibold">
                            {cajasCiclo.length} caja{cajasCiclo.length !== 1 ? 's' : ''} esperadas
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
                                        <p className="text-[10px] font-medium text-slate-500 mt-0.5">
                                            {pageHint(cajaMap, num) ?? `Reenvío ${cicloNum}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {(['ok', 'danada', 'faltante']).map(e => {
                                            const { Icon, label, active, idle } = TOGGLE_CFG[e];
                                            return (
                                                <button key={e} onClick={() => setEst(num, e)}
                                                    className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl border transition-all active:scale-[0.97] ${est === e ? active : idle}`}>
                                                    <Icon size={14} />
                                                    <span className="text-[9px] font-bold leading-none">{label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Electrolit */}
                {electrolitCount > 0 && (
                    <div className="p-3 rounded-2xl border border-amber-100 bg-amber-50/60 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                            <Zap size={13} className="text-amber-500 shrink-0" />
                            <span className="text-[11px] font-semibold text-amber-700 flex-1">
                                ¿Llegaron las cajas de Electrolit?
                            </span>
                            {electrolitOk === null ? (
                                <span className="text-[9px] font-bold text-rose-500 uppercase tracking-wide animate-pulse">Pendiente</span>
                            ) : (
                                <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wide">
                                    {electrolitCount} caja{electrolitCount > 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setElectrolitOk(true)}
                                className={`flex-1 text-[10px] font-bold px-3 py-1.5 rounded-xl border transition-all active:scale-[0.97] ${electrolitOk === true
                                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-200 hover:text-emerald-600'}`}>
                                ✓ Sí llegaron
                            </button>
                            <button
                                onClick={() => setElectrolitOk(false)}
                                className={`flex-1 text-[10px] font-bold px-3 py-1.5 rounded-xl border transition-all active:scale-[0.97] ${electrolitOk === false
                                    ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'}`}>
                                ✗ Aún faltan
                            </button>
                        </div>
                    </div>
                )}

                {/* Cajas especiales */}
                {especialesList.length > 0 && (
                    <div className="p-3 rounded-2xl border border-violet-100 bg-violet-50/60 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Package size={13} className="text-violet-500 shrink-0" />
                            <span className="text-[11px] font-semibold text-violet-700 flex-1">Cajas especiales pendientes</span>
                            <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wide">
                                {especialesList.length} caja{especialesList.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {especialesList.map(label => {
                                const est = espEstados[label] ?? 'ok';
                                return (
                                    <div key={label} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${est === 'ok' ? 'bg-emerald-50/80 border-emerald-200/70' : 'bg-rose-50/80 border-rose-200/70'}`}>
                                        <span className={`text-[11px] font-black w-7 shrink-0 ${est === 'ok' ? 'text-emerald-600' : 'text-rose-600'}`}>{label}</span>
                                        <div className="flex items-center gap-1 ml-auto shrink-0">
                                            <button onClick={() => setEspEstados(p => ({ ...p, [label]: 'ok' }))}
                                                className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'ok' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-200 hover:text-emerald-600'}`}>
                                                ✓ OK
                                            </button>
                                            <button onClick={() => setEspEstados(p => ({ ...p, [label]: 'faltante' }))}
                                                className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'faltante' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-500 border-slate-200 hover:border-rose-200 hover:text-rose-600'}`}>
                                                ✗ Falta
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {hayProblemas && (
                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Nota (opcional)</label>
                        <textarea
                            value={nota} onChange={e => setNota(e.target.value)} rows={2}
                            placeholder="Ej. caja dañada en el fondo, caja 4 nunca llegó…"
                            className="mt-1 w-full text-[16px] rounded-xl border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-3 shrink-0">
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
                        {electrolitOk === false && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                                ⚡ Electrolit aún pendiente
                            </span>
                        )}
                        {espFaltantes.length > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                                ✗ Esp. aún falta{espFaltantes.length > 1 ? 'n' : ''}: {espFaltantes.join(', ')}
                            </span>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <button onClick={handleClose} disabled={submitting}
                        className="text-[11px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} disabled={submitting || !hasContent || electrolitPending}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40 active:scale-[0.97] transition-all flex items-center gap-1.5">
                        {submitting && <Loader2 size={11} className="animate-spin" />}
                        {electrolitPending ? 'Respondé el Electrolit primero' : 'Confirmar reenvío'}
                    </button>
                </div>
            </div>
        </PedidoModal>
    );
}
