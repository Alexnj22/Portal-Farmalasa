import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ShoppingCart, Plus, Minus, Trash2, ShieldAlert, Loader2, Receipt, Save, Search, Printer, PackageX, ArrowLeft, AlertTriangle,
    Send, Clock, Store, Package, Tag, ListChecks, ChevronRight, Wallet, Warehouse, Eraser, UserPlus, Split,
} from 'lucide-react';
import LiquidModal from '../components/common/LiquidModal';
import ExistenciasSucursales from './distribucion/ExistenciasSucursales';
import ClienteModal from './distribucion/ClienteModal';
import VentaPerdidaModal from './distribucion/VentaPerdidaModal';
import { indexarLotes, ocupadasPorLote, libreEn, repartir, repartirTodo } from './distribucion/lotes';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import LiquidSelect from '../components/common/LiquidSelect';
import PortalInput from '../components/common/PortalInput';
import PortalTextarea from '../components/common/PortalTextarea';
import SegmentedControl from '../components/common/SegmentedControl';
import useBorrador from '@nucleo/hooks/useBorrador';
import { useMarca } from '../plataforma/useMarca';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { fechaHora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    fetchEmisor, fetchClientes, fetchCatalogo, fetchListasYPrecios, fetchPedidoParaCorregir, fetchPedidos,
    crearPedido, actualizarPedido, facturarPedido, mensajeDeDistribucion, guardarPagos, subirComprobante, adjuntarComprobante,
    pedirDescuento, anularPedido,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import Interruptor from './distribucion/Interruptor';
import FormasDePago from './distribucion/FormasDePago';
import { filaNueva, problemaDePagos, cambioDePagos } from './distribucion/pagos';
import { leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO, FORMA_PAGO } from './distribucion/comun';
import { indexarPrecios, presentacionesDe, listasDe, precioDe } from './distribucion/precios';
import { calcularVenta, descuentoConIva, totalDePedido } from './distribucion/motor';
import { rutaInicio, rutaDocumento, rutaVenta } from './distribucion/rutas';

// La venta de Distribución, en su propia vista.
//
// ── Cómo se usa ────────────────────────────────────────────────────────────
// Arriba, en una franja: cliente, documento, LISTA DE PRECIOS (la del cliente
// por defecto) y FORMA DE PAGO — el mismo orden de la caja, que pide el tipo de
// pago antes de cobrar. En medio, los renglones: producto → cantidad →
// presentación (unidad, caja, paquete: cada una con su precio) → precio/lista
// → descuento en % o en $ → importe. A la derecha, el resumen fiscal y los
// botones; F2 abre el cobro (entrega y cambio, o el pago dividido).
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

// La guía de teclas de la columna del resumen. Las mismas de la caja
// (`js_funciones_venta.js`: F2 pagar, F8 guardar, F6 borrar, F3 buscar, F4
// salir) más F7, que es del portal.
const TECLAS = [
    ['F2', 'Cobrar'], ['F8', 'Guardar preventa'], ['F6', 'Borrar la preventa · vaciar'],
    ['F3', 'Buscar producto'], ['F7', 'Existencias en sucursales'], ['F9', 'Venta perdida'], ['F4', 'Salir a Pedidos'],
    ['Tab · ← →', 'Cambiar de campo'], ['↑ ↓', 'Cambiar de producto'], ['Supr', 'Quitar el producto'],
];
const conCantidad = (n) => String(Math.round(n * 10000) / 10000);
/** Lo que se escribe en cantidad o descuento: sólo dígitos y UN separador decimal. */
const soloNumero = (v) => {
    const limpio = String(v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.');
    const [ent, ...resto] = limpio.split('.');
    return resto.length ? `${ent}.${resto.join('')}` : ent;
};
let siguienteRenglon = 1;
const renglonNuevo = (productId, presentacion, extra = {}) => ({
    product_id: String(productId), presentacion, lista_id: '', cantidad: '1',
    descTipo: 'pct', descValor: '', ...extra, clave: siguienteRenglon++,
});

/** Lo que `lotes.js` necesita saber del catálogo para repartir un renglón. */
function contextoLotes(idx, lotesIdx) {
    return {
        lotesDe: (pid) => lotesIdx.get(String(pid)) ?? [],
        porDe: (pid, pres) => presentacionesDe(idx, pid).find(x => x.presentacion === pres)?.unidades ?? 1,
        // El tramo de otro lote hereda la lista y un descuento en % (en $ no:
        // sería darlo dos veces).
        nuevo: (b, cambios) => renglonNuevo(b.product_id, b.presentacion, {
            lista_id: b.lista_id, descTipo: b.descTipo, descValor: b.descTipo === 'pct' ? b.descValor : '', ...cambios,
        }),
    };
}

// Los renglones se acomodan al ANCHO DE LA LISTA (container query), no al de la
// pantalla: desde que el resumen vive en una columna a la derecha, la lista mide
// distinto según el monitor. Con ≥56rem, UNA línea por producto (encabezado y
// filas sobre la misma cadena); con ≥32rem, dos (el nombre arriba y los
// controles en una fila); más angosta (teléfono), tres líneas cortas.
// El LOTE no tiene columna: vive en la línea del producto, junto a lo que hay
// en existencia. Como columna apretaba a la presentación y al precio hasta
// dejarlos en «B…» y «$4…».
const COLUMNAS = '@4xl:grid-cols-[minmax(9rem,1fr)_8rem_9rem_9.5rem_6.5rem_5.5rem_2rem]';
/** «2026-11-01» → «11/2026»: el vencimiento como lo trae la caja del producto. */
const mesVence = (v) => (v ? `${v.slice(5, 7)}/${v.slice(0, 4)}` : 'sin vencimiento');

export default function DistribucionVentaView() {
    useMarca('distribucion');
    const navigate = useNavigate();
    const { pedidoId: pedidoIdParam } = useParams();
    const corrigiendo = !!pedidoIdParam;
    // «Volver a vender» (desde una venta ya hecha): `?desde=<pedido>` abre una
    // venta NUEVA con el mismo cliente y los mismos productos. Pedido del
    // usuario: repetir un pedido se hace desde la venta, no al elegir cliente.
    const [params, setParams] = useSearchParams();
    // Se lee UNA vez, al abrir: después se limpia de la dirección.
    const [desde] = useState(() => (!corrigiendo ? Number(params.get('desde')) || null : null));
    // `?cliente=<id>`: una venta nueva con ese cliente ya elegido (el «Vender»
    // del tablero, sobre un cliente que dejó de comprar).
    const [clienteInicial] = useState(() => (!corrigiendo && !params.get('desde') ? params.get('cliente') : null));
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
    const [lotesIdx, setLotesIdx] = useState(() => new Map()); // product_id → lotes, primero vence primero sale
    const [perdida, setPerdida] = useState(null);         // la ventana de venta perdida: { producto?, cantidad, buscado?, clave? }
    const [pendientes, setPendientes] = useState(null);   // preventas por finalizar (sólo en una venta nueva)
    const [buscarPendiente, setBuscarPendiente] = useState('');
    const buscador = useRef(null);
    const barra = useRef(null);
    const carritoRef = useRef([]);
    const catalogoRef = useRef(new Map());
    const buscadorTexto = useRef('');
    const porAprobarRef = useRef(false);

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
                const [e, cs, cat, lp, ped, lotes, pend, base] = await Promise.all([
                    fetchEmisor(), fetchClientes(), fetchCatalogo(), fetchListasYPrecios(),
                    corrigiendo ? fetchPedidoParaCorregir(Number(pedidoIdParam)) : Promise.resolve(null),
                    // La existencia es AYUDA para quien vende (el candado de verdad
                    // lo pone la base al facturar): si no se puede leer, la venta
                    // sigue sin ese dato en vez de no abrir.
                    fetchLotes().catch(err => { console.error('venta: existencias', err); return null; }),
                    // Las preventas por finalizar (pedido del usuario: «en venta
                    // debe salir un listado de los pendientes, para seleccionar
                    // y finalizar»). Ayuda, igual que la existencia: si falla,
                    // la venta abre igual.
                    corrigiendo ? Promise.resolve(null)
                        : fetchPedidos({ estados: ['confirmado'], desde: sumarDias(hoySV(), -60) })
                            .catch(err => { console.error('venta: pendientes', err); return null; }),
                    desde ? fetchPedidoParaCorregir(desde).catch(err => { console.error('venta: volver a vender', err); return null; })
                        : Promise.resolve(null),
                ]);
                if (vivo) setPendientes(pend);
                if (vivo && base) {
                    // Mismo cliente, documento y productos; sin descuentos ni pagos:
                    // es otra venta, y lo que se dio en la anterior no se hereda.
                    const c = cs.find(x => x.id === base.pedido.cliente_id);
                    setClienteId(String(base.pedido.cliente_id));
                    setListaVenta(c?.lista_id ? String(c.lista_id) : '');
                    setTipoDoc(base.pedido.tipo_documento ?? (c?.contribuyente ? '03' : '01'));
                    setCarrito(base.items.map(i => renglonNuevo(i.product_id, i.presentacion ?? 'UNIDAD', {
                        cantidad: conCantidad(Number(i.cantidad)),
                        // El lote NO se hereda: se vuelve a elegir por vencimiento.
                        lote_id: null,
                        lista_id: i.lista_id && c?.lista_id && Number(i.lista_id) !== Number(c.lista_id) ? String(i.lista_id) : '',
                    })));
                    const p = new URLSearchParams(params);
                    p.delete('desde');
                    setParams(p, { replace: true });
                    showToast('Venta nueva con los mismos productos', 'Revisa las cantidades antes de guardar.', 'info');
                }
                if (vivo && clienteInicial && !base) {
                    const c = cs.find(x => String(x.id) === String(clienteInicial));
                    if (c) {
                        setClienteId(String(c.id));
                        setTipoDoc(c.contribuyente ? '03' : '01');
                        setListaVenta(c.lista_id ? String(c.lista_id) : '');
                        setPlazo(c.plazo_dias ? String(c.plazo_dias) : '');
                    }
                    const p = new URLSearchParams(params);
                    p.delete('cliente');
                    setParams(p, { replace: true });
                }
                if (!vivo) return;
                setEmisor(e); setClientes(cs); setCatalogo(cat); setListas(lp.listas); setPrecios(lp.precios); setPedido(ped);
                const li = lotes ? indexarLotes(lotes) : new Map();
                if (lotes) {
                    const m = new Map();
                    for (const l of lotes) m.set(String(l.product_id), (m.get(String(l.product_id)) ?? 0) + Number(l.existencia || 0));
                    setExistencias(m);
                    setLotesIdx(li);
                }
                // Una venta que llega armada (volver a vender, o una preventa de
                // antes de los lotes) se reparte por vencimiento al abrir.
                const ix = indexarPrecios(lp.precios, lp.listas);
                const ctxAlAbrir = contextoLotes(ix, li);
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
                            lote_id: i.lote_id ?? null,
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
                if (lotes) setCarrito(cs => repartirTodo(cs, ctxAlAbrir));
            } catch (e) {
                if (vivo) setErrorCarga(mensajeDeDistribucion(e));
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    // La carga corre al abrir (o al cambiar de venta). `params` y `showToast` sólo
    // se usan para limpiar `?desde=` y avisar una vez: no deben recargar todo.
    }, [corrigiendo, pedidoIdParam, desde]); // eslint-disable-line react-hooks/exhaustive-deps

    const { recuperado, descartar } = useBorrador(
        emisor && !corrigiendo ? `distribucion-venta-${emisor.id}` : null,
        { clienteId, listaVenta, tipoDoc, carrito, pagos: pagos.map(({ adjunto, ...f }) => f), plazo, notas, uuid },
        { activo: !corrigiendo, vale: (v) => !!v?.clienteId || v?.carrito?.length > 0 },
    );
    const repuesto = useRef(false);
    useEffect(() => {
        // Con «volver a vender» la venta ya viene armada: el borrador no la pisa.
        if (corrigiendo || desde || clienteInicial || repuesto.current || !recuperado) return;
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
    }, [corrigiendo, recuperado, desde, clienteInicial]);

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
        // En el menú (no en el control) se dice lo que hace elegirla: cambia el
        // precio de TODOS los productos (pedido del usuario).
        value: String(l.id), label: l.nombre,
        sublabel: `${l.id === listaBase ? 'Lista base · ' : ''}cambia el precio de todos los productos`,
    })), [idx, listaBase]);

    const permitido = useCallback((p) => p.activo && (!cliente || !soloVentaLibre(cliente.tipo) || (p.venta_libre && !p.controlado)), [cliente]);
    const porId = useMemo(() => new Map(catalogo.map(p => [String(p.product_id), p])), [catalogo]);

    const resultados = useMemo(() => {
        const q = buscar.trim();
        if (!q || !cliente) return [];
        return catalogo.filter(p => permitido(p) && tokenMatch(q, p.nombre, p.codigo_barras)).slice(0, RESULTADOS);
    }, [buscar, catalogo, cliente, permitido]);

    const [resaltado, setResaltado] = useState(0);     // el resultado del buscador que agrega Enter
    const [enfocar, setEnfocar] = useState(null);      // la clave del renglón cuya cantidad toma el foco
    const [verExistencias, setVerExistencias] = useState(null); // null, o el texto con que abre la búsqueda

    const ctxLotes = useMemo(() => contextoLotes(idx, lotesIdx), [idx, lotesIdx]);
    /** Reparte un renglón por lotes (primero vence) tras cambiarlo: cantidad, presentación o lote. */
    const cambiarYRepartir = (clave, cambios) => setCarrito(cs => repartir(
        cs.map(c => (c.clave === clave ? { ...c, ...(typeof cambios === 'function' ? cambios(c) : cambios) } : c)), clave, ctxLotes));

    // Al agregar, el foco va DIRECTO a la cantidad de ese producto (pedido del
    // usuario): es lo primero que se escribe. Enter ahí vuelve al buscador.
    // Sin existencia en ningún lote no se agrega: se abre «venta perdida»
    // (pedido del usuario: «si ingreso un producto y no hay stock, que salga
    // agregar ventas perdidas»).
    const agregar = (p) => {
        const pid = String(p.product_id);
        setBuscar('');
        setResaltado(0);
        if (existencias && !(existencias.get(pid) > 0)) {
            setPerdida({ producto: { product_id: pid, nombre: p.nombre, motivo: 'Sin existencia en ningún lote' }, cantidad: 1 });
            return;
        }
        const pres = presentacionesDe(idx, p.product_id)[0].presentacion;
        const mismos = carrito.filter(c => c.product_id === pid && c.presentacion === pres);
        const ya = mismos[mismos.length - 1];
        let clave;
        let armado;
        if (ya) {
            clave = ya.clave;
            armado = carrito.map(c => (c === ya ? { ...c, cantidad: conCantidad((leerMonto(c.cantidad) ?? 0) + 1) } : c));
        } else {
            const nuevo = renglonNuevo(pid, pres);
            clave = nuevo.clave;
            armado = [...carrito, nuevo];
        }
        const repartido = repartir(armado, clave, ctxLotes);
        setCarrito(repartido);
        setEnfocar(repartido.some(c => c.clave === clave) ? clave : [...repartido].reverse().find(c => c.product_id === pid)?.clave);
    };
    useEffect(() => {
        if (enfocar == null) return;
        const campo = document.querySelector(`input[name="cantidad-${enfocar}"]`);
        if (campo) { campo.focus(); campo.select(); }
        setEnfocar(null); // eslint-disable-line react-hooks/set-state-in-effect -- consumir la orden de foco
    }, [enfocar, carrito]);

    /*
     * Moverse por los renglones con el teclado, como en una hoja:
     *   ← →  al campo anterior / siguiente del mismo producto
     *   ↑ ↓  al mismo campo del producto de arriba / abajo
     * En un campo de texto, ← → sólo saltan si el cursor ya está en el borde
     * (o todo está seleccionado): si no, mueven el cursor, que es lo esperado.
     * Con un menú abierto las flechas son del menú, no de la tabla.
     */
    const navegarRenglones = (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        const t = e.target;
        if (t.closest?.('[role="listbox"]') || t.getAttribute?.('aria-expanded') === 'true') return;
        const celda = t.closest?.('[data-col]');
        const fila = t.closest?.('[data-fila]');
        if (!celda || !fila) return;
        if (t.tagName === 'INPUT' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            const todo = t.selectionStart === 0 && t.selectionEnd === t.value.length;
            const enBorde = e.key === 'ArrowLeft' ? t.selectionStart === 0 && t.selectionEnd === 0 : t.selectionStart === t.value.length;
            if (!todo && !enBorde) return;
        }
        const col = Number(celda.dataset.col);
        const f = Number(fila.dataset.fila);
        // Un campo deshabilitado (la presentación cuando es única) NO corta el
        // camino: se sigue en la misma dirección hasta el siguiente que sirva.
        // Arriba/abajo, si esa columna no sirve en el otro producto, cae en su
        // cantidad, que siempre está.
        const enfocable = (fi, co) => document.querySelector(`[data-fila="${fi}"] [data-col="${co}"]`)
            ?.querySelector('input:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), button:not([disabled]):not([tabindex="-1"])');
        let el = null;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const paso = e.key === 'ArrowLeft' ? -1 : 1;
            for (let c = col + paso; c >= 0 && c <= 5 && !el; c += paso) el = enfocable(f, c);
        } else {
            const otra = e.key === 'ArrowUp' ? f - 1 : f + 1;
            el = enfocable(otra, col) ?? enfocable(otra, 0);
        }
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        el.focus();
        if (el.tagName === 'INPUT') el.select();
    };
    const cambiar = (clave, cambios) => setCarrito(cs => cs.map(c => (c.clave === clave ? { ...c, ...cambios } : c)));
    const sumar = (clave, delta) => cambiarYRepartir(clave, (c) => ({ cantidad: conCantidad(Math.max(1, (leerMonto(c.cantidad) ?? 0) + delta)) }));
    const quitar = (clave) => setCarrito(cs => cs.filter(c => c.clave !== clave));

    const cambiarCliente = useCallback((v, lista = clientes) => {
        setClienteId(v || '');
        const c = lista.find(x => String(x.id) === String(v));
        setTipoDoc(c?.contribuyente ? '03' : '01');
        setListaVenta(c?.lista_id ? String(c.lista_id) : '');
        if (!c || !(c.plazo_dias > 0)) setPagos(ps => ps.map(f => (f.forma === '13' ? { ...f, forma: '01' } : f)));
        setPlazo(c?.plazo_dias ? String(c.plazo_dias) : '');
        setError('');
    }, [clientes]);

    // Unidades que los OTROS renglones ya ocupan en cada lote.
    const ocupadasTodas = ocupadasPorLote(carrito, ctxLotes.porDe);
    const ocupadasOtros = (clave) => {
        const c = carrito.find(x => x.clave === clave);
        if (!c || c.lote_id == null) return ocupadasTodas;
        const m = new Map(ocupadasTodas);
        const propias = (leerMonto(c.cantidad) ?? 0) * ctxLotes.porDe(c.product_id, c.presentacion);
        m.set(Number(c.lote_id), (m.get(Number(c.lote_id)) ?? 0) - propias);
        return m;
    };
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
        // El lote del renglón y lo que le queda, descontando lo que ya llevan
        // los demás renglones de este carrito.
        const lotesP = lotesIdx.get(c.product_id) ?? [];
        const lote = lotesP.find(x => x.id === Number(c.lote_id)) ?? null;
        const por = r?.unidades || 1;
        const libres = lotesP.map(x => ({ ...x, libre: libreEn(x, ocupadasOtros(c.clave)) }));
        const libreLote = lote ? libres.find(x => x.id === lote.id).libre : 0;
        const faltanUnidades = existencias ? Math.max(0, unidades - (lote ? libreLote : 0)) : 0;
        return {
            ...c, p, n, r, presentacion, presentaciones, desc, pct, porAprobar, unidades, hay,
            lote, libres, libreLote, por,
            faltaExistencia: faltanUnidades > 0,
            faltan: faltanUnidades > 0 ? Math.ceil(faltanUnidades / por) : 0,
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
    const sinExistencia = lineas.find(l => l.faltaExistencia);
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
        ?? (sinExistencia ? `No hay existencia para «${sinExistencia.p?.nombre ?? 'un producto'}»: baja la cantidad o anota lo que falta como venta perdida.` : null)
        ?? problemaPago;
    const listo = !bloqueo && !guardando;
    const puedeGuardar = !bloqueoGuardar && !guardando;

    /** Deja la pantalla lista para la siguiente venta (tras guardar una preventa). */
    const empezarOtra = () => {
        setClienteId(''); setListaVenta(''); setCarrito([]); setBuscar(''); setTipoDoc('01');
        setPagos([filaNueva()]); setPagoAbierto(null); setPlazo(''); setNotas(''); setMotivoDescuento('');
        setUuid(crypto.randomUUID()); setError('');
        fetchPedidos({ estados: ['confirmado'], desde: sumarDias(hoySV(), -60) })
            .then(setPendientes).catch(e => console.error('venta: pendientes', e));
    };

    // modo: 'preventa' (guardar sin facturar), 'aprobacion' (preventa + pedir
    // el descuento) o 'facturar'.
    const guardar = async (modo) => {
        const yFacturar = modo === 'facturar';
        setGuardando(modo);
        setError('');
        const renglones = lineas.map(l => ({
            product_id: Number(l.product_id), cantidad: l.n, presentacion: l.presentacion,
            lote_id: l.lote_id != null ? Number(l.lote_id) : null,
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
                           : 'Queda en Pendientes para facturarla después.');
                // Se toma un pedido tras otro: la pantalla queda lista para el
                // siguiente, sin pasar por Pedidos.
                // La misma vista sirve a las dos rutas y React la reutiliza: sin
                // limpiar, la venta nueva nacería con los productos de ésta.
                empezarOtra();
                if (corrigiendo) navigate(rutaVenta(), { replace: true });
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


    // ── Teclas rápidas: las mismas de la caja (su js_funciones_venta.js) ──
    //   F2  finalizar (facturar, o enviar a aprobación)   · también Ctrl+Enter
    //   F8  guardar como preventa
    //   F6  borrar la preventa abierta (o vaciar una venta nueva), con confirmación
    //   F9  anotar una venta perdida (nuevo; en la caja F9 es «vale», que aquí no existe)
    //   F3  al buscador                                   · también /
    //   F4  salir a Pedidos
    //   F7  existencias en todas las sucursales (nuevo, pedido del usuario)
    //   Supr sobre un producto (fuera de un campo de texto): quitarlo
    // Aprietan el MISMO botón que el ratón: si está deshabilitado, no pasa nada.
    // Las teclas se escuchan una vez; el carrito que ven lo refresca este efecto.
    useEffect(() => { carritoRef.current = carrito; }, [carrito]);
    useEffect(() => { catalogoRef.current = porId; }, [porId]);
    useEffect(() => { buscadorTexto.current = buscar; }, [buscar]);
    useEffect(() => { porAprobarRef.current = porAprobar.length > 0; });
    useEffect(() => {
        const apretar = (sel) => document.querySelector(`${sel}:not([disabled])`)?.click();
        const alTeclado = (e) => {
            if (document.querySelector('[role="dialog"]') && e.key !== 'F7') return; // con un diálogo abierto, las teclas son suyas
            const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
            const k = e.key;
            // F2 abre el COBRO (el mismo botón «Cobrar»): ahí sólo queda el monto, y Enter procesa.
            if (k === 'F2' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); apretar('[data-accion-principal]'); }
            else if (k === 'F8') { e.preventDefault(); apretar('[data-accion-preventa]'); }
            else if (k === 'F6') { e.preventDefault(); apretar('[data-accion-borrar]'); }
            else if (k === 'F9') { e.preventDefault(); apretar('[data-accion-perdida]'); }
            else if (k === 'F3' || (k === '/' && !enCampo)) { e.preventDefault(); buscador.current?.focus(); }
            else if (k === 'F4') { e.preventDefault(); navigate(rutaInicio()); }
            else if (k === 'F7') {
                // Abre buscando el producto donde está parado el cursor, o lo escrito.
                e.preventDefault();
                const fila = e.target?.closest?.('[data-fila]');
                const renglon = fila && carritoRef.current[Number(fila.dataset.fila)];
                const nombre = renglon ? catalogoRef.current.get(renglon.product_id)?.nombre : null;
                setVerExistencias(v => (v != null ? null : (nombre ?? buscadorTexto.current ?? '')));
            }
            else if (k === 'Delete' && !enCampo) {
                const fila = e.target?.closest?.('[data-fila]');
                const clave = fila && carritoRef.current[Number(fila.dataset.fila)]?.clave;
                if (clave != null) { e.preventDefault(); setCarrito(cs => cs.filter(c => c.clave !== clave)); buscador.current?.focus(); }
            }
        };
        window.addEventListener('keydown', alTeclado);
        return () => window.removeEventListener('keydown', alTeclado);
    }, [navigate]);

    const [verPendientes, setVerPendientes] = useState(false);
    const [verCobro, setVerCobro] = useState(false);
    const [avisoCobro, setAvisoCobro] = useState('');
    const [verNotas, setVerNotas] = useState(!!notas);
    const [verBorrar, setVerBorrar] = useState(false);
    const [motivoBorrar, setMotivoBorrar] = useState('');
    const [borrando, setBorrando] = useState(false);
    const [nuevoCliente, setNuevoCliente] = useState(false);

    // ── Forma de pago, en la franja de arriba ──
    // En la caja el tipo de pago se elige ANTES de cobrar, junto al cliente;
    // aquí vivía escondido dentro del cobro. Una sola forma se elige aquí; el
    // pago dividido se arma en el cobro (F2) y aquí sólo se nombra.
    const opcionesPago = [...FORMA_PAGO, ...(tieneCredito ? [{ value: '13', label: 'A crédito', sublabel: `${cliente.plazo_dias} días · hasta ${formatMoney(cliente.limite_credito)}` }] : [])];
    const cambiarFormaPago = (v) => {
        const forma = v || '01';
        setPagos([filaNueva(forma)]);
        setPagoAbierto(null);
        if (forma === '13' && !plazo) setPlazo(String(cliente?.plazo_dias ?? ''));
    };
    const rotuloPago = pagos.length > 1 ? `Pago dividido en ${pagos.length} formas`
        : pagos[0].forma === '13' ? `A crédito · ${plazo || cliente?.plazo_dias || 0} días`
        : `Contado · ${FORMA_PAGO.find(f => f.value === pagos[0].forma)?.label ?? ''}`;

    // ── Borrar (F6), como en la caja ──
    // Una preventa abierta se ANULA: deja de salir en Pendientes y queda en
    // Pedidos con su motivo (la caja la borra; aquí queda el rastro). Si
    // esperaba un descuento, la base cancela la solicitud (borrador 0009). En
    // una venta nueva no hay nada guardado: F6 la vacía.
    const puedeBorrarPreventa = corrigiendo && !!pedido && !pedido.pedido.reemplaza_dte_id && puedeVender;
    const hayAlgo = !!clienteId || carrito.length > 0;
    const abrirBorrar = () => { setMotivoBorrar(''); setVerBorrar(true); };
    const confirmarBorrar = async () => {
        if (borrando) return;
        if (!corrigiendo) {
            descartar();
            empezarOtra();
            setVerBorrar(false);
            return;
        }
        const id = pedido.pedido.id;
        setBorrando(true);
        try {
            await anularPedido(id, motivoBorrar.trim() || 'Preventa borrada desde la venta');
            useStaff.getState().appendAuditLog('DISTRIBUCION_PEDIDO_ANULADO', String(id), { desde: 'venta' });
            showToast('Preventa borrada', `La venta ${id} ya no sale en Pendientes.`);
            setVerBorrar(false);
            empezarOtra();
            navigate(rutaVenta(), { replace: true });
        } catch (e) {
            setVerBorrar(false);
            setError(mensajeDeDistribucion(e));
        } finally {
            setBorrando(false);
        }
    };

    // Cliente nuevo sin salir de la venta (la caja tiene «Agregar» al lado
    // del cliente): se crea, se relee la lista y queda elegido.
    const alCrearCliente = async (id) => {
        setNuevoCliente(false);
        try {
            const cs = await fetchClientes();
            setClientes(cs);
            if (id) cambiarCliente(String(id), cs);
        } catch (e) {
            showToast('Cliente guardado', `No se pudo releer la lista (${mensajeDeDistribucion(e)}). Búscalo de nuevo.`, 'warning');
        }
    };

    // Las preventas por finalizar se releen solas cada minuto (la caja lo hace
    // cada 30 s) y al abrir la lista: otro vendedor pudo guardar una.
    const releerPendientes = useCallback(() => {
        fetchPedidos({ estados: ['confirmado'], desde: sumarDias(hoySV(), -60) })
            .then(setPendientes).catch(e => console.error('venta: pendientes', e));
    }, []);
    useEffect(() => {
        if (corrigiendo) return undefined;
        const t = setInterval(releerPendientes, 60000);
        return () => clearInterval(t);
    }, [corrigiendo, releerPendientes]);

    const titulo = corrigiendo
        ? (pedido?.pedido.reemplaza_dte_id ? `Corregir documento (pedido ${pedidoIdParam})` : `Finalizar venta ${pedidoIdParam}`)
        : 'Nueva venta';

    const headerLeft = (
        <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" iconOnly icon={ArrowLeft} title="Volver a Pedidos (F4)" onClick={() => navigate(rutaInicio())} />
            <h2 className="font-black text-body text-content tracking-tight leading-tight truncate">{titulo}</h2>
        </div>
    );

    // A la derecha del encabezado: las preventas por finalizar, a un toque.
    // Antes eran una tarjeta grande arriba de todo, que empujaba la venta
    // hacia abajo cada vez que se abría la pantalla.
    const accionesEncabezado = !corrigiendo && pendientes?.length > 0 ? (
        <Button size="sm" variant="secondary" icon={ListChecks} onClick={() => { setVerPendientes(true); releerPendientes(); }}>
            Pendientes <Badge size="sm" variant="warning" uppercase={false}>{pendientes.length}</Badge>
        </Button>
    ) : null;

    // El botón principal ABRE EL COBRO (F2): la venta se arma en la página y se
    // cobra en una ventana donde sólo queda el monto y Enter procesa (pedido del
    // usuario). Con un descuento por aprobar, la ventana pide el motivo.
    const abrirCobro = () => {
        setAvisoCobro('');
        setVerCobro(true);
    };

    // Procesar desde la ventana de cobro: Enter o F2.
    const procesar = () => {
        if (guardando) return;
        if (porAprobar.length) { guardar('aprobacion'); return; }
        if (!listo) { setAvisoCobro(bloqueo ?? 'Revisa el cobro.'); return; }
        guardar('facturar');
    };
    const alTecladoCobro = (e) => {
        if (e.key !== 'Enter' && e.key !== 'F2') return;
        if (e.key === 'Enter' && e.shiftKey) return;
        const t = e.target;
        if (t.tagName === 'TEXTAREA' && e.key === 'Enter') return;        // en observaciones, Enter es salto de línea
        if (t.getAttribute?.('aria-expanded') === 'true' || t.closest?.('[role="listbox"]')) return; // el menú abierto elige
        if (t.tagName === 'BUTTON' && e.key === 'Enter' && !t.dataset.procesar) return; // un botón hace lo suyo
        e.preventDefault();
        e.stopPropagation();
        procesar();
    };
    // Al abrir: el foco al monto. Con efectivo solo, «Entrega»; con el pago
    // dividido, el primer monto; con descuento por aprobar, el motivo.
    useEffect(() => {
        if (!verCobro) return undefined;
        const t = setTimeout(() => {
            const caja = document.querySelector('[data-cobro-ventana]');
            const campo = porAprobarRef.current
                ? caja?.querySelector('input[name="motivo-descuento"]')
                : caja?.querySelector('input[name^="monto-pago-"]') ?? caja?.querySelector('input[name^="recibido-pago-"]');
            if (campo) { campo.focus(); campo.select?.(); } else caja?.querySelector('[data-procesar]')?.focus();
        }, 80);
        return () => clearTimeout(t);
    }, [verCobro]);

    const qPendiente = buscarPendiente.trim();
    const listaPendientes = (pendientes ?? []).filter(p => !qPendiente || tokenMatch(qPendiente, p.dist_clientes?.nombre, String(p.id)));

    return (
        // Sin el encabezado de vista (pedido del usuario: «para tener más
        // espacio»): el título y las acciones viven en la franja del cliente.
        // Este contenedor hace lo que hacía GlassViewLayout con el desplazamiento:
        // en computadora scrollea él; en el teléfono, el documento.
        <div className="lg:h-full lg:overflow-y-auto lg:overscroll-contain scroll-smooth">
            <div className="p-3 md:p-4 pb-40 lg:pb-4 flex flex-col gap-3 min-h-full">
                {errorCarga && <Notice variant="danger" icon={AlertTriangle}>{errorCarga}</Notice>}
                {cargando && !errorCarga && <p className="text-caption text-content-3">Cargando…</p>}
                {!cargando && !errorCarga && (
                    <>
                    {/* La venta a la izquierda; el resumen fiscal y los botones en una
                        columna fija a la derecha (pedido del usuario): siempre a la
                        vista y sin tapar ningún producto. En el teléfono, la barra de abajo. */}
                    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-4 lg:items-start">
                    <div className="flex flex-col gap-3 min-w-0">
                        {error && <Notice variant="danger" bloque>{error}</Notice>}
                        {esperandoAprobacion && (
                            <Notice variant="warning" icon={Clock} compact>
                                Esta venta espera la aprobación de un descuento. Al guardarla, la solicitud se pone al día.
                            </Notice>
                        )}

                        {/* ── Quién compra: una sola franja ── */}
                        {/* Se acomoda al ancho de SU tarjeta (container query): con la
                            columna del resumen al lado, el ancho de la pantalla ya no dice
                            cuánto lugar hay. */}
                        <section data-surface="card" className="@container p-3 md:p-4 flex flex-col gap-2.5">
                            {/* Dos filas, como el encabezado de la caja: arriba el título,
                                lo que hay que saber del cliente y las acciones; abajo, lo que
                                se elige — cliente, documento, lista y forma de pago. */}
                            <div className="flex items-center justify-between gap-2 -mt-1 min-w-0">
                                <div className="flex items-center gap-x-2 gap-y-1 min-w-0 flex-wrap">
                                    {headerLeft}
                                    {cliente && !cliente.contribuyente && <Badge size="sm" variant="neutral" uppercase={false}>Sin NRC: sólo Factura</Badge>}
                                    {cliente?.gran_contribuyente && tipoDoc === '03' && <Badge size="sm" variant="warning" uppercase={false}>Retiene 1%</Badge>}
                                    {cliente && soloVentaLibre(cliente.tipo) && <Badge size="sm" variant="neutral" uppercase={false}>Sólo venta libre</Badge>}
                                    {tieneCredito && <Badge size="sm" variant="neutral" uppercase={false}>Crédito {formatMoney(cliente.limite_credito)} · {cliente.plazo_dias} días</Badge>}
                                    {cliente?.lista_id && String(cliente.lista_id) !== String(listaEfectiva) && <Badge size="sm" variant="warning" uppercase={false}>Lista distinta de la del cliente</Badge>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <Button size="sm" variant="ghost" icon={Warehouse} title="Existencias en todas las sucursales (F7)"
                                        onClick={() => setVerExistencias(buscar || '')}>
                                        <span className="hidden @lg:inline">Existencias</span> <kbd aria-hidden="true" className="hidden @lg:inline text-micro font-bold opacity-60">F7</kbd>
                                    </Button>
                                    {/* Como el botón de la caja: lo que pidieron y no hay. */}
                                    {puedeVender && emisor && (
                                        <Button size="sm" variant="ghost" icon={PackageX} title="Anotar una venta perdida (F9)" data-accion-perdida
                                            onClick={() => setPerdida({ buscado: buscar, cantidad: 1 })}>
                                            <span className="hidden @2xl:inline">Venta perdida</span> <kbd aria-hidden="true" className="hidden @2xl:inline text-micro font-bold opacity-60">F9</kbd>
                                        </Button>
                                    )}
                                    {(corrigiendo ? puedeBorrarPreventa : hayAlgo) && (
                                        <Button size="sm" variant="ghost" icon={Eraser} data-accion-borrar onClick={abrirBorrar}
                                            title={corrigiendo ? 'Borrar esta preventa (F6)' : 'Vaciar la venta (F6)'}>
                                            <span className="hidden @lg:inline">{corrigiendo ? 'Borrar' : 'Vaciar'}</span> <kbd aria-hidden="true" className="hidden @lg:inline text-micro font-bold opacity-60">F6</kbd>
                                        </Button>
                                    )}
                                    {accionesEncabezado}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 @xl:grid-cols-[minmax(0,1fr)_auto] @4xl:grid-cols-[minmax(0,1fr)_auto_minmax(9rem,12rem)_minmax(10rem,14rem)] gap-2.5 items-center">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <div className="flex-1 min-w-0">
                                        <LiquidSelect value={clienteId} onChange={(v) => cambiarCliente(v)} options={opcionesClientes} icon={Store}
                                            placeholder="Elegir cliente…" clearable={false} disabled={corrigiendo} ariaLabel="Cliente" />
                                    </div>
                                    {!corrigiendo && puedeVender && (
                                        <Button variant="ghost" iconOnly icon={UserPlus} title="Cliente nuevo" onClick={() => setNuevoCliente(true)} />
                                    )}
                                </div>
                                <SegmentedControl value={tipoDoc} onChange={setTipoDoc} label="Documento"
                                    options={[
                                        { value: '01', label: TIPO_DOCUMENTO['01'].largo },
                                        { value: '03', label: TIPO_DOCUMENTO['03'].largo, disabled: !cliente?.contribuyente },
                                    ]} />
                                {/* Lista y pago: una fila propia a media anchura; en pantalla
                                    ancha, cada uno su columna junto al cliente. */}
                                <div className="@xl:col-span-2 @4xl:contents grid grid-cols-1 @lg:grid-cols-2 gap-2.5">
                                <div className="min-w-0">
                                    <LiquidSelect value={listaEfectiva != null ? String(listaEfectiva) : ''} onChange={cambiarLista} icon={Tag}
                                        options={opcionesListas} placeholder="Sin listas" clearable={false} disabled={!opcionesListas.length}
                                        sublabelSoloEnMenu ariaLabel="Lista de precios (cambia el precio de todos los productos)" />
                                </div>
                                <div className="min-w-0" data-testid="forma-pago">
                                    {pagos.length > 1 ? (
                                        <Button variant="secondary" icon={Split} onClick={abrirCobro} disabled={!puedeGuardar} className="w-full justify-center">
                                            Pago dividido · {pagos.length}
                                        </Button>
                                    ) : (
                                        <LiquidSelect value={pagos[0].forma} onChange={cambiarFormaPago} options={opcionesPago} icon={Wallet}
                                            clearable={false} disabled={!cliente} sublabelSoloEnMenu ariaLabel="Forma de pago" />
                                    )}
                                </div>
                                </div>
                            </div>
                            {sinLicencia && (
                                <Notice variant="danger" icon={ShieldAlert} compact>
                                    {licenciaVencida ? 'La licencia de la SRS de este cliente está vencida.' : 'Este cliente no tiene licencia de la SRS registrada.'}
                                </Notice>
                            )}
                        </section>

                        {/* ── Qué se lleva ──
                            Con la lista del buscador abierta, la tarjeta sube (`z-dropdown`)
                            para que la lista flote por encima de lo de abajo. SÓLO mientras
                            está abierta: siempre arriba, en el teléfono tapaba la barra fija
                            del total y los botones. */}
                        <section data-surface="card" className={`relative ${buscar.trim() && cliente ? 'z-dropdown' : ''} p-3 md:p-4 flex flex-col gap-3`}>
                            <div className="relative">
                                <PortalInput ref={buscador} icon={Search} name="buscar-producto" value={buscar}
                                    placeholder={cliente ? 'Producto o código de barras (F3)' : 'Elige primero el cliente'}
                                    aria-label="Buscar producto" disabled={!cliente}
                                    onChange={(e) => { setBuscar(e.target.value); setResaltado(0); }}
                                    onKeyDown={(e) => {
                                        // ↑ ↓ recorren los resultados; Enter agrega el resaltado.
                                        if (e.key === 'ArrowDown' && resultados.length) { e.preventDefault(); setResaltado(i => Math.min(i + 1, resultados.length - 1)); }
                                        if (e.key === 'ArrowUp' && resultados.length) { e.preventDefault(); setResaltado(i => Math.max(i - 1, 0)); }
                                        if (e.key === 'Enter' && resultados[resaltado]) { e.preventDefault(); agregar(resultados[resaltado]); }
                                        if (e.key === 'Escape') setBuscar('');
                                    }} />
                                {/* Los resultados flotan sobre la lista (no la empujan) y con la
                                    superficie OPACA de los menús del portal: con la de tarjeta se
                                    veía lo de atrás a través. */}
                                {buscar.trim() && cliente && (
                                    <div data-surface="dropdown" className="absolute z-dropdown left-0 right-0 top-full mt-1 overflow-hidden max-h-[24rem] overflow-y-auto rounded-2xl" role="listbox" aria-label="Productos encontrados">
                                        {resultados.length === 0 && (
                                            <p className="px-4 py-3 text-caption text-content-3 flex items-center gap-2">
                                                <PackageX size={14} /> Nada que coincida{soloVentaLibre(cliente.tipo) ? ' entre los productos de venta libre' : ''}.
                                                <button type="button" className="font-bold text-brand-text underline" onClick={() => setVerExistencias(buscar)}>Buscar en todas las sucursales (F7)</button>
                                                <button type="button" className="font-bold text-warning-text underline" data-anotar-perdida
                                                    onClick={() => { setPerdida({ buscado: buscar, cantidad: 1 }); setBuscar(''); }}>Anotar venta perdida</button>
                                            </p>
                                        )}
                                        {resultados.map((p, k) => {
                                            const pres = presentacionesDe(idx, p.product_id);
                                            const r = precioDe(idx, p, pres[0].presentacion, listaEfectiva);
                                            const hay = existencias?.get(String(p.product_id));
                                            const activo = k === resaltado;
                                            return (
                                                <button key={p.product_id} type="button" role="option" aria-selected={activo}
                                                    onMouseEnter={() => setResaltado(k)} onClick={() => agregar(p)}
                                                    className={`w-full grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 min-h-[max(48px,var(--tap-min))] py-2 text-left border-b border-divider last:border-b-0 transition-colors ${activo ? 'bg-brand/10' : ''}`}>
                                                    <span className="min-w-0">
                                                        <span className="block text-body-sm font-bold text-content truncate">{p.nombre}</span>
                                                        <span className="block text-caption text-content-3 truncate">
                                                            {pres.map(x => x.presentacion).join(' · ')}
                                                            {hay != null && <span className={hay > 0 ? '' : 'text-danger-text font-bold'}> · {hay > 0 ? `hay ${hay}` : 'sin existencia'}</span>}
                                                        </span>
                                                    </span>
                                                    <span className="flex items-center gap-2 shrink-0">
                                                        <span className="text-body-sm font-black text-content tabular-nums">{r ? formatMoney(visto(r.precio)) : 'Sin precio'}</span>
                                                        {activo && <kbd className="hidden md:inline text-micro font-bold text-content-3 border border-divider rounded px-1">Enter</kbd>}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {lineas.length === 0 ? (
                                <div className="py-8 flex flex-col items-center gap-1.5 text-center">
                                    <Package size={26} className="text-content-3" />
                                    <p className="text-body-sm font-bold text-content-2">{cliente ? 'Agrega productos' : 'Elige el cliente para empezar'}</p>
                                    <p className="text-caption text-content-3">
                                        {cliente ? 'Escribe el nombre o escanea el código de barras.' : 'Lo que se le puede vender depende de él.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="@container rounded-xl border border-divider overflow-hidden" onKeyDownCapture={navegarRenglones}>
                                    <div className={`hidden @4xl:grid ${COLUMNAS} gap-2 px-3 py-2 border-b border-divider bg-surface-card-hover/40 text-micro font-bold uppercase tracking-wide text-content-3`}>
                                        <span>Producto</span><span className="text-center">Cantidad</span><span>Presentación</span>
                                        <span>Precio {conIva ? 'c/IVA' : 's/IVA'} · lista</span><span>Descuento</span>
                                        <span className="text-right">Importe</span><span />
                                    </div>
                                    {lineas.map((l, k) => {
                                        const nombre = l.p?.nombre ?? `Producto ${l.product_id}`;
                                        // Una presentación ya tomada por OTRO renglón del mismo producto y
                                        // el mismo lote no se ofrece (serían dos renglones iguales). En otro
                                        // lote sí: es el reparto por vencimiento.
                                        const ocupadas = new Set(lineas.filter(o => o.clave !== l.clave && o.product_id === l.product_id
                                            && String(o.lote_id ?? '') === String(l.lote_id ?? '')).map(o => o.presentacion));
                                        // Lo elegido se muestra CORTO («PAQUETE», «$30.18»): así no se
                                        // corta. Lo que falta (las unidades, la lista) va en la línea del
                                        // producto y en el menú abierto (`sublabel`).
                                        const opcPres = l.presentaciones
                                            .filter(x => !ocupadas.has(x.presentacion))
                                            .map(x => ({ value: x.presentacion, label: x.presentacion, sublabel: x.unidades > 1 ? `${x.unidades} unidades` : undefined }));
                                        const opcListas = l.p ? listasDe(idx, l.p.product_id, l.presentacion).map(x => {
                                            const pr = precioDe(idx, l.p, l.presentacion, x.id);
                                            return { value: String(x.id), label: formatMoney(visto(pr?.precio ?? 0)), sublabel: `Lista ${x.nombre}` };
                                        }) : [];
                                        const nombreLista = l.r?.listaId != null ? idx.listas.find(x => x.id === l.r.listaId)?.nombre : null;
                                        const porPresentacion = l.presentaciones.find(x => x.presentacion === l.presentacion)?.unidades ?? 1;
                                        const errDesc = l.descMalo ? 'No es un número' : l.pasaImporte ? 'Pasa del importe' : null;
                                        return (
                                            <div key={l.clave} data-renglon={l.product_id} data-fila={k}
                                                className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLUMNAS} gap-x-2 gap-y-2 items-center px-3 py-2 border-b border-divider last:border-b-0 focus-within:bg-brand/5 ${l.porAprobar ? 'bg-warning/5' : ''}`}>
                                                {/* Producto */}
                                                <div className="min-w-0">
                                                    <p className="text-body-sm font-bold text-content truncate" title={nombre}>{nombre}</p>
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-content-3">
                                                        {/* El total en existencia y lo del lote (pedido del usuario). */}
                                                        {l.hay != null && <span>Total {l.hay}</span>}
                                                        {/* El lote: el que vence primero, salvo que se elija otro. */}
                                                        {l.libres.length > 1 ? (
                                                            <span data-col="2" className="inline-flex items-center gap-1" data-testid="lote-renglon">
                                                                Lote
                                                                <span className="inline-block w-32">
                                                                    <LiquidSelect nano sublabelSoloEnMenu value={l.lote ? String(l.lote.id) : ''} clearable={false}
                                                                        options={l.libres.map(x => ({ value: String(x.id), label: x.lote, sublabel: `vence ${mesVence(x.vence)} · hay ${x.libre} u.`, disabled: x.libre < l.por && x.id !== l.lote?.id }))}
                                                                        ariaLabel={`Lote de ${nombre}`} onChange={(v) => v && cambiarYRepartir(l.clave, { lote_id: Number(v) })} />
                                                                </span>
                                                            </span>
                                                        ) : l.lote ? (
                                                            <span data-testid="lote-renglon">Lote {l.lote.lote}</span>
                                                        ) : existencias && <span className="text-danger-text font-bold">Sin lote</span>}
                                                        {l.lote && (
                                                            <span className={l.faltaExistencia ? 'text-danger-text font-bold' : ''}>
                                                                {l.libreLote} u. · vence {mesVence(l.lote.vence)}
                                                            </span>
                                                        )}
                                                        {l.faltaExistencia && (
                                                            <>
                                                                <span className="text-danger-text font-bold">Faltan {l.faltan}</span>
                                                                <button type="button" className="font-bold text-warning-text underline min-h-[var(--tap-min)]"
                                                                    onClick={() => setPerdida({
                                                                        producto: { product_id: l.product_id, nombre, motivo: l.hay ? `Sólo hay ${l.hay} en existencia` : 'Sin existencia en ningún lote' },
                                                                        cantidad: l.faltan, clave: l.clave,
                                                                    })}>
                                                                    Anotar venta perdida
                                                                </button>
                                                            </>
                                                        )}
                                                        {porPresentacion > 1 && <span>{l.presentacion} de {porPresentacion} u.</span>}
                                                        {nombreLista && <span className={l.otraLista ? 'text-brand-text font-bold' : ''}>Lista {nombreLista}</span>}
                                                        {l.noVa && <span className="text-danger-text font-bold">No se le vende a este cliente</span>}
                                                        {l.sinPrecio && <span className="text-danger-text font-bold">Sin precio en esta presentación</span>}
                                                        {l.porAprobar && <span className="text-warning-text font-bold">Descuento por aprobar</span>}
                                                        {!l.porAprobar && l.descEstado === 'rechazado' && !l.descValor && <span>Descuento rechazado</span>}
                                                    </div>
                                                </div>
                                                <div className="@4xl:hidden text-right">
                                                    <p className="tabular-nums font-black text-content">{formatMoney(l.doc?.importe ?? 0)}</p>
                                                </div>

                                                {/* Teléfono: cantidad | presentación, precio | descuento, quitar.
                                                    Pantalla ancha: cada control en su columna (`contents`). El
                                                    orden es el de Tab y ← →: cantidad primero, que es lo que se
                                                    escribe al agregar. */}
                                                <div className="col-span-2 grid grid-cols-2 @lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_6.5rem_auto] gap-2 items-center @4xl:contents">
                                                    {/* Cantidad */}
                                                    <div data-col="0" className="flex items-center gap-1 justify-center">
                                                        <Button variant="ghost" size="sm" iconOnly icon={Minus} title="Uno menos" tabIndex={-1}
                                                            disabled={(l.n ?? 0) <= 1} onClick={() => sumar(l.clave, -1)} />
                                                        <PortalInput compact className="w-16" inputClassName="text-center font-black" name={`cantidad-${l.clave}`} inputMode="decimal"
                                                            value={l.cantidad} aria-label={`Cantidad de ${nombre}`} hasError={!l.n || l.n <= 0}
                                                            onKeyDown={alEnterVolverAlBuscador} onFocus={(e) => e.target.select()}
                                                            onBlur={() => cambiarYRepartir(l.clave, {})}
                                                            onChange={(e) => cambiar(l.clave, { cantidad: soloNumero(e.target.value) })} />
                                                        <Button variant="ghost" size="sm" iconOnly icon={Plus} title="Uno más" tabIndex={-1} onClick={() => sumar(l.clave, 1)} />
                                                    </div>
                                                    {/* Presentación */}
                                                    <div data-col="1" className="min-w-0">
                                                        <LiquidSelect compact sublabelSoloEnMenu icon={Package} value={l.presentacion} options={opcPres} clearable={false}
                                                            disabled={opcPres.length <= 1} ariaLabel={`Presentación de ${nombre}`}
                                                            onChange={(v) => v && cambiarYRepartir(l.clave, { presentacion: v, lista_id: '' })} />
                                                    </div>
                                                    {/* Precio · lista */}
                                                    <div data-col="3" className="min-w-0" data-testid="precio-renglon">
                                                        {opcListas.length > 1 ? (
                                                            <LiquidSelect compact sublabelSoloEnMenu icon={Tag} value={l.r?.listaId != null ? String(l.r.listaId) : ''} options={opcListas} clearable={false}
                                                                ariaLabel={`Precio y lista de ${nombre}`}
                                                                onChange={(v) => cambiar(l.clave, { lista_id: v && Number(v) !== listaEfectiva ? v : '' })} />
                                                        ) : (
                                                            <p className="h-8 flex items-center text-body-sm font-bold tabular-nums text-content-2 px-2">
                                                                {l.r ? formatMoney(l.doc?.precioUni ?? visto(l.r.precio)) : '—'}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {/* Descuento */}
                                                    <div data-col="4" className="flex items-center gap-1 min-w-0">
                                                        <PortalInput compact className="flex-1 min-w-0" inputClassName="text-right" name={`descuento-${l.clave}`} inputMode="decimal" value={l.descValor}
                                                            placeholder="0" aria-label={`Descuento de ${nombre}`} hasError={!!errDesc} errorMessage={errDesc ?? undefined}
                                                            onKeyDown={alEnterVolverAlBuscador} onFocus={(e) => e.target.select()}
                                                            onChange={(e) => cambiar(l.clave, { descValor: soloNumero(e.target.value) })} />
                                                        {/* % / $ como un botón que alterna: la mitad de ancho que
                                                            el control de dos opciones, y no se roba las flechas. */}
                                                        <Button variant="secondary" size="sm" tabIndex={-1} className="w-9 shrink-0 font-black"
                                                            title={l.descTipo === 'pct' ? 'En porcentaje (tocar para pasar a $)' : 'En dólares (tocar para pasar a %)'}
                                                            onClick={() => cambiar(l.clave, { descTipo: l.descTipo === 'pct' ? 'monto' : 'pct', descValor: '' })}>
                                                            {l.descTipo === 'pct' ? '%' : '$'}
                                                        </Button>
                                                    </div>
                                                    {/* Importe */}
                                                    <div className="hidden @4xl:block text-right tabular-nums">
                                                        <p className="font-black text-content">{formatMoney(l.doc?.importe ?? 0)}</p>
                                                        {l.doc?.descuento > 0 && <p className="text-micro text-success-text">−{formatMoney(l.doc.descuento)}</p>}
                                                        {l.porAprobar && <p className="text-micro text-warning-text">−{formatMoney(conIva ? l.desc : l.desc / 1.13)} por aprobar</p>}
                                                    </div>
                                                    <div data-col="5" className="col-span-2 @lg:col-span-1 flex justify-end">
                                                        <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la venta (Supr)" onClick={() => quitar(l.clave)} />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {lineas.length > 0 && (
                                <p className="hidden md:block lg:hidden text-micro text-content-3">
                                    Tab o ← → cambian de campo · ↑ ↓ cambian de producto · Supr quita el producto · F7 existencias en todas las sucursales
                                </p>
                            )}
                        </section>

                    </div>

                    {/* ── El resumen: columna fija a la derecha (computadora) ── */}
                    <aside className="hidden lg:flex flex-col gap-3 lg:sticky lg:top-0" aria-label="Resumen de la venta">
                        <section data-surface="card" className="p-4 flex flex-col gap-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <h3 className="text-body font-black text-content">Resumen</h3>
                                <span className="text-caption text-content-3">{TIPO_DOCUMENTO[tipoDoc]?.largo}</span>
                            </div>
                            <p className={`text-caption ${bloqueoGuardar ? 'text-content-2' : 'text-content-3'}`}>
                                {bloqueoGuardar ?? `${lineas.length} producto${lineas.length === 1 ? '' : 's'} · ${conCantidad(unidadesTotal)} pieza${unidadesTotal === 1 ? '' : 's'}`}
                            </p>
                            {cliente && <p className="text-caption font-bold text-content-2 -mt-1.5">{rotuloPago}</p>}
                            <DesgloseFiscal venta={venta} conIva={conIva} porAprobar={montoPorAprobar} />
                            <div className="flex flex-col gap-2 pt-1">
                                <Button variant="primary" icon={porAprobar.length ? Send : Wallet} disabled={!puedeGuardar}
                                    data-accion-principal onClick={abrirCobro} title="F2" className="w-full justify-center">
                                    {porAprobar.length ? 'Enviar a aprobación' : 'Cobrar'} <kbd aria-hidden="true" className="ml-1 text-micro font-bold opacity-70">F2</kbd>
                                </Button>
                                <Button variant="secondary" icon={guardando === 'preventa' ? Loader2 : Save} disabled={!puedeGuardar}
                                    data-accion-preventa title="Guardar sin facturar: queda en Pendientes (F8)" onClick={() => guardar('preventa')} className="w-full justify-center">
                                    Guardar preventa <kbd aria-hidden="true" className="ml-1 text-micro font-bold opacity-60">F8</kbd>
                                </Button>
                            </div>
                        </section>
                        <section data-surface="card" className="p-3 flex flex-col gap-2" aria-label="Teclas rápidas">
                            <p className="text-micro font-bold uppercase tracking-wide text-content-3">Teclas</p>
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 items-center text-caption">
                                {TECLAS.map(([k, t]) => (
                                    <React.Fragment key={k}>
                                        <dt><kbd className="text-micro font-bold text-content-2 border border-divider rounded px-1.5 py-0.5 whitespace-nowrap">{k}</kbd></dt>
                                        <dd className="text-content-3 truncate">{t}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </section>
                    </aside>
                    </div>

                    {/* ── Teléfono y tableta: la barra de abajo ── */}
                    <div ref={barra} data-surface="card"
                        className="lg:hidden fixed inset-x-0 bottom-0 z-tabs px-4 pt-3 pb-[max(12px,var(--sa-bottom))] flex flex-col gap-2">
                        <div className="flex items-end justify-between gap-3 min-w-0">
                            <div className="min-w-0">
                                <p className={`text-caption truncate ${bloqueoGuardar ? 'text-content-2' : 'text-content-3'}`}>
                                    {bloqueoGuardar ?? `${lineas.length} producto${lineas.length === 1 ? '' : 's'} · ${conCantidad(unidadesTotal)} pieza${unidadesTotal === 1 ? '' : 's'}`}
                                </p>
                                {!bloqueoGuardar && (
                                    <p className="text-micro text-content-3 tabular-nums truncate">
                                        {conIva ? `IVA incluido ${formatMoney(venta.iva)}` : `Sub-total ${formatMoney(venta.subTotal)} · IVA ${formatMoney(venta.iva)}`}
                                        {venta.retencion > 0 && ` · retención −${formatMoney(venta.retencion)}`}
                                        {venta.percepcion > 0 && ` · percepción ${formatMoney(venta.percepcion)}`}
                                    </p>
                                )}
                            </div>
                            <p className="text-title font-black text-brand-text tabular-nums shrink-0" data-testid="total-barra">{formatMoney(venta.total)}</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" icon={guardando === 'preventa' ? Loader2 : Save} disabled={!puedeGuardar}
                                onClick={() => guardar('preventa')} className="flex-1">
                                Guardar preventa
                            </Button>
                            <Button variant="primary" icon={porAprobar.length ? Send : Wallet} disabled={!puedeGuardar}
                                onClick={abrirCobro} className="flex-1">
                                {porAprobar.length ? 'Enviar a aprobación' : 'Cobrar'}
                            </Button>
                        </div>
                    </div>
                    </>
                )}
            </div>

            {/* ── La ventana de cobro (F2) ──
                Todo lo demás queda detrás: sólo el monto, y Enter procesa. */}
            {verCobro && cliente && lineas.length > 0 && (
                <LiquidModal open onClose={guardando ? undefined : () => setVerCobro(false)} maxWidth="max-w-3xl" ariaLabel="Cobrar">
                    <LiquidModal.Header>
                        <div className="flex items-center justify-between gap-3 w-full">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <Wallet size={18} className="text-brand-text shrink-0" />
                                <h2 className="text-title font-black text-content truncate">{porAprobar.length ? 'Enviar a aprobación' : 'Cobrar'} · {cliente.nombre}</h2>
                            </div>
                            <p className="text-display font-black text-brand-text tabular-nums shrink-0">{formatMoney(estimado.total)}</p>
                        </div>
                    </LiquidModal.Header>
                    <LiquidModal.Body>
                        <div data-cobro-ventana onKeyDownCapture={alTecladoCobro}
                            className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_17rem] gap-4 items-start">
                            <div className="flex flex-col gap-3 min-w-0" data-cobro>
                                {porAprobar.length > 0 && (
                                    <div className="rounded-xl border border-warning/40 bg-warning/5 p-3 flex flex-col gap-2">
                                        <p className="text-body-sm text-content-2 flex items-start gap-2">
                                            <Tag size={16} className="text-warning-text shrink-0 mt-0.5" />
                                            <span>
                                                <b>{formatMoney(montoPorAprobar)}</b> de descuento necesita{porAprobar.length === 1 ? '' : 'n'} aprobación
                                                {puedeDescontar ? ` (pasa del tope de ${topeDescuento}%)` : ''}. Se guarda como preventa, sin el descuento, y se actualiza sola al aprobarse.
                                            </span>
                                        </p>
                                        <PortalInput label="¿Por qué el descuento? (lo ve quien aprueba)" name="motivo-descuento" value={motivoDescuento}
                                            onChange={(e) => setMotivoDescuento(e.target.value)}
                                            placeholder="Ej.: cliente nuevo, compra de volumen, igualar precio de la competencia" />
                                    </div>
                                )}
                                {!porAprobar.length && (
                                    <FormasDePago filas={pagos} setFilas={setPagos} total={estimado.total} cliente={cliente}
                                        plazo={plazo} setPlazo={setPlazo} abierto={pagoAbierto} setAbierto={setPagoAbierto} />
                                )}
                                {excedeCredito && (
                                    <Notice variant="warning" compact>Pasa del crédito aprobado del cliente ({formatMoney(cliente.limite_credito)}).</Notice>
                                )}
                                {verNotas ? (
                                    <PortalTextarea label="Observaciones" name="notas" value={notas} rows={2} compact
                                        onChange={(e) => setNotas(e.target.value)} placeholder="Sale impresa en el documento." />
                                ) : (
                                    <div><Button size="sm" variant="ghost" icon={Plus} tabIndex={-1} onClick={() => setVerNotas(true)}>Observaciones</Button></div>
                                )}
                            </div>
                            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-3 flex flex-col gap-1.5">
                                <DesgloseFiscal venta={venta} conIva={conIva} porAprobar={montoPorAprobar} />
                                {cambio > 0 && (
                                    <div className="flex items-baseline justify-between gap-3 rounded-xl bg-success/10 px-3 py-1.5 mt-1">
                                        <span className="text-body-sm font-bold text-success-text">Cambio</span>
                                        <span className="text-display font-black text-success-text tabular-nums">{formatMoney(cambio)}</span>
                                    </div>
                                )}
                                {!porAprobar.length && (
                                    <div className="pt-1">
                                        <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el ticket al facturar" />
                                    </div>
                                )}
                            </div>
                        </div>
                        {(avisoCobro || error) && <Notice variant="danger" compact className="mt-3">{error || avisoCobro}</Notice>}
                    </LiquidModal.Body>
                    <LiquidModal.Footer>
                        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
                            <p className="mr-auto text-caption text-content-3 hidden sm:block">Enter procesa · Esc vuelve a la venta</p>
                            <Button variant="ghost" onClick={() => setVerCobro(false)} disabled={!!guardando}>Volver</Button>
                            {!porAprobar.length && (
                                <Button variant="secondary" icon={guardando === 'preventa' ? Loader2 : Save} disabled={!puedeGuardar}
                                    onClick={() => guardar('preventa')}>Guardar preventa</Button>
                            )}
                            <Button variant="primary" data-procesar="1" icon={guardando ? Loader2 : (porAprobar.length ? Send : (imprimir ? Printer : Receipt))}
                                disabled={!!guardando} onClick={procesar}>
                                {porAprobar.length ? 'Enviar a aprobación' : (imprimir ? 'Facturar e imprimir' : 'Facturar')}
                                <kbd aria-hidden="true" className="hidden sm:inline ml-1 text-micro font-bold opacity-70">Enter</kbd>
                            </Button>
                        </div>
                    </LiquidModal.Footer>
                </LiquidModal>
            )}
            {verBorrar && (
                <LiquidModal open onClose={borrando ? undefined : () => setVerBorrar(false)} maxWidth="max-w-md"
                    ariaLabel={corrigiendo ? 'Borrar preventa' : 'Vaciar la venta'}>
                    <LiquidModal.Header>
                        <div className="flex items-center gap-2.5 min-w-0">
                            <Eraser size={18} className="text-danger-text shrink-0" />
                            <h2 className="text-title font-black text-content">{corrigiendo ? `Borrar la preventa ${pedido?.pedido.id}` : 'Vaciar la venta'}</h2>
                        </div>
                    </LiquidModal.Header>
                    <LiquidModal.Body>
                        <div className="flex flex-col gap-3" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmarBorrar(); } }}>
                            <p className="text-body-sm text-content-2">
                                {corrigiendo
                                    ? <>La venta de <b>{cliente?.nombre}</b> por <b>{formatMoney(venta.total)}</b> deja de salir en Pendientes. Queda anulada en Pedidos, con el motivo{esperandoAprobacion ? ', y se cancela la solicitud de descuento' : ''}.</>
                                    : <>Se quitan el cliente y {carrito.length === 1 ? 'el producto' : `los ${carrito.length} productos`}. Todavía no se había guardado nada.</>}
                            </p>
                            {corrigiendo && (
                                <PortalInput label="Motivo (opcional)" name="motivo-borrar" value={motivoBorrar} autoFocus
                                    placeholder="Ej.: el cliente ya no la quiere" onChange={(e) => setMotivoBorrar(e.target.value)} />
                            )}
                        </div>
                    </LiquidModal.Body>
                    <LiquidModal.Footer>
                        <div className="flex items-center justify-end gap-2 w-full">
                            <Button variant="ghost" onClick={() => setVerBorrar(false)} disabled={borrando}>Cancelar</Button>
                            <Button variant="secondary" tone="danger" icon={borrando ? Loader2 : Eraser} disabled={borrando}
                                autoFocus={!corrigiendo} data-confirmar-borrar onClick={confirmarBorrar}>
                                {corrigiendo ? 'Borrar preventa' : 'Vaciar'}
                            </Button>
                        </div>
                    </LiquidModal.Footer>
                </LiquidModal>
            )}
            {perdida && emisor && (
                <VentaPerdidaModal emisorId={emisor.id} cliente={cliente} pedidoId={pedido?.pedido.id ?? null}
                    producto={perdida.producto ?? null} cantidad={perdida.cantidad} buscado={perdida.buscado ?? ''}
                    onClose={() => setPerdida(null)}
                    onGuardado={({ producto, cantidad }) => {
                        // Lo que se anotó sale de la venta: el renglón baja a lo que
                        // sí hay, o se quita si no había nada.
                        if (perdida.clave != null) {
                            setCarrito(cs => cs.flatMap(c => {
                                if (c.clave !== perdida.clave) return [c];
                                const queda = (leerMonto(c.cantidad) ?? 0) - cantidad;
                                return queda > 0 ? [{ ...c, cantidad: conCantidad(queda) }] : [];
                            }));
                        }
                        setPerdida(null);
                        showToast('Venta perdida anotada', `${producto} · ${conCantidad(cantidad)}`);
                        buscador.current?.focus();
                    }} />
            )}
            {nuevoCliente && (
                <ClienteModal cliente={{}} emisorId={emisor?.id} puedeEditar={puedeVender}
                    onClose={() => setNuevoCliente(false)} onGuardado={alCrearCliente} />
            )}
            {verExistencias != null && (
                <ExistenciasSucursales terminoInicial={verExistencias} onClose={() => setVerExistencias(null)} />
            )}
            {verPendientes && (
                <LiquidModal open onClose={() => setVerPendientes(false)} maxWidth="max-w-xl" ariaLabel="Pendientes de finalizar">
                    <LiquidModal.Header>
                        <div className="flex items-center gap-2.5 min-w-0">
                            <ListChecks size={18} className="text-brand-text shrink-0" />
                            <h2 className="text-title font-black text-content">Pendientes de finalizar</h2>
                            <Badge size="sm" variant="warning" uppercase={false}>{pendientes?.length ?? 0}</Badge>
                        </div>
                    </LiquidModal.Header>
                    <LiquidModal.Body>
                        <div className="flex flex-col gap-3">
                            {(pendientes?.length ?? 0) > 4 && (
                                <PortalInput icon={Search} name="buscar-pendiente" value={buscarPendiente} compact
                                    placeholder="Cliente o número…" aria-label="Buscar una preventa"
                                    onChange={(e) => setBuscarPendiente(e.target.value)} />
                            )}
                            <div className="rounded-xl border border-divider overflow-hidden">
                                {listaPendientes.length === 0 && <p className="px-4 py-3 text-caption text-content-3">Ninguna coincide.</p>}
                                {listaPendientes.map(p => (
                                    <button key={p.id} type="button" data-pendiente={p.id}
                                        onClick={() => { setVerPendientes(false); navigate(rutaVenta(p.id)); }}
                                        className="w-full flex items-center justify-between gap-3 px-4 min-h-[var(--tap-min)] py-2.5 text-left border-b border-divider last:border-b-0 hover:bg-surface-card-hover active:scale-[0.99] transition-transform">
                                        <span className="min-w-0">
                                            <span className="block text-body-sm font-bold text-content-2 truncate">{p.dist_clientes?.nombre}</span>
                                            <span className="block text-caption text-content-3 truncate">
                                                Venta {p.id} · {fechaHora12(p.created_at)} · {shortEmployeeName(p.employees) || '—'}
                                                {p.descuento_solicitud_id ? ' · descuento por aprobar' : ''}
                                            </span>
                                        </span>
                                        <span className="flex items-center gap-2 shrink-0">
                                            <span className="tabular-nums font-black text-content">{formatMoney(totalDePedido(p))}</span>
                                            <ChevronRight size={16} className="text-content-3" />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </LiquidModal.Body>
                </LiquidModal>
            )}
        </div>
    );
}

/**
 * El desglose del total con los campos del RESUMEN del documento, en el orden
 * y con los nombres del papel (pedido del usuario: «todo según fiscalmente»):
 *   · Crédito Fiscal: sumas (sin IVA) · descuentos · sub-total · IVA 13% ·
 *     monto total de la operación · IVA retenido 1% · IVA percibido 1% · total.
 *   · Factura: sumas (con IVA) · descuentos · sub-total · IVA retenido 1% ·
 *     total, y el IVA que va INCLUIDO, como lo informa la Factura.
 * Los descuentos son informativos: ya vienen restados en cada renglón.
 */
function DesgloseFiscal({ venta, conIva, porAprobar = 0 }) {
    return (
        <div className="flex flex-col gap-1.5">
            <FilaTotal rotulo={conIva ? 'Sumas (con IVA)' : 'Sumas (sin IVA)'} valor={formatMoney(venta.ventas)} />
            {venta.descuentos > 0 && <FilaTotal rotulo="Descuentos (ya aplicados)" valor={formatMoney(venta.descuentos)} tono="text-success-text" />}
            <FilaTotal rotulo="Sub-total" valor={formatMoney(venta.subTotal)} />
            {!conIva && <FilaTotal rotulo="IVA 13%" valor={formatMoney(venta.iva)} />}
            {!conIva && <FilaTotal rotulo="Monto total de la operación" valor={formatMoney(venta.montoOperacion)} />}
            {venta.retencion > 0 && <FilaTotal rotulo="(−) IVA retenido 1%" valor={`−${formatMoney(venta.retencion)}`} />}
            {venta.percepcion > 0 && <FilaTotal rotulo="(+) IVA percibido 1%" valor={formatMoney(venta.percepcion)} />}
            {porAprobar > 0 && <FilaTotal rotulo="Descuento por aprobar (no incluido)" valor={`−${formatMoney(porAprobar)}`} tono="text-warning-text" />}
            <FilaTotal rotulo="Total a pagar" valor={formatMoney(venta.total)} fuerte />
            {conIva && venta.iva > 0 && <p className="text-micro text-content-3 text-right">IVA incluido: {formatMoney(venta.iva)}</p>}
        </div>
    );
}

/** Una fila del desglose del total. */
function FilaTotal({ rotulo, valor, fuerte = false, tono = '' }) {
    return (
        <div className={`flex items-baseline justify-between gap-3 ${fuerte ? 'pt-2 mt-0.5 border-t border-brand/20' : ''}`}>
            <span className={fuerte ? 'text-body font-black text-content' : 'text-caption text-content-3'}>{rotulo}</span>
            <span data-testid={fuerte ? 'total-venta' : undefined}
                className={`tabular-nums ${fuerte ? 'text-title font-black text-brand-text' : `text-body-sm font-bold ${tono || 'text-content-2'}`}`}>{valor}</span>
        </div>
    );
}


