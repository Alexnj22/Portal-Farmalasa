import React, { useCallback, useEffect, useState } from 'react';
import { PackageSearch, Check, X, Truck, PackageCheck, CheckCircle2 } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { fetchEncargos, responderEncargo } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';

/**
 * Encargos de la app de clientes (2026-10-07): lo que un cliente pide porque no
 * hay en ninguna sucursal. Lo ven la sala del retiro y Bodega. Se confirma con
 * precio y fecha estimada (el cliente paga el anticipo del 100 % desde la app),
 * o se dice que no se puede; después se marca pedido, llegó y entregado.
 */
const ESTADO = {
    solicitado: { label: 'Por responder', variant: 'warning' },
    confirmado: { label: 'Esperando pago', variant: 'info' },
    aceptado: { label: 'Pagado · pedir', variant: 'success' },
    pedido: { label: 'Pedido', variant: 'info' },
    listo: { label: 'Llegó', variant: 'success' },
};

export default function WidgetEncargos({ branchId = null }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [ocupado, setOcupado] = useState(null);
    const [confirmando, setConfirmando] = useState(null);
    const [rechazando, setRechazando] = useState(null);

    const cargar = useCallback(async () => {
        try { setFilas(await fetchEncargos(branchId, true)); } catch (err) { console.error('WidgetEncargos: no se pudieron cargar', err); setFilas([]); }
    }, [branchId]);
    useEffect(() => { cargar(); const t = setInterval(cargar, 120_000); return () => clearInterval(t); }, [cargar]);

    const mover = async (e, accion, datos) => {
        setOcupado(e.id);
        try {
            await responderEncargo(e.id, accion, datos);
            showToast('Encargo actualizado', accion === 'confirmar' ? 'Le avisamos al cliente con el precio y la fecha.' : '', 'success');
            cargar();
            return true;
        } catch (err) {
            showToast('No se pudo actualizar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
            return false;
        } finally {
            setOcupado(null);
        }
    };

    if (!filas?.length) return null;
    return (
        <div className="space-y-1.5 mt-3">
            <p className="text-label font-semibold text-content-2 flex items-center gap-1.5"><PackageSearch size={14} /> Encargos de clientes</p>
            <ul className="space-y-1.5 min-w-0">
                {filas.map((e) => (
                    <li key={e.id}>
                        <ListRow surface="card" density="sm" tone={e.estado === 'solicitado' || e.estado === 'aceptado' ? 'warning' : null}
                            icon={PackageSearch}
                            title={`${e.cantidad} × ${e.producto}`}
                            subtitle={`${e.codigo} · ${String(e.cliente ?? '').split(/\s+/)[0]} · retira en ${e.sala}${e.fecha_estimada ? ` · llega ${fechaTexto(e.fecha_estimada, { day: 'numeric', month: 'short' })}` : ''}${e.anticipo ? ` · ${formatMoney(e.anticipo)}` : ''}`}
                            trailing={(
                                <div className="flex items-center gap-1">
                                    <Badge variant={ESTADO[e.estado]?.variant ?? 'neutral'} uppercase={false}>{ESTADO[e.estado]?.label ?? e.estado}</Badge>
                                    {e.estado === 'solicitado' && (<>
                                        <Button variant="primary" size="xs" icon={Check} onClick={() => setConfirmando(e)}>Confirmar</Button>
                                        <Button variant="ghost" size="xs" iconOnly icon={X} title="No se puede conseguir" onClick={() => setRechazando(e)} />
                                    </>)}
                                    {e.estado === 'aceptado' && <Button variant="secondary" size="xs" icon={Truck} loading={ocupado === e.id} onClick={() => mover(e, 'pedido')}>Pedido</Button>}
                                    {(e.estado === 'aceptado' || e.estado === 'pedido') && <Button variant="secondary" size="xs" icon={PackageCheck} loading={ocupado === e.id} onClick={() => mover(e, 'listo')}>Llegó</Button>}
                                    {e.estado === 'listo' && <Button variant="secondary" size="xs" icon={CheckCircle2} loading={ocupado === e.id} onClick={() => mover(e, 'entregado')}>Entregado</Button>}
                                </div>
                            )} />
                    </li>
                ))}
            </ul>
            {confirmando && <Confirmar encargo={confirmando} onClose={() => setConfirmando(null)}
                onConfirmar={async (datos) => { if (await mover(confirmando, 'confirmar', datos)) setConfirmando(null); }} />}
            {rechazando && <Rechazar encargo={rechazando} onClose={() => setRechazando(null)}
                onRechazar={async (nota) => { if (await mover(rechazando, 'rechazar', { nota })) setRechazando(null); }} />}
        </div>
    );
}

function Confirmar({ encargo, onClose, onConfirmar }) {
    const [precio, setPrecio] = useState('');
    const [fecha, setFecha] = useState(sumarDias(hoySV(), 3));
    const [nota, setNota] = useState('');
    const p = Number(precio);
    const valido = p > 0 && fecha && fecha >= hoySV();
    // Política del plan: un producto raro, caro y no devolvible necesita el visto bueno del gerente.
    const riesgo = !encargo.devolutivo || !encargo.vendido_antes;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Confirmar encargo">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">Confirmar {encargo.codigo}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">{encargo.cantidad} × {encargo.producto}{encargo.nota_cliente ? ` · «${encargo.nota_cliente}»` : ''}</p>
                    {riesgo && (
                        <Notice variant="warning">
                            {!encargo.devolutivo ? 'No se puede devolver al proveedor. ' : ''}{!encargo.vendido_antes ? 'Nunca se ha vendido en ninguna sucursal. ' : ''}
                            Si es caro, confírmalo con el gerente antes de aceptar.
                        </Notice>
                    )}
                    <PortalInput label="Precio por unidad ($)" type="text" maskType="DECIMAL" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)}
                        helperText={p > 0 ? `El cliente paga ${formatMoney(p * encargo.cantidad)} por adelantado (100 %).` : undefined} />
                    <div>
                        <span className="block text-label font-semibold text-content-2 mb-1">Llega aproximadamente</span>
                        <LiquidDatePicker value={fecha} onChange={setFecha} />
                    </div>
                    <PortalTextarea label="Nota para el cliente (opcional)" rows={2} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button icon={Check} disabled={!valido} onClick={() => onConfirmar({ precio: p, fecha, nota: nota.trim() || null })}>Confirmar y avisar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Rechazar({ encargo, onClose, onRechazar }) {
    const titulo = `No se puede conseguir ${encargo.codigo}`;
    const [nota, setNota] = useState('');
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="No se puede conseguir">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">{titulo}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <PortalTextarea label="Motivo para el cliente" rows={3} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)}
                    placeholder="Ej. El proveedor no lo tiene; te recomendamos …" />
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button variant="danger" icon={X} onClick={() => onRechazar(nota.trim() || null)}>Avisar al cliente</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
