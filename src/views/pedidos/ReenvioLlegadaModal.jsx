import React, { useState } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { PackageCheck, PackageX, AlertTriangle, X, Loader2, Truck, Zap, Package } from 'lucide-react';
import PedidoModal from './PedidoModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';

const TOGGLE_CFG = {
    ok:       { Icon: PackageCheck,  label: 'OK',      active: 'bg-success-solid text-white shadow-[var(--shadow-glow-success)]', idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-success/10 hover:text-success hover:border-success/30' },
    danada:   { Icon: AlertTriangle, label: 'Dañada',  active: 'bg-warning-solid text-white shadow-[var(--shadow-glow-warning)]',   idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-warning/10 hover:text-warning hover:border-warning/30' },
    faltante: { Icon: PackageX,      label: 'No llegó',active: 'bg-danger-solid text-white shadow-[var(--shadow-glow-danger)]',    idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-danger/10 hover:text-danger-text hover:border-danger/30' },
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
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-divider shrink-0">
                <div className="w-9 h-9 rounded-xl bg-chart-3 shadow-[var(--shadow-glow-chart-3-md)] flex items-center justify-center shrink-0">
                    <Truck size={16} className="text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-label font-medium text-content-2 uppercase tracking-wide">
                        Pedido #{pedidoNumero} · Reenvío {cicloNum > 1 ? cicloNum : ''}
                    </p>
                    <h3 className="text-body-lg font-bold text-content leading-tight">¿Cómo llegó el reenvío?</h3>
                </div>
                <Button variant="ghost" icon={X} disabled={submitting} iconOnly onClick={handleClose} />
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-3">

                {/* Cajas regulares */}
                {cajasCiclo.length > 0 && (
                    <div className="space-y-2">
                        <p className="text-caption text-content-2 uppercase tracking-wide font-semibold">
                            {cajasCiclo.length} caja{cajasCiclo.length !== 1 ? 's' : ''} esperadas
                        </p>
                        {cajasCiclo.map(num => {
                            const est   = getEst(num);
                            const rowBg = est === 'ok'     ? 'bg-success/10 border-success/30'
                                        : est === 'danada' ? 'bg-warning/10 border-warning/30'
                                        :                    'bg-danger/10 border-danger/30';
                            const numBg = est === 'ok'     ? 'bg-success shadow-[var(--shadow-glow-success)]'
                                        : est === 'danada' ? 'bg-warning shadow-[var(--shadow-glow-warning)]'
                                        :                    'bg-danger shadow-[var(--shadow-glow-danger)]';
                            return (
                                <div key={num} className={`flex items-center gap-2.5 p-2.5 rounded-2xl border transition-all ${rowBg}`}>
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-body-lg tabular-nums text-white transition-all ${numBg}`}>
                                        {num}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-body-sm font-bold text-content-2 leading-tight">Caja #{num}</p>
                                        <p className="text-caption font-medium text-content-3 mt-0.5">
                                            {pageHint(cajaMap, num) ?? `Reenvío ${cicloNum}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <SegmentedControl
                                            size="sm"
                                            options={['ok','danada','faltante'].map(e => ({
                                                value: e, label: TOGGLE_CFG[e].label, icon: TOGGLE_CFG[e].Icon,
                                                tone: e === 'ok' ? 'success' : e === 'danada' ? 'warning' : 'danger',
                                            }))}
                                            value={est} onChange={v => setEst(num, v)} label="Estado de la caja" />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Electrolit */}
                {electrolitCount > 0 && (
                    <div className="p-3 rounded-2xl border border-warning/30 bg-warning/10 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                            <Zap size={13} className="text-warning shrink-0" />
                            <span className="text-label font-semibold text-warning-text flex-1">
                                ¿Llegaron las cajas de Electrolit?
                            </span>
                            {electrolitOk === null ? (
                                <span className="text-micro font-bold text-danger-text uppercase tracking-wide animate-pulse">Pendiente</span>
                            ) : (
                                <span className="text-micro font-bold text-warning uppercase tracking-wide">
                                    {electrolitCount} caja{electrolitCount > 1 ? 's' : ''}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" tone="success" className="flex-1" onClick={() => setElectrolitOk(true)}>✓ Sí llegaron</Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                className="flex-1"
                                onClick={() => setElectrolitOk(false)}
                            >✗ Aún faltan</Button>
                        </div>
                    </div>
                )}

                {/* Cajas especiales */}
                {especialesList.length > 0 && (
                    <div className="p-3 rounded-2xl border border-chart-3/30 bg-chart-3/10 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Package size={13} className="text-chart-3-text shrink-0" />
                            <span className="text-label font-semibold text-chart-3-text flex-1">Cajas especiales pendientes</span>
                            <span className="text-micro font-bold text-chart-3-text uppercase tracking-wide">
                                {especialesList.length} caja{especialesList.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {especialesList.map(label => {
                                const est = espEstados[label] ?? 'ok';
                                return (
                                    <div key={label} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${est === 'ok' ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/30'}`}>
                                        <span className={`text-label font-black w-7 shrink-0 ${est === 'ok' ? 'text-success' : 'text-danger-text'}`}>{label}</span>
                                        <div className="flex items-center gap-1 ml-auto shrink-0">
                                            <button onClick={() => setEspEstados(p => ({ ...p, [label]: 'ok' }))}
                                                className={`text-micro font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'ok' ? 'bg-success-solid text-white border-success' : 'bg-surface-card text-content-3 border-divider hover:border-success/30 hover:text-success'}`}>
                                                ✓ OK
                                            </button>
                                            <button onClick={() => setEspEstados(p => ({ ...p, [label]: 'faltante' }))}
                                                className={`text-micro font-bold px-2 py-1 rounded-lg border transition-all active:scale-[0.97] ${est === 'faltante' ? 'bg-danger-solid text-white border-danger' : 'bg-surface-card text-content-3 border-divider hover:border-danger/30 hover:text-danger-text'}`}>
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
                        <label className="text-caption font-semibold text-content-3 uppercase tracking-wide">Nota (opcional)</label>
                        <PortalTextarea
                            value={nota}
                            onChange={e => setNota(e.target.value)}
                            rows={2}
                            placeholder="Ej. caja dañada en el fondo, caja 4 nunca llegó…"
                            textareaClassName="mt-1"
                        />
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-divider space-y-3 shrink-0">
                {hayProblemas && (
                    <div className="flex flex-wrap gap-1.5">
                        {cajasDanadas.length > 0 && (
                            <Badge variant="warning" uppercase={false}>⚠ Dañada{cajasDanadas.length > 1 ? 's' : ''}: {cajasDanadas.map(n => `#${n}`).join(', ')}</Badge>
                        )}
                        {cajasFaltantes.length > 0 && (
                            <Badge variant="danger" uppercase={false}>✗ Aún falta{cajasFaltantes.length > 1 ? 'n' : ''}: {cajasFaltantes.map(n => `#${n}`).join(', ')} — se solicitará otro reenvío</Badge>
                        )}
                        {electrolitOk === false && (
                            <Badge variant="warning" uppercase={false}>⚡ Electrolit aún pendiente</Badge>
                        )}
                        {espFaltantes.length > 0 && (
                            <Badge variant="danger" uppercase={false}>✗ Esp. aún falta{espFaltantes.length > 1 ? 'n' : ''}: {espFaltantes.join(', ')}</Badge>
                        )}
                    </div>
                )}
                <div className="flex items-center justify-between gap-2">
                    <Button variant="secondary" disabled={submitting} onClick={handleClose}>Cancelar</Button>
                    <Button tone="chart-3" disabled={submitting || !hasContent || electrolitPending} onClick={handleConfirm}>{submitting && <Loader2 size={11} className="animate-spin" />}
                        {electrolitPending ? 'Respondé el Electrolit primero' : 'Confirmar reenvío'}</Button>
                </div>
            </div>
        </PedidoModal>
    );
}
