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
    fetchEmisor, fetchClientes, fetchCatalogo, fetchListasYPrecios, fetchPedidoParaCorregir,
    crearPedido, actualizarPedido, facturarPedido, mensajeDeDistribucion, guardarPagos, subirComprobante, adjuntarComprobante,
} from '../data/distribucion';
import Interruptor from './distribucion/Interruptor';
import FormasDePago from './distribucion/FormasDePago';
import { filaNueva, problemaDePagos, cambioDePagos } from './distribucion/pagos';
import { estimarPedido, leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO } from './distribucion/comun';
import { indexarPrecios, presentacionesDe, listasDe, precioDe, descuentoSinIva, IVA } from './distribucion/precios';

// La venta de Distribución, en su propia vista.
//
// ── Cómo se usa ────────────────────────────────────────────────────────────
// Arriba: cliente, documento y LISTA DE PRECIOS (la del cliente por defecto).
// En medio, los renglones como en la caja: producto → presentación (unidad,
// caja, paquete: cada una con su precio) → lista (si ese renglón va a otro
// precio) → cantidad → descuento en % o en $ → importe. Abajo, el cobro: las
// formas de pago, lo que entrega en efectivo y el cambio, el desglose y el
// botón. Se lee de arriba abajo en el orden en que se vende.
//
// ── Por qué vista y no modal ───────────────────────────────────────────────
// En el teléfono la hoja del modal se comía media pantalla, y una vista tiene
// DIRECCIÓN: recargar o tocar «atrás» no pierde la venta (además del borrador).
//
// ── Lo que decide la pantalla y lo que decide la base ──────────────────────
// La búsqueda ya viene recortada a venta libre para tiendas y supermercados, el
// precio se estima con `precios.js` y el descuento se frena en el tope de la
// empresa. Es AYUDA: el trigger de la base vuelve a decidir las tres cosas, y
// el precio lo pone él.
//
// ── Precios que se ven ─────────────────────────────────────────────────────
// Con Factura, con IVA (es lo que paga el cliente y lo que dice el papel); con
// Crédito Fiscal, sin IVA. Por dentro todo viaja sin IVA.
//
// ── Marca ──────────────────────────────────────────────────────────────────
// Es la otra empresa (Torogoz): `useMarca('distribucion')` pinta el portal con
// sus colores mientras la vista está abierta. Por eso todo va con tokens.
//
// Rutas: `/distribucion/venta` (nueva) y `/distribucion/venta/:pedidoId`
// (corregir un pedido por facturar, incluido el que reemplaza a un sellado).

const RESULTADOS = 8;
const conCantidad = (n) => String(Math.round(n * 10000) / 10000);
let siguienteRenglon = 1;
const renglonNuevo = (productId, presentacion, extra = {}) => ({
    product_id: String(productId), presentacion, lista_id: '', cantidad: '1',
    descTipo: 'pct', descValor: '', ...extra, clave: siguienteRenglon++,
});

// Anchos de la grilla de renglones en escritorio: el encabezado y cada fila
// usan la MISMA cadena, así las columnas no se corren. El nombre del producto
// va en su propia línea arriba de los controles: con el menú abierto la
// columna mide ~850px y en una sola línea el nombre quedaba en cero.
const COLUMNAS = 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_8.5rem_minmax(5rem,0.7fr)_10rem_minmax(5.5rem,0.7fr)_2.5rem]';

export default function DistribucionVentaView() {
    useMarca('distribucion');
    const navigate = useNavigate();
    const { pedidoId: pedidoIdParam } = useParams();
    const corrigiendo = !!pedidoIdParam;
    const { hasPermission } = useAuth();
    const puedeVender = hasPermission('distribucion', 'can_edit');
    const puedeConfigurar = hasPermission('distribucion_config', 'can_edit');
    const showToast = useToastStore(s => s.showToast);

    const [emisor, setEmisor] = useState(null);
    const [clientes, setClientes] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [listas, setListas] = useState([]);
    const [precios, setPrecios] = useState([]);
    const [pedido, setPedido] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [errorCarga, setErrorCarga] = useState('');

    const [clienteId, setClienteId] = useState('');
    const [listaVenta, setListaVenta] = useState('');
    const [carrito, setCarrito] = useState([]);
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

    const idx = useMemo(() => indexarPrecios(precios, listas), [precios, listas]);
    const listaBase = idx.listas[0]?.id ?? null;

    // Carga: la empresa, los clientes, el catálogo, los precios y —si se corrige— el pedido.
    useEffect(() => {
        let vivo = true;
        (async () => {
            setCargando(true);
            setErrorCarga('');
            try {
                const [e, cs, cat, lp, ped] = await Promise.all([
                    fetchEmisor(), fetchClientes(), fetchCatalogo(), fetchListasYPrecios(),
                    corrigiendo ? fetchPedidoParaCorregir(Number(pedidoIdParam)) : Promise.resolve(null),
                ]);
                if (!vivo) return;
                setEmisor(e); setClientes(cs); setCatalogo(cat); setListas(lp.listas); setPrecios(lp.precios); setPedido(ped);
                if (ped) {
                    if (ped.pedido.estado !== 'confirmado') {
                        setErrorCarga(`El pedido ${ped.pedido.id} ya está ${ped.pedido.estado}: no se puede corregir.`);
                        return;
                    }
                    const p = ped.pedido;
                    const c = cs.find(x => x.id === p.cliente_id);
                    const doc = p.tipo_documento ?? (c?.contribuyente ? '03' : '01');
                    setClienteId(String(p.cliente_id));
                    setListaVenta(c?.lista_id ? String(c.lista_id) : '');
                    setTipoDoc(doc);
                    setPlazo(p.plazo_dias ? String(p.plazo_dias) : '');
                    setNotas(p.observaciones ?? '');
                    setCarrito(ped.items.map(i => {
                        const enPct = i.descuento_pct != null;
                        const monto = Number(i.descuento) || 0;
                        return renglonNuevo(i.product_id, i.presentacion ?? 'UNIDAD', {
                            lista_id: i.lista_id ? String(i.lista_id) : '',
                            cantidad: conCantidad(Number(i.cantidad)),
                            descTipo: enPct || !monto ? 'pct' : 'monto',
                            descValor: enPct ? String(Number(i.descuento_pct)) : monto ? (monto * (doc === '01' ? 1 + IVA : 1)).toFixed(2) : '',
                        });
                    }));
                    setPagos(ped.pagos.length
                        ? ped.pagos.map(pg => ({
                            ...filaNueva(pg.forma), monto: pg.monto != null ? String(pg.monto) : '', referencia: pg.referencia ?? '',
                            recibido: pg.efectivo_recibido != null ? String(pg.efectivo_recibido) : '', existente: pg,
                        }))
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
        { clienteId, listaVenta, tipoDoc, carrito, pagos: pagos.map(({ adjunto, ...f }) => f), plazo, notas, uuid },
        { activo: !corrigiendo, vale: (v) => !!v?.clienteId || v?.carrito?.length > 0 },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        if (corrigiendo || repuesto.current || !recuperado) return;
        repuesto.current = true;
        setClienteId(recuperado.clienteId ?? '');
        setListaVenta(recuperado.listaVenta ?? '');
        setTipoDoc(recuperado.tipoDoc ?? '01');
        // Un borrador de antes de las presentaciones no trae `presentacion`:
        // se completa al pintar con la primera que tenga el producto.
        setCarrito((recuperado.carrito ?? []).map(c => renglonNuevo(c.product_id, c.presentacion ?? null, c)));
        setPagos(recuperado.pagos?.length ? recuperado.pagos.map(f => ({ ...filaNueva(), ...f, adjunto: null })) : [filaNueva()]);
        setPlazo(recuperado.plazo ?? '');
        setNotas(recuperado.notas ?? '');
        if (recuperado.uuid) setUuid(recuperado.uuid);
    }, [corrigiendo, recuperado]);

    const cliente = useMemo(() => clientes.find(c => String(c.id) === String(clienteId)) ?? null, [clientes, clienteId]);
    const licenciaVencida = cliente?.licencia_srs_vence && cliente.licencia_srs_vence < hoySV();
    const sinLicencia = cliente && (!cliente.licencia_srs || licenciaVencida);
    const tieneCredito = cliente && cliente.plazo_dias > 0 && Number(cliente.limite_credito) > 0;
    const conIva = tipoDoc === '01';
    const factorVisto = conIva ? 1 + IVA : 1;
    const listaEfectiva = listaVenta ? Number(listaVenta) : listaBase;
    const topeDescuento = Number(emisor?.descuento_max_pct ?? 0);

    const opcionesClientes = useMemo(() => clientes
        .filter(c => c.activo || String(c.id) === String(clienteId))
        .map(c => ({
            value: String(c.id),
            label: c.nombre,
            sublabel: `${rotuloTipoCliente(c.tipo)} · ${c.contribuyente ? 'Crédito Fiscal' : 'Factura'}${!c.licencia_srs ? ' · sin licencia SRS' : ''}${c.ruta ? ` · ${c.ruta}` : ''}`,
        })), [clientes, clienteId]);
    const opcionesListas = useMemo(() => idx.listas.map(l => ({
        value: String(l.id), label: l.nombre, sublabel: l.id === listaBase ? 'Base' : undefined,
    })), [idx, listaBase]);

    const permitido = useCallback((p) => p.activo && (!cliente || !soloVentaLibre(cliente.tipo) || (p.venta_libre && !p.controlado)), [cliente]);
    const porId = useMemo(() => new Map(catalogo.map(p => [String(p.product_id), p])), [catalogo]);

    const resultados = useMemo(() => {
        const q = buscar.trim();
        if (!q || !cliente) return [];
        return catalogo.filter(p => permitido(p) && tokenMatch(q, p.nombre, p.codigo_barras)).slice(0, RESULTADOS);
    }, [buscar, catalogo, cliente, permitido]);

    const agregar = (p) => {
        const pres = presentacionesDe(idx, p.product_id)[0].presentacion;
        setCarrito(cs => {
            const ya = cs.find(c => c.product_id === String(p.product_id) && c.presentacion === pres);
            return ya
                ? cs.map(c => (c === ya ? { ...c, cantidad: conCantidad((leerMonto(c.cantidad) ?? 0) + 1) } : c))
                : [...cs, renglonNuevo(p.product_id, pres)];
        });
        setBuscar('');
        buscador.current?.focus();
    };
    const cambiar = (clave, cambios) => setCarrito(cs => cs.map(c => (c.clave === clave ? { ...c, ...cambios } : c)));
    const sumar = (clave, delta) => setCarrito(cs => cs.map(c => (c.clave !== clave ? c
        : { ...c, cantidad: conCantidad(Math.max(1, (leerMonto(c.cantidad) ?? 0) + delta)) })));
    const quitar = (clave) => setCarrito(cs => cs.filter(c => c.clave !== clave));

    const cambiarCliente = useCallback((v) => {
        setClienteId(v || '');
        const c = clientes.find(x => String(x.id) === String(v));
        setTipoDoc(c?.contribuyente ? '03' : '01');
        setListaVenta(c?.lista_id ? String(c.lista_id) : '');
        if (!c || !(c.plazo_dias > 0)) setPagos(ps => ps.map(f => (f.forma === '13' ? { ...f, forma: '01' } : f)));
        setPlazo(c?.plazo_dias ? String(c.plazo_dias) : '');
        setError('');
    }, [clientes]);

    // Cada renglón resuelto: presentación, precio, descuento e importe.
    const lineas = carrito.map(c => {
        const p = porId.get(c.product_id);
        const presentaciones = p ? presentacionesDe(idx, p.product_id) : [];
        const presentacion = c.presentacion ?? presentaciones[0]?.presentacion ?? 'UNIDAD';
        const lista = c.lista_id ? Number(c.lista_id) : listaEfectiva;
        const r = p ? precioDe(idx, p, presentacion, lista) : null;
        const n = leerMonto(c.cantidad);
        const bruto = r && n ? n * r.precio : 0;
        const desc = descuentoSinIva({ tipo: c.descTipo, valor: leerMonto(c.descValor), importeSinIva: bruto, conIva });
        const pct = bruto > 0 ? (desc / bruto) * 100 : 0;
        const descMalo = String(c.descValor ?? '').trim() !== '' && leerMonto(c.descValor) == null;
        const pasaImporte = desc > bruto + 1e-6;
        const pasaTope = !pasaImporte && pct > topeDescuento + 0.005 && !puedeConfigurar;
        return {
            ...c, p, n, r, presentacion, presentaciones, bruto, desc, pct, neto: Math.max(0, bruto - desc),
            descMalo, pasaImporte, pasaTope, noVa: !p || !permitido(p), sinPrecio: !!p && !r,
            // Otra lista distinta de la de la venta: se marca para que se vea.
            otraLista: r?.listaId != null && r.listaId !== listaEfectiva,
        };
    });
    const cantidadMala = lineas.some(l => !l.n || l.n <= 0);
    const hayNoPermitidos = lineas.some(l => l.noVa);
    const haySinPrecio = lineas.some(l => l.sinPrecio);
    const descuentoMalo = lineas.find(l => l.descMalo || l.pasaImporte || l.pasaTope);
    const conCredito = pagos.some(f => f.forma === '13');
    const plazoNum = conCredito ? leerMonto(plazo) : null;

    const validas = lineas.filter(l => l.r && l.n > 0);
    const estimado = estimarPedido(
        validas.map(l => ({ cantidad: l.n, precio_sin_iva: l.r.precio, descuento: l.desc })),
        { contribuyente: tipoDoc === '03', granContribuyente: !!cliente?.gran_contribuyente },
    );
    const suma = validas.reduce((a, l) => a + l.bruto, 0);
    const descuentos = validas.reduce((a, l) => a + l.desc, 0);
    const fijas = pagos.slice(0, -1);
    const sumaFijas = fijas.reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const alCredito = !conCredito ? 0
        : fijas.filter(f => f.forma === '13').reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0)
          + (pagos[pagos.length - 1].forma === '13' ? Math.max(0, estimado.total - sumaFijas) : 0);
    const excedeCredito = conCredito && cliente && alCredito > Number(cliente.limite_credito);
    const problemaPago = lineas.length ? problemaDePagos(pagos, estimado.total, { cliente, plazo }) : null;
    const cambio = cambioDePagos(pagos, estimado.total);

    const bloqueo = !puedeVender ? 'No tienes permiso para vender en Distribución.'
        : !emisor ? 'Faltan los datos de la empresa.'
        : !cliente ? 'Elige el cliente.'
        : sinLicencia ? 'Este cliente no tiene licencia de la SRS vigente: no se le puede vender.'
        : !lineas.length ? 'Agrega al menos un producto.'
        : hayNoPermitidos ? 'Hay productos que este cliente no puede recibir: quítalos.'
        : haySinPrecio ? 'Hay una presentación sin precio: elige otra.'
        : cantidadMala ? 'Revisa las cantidades: tienen que ser mayores que cero.'
        : descuentoMalo ? (descuentoMalo.pasaTope
            ? `El descuento de «${descuentoMalo.p?.nombre}» pasa del tope de ${topeDescuento}%.`
            : `Revisa el descuento de «${descuentoMalo.p?.nombre ?? 'un producto'}».`)
        : problemaPago ? problemaPago
        : null;
    const listo = !bloqueo && !guardando;

    const guardar = async (yFacturar) => {
        setGuardando(yFacturar ? 'facturar' : 'guardar');
        setError('');
        const renglones = lineas.map(l => ({
            product_id: Number(l.product_id), cantidad: l.n, presentacion: l.presentacion,
            // La lista que se pidió: la del renglón o la de la venta. La base
            // vuelve a resolver el precio con esto, igual que `precioDe`.
            lista_id: (l.lista_id ? Number(l.lista_id) : listaEfectiva) ?? null,
            descuentoTipo: l.desc > 0 ? l.descTipo : null,
            descuentoValor: l.descTipo === 'pct' ? leerMonto(l.descValor) : l.desc,
        }));
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
                forma: f.forma, monto: leerMonto(f.monto), referencia: f.referencia, recibido: leerMonto(f.recibido),
                resto: i === pagos.length - 1,
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

    const botones = (
        <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={guardando === 'guardar' ? Loader2 : Save} disabled={!listo} onClick={() => guardar(false)}>
                {corrigiendo ? 'Guardar' : 'Sin facturar'}
            </Button>
            <Button variant="primary" icon={guardando === 'facturar' ? Loader2 : (imprimir ? Printer : Receipt)} disabled={!listo} onClick={() => guardar(true)}>
                {imprimir ? 'Facturar e imprimir' : 'Facturar'}
            </Button>
        </div>
    );

    const filaTotal = (rotulo, valor, { fuerte = false, tono = '' } = {}) => (
        <div className={`flex items-baseline justify-between gap-3 ${fuerte ? 'pt-2 border-t border-divider' : ''}`}>
            <span className={fuerte ? 'text-body-sm font-bold text-content-2' : 'text-caption text-content-3'}>{rotulo}</span>
            <span className={`tabular-nums ${fuerte ? 'text-title font-black text-brand-text' : `text-body-sm font-bold ${tono || 'text-content-2'}`}`}>{valor}</span>
        </div>
    );

    return (
        <GlassViewLayout icon={ShoppingCart} title={titulo} headerLeft={headerLeft} transparentBody>
            {/* El `pb-` de abajo deja lugar a la barra fija del teléfono. */}
            <div className="p-4 md:p-6 pb-44 lg:pb-6">
                {errorCarga && <Notice variant="danger" icon={AlertTriangle}>{errorCarga}</Notice>}
                {cargando && !errorCarga && <p className="text-caption text-content-3">Cargando…</p>}
                {!cargando && !errorCarga && (
                    <div className="flex flex-col gap-4 min-w-0">
                        {error && <Notice variant="danger" bloque>{error}</Notice>}

                        {/* ── Quién compra, con qué documento y a qué precio ── */}
                        <section data-surface="card" className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)] gap-4 items-start">
                            <div className="min-w-0">
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
                            <div>
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Documento</span>
                                {/* Un contribuyente no siempre pide Crédito Fiscal: se elige en
                                    cada venta. Sin NRC, sólo Factura (la base lo vuelve a frenar). */}
                                <SegmentedControl value={tipoDoc} onChange={setTipoDoc}
                                    options={[
                                        { value: '01', label: TIPO_DOCUMENTO['01'].largo },
                                        { value: '03', label: TIPO_DOCUMENTO['03'].largo, disabled: !cliente?.contribuyente },
                                    ]} />
                                {cliente && !cliente.contribuyente && <p className="text-caption text-content-3 mt-1">Sin NRC en su ficha: sólo Factura.</p>}
                            </div>
                            <div className="min-w-0">
                                <span className="text-caption font-bold text-content-2 block mb-1.5">Lista de precios</span>
                                <LiquidSelect value={listaEfectiva != null ? String(listaEfectiva) : ''} onChange={(v) => setListaVenta(v || '')}
                                    options={opcionesListas} placeholder="Sin listas" clearable={false} disabled={!opcionesListas.length} />
                                <p className="text-caption text-content-3 mt-1">
                                    {cliente?.lista_id && String(cliente.lista_id) !== String(listaEfectiva)
                                        ? 'Distinta de la del cliente.'
                                        : 'Vale para todos los productos; cada uno puede ir a otra.'}
                                </p>
                            </div>
                        </section>

                        {/* ── Qué se lleva ── */}
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
                                    {resultados.map((p, k) => {
                                        const pres = presentacionesDe(idx, p.product_id);
                                        const r = precioDe(idx, p, pres[0].presentacion, listaEfectiva);
                                        return (
                                            <button key={p.product_id} type="button" role="option" aria-selected={k === 0}
                                                onClick={() => agregar(p)}
                                                className="w-full flex items-center justify-between gap-3 px-4 min-h-[var(--tap-min)] py-2 text-left border-b border-divider last:border-b-0 hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                                                <span className="min-w-0">
                                                    <span className="block text-body-sm text-content-2 truncate">{p.nombre}</span>
                                                    <span className="block text-caption text-content-3 truncate">{pres.map(x => x.presentacion).join(' · ')}</span>
                                                </span>
                                                <span className="text-caption text-content-3 tabular-nums shrink-0">
                                                    {r ? `${formatMoney(r.precio * factorVisto)} ${conIva ? 'con IVA' : '+ IVA'}` : 'Sin precio'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="rounded-xl border border-divider overflow-hidden">
                                {lineas.length > 0 && (
                                    <div className={`hidden lg:grid ${COLUMNAS} gap-2 px-3 py-2 border-b border-divider text-caption font-bold text-content-3`}>
                                        <span>Presentación</span><span>Lista</span><span>Cantidad</span>
                                        <span className="text-right">Precio {conIva ? 'c/IVA' : 's/IVA'}</span><span>Descuento</span>
                                        <span className="text-right">Importe</span><span />
                                    </div>
                                )}
                                {lineas.length === 0 && (
                                    <p className="px-4 py-8 text-center text-caption text-content-3">Todavía no hay productos en esta venta.</p>
                                )}
                                {lineas.map(l => {
                                    const nombre = l.p?.nombre ?? `Producto ${l.product_id}`;
                                    // Las presentaciones que ya están en otro renglón del mismo producto no se ofrecen.
                                    const ocupadas = new Set(lineas.filter(o => o.clave !== l.clave && o.product_id === l.product_id).map(o => o.presentacion));
                                    const opcPres = l.presentaciones
                                        .filter(x => !ocupadas.has(x.presentacion))
                                        .map(x => ({ value: x.presentacion, label: x.presentacion, sublabel: x.unidades > 1 ? `${x.unidades} unidades` : undefined }));
                                    const opcListas = l.p ? listasDe(idx, l.p.product_id, l.presentacion).map(x => ({ value: String(x.id), label: x.nombre })) : [];
                                    const errDesc = l.descMalo ? 'No es un número' : l.pasaImporte ? 'Pasa del importe' : l.pasaTope ? `Tope ${topeDescuento}%` : null;
                                    return (
                                        <div key={l.clave} data-renglon={l.product_id}
                                            className={`grid grid-cols-2 ${COLUMNAS} gap-2 items-center px-3 py-3 lg:py-2 border-b border-divider last:border-b-0`}>
                                            <div className="col-span-2 lg:col-span-7 min-w-0 flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="text-body-sm font-bold text-content-2 truncate">{nombre}</p>
                                                    {(l.noVa || l.sinPrecio || l.otraLista) && (
                                                        <p className={`text-caption ${l.noVa || l.sinPrecio ? 'text-danger-text font-bold' : 'text-content-3'}`}>
                                                            {l.noVa ? 'No se le vende a este cliente' : l.sinPrecio ? 'Sin precio en esta presentación'
                                                                : `A precio ${idx.listas.find(x => x.id === l.r.listaId)?.nombre ?? ''}`}
                                                        </p>
                                                    )}
                                                </div>
                                                <span className="lg:hidden tabular-nums font-black text-content shrink-0">{formatMoney(l.neto * factorVisto)}</span>
                                            </div>
                                            <div className="min-w-0">
                                                <LiquidSelect compact value={l.presentacion} options={opcPres} clearable={false}
                                                    disabled={opcPres.length <= 1} ariaLabel={`Presentación de ${nombre}`}
                                                    onChange={(v) => v && cambiar(l.clave, { presentacion: v, lista_id: '' })} />
                                            </div>
                                            <div className="min-w-0">
                                                <LiquidSelect compact value={l.r?.listaId != null ? String(l.r.listaId) : ''} options={opcListas} clearable={false}
                                                    placeholder="Catálogo" disabled={opcListas.length <= 1} ariaLabel={`Lista de precio de ${nombre}`}
                                                    onChange={(v) => cambiar(l.clave, { lista_id: v && Number(v) !== listaEfectiva ? v : '' })} />
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button variant="secondary" size="sm" iconOnly icon={Minus} title="Uno menos"
                                                    disabled={(l.n ?? 0) <= 1} onClick={() => sumar(l.clave, -1)} />
                                                <PortalInput compact className="w-16 lg:w-14" inputClassName="text-center" name={`cantidad-${l.clave}`} inputMode="decimal"
                                                    value={l.cantidad} aria-label={`Cantidad de ${nombre}`} hasError={!l.n || l.n <= 0}
                                                    onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })} />
                                                <Button variant="secondary" size="sm" iconOnly icon={Plus} title="Uno más" onClick={() => sumar(l.clave, 1)} />
                                            </div>
                                            <div className="text-right tabular-nums text-body-sm text-content-2">
                                                <span className="lg:hidden text-caption text-content-3 mr-1">Precio</span>
                                                {l.r ? formatMoney(l.r.precio * factorVisto) : '—'}
                                            </div>
                                            <div className="flex items-center gap-1 min-w-0">
                                                <SegmentedControl size="sm" value={l.descTipo} label={`Descuento de ${nombre} en`}
                                                    onChange={(v) => cambiar(l.clave, { descTipo: v, descValor: '' })}
                                                    options={[{ value: 'pct', label: '%' }, { value: 'monto', label: '$' }]} />
                                                <PortalInput compact className="flex-1 min-w-0" name={`descuento-${l.clave}`} inputMode="decimal" value={l.descValor}
                                                    placeholder="0" aria-label={`Descuento de ${nombre}`} hasError={!!errDesc} errorMessage={errDesc ?? undefined}
                                                    onChange={(e) => cambiar(l.clave, { descValor: e.target.value })} />
                                            </div>
                                            <div className="hidden lg:block text-right tabular-nums font-black text-content">
                                                {formatMoney(l.neto * factorVisto)}
                                                {l.desc > 0 && <span className="block text-caption font-normal text-content-3">−{formatMoney(l.desc * factorVisto)}</span>}
                                            </div>
                                            <div className="flex justify-end">
                                                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la venta" onClick={() => quitar(l.clave)} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        {/* ── El cobro, al final: cómo paga, el desglose y el botón ── */}
                        <section data-surface="card" className="p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-5 items-start">
                            <div className="flex flex-col gap-3 min-w-0">
                                {cliente && lineas.length > 0
                                    ? <FormasDePago filas={pagos} setFilas={setPagos} total={estimado.total} cliente={cliente}
                                        plazo={plazo} setPlazo={setPlazo} abierto={pagoAbierto} setAbierto={setPagoAbierto} />
                                    : <p className="text-caption text-content-3">Las formas de pago aparecen al agregar productos.</p>}
                                {excedeCredito && (
                                    <Notice variant="warning" compact>Pasa del crédito aprobado del cliente ({formatMoney(cliente.limite_credito)}).</Notice>
                                )}
                                <PortalTextarea label="Observaciones" name="notas" value={notas} rows={2} compact
                                    onChange={(e) => setNotas(e.target.value)} placeholder="Opcional. Sale impresa en el documento." />
                            </div>
                            <div className="flex flex-col gap-2">
                                {filaTotal(`Suma (${validas.length} producto${validas.length === 1 ? '' : 's'})`, formatMoney(suma * factorVisto))}
                                {descuentos > 0 && filaTotal('Descuentos', `−${formatMoney(descuentos * factorVisto)}`, { tono: 'text-success-text' })}
                                {!conIva && filaTotal('IVA 13%', formatMoney(estimado.iva))}
                                {estimado.retencion > 0 && filaTotal('Retención 1%', `−${formatMoney(estimado.retencion)}`)}
                                {filaTotal('Total', formatMoney(estimado.total), { fuerte: true })}
                                {conIva && estimado.iva > 0 && <p className="text-caption text-content-3 text-right">Incluye IVA de {formatMoney(estimado.iva)}</p>}
                                {cambio > 0 && filaTotal('Cambio', formatMoney(cambio), { tono: 'text-success-text' })}
                                {bloqueo && lineas.length > 0 && <p className="text-caption text-content-2">{bloqueo}</p>}
                                <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el ticket al facturar"
                                    ayuda="Por la ticketera de esta computadora; si no tiene, se abre el diálogo de impresión." />
                                <div className="hidden lg:block mt-1">{botones}</div>
                            </div>
                        </section>
                    </div>
                )}
            </div>

            {/* Teléfono y tableta: el total y el botón quedan siempre a mano. */}
            {!cargando && !errorCarga && (
                <div ref={barra} data-surface="card" className="lg:hidden fixed inset-x-0 bottom-0 z-tabs px-4 pt-3 pb-[max(12px,var(--sa-bottom))] flex flex-col gap-2">
                    <div className="flex items-end justify-between gap-3">
                        <p className="min-w-0 text-caption text-content-3 truncate">
                            {bloqueo ?? (cambio > 0 ? `Cambio ${formatMoney(cambio)}` : `${lineas.length} producto${lineas.length === 1 ? '' : 's'}`)}
                        </p>
                        <p className="text-title font-black text-brand-text tabular-nums shrink-0">{formatMoney(estimado.total)}</p>
                    </div>
                    {botones}
                </div>
            )}
        </GlassViewLayout>
    );
}
