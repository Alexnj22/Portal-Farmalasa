import React, { useState, useMemo, useEffect } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import { PackageCheck, PackageX, PackagePlus, Package, AlertTriangle, X, Loader2, Zap, HelpCircle, RotateCcw, Check } from 'lucide-react';
import PedidoModal from './PedidoModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import { getPageGroups } from '../../utils/pedidoPrint';
import { ERP_NAMES, SUCURSALES } from '../../constants/erp';
import { saveDraft, loadDraft, clearDraft } from '../../utils/draftUtils';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalInput from '../../components/common/PortalInput';
import useMontadoParaSalida from '../../hooks/useMontadoParaSalida';

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
    ok:       { Icon: PackageCheck,  label: 'OK',      active: 'bg-success-solid text-white shadow-[var(--shadow-glow-success)]', idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-success/10 hover:text-success hover:border-success/30' },
    danada:   { Icon: AlertTriangle, label: 'Dañada',  active: 'bg-warning-solid text-white shadow-[var(--shadow-glow-warning)]',   idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-warning/10 hover:text-warning hover:border-warning/30' },
    faltante: { Icon: PackageX,      label: 'No llegó',active: 'bg-danger-solid text-white shadow-[var(--shadow-glow-danger)]',    idle: 'bg-surface-card-hover text-content-3 border-divider hover:bg-danger/10 hover:text-danger-text hover:border-danger/30' },
};

export default function LlegadaModal({ open, onClose, onConfirm, items = [], pedidoNumero, cajaMap = {}, cajasElectrolit = 0, cajasEspeciales = [], draftKey = null }) {
    const montadoParaSalida = useMontadoParaSalida(open);
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

    // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

    return (
        // `max-w-xl` y no `max-w-sm`: en 384px la fila de cada caja tenía que
        // meter el número, el rótulo y un segmentado de TRES opciones con ícono
        // y texto. Lo que cedía era el rótulo, que quedaba en una columna de
        // ~50px y se partía en cuatro renglones —«Caja / 1 / pág. / 1»—.
        // El paso siguiente de esta misma recepción (`RecepcionModal`) ya era
        // `max-w-2xl`, así que el angosto era este.
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-xl">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-divider shrink-0">
                <div className="flex-1">
                    <p className="text-label font-medium text-content-2 uppercase tracking-wide">Pedido #{pedidoNumero}</p>
                    <h3 className="text-body-lg font-bold text-content leading-tight">¿Cómo llegó cada caja?</h3>
                </div>
                <Button variant="ghost" icon={X} disabled={submitting} iconOnly onClick={handleClose} />
            </div>

            {/* Draft restore banner */}
            {hasDraft && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-chart-3/10 border border-chart-3/30">
                    <RotateCcw size={12} className="text-chart-3-text shrink-0" />
                    <span className="text-label text-chart-3-text flex-1">Tienes un borrador guardado</span>
                    <Button variant="ghost" onClick={handleRestoreDraft}>Restaurar</Button>
                    <Button variant="ghost" icon={X} iconOnly onClick={() => { if (draftKey) clearDraft(draftKey); setHasDraft(false); }} />
                </div>
            )}

            {/* Body — todo el contenido variable va aquí, scrollea cuando no cabe */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-4">
                <p className="text-caption text-content-2 uppercase tracking-wide font-semibold">
                    {cajas.length} caja{cajas.length !== 1 ? 's' : ''} en el pedido
                </p>

                <div className="space-y-2.5">
                    {cajas.map(c => {
                        const est = getEst(c.num);
                        const rowBg = est === 'ok'      ? 'bg-success/10 border-success/30'
                                    : est === 'danada'  ? 'bg-warning/10 border-warning/30'
                                    :                     'bg-danger/10 border-danger/30';
                        const numBg = est === 'ok'      ? 'bg-success shadow-[var(--shadow-glow-success)]'
                                    : est === 'danada'  ? 'bg-warning shadow-[var(--shadow-glow-warning)]'
                                    :                     'bg-danger shadow-[var(--shadow-glow-danger)]';
                        return (
                            // La fila ENVUELVE en vez de apretarse. El rótulo
                            // conserva un piso de 8rem (`basis-32`), así que
                            // cuando el segmentado no entra al lado se va a su
                            // propio renglón — que es lo correcto en un
                            // teléfono, donde el ancho lo pone la pantalla y
                            // ensanchar el diálogo no ayuda. Antes no envolvía
                            // nada: el rótulo se estrujaba hasta romperse.
                            <div key={c.num} className={`flex flex-wrap items-center gap-x-3 gap-y-2.5 p-3 rounded-2xl border transition-all ${rowBg}`}>
                                <div className="flex items-center gap-3 flex-1 basis-32 min-w-0">
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-black text-body-lg tabular-nums text-white transition-all ${numBg}`}>
                                        {c.num}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-bold text-content-2 leading-tight truncate">{c.label}</p>
                                        <p className="text-caption font-medium text-content-3 mt-0.5 truncate">{c.hint}</p>
                                    </div>
                                </div>
                                <SegmentedControl
                                    size="sm"
                                    options={['ok','danada','faltante'].map(e => ({
                                        value: e, label: TOGGLE_CFG[e].label, icon: TOGGLE_CFG[e].Icon,
                                        tone: e === 'ok' ? 'success' : e === 'danada' ? 'warning' : 'danger',
                                    }))}
                                    value={est} onChange={v => setEst(c.num, v)}
                                    // Nombra la caja: con ocho filas, ocho
                                    // "Estado de la caja" no distinguen ninguna.
                                    label={`Estado de ${c.label}`} />
                            </div>
                        );
                    })}
                </div>

                {hayProblemas && (
                    <div>
                        <label className="text-caption font-semibold text-content-3 uppercase tracking-wide">Nota (opcional)</label>
                        <PortalTextarea
                            value={nota}
                            onChange={e => setNota(e.target.value)}
                            rows={2}
                            placeholder="Ej. caja 3 aplastada, caja 4 nunca fue cargada…"
                            textareaClassName="mt-1"
                        />
                    </div>
                )}

                {/* Electrolit — cuántas no llegaron */}
                {cajasElectrolit > 0 && (
                    <div className="p-3 rounded-2xl border border-warning/30 bg-warning/10 flex flex-col gap-2.5">
                        <div className="flex items-center gap-2">
                            <Zap size={13} className="text-warning shrink-0" />
                            <span className="text-label font-semibold text-warning-text flex-1">
                                ¿Cuántas cajas de Electrolit no llegaron?
                            </span>
                            <span className="text-micro font-bold text-warning uppercase tracking-wide">
                                de {cajasElectrolit}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                tone="success"
                                icon={Check}
                                className="flex-1"
                                onClick={() => setElectrolitFaltantes(0)}
                            >Todas llegaron</Button>
                            <div className="flex items-center gap-1 shrink-0">
                                <Button variant="secondary" size="xs" disabled={(electrolitFaltantes ?? 0) <= 0} onClick={() => setElectrolitFaltantes(f => Math.max(0, (f ?? 0) - 1))}>−</Button>
                                <span className={`w-8 text-center text-subtitle font-black tabular-nums ${
                                    electrolitFaltantes === null ? 'text-content-3'
                                    : electrolitFaltantes === 0  ? 'text-success'
                                    :                              'text-danger-text'}`}>
                                    {electrolitFaltantes ?? '—'}
                                </span>
                                <Button variant="secondary" size="xs" disabled={(electrolitFaltantes ?? 0) >= cajasElectrolit} onClick={() => setElectrolitFaltantes(f => Math.min(cajasElectrolit, (f ?? 0) + 1))}>+</Button>
                            </div>
                        </div>
                        {(electrolitFaltantes ?? 0) > 0 && (
                            <p className="inline-flex items-start gap-1 text-caption text-danger-text px-0.5">
                                <AlertTriangle size={11} className="shrink-0 mt-px" aria-hidden="true" />
                                Se notificará a bodega sobre las {electrolitFaltantes} caja{electrolitFaltantes > 1 ? 's' : ''} faltantes.
                            </p>
                        )}
                    </div>
                )}

                {/* Cajas especiales — E1, E2… */}
                {cajasEspeciales.length > 0 && (
                    <div className="p-3 rounded-2xl border border-chart-3/30 bg-chart-3/10 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Package size={13} className="text-chart-3-text shrink-0" />
                            <span className="text-label font-semibold text-chart-3-text flex-1">Cajas especiales</span>
                            <span className="text-micro font-bold text-chart-3-text uppercase tracking-wide">
                                {cajasEspeciales.length} caja{cajasEspeciales.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {cajasEspeciales.map(e => {
                                const est = espEstados[e.label] ?? 'ok';
                                return (
                                    <div key={e.label} className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all ${est === 'ok' ? 'bg-success/10 border-success/30' : 'bg-danger/10 border-danger/30'}`}>
                                        <span className={`text-label font-black w-7 shrink-0 ${est === 'ok' ? 'text-success' : 'text-danger-text'}`}>{e.label}</span>
                                        <span className="flex-1 text-caption text-content-2 leading-tight">{e.product_name}</span>
                                        {/* OK · Falta es un uno-de-N, no dos botones. Con
                                            `SegmentedControl` el lector de pantalla anuncia
                                            "1 de 2" y la caja de esta especial se lee como
                                            un solo control, no como dos acciones sueltas. */}
                                        <SegmentedControl
                                            size="sm" tone={est === 'ok' ? 'success' : 'danger'}
                                            label={`Estado de la caja ${e.label}`}
                                            value={est}
                                            onChange={v => setEspEstados(p => ({ ...p, [e.label]: v }))}
                                            options={[
                                                { value: 'ok',       label: 'OK',    icon: Check },
                                                { value: 'faltante', label: 'Falta', icon: PackageX },
                                            ]}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                        {espFaltantes.length > 0 && (
                            <p className="inline-flex items-start gap-1 text-caption text-danger-text px-0.5">
                                <AlertTriangle size={11} className="shrink-0 mt-px" aria-hidden="true" />
                                Faltante{espFaltantes.length > 1 ? 's' : ''}: {espFaltantes.join(', ')}
                            </p>
                        )}
                    </div>
                )}

                {/* Cajas de más */}
                <div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3 rounded-xl border border-warning/30 bg-warning/10">
                        <HelpCircle size={13} className="text-warning shrink-0" />
                        <span className="text-label text-content-2 flex-1 basis-40">¿Llegaron cajas de más (no esperadas)?</span>
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                            <Button tone="warning" size="xs" disabled={cajasExtra === 0} onClick={() => setCajasExtra(n => Math.max(0, n - 1))}>−</Button>
                            <span className={`w-6 text-center text-body font-black tabular-nums ${cajasExtra > 0 ? 'text-warning' : 'text-content-3'}`}>{cajasExtra}</span>
                            <Button tone="warning" size="xs" onClick={() => setCajasExtra(n => n + 1)}>+</Button>
                        </div>
                    </div>
                    {cajasExtra > 0 && (
                        <div className="mt-2 space-y-2">
                            {Array.from({ length: cajasExtra }, (_, i) => {
                                const d = cajasExtraData[i] ?? {};
                                return (
                                    <div key={i} className="p-3 rounded-xl border border-warning/30 bg-surface-card space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-caption font-bold text-warning-text">Caja extra {i + 1}</span>
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <Checkbox checked={!!d.sinRotulacion} onChange={(v) => setExtraField(i, 'sinRotulacion', v)} size="sm" />
                                                <span className="text-caption text-content-3">Sin rotulación</span>
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
                                                <PortalInput
                                                    aria-label="Número de caja" compact className="w-32"
                                                    tono={extraError && !d.cajaNum?.trim() ? 'danger' : undefined}
                                                    value={d.cajaNum ?? ''}
                                                    onChange={e => { setExtraField(i, 'cajaNum', e.target.value); setExtraError(null); }}
                                                    placeholder="# de caja"
                                                />
                                            </div>
                                        )}
                                        {d.sinRotulacion && (
                                            <p className="text-caption text-warning-text italic">Se reportará a bodega como caja sin identificar.</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-divider space-y-3 shrink-0">
                {(hayProblemas || cajasExtra > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                        {cajasDanadas.length > 0 && (
                            <Badge variant="warning" uppercase={false} icon={AlertTriangle}>Dañada{cajasDanadas.length > 1 ? 's' : ''}: {cajasDanadas.map(n => `#${n}`).join(', ')}</Badge>
                        )}
                        {cajasFaltantes.length > 0 && (
                            <Badge variant="danger" uppercase={false} icon={PackageX}>No llegó{cajasFaltantes.length > 1 ? 'n' : ''}: {cajasFaltantes.map(n => `#${n}`).join(', ')}</Badge>
                        )}
                        {cajasExtra > 0 && (
                            <Badge variant="warning" uppercase={false} icon={PackagePlus}>{cajasExtra} caja{cajasExtra > 1 ? 's' : ''} extra{cajasExtra > 1 ? 's' : ''}</Badge>
                        )}
                    </div>
                )}
                {extraError && (
                    <p className="text-caption text-danger-text font-medium flex items-center gap-1">
                        <AlertTriangle size={11} className="shrink-0" aria-hidden="true" /> {extraError}
                    </p>
                )}
                {Object.keys(estados).length === 0 && cajas.length > 0 && (
                    <p className="text-caption text-content-3 text-center pb-1">
                        Las cajas sin marcar se registran como <strong>OK</strong>
                    </p>
                )}
                {/* `flex-wrap`: «Confirmar que todas llegaron» no se encoge, y
                    en un teléfono el pie no le daba el ancho — el rótulo salía
                    cortado a media palabra. Envolviendo, baja entero a su
                    renglón. En escritorio nada cambia: los dos entran. */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="secondary" disabled={submitting} onClick={handleClose}>Cancelar</Button>
                    <Button loading={submitting} onClick={handleConfirm}>
                        {Object.keys(estados).length === 0 && cajas.length > 0
                            ? 'Confirmar que todas llegaron'
                            : 'Confirmar llegada'}</Button>
                </div>
            </div>
        </PedidoModal>
    );
}
