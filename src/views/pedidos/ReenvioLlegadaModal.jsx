import React, { useState } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { PackageCheck, PackageX, AlertTriangle, X, Truck, Zap, Package, Check, ChevronLeft } from 'lucide-react';
import PedidoModal from './PedidoModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import useMontadoParaSalida from '../../plataforma/useMontadoParaSalida';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

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
    const montadoParaSalida = useMontadoParaSalida(open);
    const [estados,         setEstados]         = useState({});
    const [nota,            setNota]            = useState('');
    const [electrolitOk,    setElectrolitOk]    = useState(null); // null=sin responder, true=todas ok, false=aun faltan
    const [espEstados,      setEspEstados]       = useState({});   // label → 'ok' | 'faltante'
    const [submitting,      setSubmitting]       = useState(false);
    // Mismo arreglo que `LlegadaModal`: abre con UNA pregunta —¿llegó todo el
    // reenvío?— y el detalle por caja queda detrás de «Algo llegó mal». Un
    // reenvío es justo lo que se mandó porque faltaba: casi siempre llega.
    const [modo,            setModo]             = useState('rapido'); // 'rapido' | 'detalle'

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

    // Espera a que se guarde: si falla, el modal sigue abierto con lo marcado.
    const enviar = async (payload) => {
        if (submitting) return;
        setSubmitting(true);
        const ok = await onConfirm(payload);
        if (ok === false) setSubmitting(false);
    };

    const handleConfirm = () => enviar({
        cajasOk,
        cajasDanadas,
        cajasFaltantes,
        nota: nota.trim(),
        electrolitOk:  electrolitCount > 0 ? (electrolitOk === true) : true,
        especialesAun: especialesList.length > 0 ? espFaltantes : [],
    });

    // «Llegó todo»: el mismo contrato de `onConfirm` con todo en OK. No es una
    // escritura distinta, es el detalle contestado de una vez.
    const handleTodoLlego = () => enviar({
        cajasOk: [...cajasCiclo], cajasDanadas: [], cajasFaltantes: [], nota: '',
        electrolitOk: true, especialesAun: [],
    });

    const totalCajas = cajasCiclo.length + electrolitCount + especialesList.length;
    const enDetalle  = modo === 'detalle' || !hasContent;
    // Lo que se marcó mal, para el resumen del pie: cajas, Electrolit y
    // especiales. Sólo miraba las cajas, así que un Electrolit o una especial
    // que seguía faltando no aparecía en el resumen.
    const hayAvisos = hayProblemas || electrolitOk === false || espFaltantes.length > 0;

    const handleClose = () => {
        if (submitting) return;
        setEstados({}); setNota(''); setElectrolitOk(null);
        setEspEstados({}); setSubmitting(false); setModo('rapido');
        onClose();
    };

    // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

    return (
        // Mismo ancho que `LlegadaModal`: es la misma pregunta en otro momento
        // del pedido, y tenía el mismo rótulo estrujado.
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-xl">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-divider shrink-0">
                <div className="w-9 h-9 rounded-xl bg-chart-3 shadow-[var(--shadow-glow-chart-3-md)] flex items-center justify-center shrink-0">
                    <Truck size={16} className="text-white" />
                </div>
                <div className="flex-1">
                    <p className="text-label font-medium text-content-2 uppercase tracking-wide">
                        Pedido #{pedidoNumero} · Reenvío {cicloNum > 1 ? cicloNum : ''}
                    </p>
                    <h3 className="text-body-lg font-bold text-content leading-tight">{enDetalle ? '¿Cómo llegó el reenvío?' : '¿Llegó todo el reenvío?'}</h3>
                </div>
                <Button variant="ghost" icon={X} disabled={submitting} iconOnly onClick={handleClose} />
            </div>

            {!enDetalle && (<>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-5 space-y-4">
                    <div data-surface="card" className="p-4 flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-chart-3 shadow-[var(--shadow-glow-chart-3-md)] flex items-center justify-center shrink-0">
                            <Package size={18} className="text-white" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-body font-bold text-content-2 leading-tight tabular-nums">
                                {totalCajas} caja{totalCajas !== 1 ? 's' : ''} en este reenvío
                            </p>
                            <ul className="mt-1 space-y-0.5 text-caption text-content-3">
                                {cajasCiclo.length > 0 && <li>Caja{cajasCiclo.length !== 1 ? 's' : ''} {cajasCiclo.map(n => `#${n}`).join(', ')}</li>}
                                {electrolitCount > 0 && <li>{electrolitCount} de Electrolit</li>}
                                {especialesList.length > 0 && <li>Especial{especialesList.length !== 1 ? 'es' : ''} {especialesList.join(', ')}</li>}
                            </ul>
                        </div>
                    </div>

                    <Button size="lg" icon={PackageCheck} className="w-full" loading={submitting} onClick={handleTodoLlego}>
                        {totalCajas === 1 ? 'Llegó la caja' : `Llegaron las ${totalCajas} cajas`}
                    </Button>
                    <div className="flex flex-col items-center gap-1">
                        <Button variant="secondary" icon={AlertTriangle} className="w-full" disabled={submitting} onClick={() => setModo('detalle')}>
                            Algo llegó mal
                        </Button>
                        <p className="text-caption text-content-3 text-center">
                            Una caja dañada o una que todavía no llegó: se marca caja por caja.
                        </p>
                    </div>
                </div>

                <div className="px-5 pb-5 pt-3 border-t border-divider shrink-0 flex justify-start">
                    <Button variant="ghost" disabled={submitting} onClick={handleClose}>Cancelar</Button>
                </div>
            </>)}

            {enDetalle && (<>
            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-4">

                {/* Cajas regulares */}
                {cajasCiclo.length > 0 && (
                    <div className="space-y-2.5">
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
                                // Envuelve en vez de apretarse — ver la nota
                                // equivalente en `LlegadaModal`.
                                <div key={num} className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3 rounded-2xl border transition-all ${rowBg}`}>
                                    <div className="flex items-center gap-3 flex-1 basis-32 min-w-0">
                                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-body-lg tabular-nums text-white transition-all ${numBg}`}>
                                            {num}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content-2 leading-tight truncate">Caja #{num}</p>
                                            <p className="text-caption font-medium text-content-3 mt-0.5 truncate">
                                                {pageHint(cajaMap, num) ?? `Reenvío ${cicloNum}`}
                                            </p>
                                        </div>
                                    </div>
                                    <SegmentedControl
                                        size="sm"
                                        options={['ok','danada','faltante'].map(e => ({
                                            value: e, label: TOGGLE_CFG[e].label, icon: TOGGLE_CFG[e].Icon,
                                            tone: e === 'ok' ? 'success' : e === 'danada' ? 'warning' : 'danger',
                                        }))}
                                        value={est} onChange={v => setEst(num, v)} label={`Estado de la caja ${num}`} />
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
                        {/* Un uno-de-dos, no dos botones: eran dos sólidos lado a
                            lado —verde y rojo— que no mostraban cuál se había
                            elegido. Mismo control que el Electrolit de la
                            primera llegada. */}
                        <SegmentedControl
                            layout="block"
                            label="¿Llegaron las cajas de Electrolit?"
                            value={electrolitOk === null ? null : electrolitOk ? 'si' : 'no'}
                            onChange={v => setElectrolitOk(v === 'si')}
                            options={[
                                { value: 'si', label: 'Sí llegaron', icon: Check,    tone: 'success' },
                                { value: 'no', label: 'Aún faltan',  icon: PackageX, tone: 'danger'  },
                            ]}
                        />
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
                                        {/* OK · Falta es un uno-de-N, no dos botones. */}
                                        <div className="ml-auto shrink-0">
                                            <SegmentedControl
                                                size="sm" tone={est === 'ok' ? 'success' : 'danger'}
                                                label={`Estado de la caja ${label}`}
                                                value={est}
                                                onChange={v => setEspEstados(p => ({ ...p, [label]: v }))}
                                                options={[
                                                    { value: 'ok',       label: 'OK',    icon: Check },
                                                    { value: 'faltante', label: 'Falta', icon: PackageX },
                                                ]}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {hayProblemas && (
                    <div>
                        <label className={rotuloCampo('text-content-3')}>Nota (opcional)</label>
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
                {hayAvisos && (
                    <div className="flex flex-wrap gap-1.5">
                        {cajasDanadas.length > 0 && (
                            <Badge variant="warning" uppercase={false} icon={AlertTriangle}>Dañada{cajasDanadas.length > 1 ? 's' : ''}: {cajasDanadas.map(n => `#${n}`).join(', ')}</Badge>
                        )}
                        {cajasFaltantes.length > 0 && (
                            <Badge variant="danger" uppercase={false} icon={PackageX}>Aún falta{cajasFaltantes.length > 1 ? 'n' : ''}: {cajasFaltantes.map(n => `#${n}`).join(', ')} — se solicitará otro reenvío</Badge>
                        )}
                        {electrolitOk === false && (
                            <Badge variant="warning" uppercase={false} icon={Zap}>Electrolit aún pendiente</Badge>
                        )}
                        {espFaltantes.length > 0 && (
                            <Badge variant="danger" uppercase={false} icon={PackageX}>Esp. aún falta{espFaltantes.length > 1 ? 'n' : ''}: {espFaltantes.join(', ')}</Badge>
                        )}
                    </div>
                )}
                {/* `flex-wrap` — mismo motivo que en `LlegadaModal`: el rótulo
                    del botón principal no se encoge y en un teléfono salía
                    cortado. Acá el más largo es «Responde el Electrolit
                    primero». */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {hasContent
                        ? <Button variant="secondary" icon={ChevronLeft} disabled={submitting} onClick={() => setModo('rapido')}>Volver</Button>
                        : <Button variant="secondary" disabled={submitting} onClick={handleClose}>Cancelar</Button>}
                    <Button tone="chart-3" loading={submitting} disabled={!hasContent || electrolitPending} onClick={handleConfirm}>
                        {electrolitPending ? 'Responde el Electrolit primero' : 'Confirmar reenvío'}</Button>
                </div>
            </div>
            </>)}
        </PedidoModal>
    );
}
