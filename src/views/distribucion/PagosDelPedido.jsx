import React, { useState, useEffect, useCallback } from 'react';
import { Paperclip, Eye, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { fetchPagos, subirComprobante, adjuntarComprobante, mensajeDeDistribucion, LLEVA_COMPROBANTE } from '@nucleo/data/distribucion';
import ComprobantePago from './ComprobantePago';
import { nombreFormaPago, VERIFICACION_PAGO } from '@nucleo/utils/distribucionFacturacion';

// Las formas de pago de un pedido y sus comprobantes, para verlos y para
// adjuntar DESPUÉS el que faltó al vender. La forma y el monto ya no se tocan
// si el pedido está facturado (están en el documento): sólo el comprobante.

// El rótulo y el tono salen del núcleo (la app los dice igual); acá, el ícono.
const ICONO_VERIF = { coincide: CheckCircle2, sin_lectura: CheckCircle2, diferencia_aceptada: AlertTriangle, pendiente: Clock };
const VERIF = Object.fromEntries(Object.entries(VERIFICACION_PAGO).map(([k, v]) => [k, { ...v, icon: ICONO_VERIF[k] }]));

export default function PagosDelPedido({ pedidoId, puedeEditar, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [pagos, setPagos] = useState(null);
    const [error, setError] = useState('');
    const [abierto, setAbierto] = useState(null);
    const [guardando, setGuardando] = useState(false);

    const cargar = useCallback(() => {
        fetchPagos(pedidoId).then(setPagos).catch(e => setError(mensajeDeDistribucion(e)));
    }, [pedidoId]);
    useEffect(() => { cargar(); }, [cargar]);

    const adjuntar = async (pago, r) => {
        setGuardando(true);
        setError('');
        try {
            const url = await subirComprobante(r.archivo, pedidoId);
            await adjuntarComprobante(pago.id, { url, lectura: r.lectura, montoLeido: r.montoLeido, verificacion: r.verificacion, nota: r.nota });
            useStaff.getState().appendAuditLog('DISTRIBUCION_COMPROBANTE', String(pago.id), { verificacion: r.verificacion, pedido: pedidoId });
            showToast('Comprobante guardado', r.verificacion === 'diferencia_aceptada' ? 'Quedó anotada la diferencia.' : '');
            setAbierto(null);
            cargar();
            onCambio?.();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };

    if (error) return <Notice variant="danger" compact>{error}</Notice>;
    if (!pagos) return <p className="text-caption text-content-3">Cargando pagos…</p>;
    if (!pagos.length) return null;

    return (
        <div className="rounded-xl border border-divider overflow-hidden">
            <p className="px-4 py-2 text-caption font-bold text-content-2 border-b border-divider">Pagos</p>
            {pagos.map(p => {
                const v = LLEVA_COMPROBANTE.has(p.forma) ? (VERIF[p.verificacion] ?? VERIF.pendiente) : null;
                return (
                    <div key={p.id} className="px-4 py-2.5 border-b border-divider last:border-b-0 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-body-sm text-content-2">{nombreFormaPago(p.forma)}{p.referencia ? ` · ${p.referencia}` : ''}</p>
                                {p.nota && <p className="text-caption text-content-3">{p.nota}</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {v && <Badge size="sm" variant={v.variant} icon={v.icon} uppercase={false}>{v.label}</Badge>}
                                <span className="tabular-nums font-bold text-content-2">{p.monto != null ? formatMoney(p.monto) : 'El resto'}</span>
                            </div>
                        </div>
                        {v && (
                            <div className="flex flex-wrap gap-2">
                                {p.comprobante_url && (
                                    <Button size="sm" variant="ghost" icon={Eye} onClick={() => openStoredFile(p.comprobante_url)}>Ver comprobante</Button>
                                )}
                                {puedeEditar && abierto !== p.id && (
                                    <Button size="sm" variant="ghost" icon={Paperclip} disabled={guardando} onClick={() => setAbierto(p.id)}>
                                        {p.comprobante_url ? 'Cambiar comprobante' : 'Adjuntar comprobante'}
                                    </Button>
                                )}
                            </div>
                        )}
                        {abierto === p.id && (
                            <ComprobantePago forma={p.forma} montoEsperado={p.monto} puedeCambiarMonto={false} onListo={(r) => adjuntar(p, r)} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
