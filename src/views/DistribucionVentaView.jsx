import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    ShoppingCart, Plus, Minus, Trash2, ShieldAlert, Loader2, Receipt, Save, Search, Printer, PackageX, ArrowLeft, AlertTriangle,
    Send, Clock, Store, Package, Wallet, Tag, RefreshCw,
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
    pedirDescuento,
} from '../data/distribucion';
import { fetchLotes } from '../data/distribucionInventario';
import Interruptor from './distribucion/Interruptor';
import FormasDePago from './distribucion/FormasDePago';
import { filaNueva, problemaDePagos, cambioDePagos } from './distribucion/pagos';
import { leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO } from './distribucion/comun';
import { indexarPrecios, presentacionesDe, listasDe, precioDe } from './distribucion/precios';
import { calcularVenta, descuentoConIva } from './distribucion/motor';
import { rutaInicio, rutaDocumento } from './distribucion/rutas';

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
// Se guardan CON IVA en centavos, que es lo que paga el cliente. Se ven como
// los pone el documento: con IVA en la Factura, sin IVA en el Crédito Fiscal.
// Todas las cuentas salen de `motor.js`, el mismo motor del documento: la
// pantalla no puede decir un total y el papel otro.
//
// ── Marca ──────────────────────────────────────────────────────────────────
// Es la otra empresa (Torogoz): `useMarca('distribucion')` pinta el portal con
// sus colores mientras la vista está abierta. Por eso todo va con tokens.
//
// Rutas: `/torogoz/venta` (nueva) y `/torogoz/venta/:pedidoId`
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
    const puedeDescontar = hasPermission('distribucion_descuentos', 'can_edit');
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
    const [motivoDescuento, setMotivoDescuento] = useState('');
    const [existencias, setExistencias] = useState(null); // Map product_id → unidades, o null si no se pudo leer
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
                const [e, cs, cat, lp, ped, lotes] = await Promise.all([
                    fetchEmisor(), fetchClientes(), fetchCatalogo(), fetchListasYPrecios(),
                    corrigiendo ? fetchPedidoParaCorregir(Number(pedidoIdParam)) : Promise.resolve(null),
                    // La existencia es AYUDA para quien vende (el candado de verdad
                    // lo pone la base al facturar): si no se puede leer, la venta
                    // sigue sin ese dato en vez de no abrir.
                    fetchLotes().catch(err => { console.error('venta: existencias', err); return null; }),
                ]);
                if (!vivo) return;
                setEmisor(e); setClientes(cs); setCatalogo(cat); setListas(lp.listas); setPrecios(lp.precios); setPedido(ped);
                if (lotes) {
                    const m = new Map();
                    for (const l of lotes) m.set(String(l.product_id), (m.get(String(l.product_id)) ?? 0) + Number(l.existencia || 0));
                    setExistencias(m);
                }
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
                        // Pendiente: lo que vale es 0 y lo pedido vive aparte.
                        const monto = Number(i.descuento_estado === 'pendiente' ? i.descuento_pedido : i.descuento) || 0;
                        const descTipo = enPct || !monto ? 'pct' : 'monto';
                        // El $ se guarda con IVA; se muestra en el precio que se ve.
                        const descValor = enPct ? String(Number(i.descuento_pct))
                            : monto ? (doc === '01' ? monto : monto / 1.13).toFixed(2) : '';
                        const cantidad = conCantidad(Number(i.cantidad));
                        return renglonNuevo(i.product_id, i.presentacion ?? 'UNIDAD', {
                            lista_id: i.lista_id ? String(i.lista_id) : '',
                            cantidad, descTipo, descValor,
                            descEstado: i.descuento_estado ?? 'aplicado',
                            // Un descuento que ya se dio (aprobado, o por quien podía)
                            // sigue valiendo mientras nadie lo toque: la base hace lo
                            // mismo (`dist_validar_item`, borrador 0008).
                            descFijo: i.descuento_estado === 'aplicado' && monto > 0
                                ? `${descTipo}|${descValor}|${cantidad}|${Number(i.precio_con_iva)}` : null,
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
    // Precio de lista (con IVA) → el que se ve. Sólo para mostrar: las cuentas son del motor.
    const visto = (conIvaPrecio) => (conIva ? conIvaPrecio : conIvaPrecio / 1.13);
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

    // Cada renglón resuelto: presentación, precio de lista y descuento (con IVA).
    const base = carrito.map(c => {
        const p = porId.get(c.product_id);
        const presentaciones = p ? presentacionesDe(idx, p.product_id) : [];
        const presentacion = c.presentacion ?? presentaciones[0]?.presentacion ?? 'UNIDAD';
        const lista = c.lista_id ? Number(c.lista_id) : listaEfectiva;
        const r = p ? precioDe(idx, p, presentacion, lista) : null;
        const n = leerMonto(c.cantidad);
        const brutoConIva = r && n ? n * r.precio : 0;
        const desc = r && n ? descuentoConIva({ tipo: c.descTipo, valor: leerMonto(c.descValor), cantidad: n, precioConIva: r.precio, conIva }) : 0;
        const pct = brutoConIva > 0 ? (desc / brutoConIva) * 100 : 0;
        const descMalo = String(c.descValor ?? '').trim() !== '' && leerMonto(c.descValor) == null;
        const pasaImporte = desc > brutoConIva + 1e-6;
        // ¿Lo puede dar quien vende? Mismo juicio que `dist_validar_item`: el
        // de configuración, cualquiera; el de descuentos, hasta el tope; y uno
        // ya dado que nadie tocó, sigue. Lo demás se PIDE (no bloquea).
        const yaDado = !!c.descFijo && c.descFijo === `${c.descTipo}|${c.descValor}|${c.cantidad}|${r?.precio}`;
        const directo = desc === 0 || yaDado || puedeConfigurar || (puedeDescontar && pct <= topeDescuento + 0.005);
        const porAprobar = desc > 0 && !pasaImporte && !descMalo && !directo;
        const unidades = r && n ? Math.ceil(n * (r.unidades || 1)) : 0;
        const hay = existencias ? (existencias.get(c.product_id) ?? 0) : null;
        return {
            ...c, p, n, r, presentacion, presentaciones, desc, pct, porAprobar, unidades, hay,
            faltaExistencia: hay != null && unidades > hay,
            descMalo, pasaImporte, noVa: !p || !permitido(p), sinPrecio: !!p && !r,
            // Otra lista distinta de la de la venta: se marca para que se vea.
            otraLista: r?.listaId != null && r.listaId !== listaEfectiva,
        };
    });
    // Los números —importe de cada renglón, IVA, retención, total— los da el
    // motor del documento, con las mismas opciones que usa la edge function.
    // Un descuento por aprobar NO entra: todavía no se dio.
    const cuentan = base.filter(l => l.r && l.n > 0 && !l.pasaImporte);
    const venta = calcularVenta(
        cuentan.map(l => ({ cantidad: l.n, precioConIva: l.r.precio, descuentoConIva: l.porAprobar ? 0 : l.desc })),
        {
            tipoDoc,
            retiene1: !!cliente?.gran_contribuyente && tipoDoc === '03',
            percibe1: !!emisor?.gran_contribuyente && !cliente?.gran_contribuyente && tipoDoc === '03',
        },
    );
    const delMotor = new Map(cuentan.map((l, i) => [l.clave, venta.renglones[i]]));
    const lineas = base.map(l => ({ ...l, doc: delMotor.get(l.clave) ?? null }));
    const porAprobar = lineas.filter(l => l.porAprobar);
    const montoPorAprobar = porAprobar.reduce((a, l) => a + (conIva ? l.desc : l.desc / 1.13), 0);
    const unidadesTotal = lineas.reduce((a, l) => a + (l.n || 0), 0);
    const cantidadMala = lineas.some(l => !l.n || l.n <= 0);
    const hayNoPermitidos = lineas.some(l => l.noVa);
    const haySinPrecio = lineas.some(l => l.sinPrecio);
    const descuentoMalo = lineas.find(l => l.descMalo || l.pasaImporte);
    const conCredito = pagos.some(f => f.forma === '13');
    const plazoNum = conCredito ? leerMonto(plazo) : null;
    const estimado = venta;
    const fijas = pagos.slice(0, -1);
    const sumaFijas = fijas.reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const alCredito = !conCredito ? 0
        : fijas.filter(f => f.forma === '13').reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0)
          + (pagos[pagos.length - 1].forma === '13' ? Math.max(0, estimado.total - sumaFijas) : 0);
    const excedeCredito = conCredito && cliente && alCredito > Number(cliente.limite_credito);
    const problemaPago = lineas.length ? problemaDePagos(pagos, estimado.total, { cliente, plazo }) : null;
    const cambio = cambioDePagos(pagos, estimado.total);
    const esperandoAprobacion = !!pedido?.pedido.descuento_solicitud_id;

    // Lo que impide GUARDAR (también como preventa).
    const bloqueoGuardar = !puedeVender ? 'No tienes permiso para vender en Distribución.'
        : !emisor ? 'Faltan los datos de la empresa.'
        : !cliente ? 'Elige el cliente.'
        : sinLicencia ? 'Este cliente no tiene licencia de la SRS vigente: no se le puede vender.'
        : !lineas.length ? 'Agrega al menos un producto.'
        : hayNoPermitidos ? 'Hay productos que este cliente no puede recibir: quítalos.'
        : haySinPrecio ? 'Hay una presentación sin precio: elige otra.'
        : cantidadMala ? 'Revisa las cantidades: tienen que ser mayores que cero.'
        : descuentoMalo ? `Revisa el descuento de «${descuentoMalo.p?.nombre ?? 'un producto'}».`
        : venta.error ? `No se pudo calcular la venta: ${venta.error}.`
        : null;
    // Y lo que además impide FACTURAR.
    const bloqueo = bloqueoGuardar
        ?? (porAprobar.length ? 'Hay descuentos por aprobar: la venta se guarda como preventa.' : null)
        ?? problemaPago;
    const listo = !bloqueo && !guardando;
    const puedeGuardar = !bloqueoGuardar && !guardando;

    // modo: 'preventa' (guardar sin facturar), 'aprobacion' (preventa + pedir
    // el descuento) o 'facturar'.
    const guardar = async (modo) => {
        const yFacturar = modo === 'facturar';
        setGuardando(modo);
        setError('');
        const renglones = lineas.map(l => ({
            product_id: Number(l.product_id), cantidad: l.n, presentacion: l.presentacion,
            // La lista que se pidió: la del renglón o la de la venta. La base
            // vuelve a resolver el precio con esto, igual que `precioDe`.
            lista_id: (l.lista_id ? Number(l.lista_id) : listaEfectiva) ?? null,
            descuentoTipo: l.desc > 0 ? l.descTipo : null,
            // En $ viaja con IVA (como se guarda); en %, el porcentaje.
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
            // Descuentos que quien vende no puede dar: la base ya dejó esos
            // renglones «pendiente»; esto arma (o pone al día, o retira) la
            // solicitud. Si falla, la venta queda guardada y se avisa.
            let pedida = false;
            if (porAprobar.length || esperandoAprobacion) {
                try {
                    pedida = !!(await pedirDescuento(pedidoId, motivoDescuento));
                } catch (e) {
                    showToast('No se pudo pedir el descuento', `${mensajeDeDistribucion(e)} La venta quedó guardada: vuelve a abrirla para pedirlo.`, 'warning');
                }
            }
            useStaff.getState().appendAuditLog(corrigiendo ? 'DISTRIBUCION_PEDIDO_CORREGIDO' : 'DISTRIBUCION_PEDIDO_CREADO',
                String(pedidoId), { modo, descuento_pedido: pedida });
            // El pedido YA quedó guardado aunque facturar falle: no se deshace.
            descartar();
            if (!yFacturar) {
                showToast(pedida ? 'Enviada a aprobación' : 'Preventa guardada',
                    pedida ? 'La venta queda como preventa hasta que aprueben el descuento. Te llega un aviso.'
                           : 'Se factura después desde Pedidos.');
                navigate(rutaInicio(), { replace: true });
                return;
            }
            try {
                const factura = await facturarPedido(pedidoId);
                navigate(rutaDocumento(factura.dte_id, { imprimir }), { replace: true });
            } catch (e) {
                showToast('Pedido guardado sin facturar', mensajeDeDistribucion(e), 'warning');
                navigate(rutaInicio(), { replace: true });
            }
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(null);
        }
    };

    // Cambiar la lista de la venta cambia el precio de TODOS los productos:
    // también los que tenían otra lista elegida a mano. Se dice en voz alta
    // porque el total se mueve sin que nadie toque un renglón.
    const cambiarLista = (v) => {
        const nueva = v || '';
        if (nueva === String(listaEfectiva ?? '')) return;
        setListaVenta(nueva);
        if (!carrito.length) return;
        setCarrito(cs => cs.map(c => ({ ...c, lista_id: '' })));
        const nombre = idx.listas.find(l => String(l.id) === nueva)?.nombre ?? 'la lista elegida';
        showToast('Precios actualizados', `${carrito.length} producto${carrito.length === 1 ? '' : 's'} a precio ${nombre}.`, 'info');
    };

    // Enter en cantidad o descuento: vuelve al buscador, como en la caja —
    // el siguiente producto se escanea o se escribe sin tocar el ratón.
    const alEnterVolverAlBuscador = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        buscador.current?.focus();
    };

    const titulo = corrigiendo
        ? (pedido?.pedido.reemplaza_dte_id ? `Corregir documento (pedido ${pedidoIdParam})` : `Corregir venta ${pedidoIdParam}`)
        : 'Nueva venta';

    const headerLeft = (
        <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" iconOnly icon={ArrowLeft} title="Volver a Pedidos" onClick={() => navigate(rutaInicio())} />
            <div className="min-w-0">
                <p className="text-caption font-black text-content-3 uppercase tracking-widest">Distribución</p>
                <h2 className="font-black text-title text-content tracking-tight leading-tight truncate">{titulo}</h2>
            </div>
        </div>
    );

    // «Preventa» es la venta guardada sin facturar: el pedido que el vendedor
    // toma en la ruta y se factura después (o espera un descuento). El botón
    // principal cambia con lo que la venta puede hacer AHORA.
    const botones = (
        <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={guardando === 'preventa' ? Loader2 : Save} disabled={!puedeGuardar}
                title="Guardar sin facturar: queda en Pedidos para facturarla después"
                onClick={() => guardar('preventa')}>
                Guardar preventa
            </Button>
            {porAprobar.length > 0 ? (
                <Button variant="primary" icon={guardando === 'aprobacion' ? Loader2 : Send} disabled={!puedeGuardar}
                    data-accion-principal onClick={() => guardar('aprobacion')}>
                    Enviar a aprobación
                </Button>
            ) : (
                <Button variant="primary" icon={guardando === 'facturar' ? Loader2 : (imprimir ? Printer : Receipt)} disabled={!listo}
                    data-accion-principal onClick={() => guardar('facturar')}>
                    {imprimir ? 'Facturar e imprimir' : 'Facturar'}
                </Button>
            )}
        </div>
    );

    const filaTotal = (rotulo, valor, { fuerte = false, tono = '' } = {}) => (
        <div className={`flex items-baseline justify-between gap-3 ${fuerte ? 'pt-3 mt-1 border-t border-brand/20' : ''}`}>
            <span className={fuerte ? 'text-body font-black text-content' : 'text-caption text-content-3'}>{rotulo}</span>
            <span data-testid={fuerte ? 'total-venta' : undefined}
                className={`tabular-nums ${fuerte ? 'text-display font-black text-brand-text' : `text-body-sm font-bold ${tono || 'text-content-2'}`}`}>{valor}</span>
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
                        {esperandoAprobacion && (
                            <Notice variant="warning" icon={Clock}>
                                Esta venta espera la aprobación de un descuento. Se puede corregir; al guardarla, la solicitud se pone al día.
                            </Notice>
                        )}

                        {/* ── 1 · Quién compra, con qué documento y a qué precio ── */}
                        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4">
                            <Paso n={1} icono={Store} titulo="Cliente y documento" />
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)] gap-4 items-start">
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
                                    <LiquidSelect value={listaEfectiva != null ? String(listaEfectiva) : ''} onChange={cambiarLista}
                                        options={opcionesListas} placeholder="Sin listas" clearable={false} disabled={!opcionesListas.length} />
                                    <p className="text-caption text-content-3 mt-1 flex items-start gap-1">
                                        <RefreshCw size={12} className="shrink-0 mt-0.5" />
                                        <span>
                                            Al cambiarla, todos los productos de la venta toman sus precios.
                                            {cliente?.lista_id && String(cliente.lista_id) !== String(listaEfectiva) && ' Distinta de la del cliente.'}
                                        </span>
                                    </p>
                                </div>
                            </div>
                        </section>

                        {/* ── 2 · Qué se lleva ── */}
                        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-3">
                            <Paso n={2} icono={Package} titulo="Productos"
                                derecha={lineas.length > 0 && (
                                    <span className="text-caption text-content-3 tabular-nums">
                                        {lineas.length} producto{lineas.length === 1 ? '' : 's'} · {conCantidad(unidadesTotal)} {unidadesTotal === 1 ? 'pieza' : 'piezas'}
                                    </span>
                                )} />
                            <PortalInput ref={buscador} icon={Search} name="buscar-producto" value={buscar}
                                placeholder="Producto o código de barras… (Enter agrega el primero)" aria-label="Buscar producto"
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
                                        const hay = existencias?.get(String(p.product_id));
                                        return (
                                            <button key={p.product_id} type="button" role="option" aria-selected={k === 0}
                                                onClick={() => agregar(p)}
                                                className={`w-full flex items-center justify-between gap-3 px-4 min-h-[var(--tap-min)] py-2 text-left border-b border-divider last:border-b-0 hover:bg-surface-card-hover active:scale-[0.99] transition-transform ${k === 0 ? 'bg-brand/5' : ''}`}>
                                                <span className="min-w-0">
                                                    <span className="block text-body-sm font-bold text-content-2 truncate">{p.nombre}</span>
                                                    <span className="block text-caption text-content-3 truncate">
                                                        {pres.map(x => x.presentacion).join(' · ')}
                                                        {hay != null && <span className={hay > 0 ? '' : 'text-danger-text font-bold'}> · {hay > 0 ? `hay ${hay}` : 'sin existencia'}</span>}
                                                    </span>
                                                </span>
                                                <span className="text-caption text-content-3 tabular-nums shrink-0">
                                                    {r ? `${formatMoney(visto(r.precio))} ${conIva ? 'con IVA' : '+ IVA'}` : 'Sin precio'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            <div className="rounded-xl border border-divider overflow-hidden">
                                {lineas.length > 0 && (
                                    <div className={`hidden lg:grid ${COLUMNAS} gap-2 px-3 py-2 border-b border-divider bg-surface-card-hover/40 text-caption font-bold text-content-3`}>
                                        <span>Presentación</span><span>Lista</span><span>Cantidad</span>
                                        <span className="text-right">Precio {conIva ? 'c/IVA' : 's/IVA'}</span><span>Descuento</span>
                                        <span className="text-right">Importe</span><span />
                                    </div>
                                )}
                                {lineas.length === 0 && (
                                    <div className="px-4 py-10 flex flex-col items-center gap-2 text-center">
                                        <Package size={28} className="text-content-3" />
                                        <p className="text-body-sm font-bold text-content-2">Todavía no hay productos en esta venta</p>
                                        <p className="text-caption text-content-3">Escribe el nombre o escanea el código de barras arriba.</p>
                                    </div>
                                )}
                                {lineas.map((l, k) => {
                                    const nombre = l.p?.nombre ?? `Producto ${l.product_id}`;
                                    // Las presentaciones que ya están en otro renglón del mismo producto no se ofrecen.
                                    const ocupadas = new Set(lineas.filter(o => o.clave !== l.clave && o.product_id === l.product_id).map(o => o.presentacion));
                                    const opcPres = l.presentaciones
                                        .filter(x => !ocupadas.has(x.presentacion))
                                        .map(x => ({ value: x.presentacion, label: x.presentacion, sublabel: x.unidades > 1 ? `${x.unidades} unidades` : undefined }));
                                    const opcListas = l.p ? listasDe(idx, l.p.product_id, l.presentacion).map(x => ({ value: String(x.id), label: x.nombre })) : [];
                                    const errDesc = l.descMalo ? 'No es un número' : l.pasaImporte ? 'Pasa del importe' : null;
                                    return (
                                        <div key={l.clave} data-renglon={l.product_id}
                                            className={`grid grid-cols-2 ${COLUMNAS} gap-2 items-center px-3 py-3 border-b border-divider last:border-b-0 ${l.porAprobar ? 'bg-warning/5' : ''}`}>
                                            <div className="col-span-2 lg:col-span-7 min-w-0 flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex items-start gap-2.5">
                                                    <span className="shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand-text text-micro font-black flex items-center justify-center tabular-nums">{k + 1}</span>
                                                    <div className="min-w-0">
                                                        <p className="text-body-sm font-bold text-content truncate">{nombre}</p>
                                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-caption">
                                                            {l.p?.codigo_barras && <span className="text-content-3 tabular-nums">{l.p.codigo_barras}</span>}
                                                            {l.hay != null && (
                                                                <span className={l.faltaExistencia ? 'text-danger-text font-bold' : 'text-content-3'}>
                                                                    {l.faltaExistencia ? `Sólo hay ${l.hay} unidades` : `Hay ${l.hay} u.`}
                                                                </span>
                                                            )}
                                                            {l.noVa && <Badge size="sm" variant="danger" uppercase={false}>No se le vende a este cliente</Badge>}
                                                            {l.sinPrecio && <Badge size="sm" variant="danger" uppercase={false}>Sin precio en esta presentación</Badge>}
                                                            {l.otraLista && !l.noVa && <Badge size="sm" variant="neutral" uppercase={false}>A precio {idx.listas.find(x => x.id === l.r.listaId)?.nombre}</Badge>}
                                                            {l.porAprobar && <Badge size="sm" variant="warning" icon={Clock} uppercase={false}>Descuento por aprobar</Badge>}
                                                            {!l.porAprobar && l.descEstado === 'rechazado' && !l.descValor && <Badge size="sm" variant="neutral" uppercase={false}>Descuento rechazado</Badge>}
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className="lg:hidden tabular-nums font-black text-content shrink-0">{formatMoney(l.doc?.importe ?? 0)}</span>
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
                                                    onKeyDown={alEnterVolverAlBuscador}
                                                    onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })} />
                                                <Button variant="secondary" size="sm" iconOnly icon={Plus} title="Uno más" onClick={() => sumar(l.clave, 1)} />
                                            </div>
                                            <div className="text-right tabular-nums text-body-sm text-content-2" data-testid="precio-renglon">
                                                <span className="lg:hidden text-caption text-content-3 mr-1">Precio</span>
                                                {l.r ? formatMoney(l.doc?.precioUni ?? visto(l.r.precio)) : '—'}
                                            </div>
                                            <div className="flex items-center gap-1 min-w-0">
                                                <SegmentedControl size="sm" value={l.descTipo} label={`Descuento de ${nombre} en`}
                                                    onChange={(v) => cambiar(l.clave, { descTipo: v, descValor: '' })}
                                                    options={[{ value: 'pct', label: '%' }, { value: 'monto', label: '$' }]} />
                                                <PortalInput compact className="flex-1 min-w-0" name={`descuento-${l.clave}`} inputMode="decimal" value={l.descValor}
                                                    placeholder="0" aria-label={`Descuento de ${nombre}`} hasError={!!errDesc} errorMessage={errDesc ?? undefined}
                                                    onKeyDown={alEnterVolverAlBuscador}
                                                    onChange={(e) => cambiar(l.clave, { descValor: e.target.value })} />
                                            </div>
                                            <div className="hidden lg:block text-right tabular-nums font-black text-content">
                                                {formatMoney(l.doc?.importe ?? 0)}
                                                {l.doc?.descuento > 0 && <span className="block text-caption font-normal text-success-text">−{formatMoney(l.doc.descuento)}</span>}
                                                {l.porAprobar && <span className="block text-caption font-normal text-warning-text">−{formatMoney(conIva ? l.desc : l.desc / 1.13)} por aprobar</span>}
                                            </div>
                                            <div className="flex justify-end">
                                                <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la venta" onClick={() => quitar(l.clave)} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        {/* ── 3 · El cobro, al final: cómo paga, el desglose y el botón ── */}
                        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4">
                            <Paso n={3} icono={Wallet} titulo="Cobro" />
                            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] gap-5 items-start">
                                <div className="flex flex-col gap-3 min-w-0" data-cobro>
                                    {porAprobar.length > 0 && (
                                        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
                                            <p className="text-body-sm text-content-2 flex items-start gap-2">
                                                <Tag size={16} className="text-warning-text shrink-0 mt-0.5" />
                                                <span>
                                                    <b>{formatMoney(montoPorAprobar)}</b> de descuento en {porAprobar.length} producto{porAprobar.length === 1 ? '' : 's'} necesita{porAprobar.length === 1 ? '' : 'n'} aprobación
                                                    {puedeDescontar ? ` (pasa del tope de ${topeDescuento}%)` : ''}. La venta se guarda como preventa, sin el descuento,
                                                    y se actualiza sola cuando lo aprueben.
                                                </span>
                                            </p>
                                            <PortalTextarea label="¿Por qué el descuento? (lo ve quien aprueba)" name="motivo-descuento" value={motivoDescuento}
                                                rows={2} compact onChange={(e) => setMotivoDescuento(e.target.value)}
                                                placeholder="Ej.: cliente nuevo, compra de volumen, igualar precio de la competencia" />
                                        </div>
                                    )}
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
                                <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 flex flex-col gap-2 lg:sticky lg:top-4">
                                    {filaTotal(`Suma (${cuentan.length} producto${cuentan.length === 1 ? '' : 's'})`, formatMoney(venta.suma))}
                                    {venta.descuentos > 0 && filaTotal('Descuentos', `−${formatMoney(venta.descuentos)}`, { tono: 'text-success-text' })}
                                    {montoPorAprobar > 0 && filaTotal('Descuento por aprobar (no incluido)', `−${formatMoney(montoPorAprobar)}`, { tono: 'text-warning-text' })}
                                    {!conIva && filaTotal('IVA 13%', formatMoney(estimado.iva))}
                                    {estimado.retencion > 0 && filaTotal('Retención 1%', `−${formatMoney(estimado.retencion)}`)}
                                    {estimado.percepcion > 0 && filaTotal('Percepción 1%', formatMoney(estimado.percepcion))}
                                    {filaTotal('Total', formatMoney(estimado.total), { fuerte: true })}
                                    {conIva && estimado.iva > 0 && <p className="text-caption text-content-3 text-right">Incluye IVA de {formatMoney(estimado.iva)}</p>}
                                    {cambio > 0 && (
                                        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-success/10 px-3 py-2">
                                            <span className="text-body-sm font-bold text-success-text">Cambio</span>
                                            <span className="text-title font-black text-success-text tabular-nums">{formatMoney(cambio)}</span>
                                        </div>
                                    )}
                                    {bloqueo && lineas.length > 0 && !porAprobar.length && <p className="text-caption text-content-2">{bloqueo}</p>}
                                    <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el ticket al facturar"
                                        ayuda="Por la ticketera de esta computadora; si no tiene, se abre el diálogo de impresión." />
                                    <div className="hidden lg:block mt-1">{botones}</div>
                                    <p className="hidden lg:block text-micro text-content-3">
                                        «Guardar preventa» deja la venta en Pedidos sin facturar, para facturarla después.
                                    </p>
                                </div>
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

/** El encabezado de cada paso de la venta: número, ícono y título. */
function Paso({ n, icono: Icono, titulo, derecha }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 w-7 h-7 rounded-full bg-brand text-white text-caption font-black flex items-center justify-center">{n}</span>
                <Icono size={16} className="text-brand-text shrink-0" />
                <h3 className="text-body font-black text-content truncate">{titulo}</h3>
            </div>
            {derecha}
        </div>
    );
}
