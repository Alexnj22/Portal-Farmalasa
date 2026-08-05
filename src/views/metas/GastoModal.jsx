import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Receipt, Plus, Trash2, AlertTriangle } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { crearMetaGasto, previewMetaGasto } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, ymLabelCorto } from './metasUtils';

const squircleClass = 'w-12 h-12 rounded-2xl bg-surface-card-hover border border-border-card shadow-sm flex items-center justify-center shrink-0';

// Hasta 24 meses: más que eso deja de ser «recuperar un gasto» y es otra cosa.
const MESES_OPCIONES = [1, 2, 3, 4, 6, 9, 12, 18, 24].map((n) => ({
    value: String(n), label: n === 1 ? 'Un solo mes' : `${n} meses`,
}));

// Cargar un gasto que se suma a la meta de una o varias salas. El reparto y la
// conversión los hace el servidor: acá no se calcula ni un centavo — la vista
// previa se PIDE, no se deduce.
export default function GastoModal({ isOpen, onClose, onSaved, salaOptions, metasPorClave }) {
    const { showToast } = useToastStore();
    // El primer mes que se puede cargar es el siguiente: un gasto no entra a un
    // mes que ya arrancó (nadie ve su meta moverse a mitad de mes).
    const ymMin = useMemo(() => ymSumar(ymHoySV(), 1), []);

    const [concepto, setConcepto] = useState('');
    const [ym, setYm] = useState(ymMin);
    const [meses, setMeses] = useState('1');
    const [filas, setFilas] = useState([{ branchId: '', monto: '' }]);
    const [nota, setNota] = useState('');
    const [preview, setPreview] = useState(null);
    const [cargandoPreview, setCargandoPreview] = useState(false);
    const [saving, setSaving] = useState(false);

    // Doce meses hacia adelante desde el siguiente. Los meses ya arrancados no
    // están en la lista: la regla se aplica sacando la opción, no explicándola
    // con un error después de guardar.
    const mesOptions = useMemo(
        () => Array.from({ length: 12 }, (_, i) => {
            const v = ymSumar(ymMin, i);
            return { value: v, label: ymLabel(v) };
        }),
        [ymMin],
    );

    useEffect(() => {
        if (!isOpen) return;
        setConcepto(''); setYm(ymMin); setMeses('1');
        setFilas([{ branchId: '', monto: '' }]); setNota('');
        setPreview(null);
    }, [isOpen, ymMin]);

    const salasValidas = useMemo(
        () => filas
            .map((f) => ({ branch_id: Number(f.branchId), monto: parseFloat(String(f.monto).replace(/,/g, '')) }))
            .filter((f) => f.branch_id > 0 && Number.isFinite(f.monto) && f.monto > 0),
        [filas],
    );

    const total = salasValidas.reduce((s, f) => s + f.monto, 0);
    const listoParaPreview = salasValidas.length > 0 && !!ym && Number(meses) > 0;

    // La vista previa se pide al servidor cada vez que cambia algo que la
    // afecta. Es una llamada barata (no escribe) y es la única forma de que lo
    // que se ve sea lo que se guarda.
    useEffect(() => {
        if (!isOpen || !listoParaPreview) { setPreview(null); return; }
        let alive = true;
        setCargandoPreview(true);
        const t = setTimeout(() => {
            previewMetaGasto({ salas: salasValidas, ymInicio: ym, meses: Number(meses) })
                .then((p) => { if (alive) { setPreview(p); setCargandoPreview(false); } })
                .catch(() => { if (alive) { setPreview(null); setCargandoPreview(false); } });
        }, 350);
        return () => { alive = false; clearTimeout(t); };
    }, [isOpen, listoParaPreview, ym, meses, salasValidas]);

    // Cuáles de las metas afectadas ya estaban confirmadas o aprobadas: esas
    // vuelven a revisión, y decirlo antes de guardar es la diferencia entre un
    // aviso y una sorpresa.
    const reabre = useMemo(() => {
        if (!preview?.cuotas) return [];
        const vistas = new Set();
        const out = [];
        for (const c of preview.cuotas) {
            const clave = `${c.branch_id}|${c.year_month}`;
            if (vistas.has(clave)) continue;
            vistas.add(clave);
            const estado = metasPorClave?.[clave];
            if (estado === 'confirmada_supervisor' || estado === 'oficial') {
                out.push(`${c.sala} en ${ymLabelCorto(c.year_month).toLowerCase()}`);
            }
        }
        return out;
    }, [preview, metasPorClave]);

    const setFila = useCallback((i, patch) => {
        setFilas((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
    }, []);

    const salasLibres = useCallback(
        (i) => salaOptions.filter(
            (o) => !filas.some((f, idx) => idx !== i && f.branchId === o.value),
        ),
        [salaOptions, filas],
    );

    const valido = concepto.trim() && salasValidas.length > 0 && !!ym && Number(meses) > 0;

    const guardar = async () => {
        if (!valido || saving) return;
        setSaving(true);
        try {
            const res = await crearMetaGasto({
                concepto: concepto.trim(), salas: salasValidas,
                ymInicio: ym, meses: Number(meses), nota,
            });
            useStaffStore.getState().appendAuditLog('METAS_GASTO_CREAR', String(res?.gasto_id ?? ''), {
                concepto: concepto.trim(), monto: total, meses: Number(meses), desde: ym,
                ventaTotal: res?.venta_total, metasReabiertas: res?.metas_reabiertas,
            });
            showToast(
                'Gasto cargado',
                `${formatMoney(total)} le agregan ${formatMoney(res?.venta_total ?? 0)} de meta`
                  + (res?.metas_reabiertas ? `. ${res.metas_reabiertas} meta(s) volvieron a revisión.` : '.'),
                'success',
            );
            onSaved?.();
            onClose();
        } catch (err) {
            showToast('Error', mensajeAmigable(err, 'No se pudo cargar el gasto'), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Agregar gasto">
            <div className="flex-none px-6 py-6 border-b border-border-card flex items-center gap-4">
                <div className={`${squircleClass} text-brand-text`}><Receipt size={22} strokeWidth={2.5} /></div>
                <div>
                    <h3 className="font-black text-content uppercase tracking-tighter text-lg leading-none mb-1">Agregar gasto</h3>
                    <p className="text-caption font-bold text-content-3 uppercase tracking-[0.2em]">Gastos por recuperar</p>
                </div>
            </div>

            <div className="px-6 py-6 space-y-4 overflow-y-auto">
                <PortalInput
                    label="¿Qué gasto es?" name="concepto"
                    value={concepto} onChange={(e) => setConcepto(e.target.value)}
                    placeholder="Ej. aire acondicionado" required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Desde qué mes</p>
                        <LiquidSelect value={ym} onChange={setYm} options={mesOptions} placeholder="Mes" />
                    </div>
                    <div>
                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Se recupera en</p>
                        <LiquidSelect value={meses} onChange={setMeses} options={MESES_OPCIONES} placeholder="¿En cuántos meses?" />
                    </div>
                </div>

                <div>
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">
                        Salas y cuánto le toca a cada una
                    </p>
                    <div className="space-y-2">
                        {filas.map((f, i) => (
                            <div key={i} className="flex items-end gap-2">
                                <div className="flex-1 min-w-0">
                                    <LiquidSelect
                                        value={f.branchId}
                                        onChange={(v) => setFila(i, { branchId: v })}
                                        options={salasLibres(i)}
                                        placeholder="Sala"
                                    />
                                </div>
                                <div className="w-36 shrink-0">
                                    <PortalInput
                                        label="Monto" name={`monto-${i}`} prefix="$" type="number" compact
                                        value={f.monto} onChange={(e) => setFila(i, { monto: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                                {filas.length > 1 && (
                                    <Button
                                        variant="secondary" size="sm" icon={Trash2} iconOnly
                                        aria-label={`Quitar la fila ${i + 1}`}
                                        onClick={() => setFilas((fs) => fs.filter((_, idx) => idx !== i))}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                    {filas.length < salaOptions.length && (
                        <Button
                            variant="secondary" size="sm" icon={Plus} className="mt-2"
                            onClick={() => setFilas((fs) => [...fs, { branchId: '', monto: '' }])}
                        >
                            Agregar otra sala
                        </Button>
                    )}
                </div>

                {/* La vista previa: nadie carga un gasto a ciegas y descubre
                    después cuánto le subió la meta a cada sala. */}
                {listoParaPreview && (
                    <div data-surface="card" data-tono="warning" className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <p className="text-caption font-black uppercase tracking-widest text-warning-text">Así queda</p>
                            {preview && (
                                <Badge variant="chart-1" size="sm">
                                    {formatMoney(total)} con {formatPct(preview.margen_pct, { decimales: 0 })} de ganancia
                                    {' = '}{formatMoney(total / (Number(preview.margen_pct) / 100))} de venta
                                </Badge>
                            )}
                        </div>

                        {cargandoPreview || !preview ? (
                            <SkeletonText lines={3} />
                        ) : (
                            <div className="space-y-1.5">
                                {preview.cuotas.map((c) => (
                                    <div key={`${c.branch_id}-${c.year_month}`}
                                         className="flex items-center justify-between gap-3 text-body-sm">
                                        <span className="font-bold text-content-2">
                                            {ymLabelCorto(c.year_month)} · {c.sala}
                                        </span>
                                        <span className="tabular-nums text-content-3">
                                            {formatMoney(c.monto_gasto)}
                                            {' → '}
                                            <strong className="text-chart-1-text">{formatMoney(c.monto_venta)}</strong>
                                            {' de meta'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {reabre.length > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        {reabre.length === 1
                            ? `La meta de ${reabre[0]} ya estaba aprobada.`
                            : `Estas metas ya estaban aprobadas: ${reabre.join(', ')}.`}
                        {' '}Al guardar vuelven a revisión y hay que confirmarlas y aprobarlas otra vez,
                        porque cambia el monto que la sala va a perseguir.
                    </Notice>
                )}

                <PortalInput
                    label="Nota (opcional)" name="nota-gasto"
                    value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="Ej. se compró con el proveedor de siempre"
                />
            </div>

            <LiquidModal.Footer>
                <Button variant="secondary" size="lg" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button variant="primary" size="lg" disabled={!valido || saving} onClick={guardar}>
                    {saving ? 'Guardando…' : 'Guardar gasto'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
