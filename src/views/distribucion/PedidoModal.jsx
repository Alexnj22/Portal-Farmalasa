import React, { useState, useEffect } from 'react';
import { ClipboardList, Receipt, Ban, Loader2, RefreshCw } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { formatMoney, formatQty } from '../../utils/formatNumber';
import { fechaTexto } from '../../utils/fecha';
import { hora12 } from '../../utils/hora';
import { shortEmployeeName } from '../../utils/nameUtils';
import {
    fetchItemsDePedido, facturarPedido, anularPedido, reintentarDocumento, mensajeDeDistribucion,
} from '../../data/distribucion';
import { ESTADO_PEDIDO, ESTADO_DOCUMENTO, TIPO_DOCUMENTO, FORMA_PAGO, rotuloTipoCliente } from './comun';

// El detalle de un pedido y lo que se puede hacer con él. Facturar lo hace el
// servidor; acá se pide y se muestra lo que contestó, incluido «quedó firmado
// y sin enviar», que NO es lo mismo que emitido.
export default function PedidoModal({ pedido, puedeVender, onClose, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);
    const [anulando, setAnulando] = useState(false);
    const [motivo, setMotivo] = useState('');

    useEffect(() => {
        let vivo = true;
        fetchItemsDePedido(pedido.id)
            .then(r => { if (vivo) setItems(r); })
            .catch(e => { if (vivo) setError(mensajeDeDistribucion(e)); });
        return () => { vivo = false; };
    }, [pedido.id]);

    const est = ESTADO_PEDIDO[pedido.estado] ?? ESTADO_PEDIDO.confirmado;
    const dte = pedido.dist_dte;
    const estDte = dte ? ESTADO_DOCUMENTO[dte.estado] : null;
    const puedeFacturar = puedeVender && pedido.estado === 'confirmado';
    const puedeReintentar = puedeVender && dte && ['sin_firmar', 'firmado'].includes(dte.estado);

    const accion = async (clave, fn, auditoria) => {
        setOcupado(clave);
        setError('');
        try {
            const r = await fn();
            useStaff.getState().appendAuditLog(auditoria, String(pedido.id), r ? { estado: r.estado } : {});
            if (r?.estado) {
                showToast(ESTADO_DOCUMENTO[r.estado]?.label ?? 'Listo', r.aviso ?? r.mensaje ?? (r.numero_control ? `Número de control ${r.numero_control}.` : ''),
                    r.estado === 'sellado' ? 'success' : 'warning');
            } else {
                showToast('Listo', '');
            }
            onCambio?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(null);
        }
    };

    const subtotal = (items ?? []).reduce((a, i) => a + i.cantidad * i.precio_sin_iva - i.descuento, 0);

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel={`Pedido ${pedido.id}`}>
            <LiquidModal.Header>
                <div className="flex items-start justify-between gap-4 w-full">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                            <ClipboardList size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content truncate">Pedido {pedido.id}</h2>
                        </div>
                        <p className="text-caption text-content-3 mt-1 truncate">
                            {pedido.dist_clientes?.nombre} · {rotuloTipoCliente(pedido.dist_clientes?.tipo)}
                        </p>
                    </div>
                    <Badge variant={est.variant}>{est.label}</Badge>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-body-sm">
                        <dt className="text-content-3">Tomado</dt>
                        <dd className="text-content-2">{fechaTexto(pedido.created_at, { day: 'numeric', month: 'short' })}, {hora12(pedido.created_at)}</dd>
                        <dt className="text-content-3">Por</dt>
                        <dd className="text-content-2">{shortEmployeeName(pedido.employees) || '—'}</dd>
                        <dt className="text-content-3">Condición</dt>
                        <dd className="text-content-2">
                            {pedido.condicion === 2 ? `Crédito a ${pedido.plazo_dias} días` : `Contado · ${FORMA_PAGO.find(f => f.value === pedido.forma_pago)?.label ?? pedido.forma_pago}`}
                        </dd>
                        {pedido.observaciones && (<>
                            <dt className="text-content-3">Observaciones</dt>
                            <dd className="text-content-2">{pedido.observaciones}</dd>
                        </>)}
                    </dl>

                    {dte && (
                        <Notice variant={estDte.variant === 'success' ? 'success' : estDte.variant === 'danger' ? 'danger' : 'warning'} compact>
                            {TIPO_DOCUMENTO[dte.tipo]?.largo} {dte.numero_control} — {estDte.label}. {estDte.ayuda}
                        </Notice>
                    )}

                    <div className="rounded-xl border border-divider overflow-hidden">
                        {items === null && <p className="p-4 text-caption text-content-3">Cargando productos…</p>}
                        {items?.map(i => (
                            <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-divider last:border-b-0">
                                <div className="min-w-0">
                                    <p className="text-body-sm text-content-2 truncate">{i.descripcion}</p>
                                    <p className="text-caption text-content-3 tabular-nums">
                                        {formatQty(i.cantidad, { decimalesMax: 4 })} × {formatMoney(i.precio_sin_iva)} sin IVA
                                    </p>
                                </div>
                                <span className="tabular-nums font-bold text-content-2 shrink-0">
                                    {formatMoney(i.cantidad * i.precio_sin_iva - i.descuento)}
                                </span>
                            </div>
                        ))}
                        {items?.length > 0 && (
                            <div className="flex justify-between px-4 py-2.5 bg-surface-card-hover/40 text-body-sm">
                                <span className="text-content-3">Subtotal sin IVA</span>
                                <span className="tabular-nums font-black text-content">{formatMoney(subtotal)}</span>
                            </div>
                        )}
                    </div>

                    {anulando && (
                        <PortalInput label="Motivo de la anulación" name="motivo" value={motivo}
                            onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente canceló" />
                    )}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</Button>
                    {puedeFacturar && !anulando && (
                        <Button variant="secondary" icon={Ban} disabled={!!ocupado} onClick={() => setAnulando(true)}>Anular</Button>
                    )}
                    {anulando && (
                        <Button variant="secondary" tone="danger" icon={ocupado === 'anular' ? Loader2 : Ban}
                            disabled={!!ocupado || !motivo.trim()}
                            onClick={() => accion('anular', () => anularPedido(pedido.id, motivo), 'DISTRIBUCION_PEDIDO_ANULADO')}>
                            Confirmar anulación
                        </Button>
                    )}
                    {puedeReintentar && (
                        <Button variant="secondary" icon={ocupado === 'reintentar' ? Loader2 : RefreshCw} disabled={!!ocupado}
                            onClick={() => accion('reintentar', () => reintentarDocumento(pedido.dte_id), 'DISTRIBUCION_DTE_REINTENTO')}>
                            Enviar a Hacienda
                        </Button>
                    )}
                    {puedeFacturar && !anulando && (
                        <Button variant="primary" icon={ocupado === 'facturar' ? Loader2 : Receipt} disabled={!!ocupado || !items?.length}
                            onClick={() => accion('facturar', () => facturarPedido(pedido.id), 'DISTRIBUCION_PEDIDO_FACTURADO')}>
                            Facturar
                        </Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
