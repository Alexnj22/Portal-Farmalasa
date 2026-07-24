import React, { useState, useMemo, useEffect } from 'react';
import { PackageCheck, PackageX, Package, AlertTriangle, X, Loader2, Zap, HelpCircle, RotateCcw } from 'lucide-react';
import PedidoModal from './PedidoModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import { getPageGroups } from '../../utils/pedidoPrint';
import { ERP_NAMES, SUCURSALES } from '../../constants/erp';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';

// Opciones de sucursal para selector de caja extra (excluye bodega)
const SUC_OPTIONS = SUCURSALES.map(id => ({ value: String(id), label: ERP_NAMES[id] ?? `Suc. ${id}` }));

function deriveCajas(cajaMap, items) {
    if (cajaMap && Object.keys(cajaMap).length > 0) {
        return Object.entries(cajaMap)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([boxNum, pages]) => ({
                num: Number(boxNum),
                label: `Caja ${boxNum}`,
                hint: pages.length === 1 ? `pág. ${pages[0]}` : `págs. ${pages[0]}–${pages[pages.length - 1]}`,
            }));
    }
    const groups = getPageGroups(items);
    return groups.map((_, i) => ({ num: i + 1, label: `Caja ${i + 1}`, hint: `pág. ${i + 1}` }));
}

const TOGGLE_CFG = {
    ok:       { Icon: PackageCheck,  label: 'OK',      active: 'bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.45)]', idle: 'bg-surface-card-hover text-content-3 border-slate-200 hover:bg-success/10 hover:text-success hover:border-success/30' },
    danada:   { Icon: AlertTriangle, label: 'Dañada',  active: 'bg-amber-500 text-white shadow-[0_2px_8px_rgba(245,158,11,0.45)]',   idle: 'bg-surface-card-hover text-content-3 border-slate-200 hover:bg-warning/10 hover:text-warning hover:border-warning/30' },
    faltante: { Icon: PackageX,      label: 'No llegó',active: 'bg-rose-500 text-white shadow-[0_2px_8px_rgba(239,68,68,0.45)]',    idle: 'bg-surface-card-hover text-content-3 border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200' },
};

export default function LlegadaModal({ open, onClose, onConfirm, items = [], pedidoNumero, cajaMap = {}, cajasElectrolit = 0, cajasEspeciales = [], draftKey = null }) {
    const [estados,              setEstados]              = useState({});
    const [nota,                 setNota]                 = useState('');
    const [electrolitFaltantes,  setElectrolitFaltantes]  = useState(null); // null=sin responder, 0=todas ok, N=N faltantes
    const [espEstados,           setEspEstados]           = useState({});   // label → 'ok' | 'faltante'
    const [cajasExtra,           setCajasExtra]           = useState(0);
    // idx → { sucursalId: string|null, cajaNum: string, sinRotulacion: bool }
    const [cajasExtraData,       setCajasExtraData]       = useState({});
    const [extraError,           setExtraError]           = useState(null);
    const [submitting,           setSubmitting]           = useState(false);
    const [hasDraft,             setHasDraft]             = useState(false);

    // Check for draft on open
    useEffect(() => {
        if (open && draftKey) setHasDraft(!!loadDraft(draftKey)); // eslint-disable-line react-hooks/set-state-in-effect
        if (!open) setHasDraft(false);
    }, [open, draftKey]);

    const cajas = useMemo(() => deriveCajas(cajaMap, items), [cajaMap, items]);

    const getEst  = (num) => estados[num] ?? 'ok';
    const setEst  = (num, val) => setEstados(prev => ({ ...prev, [num]: val }));

    const cajasOk        = cajas.filter(c => getEst(c.num) === 'ok').map(c => c.num);
    const cajasDanadas   = cajas.filter(c => getEst(c.num) === 'danada').map(c => c.num);
    const cajasFaltantes = cajas.filter(c => getEst(c.num) === 'faltante').map(c => c.num);
    const hayProblemas   = cajasDanadas.length > 0 || cajasFaltantes.length > 0;

    const espFaltantes = cajasEspeciales.filter(e => espEstados[e.label] === 'faltante').map(e => e.label);

    const handleConfirm = () => {
        // Validar cajas extra: si no tiene rotulación, requerir número de caja
        for (let i = 0; i < cajasExtra; i++) {
            const d = cajasExtraData[i] ?? {};
            if (!d.sinRotulacion && !d.cajaNum?.trim()) {
                setExtraError(`Caja extra ${i + 1}: ingresa el # de caja o marca "Sin rotulación".`);
                return;
            }
        }
        setExtraError(null);
        setSubmitting(true);
        if (draftKey) clearDraft(draftKey);
        onConfirm({
            cajasOk, cajasDanadas, cajasFaltantes, nota: nota.trim(),
            electrolitFaltantes:    cajasElectrolit > 0 ? electrolitFaltantes : null,
            especialesLlegadas:     cajasEspeciales.length > 0
                ? Object.fromEntries(cajasEspeciales.map(e => [e.label, espEstados[e.label] ?? 'ok']))
                : null,
            cajasExtra:             cajasExtra > 0 ? cajasExtra : 0,
            cajasExtraNotas:        cajasExtra > 0 ? cajasExtraNotas : null,
        });
    };

    // Serializar cajasExtraData a notas de texto para el handler existente
    // eslint-disable-next-line react-hooks/preserve-manual-memoization -- el compiler no puede re-optimizar este useMemo por su cuenta, la memoización manual sigue funcionando igual
    const cajasExtraNotas = useMemo(() => {
        if (cajasExtra === 0) return null;
        const out = {};
        for (let i = 0; i < cajasExtra; i++) {
            const d = cajasExtraData[i] ?? {};
            if (d.sinRotulacion) {
                out[i] = 'Sin rotulación';
            } else {
                const suc = d.sucursalId ? (ERP_NAMES[Number(d.sucursalId)] ?? `Suc. ${d.sucursalId}`) : null;
                const num = d.cajaNum?.trim();
                out[i] = [suc, num ? `Caja #${num}` : null].filter(Boolean).join(' · ') || 'Sin identificar';
            }
        }
        return out;
    }, [cajasExtra, cajasExtraData]);

    const setExtraField = (idx, field, val) =>
        setCajasExtraData(prev => ({ ...prev, [idx]: { ...(prev[idx] ?? {}), [field]: val } }));

    const handleClose = () => {
        if (submitting) return;
        // Save draft if any estado was set (user started filling in)
        const hasState = Object.keys(estados).some(k => estados[k] !== 'ok')
            || nota.trim() || cajasExtra > 0
            || electrolitFaltantes !== null
            || Object.keys(espEstados).length > 0;
        if (draftKey && hasState) {
            saveDraft(draftKey, { estados, nota, electrolitFaltantes, espEstados, cajasExtra, cajasExtraData });
        }
        setEstados({}); setNota(''); setElectrolitFaltantes(null);
        setEspEstados({}); setCajasExtra(0); setCajasExtraData({});
        setExtraError(null); setSubmitting(false);
        onClose();
    };

    const handleRestoreDraft = () => {
        if (!draftKey) return;
        const d = loadDraft(draftKey);
        if (!d) return;
        setEstados(d.estados ?? {});
        setNota(d.nota ?? '');
        setElectrolitFaltantes(d.electrolitFaltantes ?? null);
        setEspEstados(d.espEstados ?? {});
        setCajasExtra(d.cajasExtra ?? 0);
        setCajasExtraData(d.cajasExtraData ?? {});
        setHasDraft(false);
        clearDraft(draftKey);
    };

    if (!open) return null;

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm" className="max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100 shrink-0">
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-content-2 uppercase tracking-wide">Pedido #{pedidoNumero}</p>
                    <h3 className="text-[14px] font-bold text-content leading-tight">¿Cómo llegó cada caja?</h3>
                </div>
                <button onClick={handleClose} disabled={submitting} className="text-content-3 hover:text-content-2 transition-colors">
                    <X size={15} />
                </button>
            </div>

            {/* Draft restore banner */}
            {hasDraft && (
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

            {/* Body — todo el contenido variable va aquí, scrollea cuando no cabe */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-3">
                <p className="text-[10px] text-content-2 uppercase tracking-wide font-semibold">
                    {cajas.length} caja{cajas.length !== 1 ? 's' : ''} en el pedido
                </p>

                <div className="space-y-2">
                    {cajas.map(c => {
                        const est = getEst(c.num);
                        const rowBg = est === 'ok'      ? 'bg-success/60 border-success/70'
                                    : est === 'danada'  ? 'bg-warning/60 border-warning/70'
                                    :                     'bg-rose-50/60 border-rose-200/70';
                        const numBg = est === 'ok'      ? 'bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.4)]'
                                    : est === 'danada'  ? 'bg-amber-500 shadow-[0_2px_8px_rgba(245,158,11,0.4)]'
                                    :                     'bg-rose-500 shadow-[0_2px_8px_rgba(239,68,68,0.4)]';
                        return (
                            <div key={c.num} className={`flex items-center gap-2.5 p-2.5 rounded-2xl border transition-all ${rowBg}`}>
                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-[14px] tabular-nums text-white transition-all ${numBg}`}>
                                    {c.num}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-bold text-content-2 leading-tight">{c.label}</p>
                                    <p className="text-[10px] font-medium text-content-3 mt-0.5">{c.hint}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {(['ok', 'danada', 'faltante']).map(e => {
                                        const { Icon, label, active, idle } = TOGGLE_CFG[e];
                                        return (
                                            <button key={e} onClick={() => setEst(c.num, e)}
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

                {hayProblemas && (
                    <div>
                        <label className="text-[10px] font-semibold text-content-3 uppercase tracking-wide">Nota (opcional)</label>
                        <textarea
                            value={nota} onChange={e => setNota(e.target.value)} rows={2}
                            placeholder="Ej. caja 3 aplastada, caja 4 nunca fue cargada…"
                            className="mt-1 w-full text-[16px] rounded-xl border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                    </div>
                )}

                {/* Electrolit — cuántas no llegaron */}
                {cajasElectrolit > 0 && (
                    <div className="p-3 rounded-2xl border border-warning/30 bg-warning/60 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                            <Zap size={13} className="text-warning shrink-0" />
                            <span className="text-[11px] font-semibold text-amber-700 flex-1">
                                ¿Cuántas cajas de Electrolit no llegaron?
                            </span>
                            <span className="text-[9px] font-bold text-warning uppercase tracking-wide">
                                de {cajasElectrolit}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setElectrolitFaltantes(0)}
                                className={`flex-1 text-[10px] font-bold px-3 py-1.5 rounded-xl border transition-all active:scale-[0.97] ${electrolitFaltantes === 0
                                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm'
                                    : 'bg-white text-content-3 border-slate-200 hover:border-success/30 hover:text-success'}`}>
                                ✓ Todas llegaron
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={() => setElectrolitFaltantes(f => Math.max(0, (f ?? 0) - 1))}
                                    disabled={(electrolitFaltantes ?? 0) <= 0}
                                    className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-content-2 font-black text-[14px] flex items-center justify-center hover:bg-surface-card-hover active:scale-[0.97] transition-all disabled:opacity-30">
                                    −
                                </button>
                                <span className={`w-8 text-center text-[15px] font-black tabular-nums ${
                                    electrolitFaltantes === null ? 'text-content-3'
                                    : electrolitFaltantes === 0  ? 'text-success'
                                    :                              'text-rose-600'}`}>
                                    {electrolitFaltantes ?? '—'}
                                </span>
                                <button
                                    onClick={() => setElectrolitFaltantes(f => Math.min(cajasElectrolit, (f ?? 0) + 1))}
                                    disabled={(electrolitFaltantes ?? 0) >= cajasElectrolit}
                                    className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-content-2 font-black text-[14px] flex items-center justify-center hover:bg-surface-card-hover active:scale-[0.97] transition-all disabled:opacity-30">
                                    +
                                </button>
                            </div>
                        </div>
                        {(electrolitFaltantes ?? 0) > 0 && (
                            <p className="text-[10px] text-rose-600 px-0.5">
                                ⚠ Se notificará a bodega sobre las {electrolitFaltantes} caja{electrolitFaltantes > 1 ? 's' : ''} faltantes.
                            </p>
                        )}
                    </div>
                )}

                {/* Cajas especiales — E1, E2… */}
                {cajasEspeciales.length > 0 && (
                    <div className="p-3 rounded-2xl border border-violet-100 bg-violet-50/60 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Package size={13} className="text-violet-500 shrink-0" />
                            <span className="text-[11px] font-semibold text-violet-700 flex-1">Cajas especiales</span>
                            <span className="text-[9px] font-bold text-violet-400 uppercase tracking-wide">
                                {cajasEspeciales.length} caja{cajasEspeciales.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {cajasEspeciales.map(e => {
                                const est = espEstados[e.label] ?? 'ok';
                                return (
                                    <div key={e.label} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${est === 'ok' ? 'bg-success/80 border-success/70' : 'bg-rose-50/80 border-rose-200/70'}`}>
                                        <span className={`text-[11px] font-black w-7 shrink-0 ${est === 'ok' ? 'text-success' : 'text-rose-600'}`}>{e.label}</span>
                                        <span className="flex-1 text-[10px] text-content-2 leading-tight">{e.product_name}</span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button onClick={() => setEspEstados(p => ({ ...p, [e.label]: 'ok' }))}
                                                className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'ok' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-content-3 border-slate-200 hover:border-success/30 hover:text-success'}`}>
                                                ✓ OK
                                            </button>
                                            <button onClick={() => setEspEstados(p => ({ ...p, [e.label]: 'faltante' }))}
                                                className={`text-[9px] font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'faltante' ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-content-3 border-slate-200 hover:border-rose-200 hover:text-rose-600'}`}>
                                                ✗ Falta
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {espFaltantes.length > 0 && (
                            <p className="text-[10px] text-rose-600 px-0.5">⚠ Faltante{espFaltantes.length > 1 ? 's' : ''}: {espFaltantes.join(', ')}</p>
                        )}
                    </div>
                )}

                {/* Cajas de más */}
                <div>
                    <div className="flex items-center gap-2 p-2.5 rounded-xl border border-warning/80 bg-warning/40">
                        <HelpCircle size={13} className="text-warning shrink-0" />
                        <span className="text-[11px] text-content-2 flex-1">¿Llegaron cajas de más (no esperadas)?</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={() => setCajasExtra(n => Math.max(0, n - 1))} disabled={cajasExtra === 0}
                                className="w-6 h-6 rounded-lg bg-white border border-warning/30 text-content-2 font-black text-[13px] flex items-center justify-center hover:bg-warning/10 active:scale-[0.97] transition-all disabled:opacity-30">−</button>
                            <span className={`w-6 text-center text-[13px] font-black tabular-nums ${cajasExtra > 0 ? 'text-warning' : 'text-content-3'}`}>{cajasExtra}</span>
                            <button onClick={() => setCajasExtra(n => n + 1)}
                                className="w-6 h-6 rounded-lg bg-white border border-warning/30 text-content-2 font-black text-[13px] flex items-center justify-center hover:bg-warning/10 active:scale-[0.97] transition-all">+</button>
                        </div>
                    </div>
                    {cajasExtra > 0 && (
                        <div className="mt-2 space-y-2">
                            {Array.from({ length: cajasExtra }, (_, i) => {
                                const d = cajasExtraData[i] ?? {};
                                return (
                                    <div key={i} className="p-3 rounded-xl border border-warning/30 bg-white space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-bold text-amber-700">Caja extra {i + 1}</span>
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={!!d.sinRotulacion}
                                                    onChange={e => setExtraField(i, 'sinRotulacion', e.target.checked)}
                                                    className="w-3.5 h-3.5 rounded accent-amber-500"
                                                />
                                                <span className="text-[10px] text-content-3">Sin rotulación</span>
                                            </label>
                                        </div>
                                        {!d.sinRotulacion && (
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1">
                                                    <LiquidSelect
                                                        value={d.sucursalId ?? ''}
                                                        onChange={v => setExtraField(i, 'sucursalId', v)}
                                                        options={[{ value: '', label: '¿De qué sucursal?' }, ...SUC_OPTIONS]}
                                                        compact
                                                        clearable={false}
                                                        placeholder="¿De qué sucursal?"
                                                    />
                                                </div>
                                                <input
                                                    value={d.cajaNum ?? ''}
                                                    onChange={e => { setExtraField(i, 'cajaNum', e.target.value); setExtraError(null); }}
                                                    placeholder="# de caja"
                                                    className={`w-32 text-[16px] rounded-lg border px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-300 bg-white ${extraError && !d.cajaNum?.trim() ? 'border-red-400' : 'border-slate-200'}`}
                                                />
                                            </div>
                                        )}
                                        {d.sinRotulacion && (
                                            <p className="text-[10px] text-warning italic">Se reportará a bodega como caja sin identificar.</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-slate-100 space-y-3 shrink-0">
                {(hayProblemas || cajasExtra > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                        {cajasDanadas.length > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-warning/10 text-amber-700 border border-warning/30">
                                ⚠ Dañada{cajasDanadas.length > 1 ? 's' : ''}: {cajasDanadas.map(n => `#${n}`).join(', ')}
                            </span>
                        )}
                        {cajasFaltantes.length > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                                ✗ No llegó{cajasFaltantes.length > 1 ? 'n' : ''}: {cajasFaltantes.map(n => `#${n}`).join(', ')}
                            </span>
                        )}
                        {cajasExtra > 0 && (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-sky-100 text-sky-700 border border-sky-200">
                                + {cajasExtra} caja{cajasExtra > 1 ? 's' : ''} extra{cajasExtra > 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                )}
                {extraError && (
                    <p className="text-[10px] text-danger font-medium flex items-center gap-1">
                        <span>⚠</span> {extraError}
                    </p>
                )}
                {Object.keys(estados).length === 0 && cajas.length > 0 && (
                    <p className="text-[10px] text-content-3 text-center pb-1">
                        Las cajas sin marcar se registran como <strong>OK</strong>
                    </p>
                )}
                <div className="flex items-center justify-between gap-2">
                    <button onClick={handleClose} disabled={submitting}
                        className="text-[11px] font-semibold px-4 py-2 rounded-xl text-content-3 hover:bg-surface-card-hover transition-all">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} disabled={submitting}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 active:scale-[0.97] transition-all flex items-center gap-1.5">
                        {submitting && <Loader2 size={11} className="animate-spin" />}
                        {Object.keys(estados).length === 0 && cajas.length > 0
                            ? '✓ Todas llegaron OK'
                            : 'Confirmar llegada'}
                    </button>
                </div>
            </div>
        </PedidoModal>
    );
}
