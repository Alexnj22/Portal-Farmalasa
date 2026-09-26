import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { ClipboardList, Plus, Trash2, ShieldAlert, Loader2, Receipt, Save } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import useBorrador from '../../hooks/useBorrador';
import { formatMoney } from '../../utils/formatNumber';
import { hoySV } from '../../utils/fecha';
import { crearPedido, facturarPedido, mensajeDeDistribucion } from '../../data/distribucion';
import { FORMA_PAGO, estimarPedido, leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO } from './comun';

// Tomar un pedido de preventa.
//
// ── Lo que la pantalla filtra y lo que decide la base ──────────────────────
// La lista de productos ya viene recortada a venta libre cuando el cliente es
// una tienda o un supermercado, y el cliente sin licencia de la SRS se ve en
// rojo antes de elegirlo. Pero eso es AYUDA: quien decide es el trigger de la
// base, que rechaza igual un producto con receta o un cliente sin licencia
// aunque la pantalla se equivocara. El precio tampoco sale de acá: se muestra
// el del catálogo y la base pone el mismo.
//
// ── Borrador ───────────────────────────────────────────────────────────────
// Un pedido de veinte renglones se toma parado frente al mostrador de una
// tienda. Si la sesión se cierra sola en el medio, se pierde todo: por eso se
// guarda solo, y el UUID del pedido va en el borrador para que reintentar no
// duplique nada.

const renglonVacio = () => ({ product_id: '', cantidad: '1' });

export default function NuevoPedidoModal({ open, onClose, emisor, clientes, catalogo, onCreado }) {
    const [clienteId, setClienteId] = useState('');
    const [renglones, setRenglones] = useState([renglonVacio()]);
    const [condicion, setCondicion] = useState(1);
    const [plazo, setPlazo] = useState('');
    const [formaPago, setFormaPago] = useState('01');
    const [notas, setNotas] = useState('');
    const [uuid, setUuid] = useState(() => crypto.randomUUID());
    const [guardando, setGuardando] = useState(null); // 'guardar' | 'facturar'
    const [error, setError] = useState('');

    const { recuperado, descartar } = useBorrador(
        open && emisor ? `distribucion-pedido-${emisor.id}` : null,
        { clienteId, renglones, condicion, plazo, formaPago, notas, uuid },
        { activo: open, vale: (v) => !!v?.clienteId || v?.renglones?.some(r => r.product_id) },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        if (!open) { repuesto.current = false; return; }
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        setClienteId(recuperado.clienteId ?? '');
        setRenglones(recuperado.renglones?.length ? recuperado.renglones : [renglonVacio()]);
        setCondicion(recuperado.condicion ?? 1);
        setPlazo(recuperado.plazo ?? '');
        setFormaPago(recuperado.formaPago ?? '01');
        setNotas(recuperado.notas ?? '');
        if (recuperado.uuid) setUuid(recuperado.uuid);
    }, [open, recuperado]);

    const cliente = useMemo(() => clientes.find(c => String(c.id) === String(clienteId)) ?? null, [clientes, clienteId]);
    const licenciaVencida = cliente?.licencia_srs_vence && cliente.licencia_srs_vence < hoySV();
    const sinLicencia = cliente && (!cliente.licencia_srs || licenciaVencida);
    const tieneCredito = cliente && cliente.plazo_dias > 0 && Number(cliente.limite_credito) > 0;

    const opcionesClientes = useMemo(() => clientes
        .filter(c => c.activo)
        .map(c => ({
            value: String(c.id),
            label: c.nombre,
            // El detalle a la derecha es lo que decide si se le puede vender.
            sublabel: `${rotuloTipoCliente(c.tipo)} · ${c.contribuyente ? 'Crédito Fiscal' : 'Factura'}${!c.licencia_srs ? ' · sin licencia SRS' : ''}`,
        })), [clientes]);

    const catalogoPermitido = useMemo(() => {
        const soloLibre = cliente && soloVentaLibre(cliente.tipo);
        return catalogo.filter(p => p.activo && (!soloLibre || (p.venta_libre && !p.controlado)));
    }, [catalogo, cliente]);
    const porId = useMemo(() => new Map(catalogo.map(p => [String(p.product_id), p])), [catalogo]);

    // Al cambiar de cliente, lo que ya no se le puede vender se marca (no se borra
    // en silencio: la persona tiene que ver que ese renglón no va).
    const renglonNoPermitido = (r) => r.product_id && !catalogoPermitido.some(p => String(p.product_id) === String(r.product_id));

    const cambiarCliente = useCallback((v) => {
        setClienteId(v || '');
        const c = clientes.find(x => String(x.id) === String(v));
        if (!c || !(c.plazo_dias > 0)) setCondicion(1);
        setPlazo(c?.plazo_dias ? String(c.plazo_dias) : '');
        setError('');
    }, [clientes]);

    const setRenglon = (i, campo, valor) => setRenglones(rs => rs.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)));
    const quitarRenglon = (i) => setRenglones(rs => (rs.length === 1 ? [renglonVacio()] : rs.filter((_, k) => k !== i)));

    const validos = renglones
        .filter(r => r.product_id)
        .map(r => ({ ...r, cantidadNum: leerMonto(r.cantidad), p: porId.get(String(r.product_id)) }));
    const cantidadMala = validos.some(r => !r.cantidadNum || r.cantidadNum <= 0);
    const repetidos = new Set(validos.map(r => r.product_id)).size !== validos.length;
    const hayNoPermitidos = renglones.some(renglonNoPermitido);
    const plazoNum = condicion === 2 ? leerMonto(plazo) : null;
    const plazoMalo = condicion === 2 && (!plazoNum || !Number.isInteger(plazoNum) || plazoNum > (cliente?.plazo_dias ?? 0));

    const estimado = useMemo(() => estimarPedido(
        validos.filter(r => r.cantidadNum > 0 && r.p).map(r => ({ cantidad: r.cantidadNum, precio_sin_iva: Number(r.p.precio_sin_iva) })),
        { contribuyente: !!cliente?.contribuyente, granContribuyente: !!cliente?.gran_contribuyente },
    ), [validos, cliente]);

    const falta = [];
    if (!emisor) falta.push('los datos de la empresa');
    if (!cliente) falta.push('el cliente');
    if (!validos.length) falta.push('al menos un producto');
    const bloqueo = sinLicencia ? 'Este cliente no tiene licencia de la SRS vigente: no se le puede vender.'
        : hayNoPermitidos ? 'Hay productos que este cliente no puede recibir: quítalos.'
        : cantidadMala ? 'Revisa las cantidades: tienen que ser números mayores que cero.'
        : repetidos ? 'Hay un producto repetido: súmalo en un solo renglón.'
        : plazoMalo ? `El plazo tiene que ser de 1 a ${cliente?.plazo_dias ?? 0} días.`
        : null;
    const listo = !falta.length && !bloqueo && !guardando;

    const reiniciar = () => {
        setClienteId(''); setRenglones([renglonVacio()]); setCondicion(1); setPlazo('');
        setFormaPago('01'); setNotas(''); setUuid(crypto.randomUUID()); setError('');
    };

    const guardar = async (yFacturar) => {
        setGuardando(yFacturar ? 'facturar' : 'guardar');
        setError('');
        try {
            const pedidoId = await crearPedido({
                emisorId: emisor.id, clienteId: cliente.id,
                condicion, plazoDias: plazoNum, formaPago, observaciones: notas, clientUuid: uuid,
                renglones: validos.map(r => ({ product_id: Number(r.product_id), cantidad: r.cantidadNum, descripcion: r.p?.nombre })),
            });
            let factura = null;
            if (yFacturar) {
                try {
                    factura = await facturarPedido(pedidoId);
                } catch (e) {
                    // El pedido YA quedó guardado: el error de facturar no lo deshace.
                    descartar();
                    reiniciar();
                    onCreado?.({ pedidoId, errorFactura: mensajeDeDistribucion(e) });
                    return;
                }
            }
            descartar();
            reiniciar();
            onCreado?.({ pedidoId, factura });
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(null);
        }
    };

    const tipoDoc = cliente ? TIPO_DOCUMENTO[cliente.contribuyente ? '03' : '01'].largo : null;

    return (
        <LiquidModal open={open} onClose={guardando ? undefined : onClose} maxWidth="max-w-3xl" ariaLabel="Nuevo pedido">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <ClipboardList size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Nuevo pedido</h2>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}

                    <div>
                        <span className="text-caption font-bold text-content-2 block mb-1.5">Cliente</span>
                        <LiquidSelect value={clienteId} onChange={cambiarCliente} options={opcionesClientes}
                            placeholder="Elegir cliente…" clearable={false} />
                        {cliente && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                <Badge size="sm" variant="neutral" uppercase={false}>{rotuloTipoCliente(cliente.tipo)}</Badge>
                                <Badge size="sm" variant="info" uppercase={false}>Se emite {tipoDoc}</Badge>
                                {cliente.gran_contribuyente && <Badge size="sm" variant="warning" uppercase={false}>Retiene 1%</Badge>}
                                {soloVentaLibre(cliente.tipo) && <Badge size="sm" variant="neutral" uppercase={false}>Sólo venta libre</Badge>}
                            </div>
                        )}
                        {sinLicencia && (
                            <Notice variant="danger" icon={ShieldAlert} compact className="mt-2">
                                {licenciaVencida ? 'La licencia de la SRS de este cliente está vencida.' : 'Este cliente no tiene licencia de la SRS registrada.'}
                            </Notice>
                        )}
                    </div>

                    <div className="flex flex-col gap-2">
                        <span className="text-caption font-bold text-content-2 sm:hidden">Productos</span>
                        <div className="hidden sm:grid grid-cols-[1fr_104px_auto] gap-2 text-caption font-bold text-content-2">
                            <span>Productos</span><span>Cantidad</span><span className="w-[var(--tap-min)]" />
                        </div>
                        {renglones.map((r, i) => {
                            const p = porId.get(String(r.product_id));
                            const noVa = renglonNoPermitido(r);
                            return (
                                // En el teléfono el producto va en su propia fila y la cantidad debajo:
                                // en 390px no entran los tres lado a lado.
                                <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_104px_auto] gap-2 items-end sm:items-start">
                                    <div className="min-w-0 col-span-2 sm:col-span-1">
                                        <LiquidSelect value={String(r.product_id)} onChange={(v) => setRenglon(i, 'product_id', v || '')}
                                            options={catalogoPermitido.map(x => ({ value: String(x.product_id), label: x.nombre, sublabel: formatMoney(x.precio_sin_iva) }))}
                                            placeholder={cliente ? 'Producto…' : 'Primero el cliente'}
                                            disabled={!cliente} clearable={false} />
                                        {noVa && <p className="text-caption text-danger-text font-bold mt-1">«{p?.nombre ?? 'Producto'}» no se le vende a este cliente.</p>}
                                        {p && !noVa && (
                                            <p className="text-caption text-content-3 mt-1 tabular-nums">
                                                {formatMoney(p.precio_sin_iva)} sin IVA
                                            </p>
                                        )}
                                    </div>
                                    <div>
                                        <span className="sm:hidden text-caption font-bold text-content-2 block mb-1">Cantidad</span>
                                        <PortalInput name={`cantidad-${i}`} inputMode="decimal"
                                            value={r.cantidad} onChange={(e) => setRenglon(i, 'cantidad', e.target.value)}
                                            aria-label="Cantidad" />
                                    </div>
                                    <Button variant="ghost" iconOnly icon={Trash2} title="Quitar producto"
                                        onClick={() => quitarRenglon(i)} />
                                </div>
                            );
                        })}
                        <div>
                            <Button variant="secondary" size="sm" icon={Plus} disabled={!cliente}
                                onClick={() => setRenglones(rs => [...rs, renglonVacio()])}>Agregar producto</Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <span className="text-caption font-bold text-content-2 block mb-1.5">Condición</span>
                            <SegmentedControl value={condicion} onChange={setCondicion}
                                options={[
                                    { value: 1, label: 'Contado' },
                                    { value: 2, label: 'Crédito', disabled: !tieneCredito },
                                ]} />
                            {cliente && !tieneCredito && (
                                <p className="text-caption text-content-3 mt-1">Este cliente no tiene crédito aprobado.</p>
                            )}
                        </div>
                        {condicion === 2 ? (
                            <PortalInput label="Plazo en días" name="plazo" inputMode="numeric" value={plazo}
                                onChange={(e) => setPlazo(e.target.value)}
                                helperText={`Hasta ${cliente?.plazo_dias ?? 0} días. Crédito aprobado: ${formatMoney(cliente?.limite_credito ?? 0)}.`} />
                        ) : (
                            <div>
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Forma de pago</span>
                                <LiquidSelect value={formaPago} onChange={(v) => setFormaPago(v || '01')} options={FORMA_PAGO} clearable={false} />
                            </div>
                        )}
                    </div>

                    <PortalTextarea label="Observaciones" name="notas" value={notas} rows={2}
                        onChange={(e) => setNotas(e.target.value)} placeholder="Opcional. Sale impresa en el documento." />

                    {estimado.subtotal > 0 && (
                        <div className="rounded-xl border border-divider bg-surface-card-hover/40 px-4 py-3 grid grid-cols-2 gap-y-1 text-body-sm tabular-nums">
                            <span className="text-content-3">Subtotal sin IVA</span><span className="text-right text-content-2">{formatMoney(estimado.subtotal)}</span>
                            <span className="text-content-3">IVA 13%</span><span className="text-right text-content-2">{formatMoney(estimado.iva)}</span>
                            {estimado.retencion > 0 && (<>
                                <span className="text-content-3">Retención 1%</span><span className="text-right text-content-2">−{formatMoney(estimado.retencion)}</span>
                            </>)}
                            <span className="font-bold text-content">Total aproximado</span><span className="text-right font-black text-content">{formatMoney(estimado.total)}</span>
                        </div>
                    )}
                </div>
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center justify-between gap-3 w-full">
                    <p className="text-caption text-content-3 min-w-0 flex-1">
                        {bloqueo ?? (falta.length ? `Falta ${falta.join(', ')}.` : 'El total final lo calcula el documento, con el redondeo de Hacienda.')}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={!!guardando}>Cerrar</Button>
                        <Button variant="secondary" icon={guardando === 'guardar' ? Loader2 : Save}
                            disabled={!listo} onClick={() => guardar(false)}>Guardar pedido</Button>
                        <Button variant="primary" icon={guardando === 'facturar' ? Loader2 : Receipt}
                            disabled={!listo} onClick={() => guardar(true)}>Guardar y facturar</Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
