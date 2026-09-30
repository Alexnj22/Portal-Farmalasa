import React, { useState, useEffect, useMemo } from 'react';
import { Undo2, Loader2, AlertTriangle, PackageCheck, ShieldAlert, Info, FileMinus } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fetchDevolucionDisponible, emitirNotaCredito, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { totalDevolucion, DESTINOS_DEVOLUCION } from './devolucion';

// Devolución parcial de un Crédito Fiscal: el cliente regresa parte de lo que
// compró y sale una Nota de Crédito por eso (borrador 0017).
//
// Por renglón y LOTE, porque lo que vuelve tiene que volver a su lote (o no
// volver: dañado o vencido va a cuarentena). La pantalla sólo deja pedir lo
// que la base va a aceptar —lo vendido menos lo ya devuelto—, y el total que
// muestra es el de los productos con IVA: la nota calcula el exacto con la
// percepción o retención del documento original.

export default function DevolucionModal({ dteId, onClose, onEmitida }) {
    const showToast = useToastStore(s => s.showToast);
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [unidades, setUnidades] = useState({});   // clave renglón → texto
    const [destino, setDestino] = useState({});     // clave renglón → reingreso|cuarentena
    const [motivo, setMotivo] = useState('');
    const [emitiendo, setEmitiendo] = useState(false);
    // Uno por intento de devolución: un reintento tras un corte no emite dos notas.
    const [uuid] = useState(() => crypto.randomUUID());

    useEffect(() => {
        let vivo = true;
        fetchDevolucionDisponible(dteId).then(d => { if (vivo) setDatos(d); })
            .catch(e => { if (vivo) setError(mensajeDeDistribucion(e)); });
        return () => { vivo = false; };
    }, [dteId]);

    const items = useMemo(() => (datos?.items ?? []).map(it => ({ ...it, clave: `${it.item_id}:${it.lote_id ?? ''}` })), [datos]);
    const pedidos = useMemo(() => items.map(it => ({
        ...it, pide: unidades[it.clave] ?? '', destino: destino[it.clave] ?? 'reingreso',
    })), [items, unidades, destino]);
    const { total, renglones, errores } = useMemo(() => totalDevolucion(pedidos), [pedidos]);
    const listo = datos?.puede && renglones.length > 0 && !errores.length && motivo.trim() !== '' && !emitiendo;

    const emitir = async () => {
        setEmitiendo(true);
        setError('');
        try {
            const r = await emitirNotaCredito({ dteId, clientUuid: uuid, motivo: motivo.trim(), renglones });
            useStaff.getState().appendAuditLog('DISTRIBUCION_NOTA_CREDITO', String(r?.dte_id ?? ''),
                { origen: dteId, total: r?.total, renglones: renglones.length, a_favor: r?.a_favor, motivo: motivo.trim() });
            const aFavor = Number(r?.a_favor ?? 0);
            showToast('Nota de crédito emitida',
                aFavor > 0 ? `Hay que devolverle ${formatMoney(aFavor)} al cliente (ya había pagado).`
                    : `Se descontó ${formatMoney(Number(r?.credito_aplicado ?? 0))} de su cuenta.`,
                'success');
            onEmitida?.(r?.dte_id);
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setEmitiendo(false);
        }
    };

    const doc = datos?.documento;
    return (
        <LiquidModal open onClose={emitiendo ? undefined : onClose} maxWidth="max-w-3xl" ariaLabel="Devolución">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <Undo2 size={18} className="text-brand-text shrink-0" />
                        <h2 className="text-title font-black text-content truncate">Devolución con nota de crédito</h2>
                    </div>
                    {doc && <p className="text-caption text-content-3 mt-1 truncate">{doc.cliente} · {doc.numero_control} · {fechaNumerica(doc.fec_emi)}</p>}
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4" data-devolucion>
                    {error && <Notice variant="danger" icon={AlertTriangle} bloque>{error}</Notice>}
                    {!datos && !error && <p className="text-caption text-content-3 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Cargando…</p>}
                    {datos && !datos.puede && <Notice variant="warning" icon={Info} bloque>{datos.motivo}</Notice>}
                    {datos?.notas?.length > 0 && (
                        <Notice variant="info" icon={FileMinus} bloque>
                            Ya tiene {datos.notas.length} nota{datos.notas.length === 1 ? '' : 's'} de crédito por {formatMoney(datos.notas.reduce((a, n) => a + Number(n.total), 0))}.
                            Abajo sólo se puede devolver lo que queda.
                        </Notice>
                    )}
                    {datos?.puede && (<>
                        <ul className="flex flex-col divide-y divide-divider" aria-label="Productos del documento">
                            {pedidos.map(it => {
                                const sinQueda = it.disponibles <= 0;
                                const mal = errores.includes(it.clave);
                                return (
                                    <li key={it.clave} className={`py-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-end ${sinQueda ? 'opacity-50' : ''}`} data-renglon-devolucion={it.clave}>
                                        <div className="md:col-span-5 min-w-0">
                                            <p className="text-body-sm font-bold text-content-2 truncate" title={it.descripcion}>{it.descripcion}</p>
                                            <p className="text-caption text-content-3 truncate">
                                                {it.lote ? `Lote ${it.lote}${it.vence ? ` · vence ${fechaNumerica(it.vence)}` : ''} · ` : ''}
                                                vendidas {it.vendidas}{it.devueltas ? ` · ya devueltas ${it.devueltas}` : ''} · {formatMoney(Number(it.precio_unitario))} c/u
                                            </p>
                                        </div>
                                        <PortalInput label="Devuelve" name={`dev-${it.clave}`} inputMode="numeric" value={it.pide} readOnly={sinQueda}
                                            onChange={(e) => setUnidades(u => ({ ...u, [it.clave]: e.target.value }))} className="md:col-span-2"
                                            hasError={mal} errorMessage={`Hasta ${it.disponibles}`} helperText={sinQueda ? 'Nada' : `de ${it.disponibles}`} />
                                        <div className="md:col-span-5">
                                            <SegmentedControl value={it.destino} onChange={(v) => setDestino(d => ({ ...d, [it.clave]: v }))}
                                                options={DESTINOS_DEVOLUCION} size="sm" />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                        <PortalTextarea label="¿Por qué devuelve? (va en la nota)" name="motivo-devolucion" value={motivo} rows={2}
                            onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: dos cajas llegaron golpeadas" />
                        <div data-surface="card" className="p-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-caption text-content-3 flex items-center gap-1.5">
                                <PackageCheck size={14} /> {renglones.filter(r => r.destino === 'reingreso').length} vuelven a bodega
                                <ShieldAlert size={14} className="ml-2" /> {renglones.filter(r => r.destino === 'cuarentena').length} a cuarentena
                            </span>
                            <span className="text-body font-black tabular-nums text-content" data-total-devolucion>{formatMoney(total)}</span>
                        </div>
                        <p className="text-caption text-content-3">
                            Si la venta se fió y todavía se debe, la nota se descuenta de esa cuenta. Si ya estaba pagada, te dice cuánto devolverle al cliente.
                        </p>
                    </>)}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={emitiendo}>Cancelar</Button>
                    {datos?.puede && (
                        <Button variant="primary" icon={emitiendo ? Loader2 : FileMinus} disabled={!listo} onClick={emitir}>Emitir nota de crédito</Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
