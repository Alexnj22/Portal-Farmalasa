import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { PackageSearch, Check, X, Truck, PackageCheck, CheckCircle2, Link2, Image as ImageIcon, PackagePlus, MessageCircle, Sparkles, CalendarPlus, Wallet } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import FilaConAcciones from './FilaConAcciones';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { fetchEncargos, mensajeDeEncargo, pasarEncargoASaldo, prorrogarEncargo, responderEncargo, vincularProductoDeEncargo, whatsappDe } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';

// Entregar un encargo pagado aplica el pago a su factura (2026-10-20).
const DialogoRetirar = lazy(() => import('../../components/caja/DialogoRetirar'));

/**
 * Encargos de la app de clientes (2026-10-07): lo que un cliente pide porque no
 * hay en ninguna sucursal. Lo ven la sala del retiro y Bodega. Se confirma con
 * precio y fecha estimada (el cliente paga el anticipo del 100 % desde la app),
 * o se dice que no se puede; después se marca pedido, llegó y entregado.
 *
 * Un producto que no tenemos (2026-10-21) llega como consulta, con la ficha del
 * SRS (o «no aparece») y la foto si la hay. Rechazarlo exige motivo. Como es
 * nuevo, Bodega lo crea en el sistema y, cuando ya está en el catálogo, lo
 * vincula aquí: sin eso no se puede marcar «Llegó». Desde el 2026-10-22 la base
 * lo busca sola cada hora y, si lo encuentra, lo sugiere (`sugerido`).
 *
 * El resto de una reserva (2026-10-22, `reserva`) se cobra con la reserva: no
 * pasa por «Esperando pago», y al llegar la reserva queda lista sola.
 *
 * A quien no tiene la app se le avisa por WhatsApp desde aquí: el precio y la
 * fecha cuando Bodega confirma, y que ya llegó.
 *
 * Reglamento v2 (2026-10-22): lo que llegó se retira en 7 días (`retirar_hasta`),
 * con UNA prórroga de 7 más. Si no se retira, la base avisa a la sala para que
 * llame al cliente (`reservas_vigilar`), y si no lo va a retirar —o desiste—
 * la sala lo pasa a saldo a favor: el producto queda para la venta.
 */
const sinVincular = (e) => e.producto_nuevo && !e.product_id;
const ESTADO = {
    solicitado: { label: 'Por responder', variant: 'warning' },
    confirmado: { label: 'Esperando pago', variant: 'info' },
    aceptado: { label: 'Pagado · pedir', variant: 'success' },
    pedido: { label: 'Pedido', variant: 'info' },
    listo: { label: 'Llegó', variant: 'success' },
};
// El resto de una reserva: lo que decide es el cliente, y ya pagó con la reserva.
const ESTADO_DE_RESERVA = {
    confirmado: { label: 'Otro precio · decide el cliente', variant: 'warning' },
    aceptado: { label: 'Reservado · pedir', variant: 'success' },
};
const estadoDe = (e) => (e.reserva && ESTADO_DE_RESERVA[e.estado]) || ESTADO[e.estado];

// `soloLectura`: quien sólo puede mirar las reservas ve el estado sin los botones.
export default function WidgetEncargos({ branchId = null, soloLectura = false }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [ocupado, setOcupado] = useState(null);
    const [confirmando, setConfirmando] = useState(null);
    const [rechazando, setRechazando] = useState(null);
    const [retirando, setRetirando] = useState(null);
    const [vinculando, setVinculando] = useState(null);
    const [aSaldo, setASaldo] = useState(null);

    const cargar = useCallback(async () => {
        try { setFilas(await fetchEncargos(branchId, true)); } catch (err) { console.error('WidgetEncargos: no se pudieron cargar', err); setFilas([]); }
    }, [branchId]);
    useEffect(() => { cargar(); const t = setInterval(cargar, 120_000); return () => clearInterval(t); }, [cargar]);

    const mover = async (e, accion, datos) => {
        setOcupado(e.id);
        try {
            await responderEncargo(e.id, accion, datos);
            // La app del cliente no recibe este aviso: lo da la sala (le llega una notificación).
            showToast('Encargo actualizado', accion === 'confirmar' ? 'La sala recibe el aviso para confirmarlo con el cliente.' : '', 'success');
            cargar();
            return true;
        } catch (err) {
            showToast('No se pudo actualizar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
            return false;
        } finally {
            setOcupado(null);
        }
    };

    const prorrogar = async (e) => {
        setOcupado(e.id);
        try {
            const r = await prorrogarEncargo(e.id);
            showToast('Plazo prorrogado', `Puede retirarlo hasta el ${fechaTexto(r?.retirar_hasta, { day: 'numeric', month: 'long' })}. No admite otra prórroga.`, 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo prorrogar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupado(null);
        }
    };
    // No lanza: el error se avisa acá (el diálogo sólo espera).
    const pasarASaldo = async (motivo) => {
        try {
            const r = await pasarEncargoASaldo(aSaldo.id, motivo);
            showToast('Quedó como saldo a favor', `${formatMoney(r?.saldo)} a favor del cliente (${r?.reserva}). El producto queda para la venta.`, 'success');
            setASaldo(null);
            cargar();
        } catch (err) {
            showToast('No se pudo pasar a saldo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };
    const vencido = (e) => e.estado === 'listo' && e.retirar_hasta && e.retirar_hasta < hoySV();

    if (!filas?.length) return null;
    return (
        <div className="space-y-1.5 mt-3">
            <p className="text-label font-semibold text-content-2 flex items-center gap-1.5"><PackageSearch size={14} /> Encargos de clientes</p>
            <ul className="space-y-1.5 min-w-0">
                {filas.map((e) => (
                    <li key={e.id}>
                        <FilaConAcciones tone={e.estado === 'solicitado' || e.estado === 'aceptado' || vencido(e) ? 'warning' : null}
                            icon={e.producto_nuevo ? PackagePlus : PackageSearch}
                            titulo={`${e.cantidad} × ${e.producto}${e.producto_nuevo ? (e.product_id ? ` → ${e.producto_catalogo ?? 'vinculado'}` : ' · producto nuevo') : ''}`}
                            detalle={`${e.codigo}${e.reserva ? ` · resto de ${e.reserva}` : ''} · ${String(e.cliente ?? '').split(/\s+/)[0]} · retira en ${e.sala}${e.fecha_estimada ? ` · llega ${fechaTexto(e.fecha_estimada, { day: 'numeric', month: 'short' })}` : ''}${e.anticipo ? ` · ${formatMoney(e.anticipo)}` : ''}${e.retirar_hasta ? ` · retira hasta ${fechaTexto(e.retirar_hasta, { day: 'numeric', month: 'short' })}${e.prorrogado_at ? ' (prorrogado)' : ''}` : ''}`}
                            acciones={(
                                <>
                                    <Badge variant={estadoDe(e)?.variant ?? 'neutral'} uppercase={false}>{estadoDe(e)?.label ?? e.estado}</Badge>
                                    {sinVincular(e) && e.sugerido && <Badge variant="info" uppercase={false} title={`Parece que ya entró como «${e.sugerido}»`}>¿Ya está en el catálogo?</Badge>}
                                    {!soloLectura && !e.reserva && !e.tiene_app && ['confirmado', 'listo'].includes(e.estado) && whatsappDe(e.telefono) && (
                                        <Button variant="ghost" size="xs" iconOnly icon={MessageCircle} title="Avisar por WhatsApp"
                                            onClick={() => window.open(`https://wa.me/${whatsappDe(e.telefono)}?text=${encodeURIComponent(mensajeDeEncargo(e))}`, '_blank', 'noopener')} />
                                    )}
                                    {!soloLectura && e.estado === 'solicitado' && (<>
                                        <Button variant="primary" size="xs" icon={Check} onClick={() => setConfirmando(e)}>Confirmar</Button>
                                        <Button variant="ghost" size="xs" iconOnly icon={X} title="No se puede conseguir" onClick={() => setRechazando(e)} />
                                    </>)}
                                    {!soloLectura && e.estado === 'aceptado' && <Button variant="secondary" size="xs" icon={Truck} loading={ocupado === e.id} onClick={() => mover(e, 'pedido')}>Pedido</Button>}
                                    {e.foto_url && <Button variant="ghost" size="xs" iconOnly icon={ImageIcon} title="Ver la foto" onClick={() => openStoredFile(e.foto_url)} />}
                                    {!soloLectura && sinVincular(e) && <Button variant="secondary" size="xs" icon={Link2} onClick={() => setVinculando(e)}>Vincular producto</Button>}
                                    {!soloLectura && (e.estado === 'aceptado' || e.estado === 'pedido') && <Button variant="secondary" size="xs" icon={PackageCheck} loading={ocupado === e.id}
                                        disabled={sinVincular(e)} title={sinVincular(e) ? 'Primero vincula el producto ya creado en el catálogo' : undefined} onClick={() => mover(e, 'listo')}>Llegó</Button>}
                                    {vencido(e) && <Badge variant="warning" uppercase={false}>Sin retirar · llamar</Badge>}
                                    {!soloLectura && e.estado === 'listo' && <Button variant="secondary" size="xs" icon={CheckCircle2} onClick={() => setRetirando(e)}>Entregar</Button>}
                                    {!soloLectura && e.estado === 'listo' && !e.prorrogado_at && <Button variant="ghost" size="xs" icon={CalendarPlus} loading={ocupado === e.id}
                                        title="Una sola prórroga de 7 días" onClick={() => prorrogar(e)}>Prorrogar</Button>}
                                    {!soloLectura && !e.reserva && e.pago_estado === 'pagado' && ['aceptado', 'pedido', 'listo'].includes(e.estado) && (
                                        <Button variant="ghost" size="xs" icon={Wallet} title="El cliente no lo retira o desiste: lo pagado queda a su favor" onClick={() => setASaldo(e)}>A saldo a favor</Button>
                                    )}
                                </>
                            )} />
                    </li>
                ))}
            </ul>
            {confirmando && <Confirmar encargo={confirmando} onClose={() => setConfirmando(null)}
                onConfirmar={async (datos) => { if (await mover(confirmando, 'confirmar', datos)) setConfirmando(null); }} />}
            {retirando && (
                <Suspense fallback={null}>
                    <DialogoRetirar sala={retirando.branch_id ?? branchId} referencia={{ encargo_id: retirando.id }}
                        onClose={() => setRetirando(null)} onListo={() => { setRetirando(null); cargar(); }} />
                </Suspense>
            )}
            {vinculando && <Vincular encargo={vinculando} onClose={() => setVinculando(null)}
                onListo={() => { setVinculando(null); cargar(); }} />}
            {aSaldo && <ASaldo encargo={aSaldo} onClose={() => setASaldo(null)} onConfirmar={pasarASaldo} />}
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
    const riesgo = !encargo.producto_nuevo && (!encargo.devolutivo || !encargo.vendido_antes);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Confirmar encargo">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">Confirmar {encargo.codigo}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">{encargo.cantidad} × {encargo.producto}{encargo.nota_cliente ? ` · «${encargo.nota_cliente}»` : ''}</p>
                    {encargo.producto_nuevo && <FichaDeProductoNuevo encargo={encargo} />}
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
    // Un producto que no tenemos se rechaza con motivo: es lo que se le dice al cliente.
    const exigeMotivo = !!encargo.producto_nuevo;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="No se puede conseguir">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">{titulo}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <PortalTextarea label="Motivo para el cliente" rows={3} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)}
                    placeholder="Ej. El proveedor no lo tiene; te recomendamos …" />
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button variant="danger" icon={X} disabled={exigeMotivo && !nota.trim()} onClick={() => onRechazar(nota.trim() || null)}>Avisar al cliente</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function ASaldo({ encargo, onClose, onConfirmar }) {
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Pasar a saldo a favor">
            <LiquidModal.Header><h2 className="text-body-xl font-semibold text-content">{`${encargo.codigo} a saldo a favor`}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <Notice variant="info" compact icon={Wallet}>
                    Lo pagado ({formatMoney(encargo.anticipo)}) queda a favor del cliente por 60 días, para cualquier compra en cualquier sala.
                    El producto queda para la venta. No se deshace.
                </Notice>
                <PortalTextarea label="Motivo" rows={3} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ej. Se le llamó dos veces y no contestó / dijo que ya no lo necesita" />
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Volver</Button>
                <Button variant="primary" icon={Wallet} loading={enviando} disabled={motivo.trim().length < 3}
                    onClick={async () => { setEnviando(true); await onConfirmar(motivo.trim()); setEnviando(false); }}>Pasar a saldo a favor</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function FichaDeProductoNuevo({ encargo }) {
    const r = encargo.srs;
    return (
        <Notice variant={r ? 'info' : 'warning'} compact icon={PackagePlus}>
            <b>Producto que no está en el catálogo.</b>{' '}
            {r ? `En el SRS: ${[r.nombre, r.principio, r.conc, r.forma, r.lab, r.noregistro && `Reg. ${r.noregistro}`].filter(Boolean).join(' · ')}.`
                : 'No aparece en el SRS: revisar antes de responder.'}
            {encargo.foto_url && (<>{' '}<button type="button" className="underline font-semibold" onClick={() => openStoredFile(encargo.foto_url)}>Ver la foto</button></>)}
        </Notice>
    );
}

// Bodega ya creó el producto y llegó al catálogo: se amarra al encargo.
function Vincular({ encargo, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [ocupado, setOcupado] = useState(false);
    const elegir = async (p) => {
        setOcupado(true);
        try {
            await vincularProductoDeEncargo(encargo.id, p.id);
            showToast('Producto vinculado', `${encargo.codigo} → ${p.nombre}`, 'success');
            onListo();
        } catch (err) {
            showToast('No se pudo vincular', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupado(false);
        }
    };
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Vincular producto">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Vincular {encargo.codigo}</h2>
                <p className="text-body-sm text-content-2">Elige el producto que ya se creó para «{encargo.producto}».</p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <FichaDeProductoNuevo encargo={encargo} />
                    {encargo.sugerido && !ocupado && (
                        <Notice variant="info" compact icon={Sparkles}>
                            Parece que ya entró como <b>{encargo.sugerido}</b>.{' '}
                            <Button variant="secondary" size="xs" icon={Link2}
                                onClick={() => elegir({ id: encargo.sugerido_product_id, nombre: encargo.sugerido })}>Es éste</Button>
                        </Notice>
                    )}
                    {ocupado ? <p className="text-body-sm text-content-3">Vinculando…</p> : (
                        <BuscadorDeProducto placeholder="Producto del catálogo…"
                            invitacion={{ icono: Link2, texto: 'Busca el producto que se creó para este encargo' }} onElegir={elegir} />
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
