import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, PackageSearch, Pencil, Plus, Undo2, X } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Checkbox from '../../components/common/Checkbox';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import PromptModal from '../../components/common/PromptModal';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { confirmarLoteDelLibro, corregirLoteDelLibro, fetchLotesPorRevisar } from '@nucleo/data/bitacoras';
import { vencidoAlVender } from '@nucleo/utils/libroBajoReceta';

// Lotes del libro bajo receta que no sirven para rastrear (PENDIENTES 22).
//
// El lote del renglón sale de la venta, y la venta lo saca del inventario: si
// ahí dice `2603216_2603525` (dos lotes en uno) o «GENERICO», el libro lo
// hereda. Lo que pide la norma es el lote de la caja que se entregó, y eso
// sólo lo sabe quien tiene la caja en la mano — por eso corrige el encargado de
// la sala y no se elige de una lista. El regente confirma. El lote original no
// se pisa: el libro muestra el corregido y la revisión guarda los dos.

const MOTIVO_LOTE = {
    fundido:  { label: 'Dos lotes en uno', variant: 'danger' },
    generico: { label: 'Lote genérico',    variant: 'danger' },
    sin_lote: { label: 'Sin lote',         variant: 'danger' },
    vencido:  { label: 'Vencido al vender', variant: 'warning' },
};

const ESTADO = {
    pendiente:  { label: 'Por corregir',     variant: 'warning' },
    devuelta:   { label: 'Devuelto',         variant: 'danger' },
    corregida:  { label: 'Por confirmar',    variant: 'info' },
    confirmada: { label: 'Confirmado',       variant: 'success' },
};

const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));
const fmt = (f) => (f ? fechaTexto(f, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const MOVIL = { identidad: 'renglon', ancla: 'estado', chips: ['lote'], acciones: true };


// «Abiertas / Confirmadas» se elige en la píldora de la vista; las cuentas
// vuelven por `onCuentas`.
export default function TabLotesPorRevisar({ branchId = null, puedeCorregir = false, puedeConfirmar = false,
    vista = 'abiertas', onCuentas }) {
    const showToast = useToastStore(s => s.showToast);
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [corrigiendo, setCorrigiendo] = useState(null);
    const [devolviendo, setDevolviendo] = useState(null);
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(async () => {
        const { revisiones, error: e } = await fetchLotesPorRevisar(branchId);
        setError(e || null);
        setFilas(e ? [] : revisiones);
    }, [branchId]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al entrar a la pestaña y al cambiar de sala
    useEffect(() => { cargar(); }, [cargar]);

    const abiertas = useMemo(() => (filas || []).filter(f => f.estado !== 'confirmada'), [filas]);
    const confirmadas = useMemo(() => (filas || []).filter(f => f.estado === 'confirmada'), [filas]);
    useEffect(() => { onCuentas?.({ abiertas: abiertas.length, confirmadas: confirmadas.length }); }, [abiertas, confirmadas, onCuentas]);
    const lista = vista === 'abiertas' ? abiertas : confirmadas;
    const porCorregir = abiertas.filter(f => f.estado === 'pendiente' || f.estado === 'devuelta').length;
    const porConfirmar = abiertas.filter(f => f.estado === 'corregida').length;

    const confirmar = async (f) => {
        setOcupado(f.id);
        const { error: e } = await confirmarLoteDelLibro({ revisionId: f.id, aceptar: true });
        setOcupado(null);
        if (e) { showToast('No se pudo confirmar', mensajeAmigable(e), 'error'); return; }
        useStaff.getState().appendAuditLog('BITACORA_LOTE_CONFIRMADO', String(f.dispensacion_id), { revision_id: f.id, folio: f.folio_txt });
        showToast('Lote confirmado', `${f.folio_txt} · ${f.producto_nombre}`, 'success');
        cargar();
    };

    const devolver = async (motivo) => {
        const f = devolviendo;
        setOcupado(f.id);
        const { error: e } = await confirmarLoteDelLibro({ revisionId: f.id, aceptar: false, motivo });
        setOcupado(null);
        if (e) { showToast('No se pudo devolver', mensajeAmigable(e), 'error'); return; }
        useStaff.getState().appendAuditLog('BITACORA_LOTE_DEVUELTO', String(f.dispensacion_id), { revision_id: f.id, folio: f.folio_txt, motivo });
        showToast('Devuelto a la sala', f.folio_txt, 'success');
        setDevolviendo(null);
        cargar();
    };

    return (
        <div className="space-y-4">
            {abiertas.length > 0 ? (
                <Notice variant={porCorregir ? 'warning' : 'info'} icon={PackageSearch} bloque>
                    <span className="font-bold">
                        {[porCorregir && `${porCorregir} por corregir`, porConfirmar && `${porConfirmar} por confirmar`]
                            .filter(Boolean).join(' · ')}
                    </span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Escribe el lote y el vencimiento impresos en la caja entregada. Después lo confirma el regente.
                    </span>
                </Notice>
            ) : filas && !error && (
                <Notice variant="success" icon={Check}>No hay lotes del libro por revisar.</Notice>
            )}


            {error && <Notice variant="danger">{mensajeAmigable(error)}</Notice>}

            <DataTable
                columns={[
                    { key: 'renglon', label: 'Renglón' },
                    { key: 'lote',    label: 'Lote' },
                    { key: 'estado',  label: 'Estado' },
                    { key: 'accion',  label: '' },
                ]}
                loading={filas == null}
                skeletonRows={3}
                empty={{ icon: PackageSearch, message: vista === 'abiertas' ? 'Nada por revisar' : 'Ninguno confirmado todavía' }}
                minWidth="760px"
                movil={MOVIL}
            >
                {lista.map((f, i) => {
                    const m = MOTIVO_LOTE[f.motivo];
                    const e = ESTADO[f.estado];
                    const partes = Array.isArray(f.partes) ? f.partes : [];
                    const corrige = puedeCorregir && (f.estado === 'pendiente' || f.estado === 'devuelta');
                    const confirma = puedeConfirmar && f.estado === 'corregida';
                    return (
                        <DataRow key={f.id} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold text-content leading-snug">{f.producto_nombre}</p>
                                <p className="text-caption text-content-3 tabular-nums">
                                    {f.folio_txt} · {fmt(f.fecha)} · {num(f.cantidad)} {Number(f.cantidad) === 1 ? 'unidad' : 'unidades'}
                                    {branchId ? '' : ` · ${f.sala}`}
                                </p>
                            </DataCell>
                            <DataCell className="text-body-sm">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {m && <Badge variant={m.variant} size="sm" uppercase={false}>{m.label}</Badge>}
                                    <span className={`tabular-nums ${partes.length ? 'line-through text-content-3' : 'text-content-2'}`}>
                                        {f.lote_original || 'sin lote'} · vence {fmt(f.vence_original)}
                                    </span>
                                </div>
                                {partes.length > 0 && (
                                    <ul className="mt-1 space-y-0.5">
                                        {partes.map((p, k) => (
                                            <li key={k} className="tabular-nums text-content font-semibold">
                                                {p.lote} · vence {fmt(p.vence)}{partes.length > 1 ? ` · ${num(p.cantidad)}` : ''}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {f.vendido_vencido && (
                                    <Badge variant="danger" size="sm" uppercase={false} className="mt-1">Se vendió vencido</Badge>
                                )}
                                {f.nota && <p className="mt-1 text-caption text-content-3">{f.nota}</p>}
                            </DataCell>
                            <DataCell className="text-body-sm">
                                {e && <Badge variant={e.variant} size="sm">{e.label}</Badge>}
                                {f.estado === 'devuelta' && f.devuelta_motivo && (
                                    <p className="mt-1 text-caption text-danger-text">{f.devuelta_motivo}</p>
                                )}
                                {f.corregida_por_nombre && (
                                    <p className="mt-1 text-caption text-content-3">
                                        Corrigió {shortEmployeeName(f.corregida_por_nombre)}
                                    </p>
                                )}
                                {f.confirmada_por_nombre && (
                                    <p className="text-caption text-content-3">
                                        Confirmó {shortEmployeeName(f.confirmada_por_nombre)}
                                    </p>
                                )}
                            </DataCell>
                            <DataCell align="right">
                                <div className="flex flex-wrap justify-end gap-1.5">
                                    {corrige && (
                                        <Button variant="primary" size="sm" icon={Pencil} onClick={() => setCorrigiendo(f)}>
                                            Escribir el lote
                                        </Button>
                                    )}
                                    {confirma && (
                                        <>
                                            <Button variant="ghost" size="sm" icon={Undo2}
                                                disabled={ocupado === f.id} onClick={() => setDevolviendo(f)}>
                                                Devolver
                                            </Button>
                                            <Button variant="primary" size="sm" icon={Check}
                                                loading={ocupado === f.id} onClick={() => confirmar(f)}>
                                                Confirmar
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {corrigiendo && (
                <CorregirLote revision={corrigiendo}
                    onCerrar={(guardado) => {
                        if (guardado) {
                            useStaff.getState().appendAuditLog('BITACORA_LOTE_CORREGIDO', String(corrigiendo.dispensacion_id), { revision_id: corrigiendo.id, folio: corrigiendo.folio_txt });
                            showToast('Lote guardado', 'Queda para que lo confirme el regente.', 'success');
                            cargar();
                        }
                        setCorrigiendo(null);
                    }} />
            )}

            <PromptModal isOpen={Boolean(devolviendo)} onClose={() => setDevolviendo(null)}
                onConfirm={devolver} required isProcessing={Boolean(ocupado)}
                title="Devolver a la sala"
                message={devolviendo ? `${devolviendo.folio_txt} · ${devolviendo.producto_nombre}. Di qué está mal para que la sala lo vuelva a mirar.` : ''}
                placeholder="Por ejemplo: el vencimiento no coincide con la caja."
                confirmText="Devolver" />
        </div>
    );
}

const PARTE_VACIA = { lote: '', vence: '', cantidad: '' };

function CorregirLote({ revision, onCerrar }) {
    const cantidad = Number(revision.cantidad);
    const previas = Array.isArray(revision.partes) && revision.partes.length ? revision.partes : null;
    const [partes, setPartes] = useState(() => (previas
        ? previas.map(p => ({ lote: p.lote, vence: p.vence, cantidad: String(p.cantidad) }))
        : [{ ...PARTE_VACIA, cantidad: String(cantidad) }]));
    const [vendidoVencido, setVendidoVencido] = useState(Boolean(revision.vendido_vencido));
    const [nota, setNota] = useState(revision.nota || '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const cambiar = (k, campo, valor) => setPartes(ps => ps.map((p, i) => (i === k ? { ...p, [campo]: valor } : p)));
    const suma = partes.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
    // Mismo juez que la base (`libro_lote_motivo`): un lote por fila.
    const fundido = (l) => /_/.test(l) || /\d{5,}\s*[-/, ]\s*\d{5,}/.test(l) || l.trim().toUpperCase() === 'GENERICO';
    const algunaVencida = partes.some(p => vencidoAlVender(p.vence, revision.fecha));
    const completas = partes.every(p => p.lote.trim() && p.vence && Number(p.cantidad) > 0 && !fundido(p.lote));
    const cuadra = Math.abs(suma - cantidad) < 1e-9;
    const puedeGuardar = !guardando && completas && cuadra && (algunaVencida === vendidoVencido);

    const guardar = async () => {
        setGuardando(true); setError(null);
        const { error: e } = await corregirLoteDelLibro({
            revisionId: revision.id, partes, vendidoVencido, nota: nota.trim() || null,
        });
        setGuardando(false);
        if (e) { setError(mensajeAmigable(e)); return; }
        onCerrar(true);
    };

    const motivo = MOTIVO_LOTE[revision.motivo];

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-2xl" ariaLabel="Escribir el lote real">
            <LiquidModal.Header titulo={revision.producto_nombre}
                onClose={guardando ? undefined : () => onCerrar(false)}
                subtitulo={`${revision.folio_txt} · ${fmt(revision.fecha)} · ${num(cantidad)} ${cantidad === 1 ? 'entregada' : 'entregadas'}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                    {motivo && <Badge variant={motivo.variant} size="sm" uppercase={false}>{motivo.label}</Badge>}
                    <span className="text-caption text-content-3 tabular-nums">
                        Dice: {revision.lote_original || 'sin lote'} · vence {fmt(revision.vence_original)}
                    </span>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {revision.estado === 'devuelta' && revision.devuelta_motivo && (
                    <Notice variant="danger" icon={Undo2} bloque>
                        <span className="font-bold">El regente lo devolvió</span>
                        <span className="block mt-0.5 font-normal text-content-2">{revision.devuelta_motivo}</span>
                    </Notice>
                )}
                <p className="text-body-sm text-content-2">
                    Escribe el lote y el vencimiento tal como están impresos en la caja. Si se entregó de dos lotes,
                    agrega una fila por cada uno.
                </p>

                {partes.map((p, k) => (
                    <div key={k} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_6rem_auto] gap-2 items-end">
                        <PortalInput label={partes.length > 1 ? `Lote ${k + 1}` : 'Lote'} name={`lote-${k}`}
                            value={p.lote} onChange={(ev) => cambiar(k, 'lote', ev.target.value.toUpperCase())}
                            placeholder="Como dice la caja" inputClassName="tabular-nums"
                            hasError={Boolean(p.lote) && fundido(p.lote)}
                            helperText={p.lote && fundido(p.lote) ? 'Un lote por fila' : undefined} />
                        <label className="block">
                            <span className="block text-label font-black uppercase tracking-widest text-content-3 mb-1.5">Vence</span>
                            <LiquidDatePicker value={p.vence} onChange={(v) => cambiar(k, 'vence', v || '')} />
                        </label>
                        <PortalInput label="Cantidad" name={`cantidad-${k}`} type="number" inputMode="decimal"
                            step="0.001" min="0" value={p.cantidad}
                            onChange={(ev) => cambiar(k, 'cantidad', ev.target.value)} inputClassName="tabular-nums" />
                        {partes.length > 1 ? (
                            <Button variant="ghost" size="sm" icon={X} iconOnly title="Quitar este lote"
                                onClick={() => setPartes(ps => ps.filter((_, i) => i !== k))} />
                        ) : <span />}
                    </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-2">
                    {partes.length < 5 && (
                        <Button variant="secondary" size="sm" icon={Plus}
                            onClick={() => setPartes(ps => [...ps, { ...PARTE_VACIA }])}>
                            Salió de otro lote
                        </Button>
                    )}
                    <p className={`text-body-sm font-bold tabular-nums ${cuadra ? 'text-success-text' : 'text-warning-text'}`}>
                        {cuadra ? `Suma ${num(suma)} de ${num(cantidad)}` : `Suman ${num(suma)} y se entregaron ${num(cantidad)}`}
                    </p>
                </div>

                {(algunaVencida || vendidoVencido) && (
                    <Notice variant="danger" icon={AlertTriangle} bloque>
                        <span className="font-bold">Ese vencimiento es anterior a la venta ({fmt(revision.fecha)}).</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Revisa la fecha. Si de verdad se entregó vencido, márcalo: queda anotado en el libro y le llega al regente.
                        </span>
                        <Checkbox className="mt-1" checked={vendidoVencido} onChange={setVendidoVencido}
                            label="Sí, se entregó vencido" />
                    </Notice>
                )}

                <PortalTextarea label="Nota (opcional)" name="nota" rows={2}
                    value={nota} onChange={(ev) => setNota(ev.target.value)}
                    placeholder="Por ejemplo: la caja trae dos lotes pegados en la misma etiqueta." />

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" icon={Check} onClick={guardar} loading={guardando} disabled={!puedeGuardar}>
                    Guardar el lote
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
