import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ShoppingCart, Plus, Minus, Trash2, ShieldAlert, Loader2, Receipt, Save, Search, Printer, PackageX, ArrowLeft, AlertTriangle,
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import PortalTextarea from '../components/common/PortalTextarea';
import SegmentedControl from '../components/common/SegmentedControl';
import useBorrador from '../hooks/useBorrador';
import { useMarca } from '../plataforma/useMarca';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { tokenMatch } from '../utils/searchUtils';
import { formatMoney } from '../utils/formatNumber';
import { hoySV } from '../utils/fecha';
import {
    fetchEmisor, fetchClientes, fetchCatalogo, fetchPedidoParaCorregir,
    crearPedido, actualizarPedido, facturarPedido, mensajeDeDistribucion, guardarPagos, subirComprobante, adjuntarComprobante,
} from '../data/distribucion';
import Interruptor from './distribucion/Interruptor';
import FormasDePago, { filaNueva, problemaDePagos } from './distribucion/FormasDePago';
import { estimarPedido, leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO } from './distribucion/comun';

// La venta de Distribución, en su propia vista (antes era un modal).
//
// ── Por qué vista y no modal ───────────────────────────────────────────────
// En el teléfono la hoja del modal se comía media pantalla con su encabezado y
// su pie, justo donde va la lista de productos. Y una vista tiene DIRECCIÓN:
// recargar o tocar «atrás» no pierde la venta (además del borrador). La caja
// también vende en pantalla completa.
//
// ── Cómo se usa ────────────────────────────────────────────────────────────
// Cliente → documento → escribir el producto (nombre o código de barras) y
// tocarlo, o Enter para el primero → − y + → formas de pago → «Facturar e
// imprimir». En escritorio el resumen y el botón quedan fijos a la derecha;
// en el teléfono, en una barra abajo.
//
// ── Lo que decide la pantalla y lo que decide la base ──────────────────────
// La búsqueda ya viene recortada a venta libre para tiendas y supermercados, y
// el cliente sin licencia de la SRS se ve en rojo. Es AYUDA: el trigger de la
// base rechaza igual lo que no corresponde, y el precio lo pone él.
//
// ── Marca ──────────────────────────────────────────────────────────────────
// Es la otra empresa (Torogoz): `useMarca('distribucion')` pinta el portal con
// sus colores mientras la vista está abierta. Por eso acá todo va con tokens
// (`brand`, `content`…) y ningún color a mano.
//
// Rutas: `/distribucion/venta` (nueva) y `/distribucion/venta/:pedidoId`
// (corregir un pedido por facturar, incluido el que reemplaza a un sellado).

const RESULTADOS = 8;
const conCantidad = (n) => String(Math.round(n * 10000) / 10000);

export default function DistribucionVentaView() {
    useMarca('distribucion');
    const navigate = useNavigate();
    const { pedidoId: pedidoIdParam } = useParams();
    const corrigiendo = !!pedidoIdParam;
    const { hasPermission } = useAuth();
    const puedeVender = hasPermission('distribucion', 'can_edit');
    const showToast = useToastStore(s => s.showToast);

    const [emisor, setEmisor] = useState(null);
    const [clientes, setClientes] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [pedido, setPedido] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState('');

    const [clienteId, setClienteId] = useState('');
    const [carrito, setCarrito] = useState([]); // [{ product_id, cantidad: string }]
    const [buscar, setBuscar] = useState('');
    const [tipoDoc, setTipoDoc] = useState('01');
    const [pagos, setPagos] = useState(() => [filaNueva()]);
    const [pagoAbierto, setPagoAbierto] = useState(null);
    const [plazo, setPlazo] = useState('');
    const [notas, setNotas] = useState('');
    const [imprimir, setImprimir] = useState(true);
    const [uuid, setUuid] = useState(() => crypto.randomUUID());
    const [guardando, setGuardando] = useState(null); // 'guardar' | 'facturar'
    const [error, setError] = useState('');
    const buscador = useRef(null);
    const barra = useRef(null);

    // La barra del total (teléfono) publica su alto en `--alto-barra-flotante`,
    // la misma variable que escribe `BarraFlotante`: así los botones de «ir
    // arriba / abajo» del layout suben por encima de ella en vez de taparla.
    // En escritorio la barra está oculta, mide 0 y todo queda como siempre.
    useEffect(() => {
        const el = barra.current;
        const raiz = document.documentElement;
        if (!el) return undefined;
        const medir = () => raiz.style.setProperty('--alto-barra-flotante', `${Math.round(el.getBoundingClientRect().height)}px`);
        medir();
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => { ro.disconnect(); raiz.style.setProperty('--alto-barra-flotante', '0px'); };
    }, [cargando, errorCarga]);

    // Carga: la empresa, los clientes, el catálogo y —si se corrige— el pedido.
    useEffect(() => {
        let vivo = true;
        (async () => {
            setCargando(true);
            setErrorCarga('');
            try {
                const [e, cs, cat, ped] = await Promise.all([
                    fetchEmisor(), fetchClientes(), fetchCatalogo(),
                    corrigiendo ? fetchPedidoParaCorregir(Number(pedidoIdParam)) : Promise.resolve(null),
                ]);
                if (!vivo) return;
                setEmisor(e); setClientes(cs); setCatalogo(cat); setPedido(ped);
                if (ped) {
                    if (ped.pedido.estado !== 'confirmado') {
                        setErrorCarga(`El pedido ${ped.pedido.id} ya está ${ped.pedido.estado}: no se puede corregir.`);
                        return;
                    }
                    const p = ped.pedido;
                    setClienteId(String(p.cliente_id));
                    setTipoDoc(p.tipo_documento ?? (cs.find(c => c.id === p.cliente_id)?.contribuyente ? '03' : '01'));
                    setPlazo(p.plazo_dias ? String(p.plazo_dias) : '');
                    setNotas(p.observaciones ?? '');
                    setCarrito(ped.items.map(i => ({ product_id: String(i.product_id), cantidad: conCantidad(Number(i.cantidad)) })));
                    setPagos(ped.pagos.length
                        ? ped.pagos.map(pg => ({ ...filaNueva(pg.forma), monto: pg.monto != null ? String(pg.monto) : '', referencia: pg.referencia ?? '', existente: pg }))
                        : [filaNueva(p.condicion === 2 ? '13' : (p.forma_pago ?? '01'))]);
                }
            } catch (e) {
                if (vivo) setErrorCarga(mensajeDeDistribucion(e));
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [corrigiendo, pedidoIdParam]);

    const { recuperado, descartar } = useBorrador(
        emisor && !corrigiendo ? `distribucion-venta-${emisor.id}` : null,
        { clienteId, tipoDoc, carrito, pagos: pagos.map(({ adjunto, ...f }) => f), plazo, notas, uuid },
        { activo: !corrigiendo, vale: (v) => !!v?.clienteId || v?.carrito?.length > 0 },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        if (corrigiendo || repuesto.current || !recuperado) return;
        repuesto.current = true;
        setClienteId(recuperado.clienteId ?? '');
        setTipoDoc(recuperado.tipoDoc ?? '01');
        setCarrito(recuperado.carrito ?? []);
        setPagos(recuperado.pagos?.length ? recuperado.pagos.map(f => ({ ...filaNueva(), ...f, adjunto: null })) : [filaNueva()]);
        setPlazo(recuperado.plazo ?? '');
        setNotas(recuperado.notas ?? '');
        if (recuperado.uuid) setUuid(recuperado.uuid);
    }, [corrigiendo, recuperado]);

    const cliente = useMemo(() => clientes.find(c => String(c.id) === String(clienteId)) ?? null, [clientes, clienteId]);
    const licenciaVencida = cliente?.licencia_srs_vence && cliente.licencia_srs_vence < hoySV();
    const sinLicencia = cliente && (!cliente.licencia_srs || licenciaVencida);
    const tieneCredito = cliente && cliente.plazo_dias > 0 && Number(cliente.limite_credito) > 0;

    const opcionesClientes = useMemo(() => clientes
        .filter(c => c.activo || String(c.id) === String(clienteId))
        .map(c => ({
            value: String(c.id),
            label: c.nombre,
            sublabel: `${rotuloTipoCliente(c.tipo)} · ${c.contribuyente ? 'Crédito Fiscal' : 'Factura'}${!c.licencia_srs ? ' · sin licencia SRS' : ''}${c.ruta ? ` · ${c.ruta}` : ''}`,
        })), [clientes, clienteId]);

    const permitido = useCallback((p) => p.activo && (!cliente || !soloVentaLibre(cliente.tipo) || (p.venta_libre && !p.controlado)), [cliente]);
    const porId = useMemo(() => new Map(catalogo.map(p => [String(p.product_id), p])), [catalogo]);

    const resultados = useMemo(() => {
        const q = buscar.trim();
        if (!q || !cliente) return [];
        return catalogo.filter(p => permitido(p) && tokenMatch(q, p.nombre, p.codigo_barras)).slice(0, RESULTADOS);
    }, [buscar, catalogo, cliente, permitido]);

    const agregar = (p) => {
        const id = String(p.product_id);
        setCarrito(cs => (cs.some(c => c.product_id === id)
            ? cs.map(c => (c.product_id === id ? { ...c, cantidad: conCantidad((leerMonto(c.cantidad) ?? 0) + 1) } : c))
            : [...cs, { product_id: id, cantidad: '1' }]));
        setBuscar('');
        buscador.current?.focus();
    };
    const cambiarCantidad = (id, valor) => setCarrito(cs => cs.map(c => (c.product_id === id ? { ...c, cantidad: valor } : c)));
    const sumar = (id, delta) => setCarrito(cs => cs.map(c => {
        if (c.product_id !== id) return c;
        const n = Math.max(1, (leerMonto(c.cantidad) ?? 0) + delta);
        return { ...c, cantidad: conCantidad(n) };
    }));
    const quitar = (id) => setCarrito(cs => cs.filter(c => c.product_id !== id));

    const cambiarCliente = useCallback((v) => {
        setClienteId(v || '');
        const c = clientes.find(x => String(x.id) === String(v));
        setTipoDoc(c?.contribuyente ? '03' : '01');
        if (!c || !(c.plazo_dias > 0)) setPagos(ps => ps.map(f => (f.forma === '13' ? { ...f, forma: '01' } : f)));
        setPlazo(c?.plazo_dias ? String(c.plazo_dias) : '');
        setError('');
    }, [clientes]);

    const lineas = carrito.map(c => {
        const p = porId.get(c.product_id);
        const n = leerMonto(c.cantidad);
        return { ...c, p, n, noVa: !p || !permitido(p), importe: p && n ? n * Number(p.precio_sin_iva) : 0 };
    });
    const cantidadMala = lineas.some(l => !l.n || l.n <= 0);
    const hayNoPermitidos = lineas.some(l => l.noVa);
    const conCredito = pagos.some(f => f.forma === '13');
    const plazoNum = conCredito ? leerMonto(plazo) : null;

    const estimado = estimarPedido(
        lineas.filter(l => l.p && l.n > 0).map(l => ({ cantidad: l.n, precio_sin_iva: Number(l.p.precio_sin_iva) })),
        { contribuyente: tipoDoc === '03', granContribuyente: !!cliente?.gran_contribuyente },
    );
    const fijas = pagos.slice(0, -1);
    const sumaFijas = fijas.reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const alCredito = !conCredito ? 0
        : fijas.filter(f => f.forma === '13').reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0)
          + (pagos[pagos.length - 1].forma === '13' ? Math.max(0, estimado.total - sumaFijas) : 0);
    const excedeCredito = conCredito && cliente && alCredito > Number(cliente.limite_credito);
    const problemaPago = lineas.length ? problemaDePagos(pagos, estimado.total, { cliente, plazo }) : null;

    const bloqueo = !puedeVender ? 'No tienes permiso para vender en Distribución.'
        : !emisor ? 'Faltan los datos de la empresa.'
        : !cliente ? 'Elige el cliente.'
        : sinLicencia ? 'Este cliente no tiene licencia de la SRS vigente: no se le puede vender.'
        : !lineas.length ? 'Agrega al menos un producto.'
        : hayNoPermitidos ? 'Hay productos que este cliente no puede recibir: quítalos.'
        : cantidadMala ? 'Revisa las cantidades: tienen que ser mayores que cero.'
        : problemaPago ? problemaPago
        : null;
    const listo = !bloqueo && !guardando;

    const guardar = async (yFacturar) => {
        setGuardando(yFacturar ? 'facturar' : 'guardar');
        setError('');
        const renglones = lineas.map(l => ({ product_id: Number(l.product_id), cantidad: l.n, descripcion: l.p?.nombre }));
        // La condición del pedido resume las formas: con crédito, el trigger
        // verifica que el cliente lo tenga aprobado.
        const condicion = conCredito ? 2 : 1;
        const formaPago = pagos[0].forma === '13' ? '01' : pagos[0].forma;
        try {
            let pedidoId = pedido?.pedido.id;
            if (corrigiendo) {
                await actualizarPedido(pedidoId, { tipoDocumento: tipoDoc, condicion, plazoDias: plazoNum, formaPago, observaciones: notas, renglones });
            } else {
                pedidoId = await crearPedido({
                    emisorId: emisor.id, clienteId: cliente.id, tipoDocumento: tipoDoc,
                    condicion, plazoDias: plazoNum, formaPago, observaciones: notas, clientUuid: uuid, renglones,
                });
            }
            const guardados = await guardarPagos(pedidoId, pagos.map((f, i) => ({
                forma: f.forma, monto: leerMonto(f.monto), referencia: f.referencia,
                resto: i === pagos.length - 1,
                // Al corregir, el comprobante que ya estaba se conserva (sólo sus datos de comprobante).
                ...(f.existente?.comprobante_url && !f.adjunto ? {
                    comprobante_url: f.existente.comprobante_url, lectura: f.existente.lectura,
                    monto_leido: f.existente.monto_leido, verificacion: f.existente.verificacion, nota: f.existente.nota,
                } : {}),
            })));
            // Los comprobantes elegidos en la venta se suben ahora que el pedido
            // existe. Si uno falla, la venta sigue y ese pago queda pendiente.
            for (const [i, f] of pagos.entries()) {
                if (!f.adjunto) continue;
                try {
                    const url = await subirComprobante(f.adjunto.archivo, pedidoId);
                    await adjuntarComprobante(guardados[i].id, { url, lectura: f.adjunto.lectura, montoLeido: f.adjunto.montoLeido,
                        verificacion: f.adjunto.verificacion, nota: f.adjunto.nota });
                } catch (e) {
                    showToast('Falta un comprobante', `No se pudo guardar (${mensajeDeDistribucion(e)}). Adjúntalo desde el pedido.`, 'warning');
                }
            }
            useStaff.getState().appendAuditLog(corrigiendo ? 'DISTRIBUCION_PEDIDO_CORREGIDO' : 'DISTRIBUCION_PEDIDO_CREADO',
                String(pedidoId), { facturar: yFacturar });
            // El pedido YA quedó guardado aunque facturar falle: no se deshace.
            descartar();
            if (!yFacturar) {
                showToast(corrigiendo ? 'Pedido corregido' : 'Pedido guardado', 'Queda por facturar.');
                navigate('/distribucion?tab=pedidos', { replace: true });
                return;
            }
            try {
                const factura = await facturarPedido(pedidoId);
                // Facturado: se abre el documento en Pedidos, con su ticket y su
                // PDF, y si se pidió el ticket sale solo.
                navigate(`/distribucion?tab=pedidos&documento=${factura.dte_id}${imprimir ? '&imprimir=1' : ''}`, { replace: true });
            } catch (e) {
                showToast('Pedido guardado sin facturar', mensajeDeDistribucion(e), 'warning');
                navigate('/distribucion?tab=pedidos', { replace: true });
            }
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(null);
        }
    };

    const titulo = corrigiendo
        ? (pedido?.pedido.reemplaza_dte_id ? `Corregir documento (pedido ${pedidoIdParam})` : `Corregir pedido ${pedidoIdParam}`)
        : 'Nueva venta';

    const headerLeft = (
        <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" iconOnly icon={ArrowLeft} title="Volver a Distribución" onClick={() => navigate('/distribucion?tab=pedidos')} />
            <div className="min-w-0">
                <p className="text-caption font-black text-content-3 uppercase tracking-widest">Distribución</p>
                <h2 className="font-black text-title text-content tracking-tight leading-tight truncate">{titulo}</h2>
            </div>
        </div>
    );

    const resumen = (
        <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
                <div className="min-w-0 text-caption text-content-3 tabular-nums">
                    {estimado.subtotal > 0 && (
                        <p>
                            {formatMoney(estimado.subtotal)} + IVA {formatMoney(estimado.iva)}
                            {estimado.retencion > 0 && ` − retención ${formatMoney(estimado.retencion)}`}
                        </p>
                    )}
                    <p className={bloqueo ? 'text-content-2' : ''}>{bloqueo ?? `${lineas.length} producto${lineas.length === 1 ? '' : 's'}`}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-caption text-content-3">Total</p>
                    <p className="text-title font-black text-brand-text tabular-nums">{formatMoney(estimado.total)}</p>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" icon={guardando === 'guardar' ? Loader2 : Save} disabled={!listo} onClick={() => guardar(false)}>
                    {corrigiendo ? 'Guardar' : 'Sin facturar'}
                </Button>
                <Button variant="primary" icon={guardando === 'facturar' ? Loader2 : (imprimir ? Printer : Receipt)} disabled={!listo} onClick={() => guardar(true)}>
                    {imprimir ? 'Facturar e imprimir' : 'Facturar'}
                </Button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout icon={ShoppingCart} title={titulo} headerLeft={headerLeft} transparentBody>
            {/* El `pb-` de abajo deja lugar a la barra fija del teléfono. */}
            <div className="p-4 md:p-6 pb-40 lg:pb-6">
                {errorCarga && <Notice variant="danger" icon={AlertTriangle}>{errorCarga}</Notice>}
                {cargando && !errorCarga && <p className="text-caption text-content-3">Cargando…</p>}
                {!cargando && !errorCarga && (
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5 items-start">
                        {/* ── Izquierda: quién compra y qué ── */}
                        <div className="flex flex-col gap-4 min-w-0">
                            {error && <Notice variant="danger" bloque>{error}</Notice>}

                            <section data-surface="card" className="p-4 flex flex-col gap-3">
                                <div>
                                    <span className="text-caption font-bold text-content-2 block mb-1.5">Cliente</span>
                                    <LiquidSelect value={clienteId} onChange={cambiarCliente} options={opcionesClientes}
                                        placeholder="Elegir cliente…" clearable={false} disabled={corrigiendo} />
                                    {cliente && (
                                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                            {cliente.gran_contribuyente && tipoDoc === '03' && <Badge size="sm" variant="warning" uppercase={false}>Retiene 1%</Badge>}
                                            {soloVentaLibre(cliente.tipo) && <Badge size="sm" variant="neutral" uppercase={false}>Sólo venta libre</Badge>}
                                            {tieneCredito && <Badge size="sm" variant="neutral" uppercase={false}>Crédito {formatMoney(cliente.limite_credito)} · {cliente.plazo_dias} días</Badge>}
                                        </div>
                                    )}
                                    {sinLicencia && (
                                        <Notice variant="danger" icon={ShieldAlert} compact className="mt-2">
                                            {licenciaVencida ? 'La licencia de la SRS de este cliente está vencida.' : 'Este cliente no tiene licencia de la SRS registrada.'}
                                        </Notice>
                                    )}
                                </div>
                                {cliente && (
                                    <div>
                                        <span className="text-caption font-bold text-content-2 block mb-1.5">Documento</span>
                                        {/* Un contribuyente no siempre pide Crédito Fiscal: se elige en
                                            cada venta. Sin NRC, sólo Factura (la base lo vuelve a frenar). */}
                                        <SegmentedControl value={tipoDoc} onChange={setTipoDoc}
                                            options={[
                                                { value: '01', label: TIPO_DOCUMENTO['01'].largo },
                                                { value: '03', label: TIPO_DOCUMENTO['03'].largo, disabled: !cliente.contribuyente },
                                            ]} />
                                        {!cliente.contribuyente && <p className="text-caption text-content-3 mt-1">Sin NRC en su ficha: sólo Factura.</p>}
                                    </div>
                                )}
                            </section>

                            <section data-surface="card" className="p-4 flex flex-col gap-3">
                                <PortalInput ref={buscador} icon={Search} name="buscar-producto" value={buscar}
                                    placeholder="Producto o código de barras…" aria-label="Buscar producto"
                                    onChange={(e) => setBuscar(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && resultados[0]) { e.preventDefault(); agregar(resultados[0]); } }} />
                                {buscar.trim() && !cliente && (
                                    <p className="text-caption text-content-3">Elige primero el cliente: lo que se le puede vender depende de él.</p>
                                )}
                                {buscar.trim() && cliente && (
                                    <div className="rounded-xl border border-divider overflow-hidden" role="listbox" aria-label="Productos encontrados">
                                        {resultados.length === 0 && (
                                            <p className="px-4 py-3 text-caption text-content-3 flex items-center gap-2">
                                                <PackageX size={14} /> Nada que coincida{soloVentaLibre(cliente.tipo) ? ' entre los productos de venta libre' : ''}.
                                            </p>
                                        )}
                                        {resultados.map((p, k) => (
                                            <button key={p.product_id} type="button" role="option" aria-selected={k === 0}
                                                onClick={() => agregar(p)}
                                                className="w-full flex items-center justify-between gap-3 px-4 min-h-[var(--tap-min)] py-2 text-left border-b border-divider last:border-b-0 hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                                                <span className="text-body-sm text-content-2 truncate">{p.nombre}</span>
                                                <span className="text-caption text-content-3 tabular-nums shrink-0">{formatMoney(p.precio_sin_iva)} + IVA</span>
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className="rounded-xl border border-divider overflow-hidden">
                                    {lineas.length === 0 && (
                                        <p className="px-4 py-8 text-center text-caption text-content-3">Todavía no hay productos en esta venta.</p>
                                    )}
                                    {lineas.map(l => (
                                        <div key={l.product_id} className="px-3 sm:px-4 py-2.5 border-b border-divider last:border-b-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-body-sm font-bold text-content-2 truncate">{l.p?.nombre ?? `Producto ${l.product_id}`}</p>
                                                    <p className={`text-caption tabular-nums ${l.noVa ? 'text-danger-text font-bold' : 'text-content-3'}`}>
                                                        {l.noVa ? 'No se le vende a este cliente' : `${formatMoney(l.p.precio_sin_iva)} sin IVA`}
                                                    </p>
                                                </div>
                                                <span className="tabular-nums font-black text-content shrink-0">{formatMoney(l.importe)}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-2">
                                                <Button variant="secondary" size="sm" iconOnly icon={Minus} title="Uno menos"
                                                    disabled={(l.n ?? 0) <= 1} onClick={() => sumar(l.product_id, -1)} />
                                                <div className="w-20">
                                                    <PortalInput name={`cantidad-${l.product_id}`} inputMode="decimal" value={l.cantidad}
                                                        aria-label={`Cantidad de ${l.p?.nombre ?? 'producto'}`} hasError={!l.n || l.n <= 0}
                                                        onChange={(e) => cambiarCantidad(l.product_id, e.target.value)} />
                                                </div>
                                                <Button variant="secondary" size="sm" iconOnly icon={Plus} title="Uno más" onClick={() => sumar(l.product_id, 1)} />
                                                <div className="flex-1" />
                                                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la venta" onClick={() => quitar(l.product_id)} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>

                        {/* ── Derecha: cómo paga y el total (fija en escritorio) ── */}
                        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-9rem)]">
                            {/* En escritorio el total y el botón van ARRIBA, y la columna
                                tiene alto máximo: lo que desplaza es sólo el bloque del pago, así
                                el total queda siempre a la vista. */}
                            <section data-surface="card" className="hidden lg:block p-4 shrink-0">
                                {resumen}
                            </section>
                            <section data-surface="card" className="p-4 flex flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
                                {cliente && lineas.length > 0
                                    ? <FormasDePago filas={pagos} setFilas={setPagos} total={estimado.total} cliente={cliente}
                                        plazo={plazo} setPlazo={setPlazo} abierto={pagoAbierto} setAbierto={setPagoAbierto} />
                                    : <p className="text-caption text-content-3">Las formas de pago aparecen al agregar productos.</p>}
                                {excedeCredito && (
                                    <Notice variant="warning" compact>Pasa del crédito aprobado del cliente ({formatMoney(cliente.limite_credito)}).</Notice>
                                )}
                                <PortalTextarea label="Observaciones" name="notas" value={notas} rows={2} compact
                                    onChange={(e) => setNotas(e.target.value)} placeholder="Opcional. Sale impresa en el documento." />
                                <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el ticket al facturar"
                                    ayuda="Por la ticketera de esta computadora; si no tiene, se abre el diálogo de impresión." />
                            </section>
                        </aside>
                    </div>
                )}
            </div>

            {/* Teléfono y tableta: el total y el botón quedan siempre a mano. */}
            {!cargando && !errorCarga && (
                <div ref={barra} data-surface="card" className="lg:hidden fixed inset-x-0 bottom-0 z-tabs px-4 pt-3 pb-[max(12px,var(--sa-bottom))]">
                    {resumen}
                </div>
            )}
        </GlassViewLayout>
    );
}
