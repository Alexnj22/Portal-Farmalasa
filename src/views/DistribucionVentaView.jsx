import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ShoppingCart, Plus, Minus, Trash2, ShieldAlert, Loader2, Receipt, Save, Search, Printer, PackageX, ArrowLeft, AlertTriangle,
    Send, Clock, Store, Package, Tag, RefreshCw, ListChecks, ChevronRight,
} from 'lucide-react';
import LiquidModal from '../components/common/LiquidModal';
import ExistenciasSucursales from './distribucion/ExistenciasSucursales';
import GlassViewLayout from '../components/GlassViewLayout';
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
    pedirDescuento,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import Interruptor from './distribucion/Interruptor';
import FormasDePago from './distribucion/FormasDePago';
import { filaNueva, problemaDePagos, cambioDePagos } from './distribucion/pagos';
import { leerMonto, rotuloTipoCliente, soloVentaLibre, TIPO_DOCUMENTO } from './distribucion/comun';
import { indexarPrecios, presentacionesDe, listasDe, precioDe } from './distribucion/precios';
import { calcularVenta, descuentoConIva, totalDePedido } from './distribucion/motor';
import { rutaInicio, rutaDocumento, rutaVenta } from './distribucion/rutas';

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

// Anchos de la grilla de renglones en pantalla ancha (xl): UNA línea por
// producto, como en la caja, con el encabezado y cada fila sobre la MISMA
// cadena. Por debajo de xl el renglón se parte en tres líneas cortas.
const COLUMNAS = 'xl:grid-cols-[minmax(9rem,1fr)_8rem_9rem_9.5rem_6.5rem_5.5rem_2rem]';

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
    const [pendientes, setPendientes] = useState(null);   // preventas por finalizar (sólo en una venta nueva)
    const [buscarPendiente, setBuscarPendiente] = useState('');
    const buscador = useRef(null);
    const barra = useRef(null);
    const carritoRef = useRef([]);
    const catalogoRef = useRef(new Map());
    const buscadorTexto = useRef('');

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
                        lista_id: i.lista_id && c?.lista_id && Number(i.lista_id) !== Number(c.lista_id) ? String(i.lista_id) : '',
                    })));
                    const p = new URLSearchParams(params);
                    p.delete('desde');
                    setParams(p, { replace: true });
                    showToast('Venta nueva con los mismos productos', 'Revisa las cantidades antes de guardar.', 'info');
                }
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
        if (corrigiendo || desde || repuesto.current || !recuperado) return;
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
    }, [corrigiendo, recuperado, desde]);

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

    const [resaltado, setResaltado] = useState(0);     // el resultado del buscador que agrega Enter
    const [enfocar, setEnfocar] = useState(null);      // la clave del renglón cuya cantidad toma el foco
    const [verExistencias, setVerExistencias] = useState(null); // null, o el texto con que abre la búsqueda

    // Al agregar, el foco va DIRECTO a la cantidad de ese producto (pedido del
    // usuario): es lo primero que se escribe. Enter ahí vuelve al buscador.
    const agregar = (p) => {
        const pres = presentacionesDe(idx, p.product_id)[0].presentacion;
        const ya = carrito.find(c => c.product_id === String(p.product_id) && c.presentacion === pres);
        if (ya) {
            setCarrito(cs => cs.map(c => (c === ya ? { ...c, cantidad: conCantidad((leerMonto(c.cantidad) ?? 0) + 1) } : c)));
            setEnfocar(ya.clave);
        } else {
            const nuevo = renglonNuevo(p.product_id, pres);
            setCarrito(cs => [...cs, nuevo]);
            setEnfocar(nuevo.clave);
        }
        setBuscar('');
        setResaltado(0);
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
        const destino = e.key === 'ArrowLeft' ? [f, col - 1] : e.key === 'ArrowRight' ? [f, col + 1]
            : e.key === 'ArrowUp' ? [f - 1, col] : [f + 1, col];
        const el = document.querySelector(`[data-fila="${destino[0]}"] [data-col="${destino[1]}"]`)
            ?.querySelector('input:not([disabled]), [role="combobox"]:not([aria-disabled="true"]), button:not([disabled]):not([tabindex="-1"])');
        if (!el) return;
        e.preventDefault();
        e.stopPropagation();
        el.focus();
        if (el.tagName === 'INPUT') el.select();
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
                if (corrigiendo) navigate(rutaVenta(), { replace: true });
                else empezarOtra();
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
    //   F3  al buscador                                   · también /
    //   F4  salir a Pedidos
    //   F7  existencias en todas las sucursales (nuevo, pedido del usuario)
    //   Supr sobre un producto (fuera de un campo de texto): quitarlo
    // Aprietan el MISMO botón que el ratón: si está deshabilitado, no pasa nada.
    // Las teclas se escuchan una vez; el carrito que ven lo refresca este efecto.
    useEffect(() => { carritoRef.current = carrito; }, [carrito]);
    useEffect(() => { catalogoRef.current = porId; }, [porId]);
    useEffect(() => { buscadorTexto.current = buscar; }, [buscar]);
    useEffect(() => {
        const apretar = (sel) => document.querySelector(`${sel}:not([disabled])`)?.click();
        const alTeclado = (e) => {
            if (document.querySelector('[role="dialog"]') && e.key !== 'F7') return; // con un diálogo abierto, las teclas son suyas
            const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
            const k = e.key;
            if (k === 'F2' || (k === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); apretar('[data-accion-principal]'); }
            else if (k === 'F8') { e.preventDefault(); apretar('[data-accion-preventa]'); }
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
    const [verNotas, setVerNotas] = useState(!!notas);

    const titulo = corrigiendo
        ? (pedido?.pedido.reemplaza_dte_id ? `Corregir documento (pedido ${pedidoIdParam})` : `Finalizar venta ${pedidoIdParam}`)
        : 'Nueva venta';

    const headerLeft = (
        <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" iconOnly icon={ArrowLeft} title="Volver a Pedidos" onClick={() => navigate(rutaInicio())} />
            <div className="min-w-0">
                <h2 className="font-black text-title text-content tracking-tight leading-tight truncate">{titulo}</h2>
                {cliente && <p className="text-caption text-content-3 truncate">{cliente.nombre}</p>}
            </div>
        </div>
    );

    // A la derecha del encabezado: las preventas por finalizar, a un toque.
    // Antes eran una tarjeta grande arriba de todo, que empujaba la venta
    // hacia abajo cada vez que se abría la pantalla.
    const accionesEncabezado = !corrigiendo && pendientes?.length > 0 ? (
        <Button variant="secondary" icon={ListChecks} onClick={() => setVerPendientes(true)}>
            Pendientes <Badge size="sm" variant="warning" uppercase={false}>{pendientes.length}</Badge>
        </Button>
    ) : null;

    // «Preventa» es la venta guardada sin facturar: el pedido que el vendedor
    // toma en la ruta y se factura después (o espera un descuento).
    const botonPrincipal = porAprobar.length > 0 ? (
        <Button variant="primary" icon={guardando === 'aprobacion' ? Loader2 : Send} disabled={!puedeGuardar}
            data-accion-principal onClick={() => guardar('aprobacion')} className="flex-1 sm:flex-none" title="F2">
            Enviar a aprobación <kbd aria-hidden="true" className="hidden lg:inline ml-1 text-micro font-bold opacity-70">F2</kbd>
        </Button>
    ) : (
        <Button variant="primary" icon={guardando === 'facturar' ? Loader2 : (imprimir ? Printer : Receipt)} disabled={!listo}
            data-accion-principal onClick={() => guardar('facturar')} className="flex-1 sm:flex-none" title="F2 o Ctrl + Enter">
            {imprimir ? 'Facturar e imprimir' : 'Facturar'} <kbd aria-hidden="true" className="hidden lg:inline ml-1 text-micro font-bold opacity-70">F2</kbd>
        </Button>
    );

    const qPendiente = buscarPendiente.trim();
    const listaPendientes = (pendientes ?? []).filter(p => !qPendiente || tokenMatch(qPendiente, p.dist_clientes?.nombre, String(p.id)));

    return (
        <GlassViewLayout icon={ShoppingCart} title={titulo} headerLeft={headerLeft} filtersContent={accionesEncabezado} transparentBody>
            <div className="p-3 md:p-5 pb-40 lg:pb-0 flex flex-col gap-3 min-h-full">
                {errorCarga && <Notice variant="danger" icon={AlertTriangle}>{errorCarga}</Notice>}
                {cargando && !errorCarga && <p className="text-caption text-content-3">Cargando…</p>}
                {!cargando && !errorCarga && (
                    <>
                        {error && <Notice variant="danger" bloque>{error}</Notice>}
                        {esperandoAprobacion && (
                            <Notice variant="warning" icon={Clock} compact>
                                Esta venta espera la aprobación de un descuento. Al guardarla, la solicitud se pone al día.
                            </Notice>
                        )}

                        {/* ── Quién compra: una sola franja ── */}
                        <section data-surface="card" className="p-3 md:p-4 flex flex-col gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_minmax(10rem,14rem)] gap-3 items-center">
                                <LiquidSelect value={clienteId} onChange={cambiarCliente} options={opcionesClientes} icon={Store}
                                    placeholder="Elegir cliente…" clearable={false} disabled={corrigiendo} ariaLabel="Cliente" />
                                <SegmentedControl value={tipoDoc} onChange={setTipoDoc} label="Documento"
                                    options={[
                                        { value: '01', label: TIPO_DOCUMENTO['01'].largo },
                                        { value: '03', label: TIPO_DOCUMENTO['03'].largo, disabled: !cliente?.contribuyente },
                                    ]} />
                                <div className="md:col-span-2 xl:col-span-1 min-w-0">
                                    <LiquidSelect value={listaEfectiva != null ? String(listaEfectiva) : ''} onChange={cambiarLista} icon={Tag}
                                        options={opcionesListas} placeholder="Sin listas" clearable={false} disabled={!opcionesListas.length}
                                        ariaLabel="Lista de precios (cambia el precio de todos los productos)" />
                                </div>
                            </div>
                            {cliente && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {!cliente.contribuyente && <Badge size="sm" variant="neutral" uppercase={false}>Sin NRC: sólo Factura</Badge>}
                                    {cliente.gran_contribuyente && tipoDoc === '03' && <Badge size="sm" variant="warning" uppercase={false}>Retiene 1%</Badge>}
                                    {soloVentaLibre(cliente.tipo) && <Badge size="sm" variant="neutral" uppercase={false}>Sólo venta libre</Badge>}
                                    {tieneCredito && <Badge size="sm" variant="neutral" uppercase={false}>Crédito {formatMoney(cliente.limite_credito)} · {cliente.plazo_dias} días</Badge>}
                                    {cliente.lista_id && String(cliente.lista_id) !== String(listaEfectiva) && <Badge size="sm" variant="warning" uppercase={false}>Lista distinta de la del cliente</Badge>}
                                    <span className="text-caption text-content-3 flex items-center gap-1"><RefreshCw size={11} /> La lista cambia el precio de todos los productos</span>
                                </div>
                            )}
                            {sinLicencia && (
                                <Notice variant="danger" icon={ShieldAlert} compact>
                                    {licenciaVencida ? 'La licencia de la SRS de este cliente está vencida.' : 'Este cliente no tiene licencia de la SRS registrada.'}
                                </Notice>
                            )}
                        </section>

                        {/* ── Qué se lleva ──
                            `relative z-dropdown`: la lista del buscador flota por encima de
                            las tarjetas de abajo (el cobro, la barra), no por debajo. */}
                        <section data-surface="card" className="relative z-dropdown p-3 md:p-4 flex flex-col gap-3">
                            <div className="relative">
                                <PortalInput ref={buscador} icon={Search} name="buscar-producto" value={buscar} alto
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
                                    <div data-surface="dropdown" className="absolute left-0 right-0 top-full mt-1 overflow-hidden max-h-[24rem] overflow-y-auto rounded-2xl" role="listbox" aria-label="Productos encontrados">
                                        {resultados.length === 0 && (
                                            <p className="px-4 py-3 text-caption text-content-3 flex items-center gap-2">
                                                <PackageX size={14} /> Nada que coincida{soloVentaLibre(cliente.tipo) ? ' entre los productos de venta libre' : ''}.
                                                <button type="button" className="font-bold text-brand-text underline" onClick={() => setVerExistencias(buscar)}>Buscar en todas las sucursales (F7)</button>
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
                                <div className="rounded-xl border border-divider overflow-hidden" onKeyDownCapture={navegarRenglones}>
                                    <div className={`hidden xl:grid ${COLUMNAS} gap-2 px-3 py-2 border-b border-divider bg-surface-card-hover/40 text-micro font-bold uppercase tracking-wide text-content-3`}>
                                        <span>Producto</span><span className="text-center">Cantidad</span><span>Presentación</span>
                                        <span>Precio {conIva ? 'c/IVA' : 's/IVA'} · lista</span><span>Descuento</span>
                                        <span className="text-right">Importe</span><span />
                                    </div>
                                    {lineas.map((l, k) => {
                                        const nombre = l.p?.nombre ?? `Producto ${l.product_id}`;
                                        const ocupadas = new Set(lineas.filter(o => o.clave !== l.clave && o.product_id === l.product_id).map(o => o.presentacion));
                                        // Una línea por opción («PAQUETE · 12 u.»): con dos líneas el
                                        // selector medía más que los campos de al lado.
                                        const opcPres = l.presentaciones
                                            .filter(x => !ocupadas.has(x.presentacion))
                                            .map(x => ({ value: x.presentacion, label: x.unidades > 1 ? `${x.presentacion} · ${x.unidades} u.` : x.presentacion }));
                                        // Lista y precio en UN control, en una línea: «$37.50 · VIP».
                                        const opcListas = l.p ? listasDe(idx, l.p.product_id, l.presentacion).map(x => {
                                            const pr = precioDe(idx, l.p, l.presentacion, x.id);
                                            return { value: String(x.id), label: `${formatMoney(visto(pr?.precio ?? 0))} · ${x.nombre}` };
                                        }) : [];
                                        const errDesc = l.descMalo ? 'No es un número' : l.pasaImporte ? 'Pasa del importe' : null;
                                        return (
                                            <div key={l.clave} data-renglon={l.product_id} data-fila={k}
                                                className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLUMNAS} gap-x-2 gap-y-2 items-center px-3 py-2 border-b border-divider last:border-b-0 focus-within:bg-brand/5 ${l.porAprobar ? 'bg-warning/5' : ''}`}>
                                                {/* Producto */}
                                                <div className="min-w-0">
                                                    <p className="text-body-sm font-bold text-content truncate" title={nombre}>{nombre}</p>
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-content-3">
                                                        {l.hay != null && (
                                                            <span className={l.faltaExistencia ? 'text-danger-text font-bold' : ''}>
                                                                {l.faltaExistencia ? `Sólo hay ${l.hay}` : `Hay ${l.hay}`}
                                                            </span>
                                                        )}
                                                        {l.noVa && <span className="text-danger-text font-bold">No se le vende a este cliente</span>}
                                                        {l.sinPrecio && <span className="text-danger-text font-bold">Sin precio en esta presentación</span>}
                                                        {l.porAprobar && <span className="text-warning-text font-bold">Descuento por aprobar</span>}
                                                        {!l.porAprobar && l.descEstado === 'rechazado' && !l.descValor && <span>Descuento rechazado</span>}
                                                    </div>
                                                </div>
                                                <div className="xl:hidden text-right">
                                                    <p className="tabular-nums font-black text-content">{formatMoney(l.doc?.importe ?? 0)}</p>
                                                </div>

                                                {/* Teléfono: cantidad | presentación, precio | descuento, quitar.
                                                    Pantalla ancha: cada control en su columna (`contents`). El
                                                    orden es el de Tab y ← →: cantidad primero, que es lo que se
                                                    escribe al agregar. */}
                                                <div className="col-span-2 grid grid-cols-2 gap-2 items-center xl:contents">
                                                    {/* Cantidad */}
                                                    <div data-col="0" className="flex items-center gap-1 justify-center">
                                                        <Button variant="ghost" size="sm" iconOnly icon={Minus} title="Uno menos" tabIndex={-1}
                                                            disabled={(l.n ?? 0) <= 1} onClick={() => sumar(l.clave, -1)} />
                                                        <PortalInput compact className="w-16" inputClassName="text-center font-black" name={`cantidad-${l.clave}`} inputMode="decimal"
                                                            value={l.cantidad} aria-label={`Cantidad de ${nombre}`} hasError={!l.n || l.n <= 0}
                                                            onKeyDown={alEnterVolverAlBuscador} onFocus={(e) => e.target.select()}
                                                            onChange={(e) => cambiar(l.clave, { cantidad: e.target.value })} />
                                                        <Button variant="ghost" size="sm" iconOnly icon={Plus} title="Uno más" tabIndex={-1} onClick={() => sumar(l.clave, 1)} />
                                                    </div>
                                                    {/* Presentación */}
                                                    <div data-col="1" className="min-w-0">
                                                        <LiquidSelect compact icon={Package} value={l.presentacion} options={opcPres} clearable={false}
                                                            disabled={opcPres.length <= 1} ariaLabel={`Presentación de ${nombre}`}
                                                            onChange={(v) => v && cambiar(l.clave, { presentacion: v, lista_id: '' })} />
                                                    </div>
                                                    {/* Precio · lista */}
                                                    <div data-col="2" className="min-w-0" data-testid="precio-renglon">
                                                        {opcListas.length > 1 ? (
                                                            <LiquidSelect compact icon={Tag} value={l.r?.listaId != null ? String(l.r.listaId) : ''} options={opcListas} clearable={false}
                                                                ariaLabel={`Precio y lista de ${nombre}`}
                                                                onChange={(v) => cambiar(l.clave, { lista_id: v && Number(v) !== listaEfectiva ? v : '' })} />
                                                        ) : (
                                                            <p className="h-8 flex items-center text-body-sm font-bold tabular-nums text-content-2 px-2">
                                                                {l.r ? formatMoney(l.doc?.precioUni ?? visto(l.r.precio)) : '—'}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {/* Descuento */}
                                                    <div data-col="3" className="flex items-center gap-1 min-w-0">
                                                        <PortalInput compact className="flex-1 min-w-0" inputClassName="text-right" name={`descuento-${l.clave}`} inputMode="decimal" value={l.descValor}
                                                            placeholder="0" aria-label={`Descuento de ${nombre}`} hasError={!!errDesc} errorMessage={errDesc ?? undefined}
                                                            onKeyDown={alEnterVolverAlBuscador} onFocus={(e) => e.target.select()}
                                                            onChange={(e) => cambiar(l.clave, { descValor: e.target.value })} />
                                                        {/* % / $ como un botón que alterna: la mitad de ancho que
                                                            el control de dos opciones, y no se roba las flechas. */}
                                                        <Button variant="secondary" size="sm" tabIndex={-1} className="w-9 shrink-0 font-black"
                                                            title={l.descTipo === 'pct' ? 'En porcentaje (tocar para pasar a $)' : 'En dólares (tocar para pasar a %)'}
                                                            onClick={() => cambiar(l.clave, { descTipo: l.descTipo === 'pct' ? 'monto' : 'pct', descValor: '' })}>
                                                            {l.descTipo === 'pct' ? '%' : '$'}
                                                        </Button>
                                                    </div>
                                                    {/* Importe */}
                                                    <div className="hidden xl:block text-right tabular-nums">
                                                        <p className="font-black text-content">{formatMoney(l.doc?.importe ?? 0)}</p>
                                                        {l.doc?.descuento > 0 && <p className="text-micro text-success-text">−{formatMoney(l.doc.descuento)}</p>}
                                                        {l.porAprobar && <p className="text-micro text-warning-text">−{formatMoney(conIva ? l.desc : l.desc / 1.13)} por aprobar</p>}
                                                    </div>
                                                    <div data-col="4" className="col-span-2 xl:col-span-1 flex justify-end">
                                                        <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar de la venta (Supr)" onClick={() => quitar(l.clave)} />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {lineas.length > 0 && (
                                <p className="hidden md:block text-micro text-content-3">
                                    Tab o ← → cambian de campo · ↑ ↓ cambian de producto · Supr quita el producto · F7 existencias en todas las sucursales
                                </p>
                            )}
                        </section>

                        {/* ── El cobro: abajo, donde termina la venta ── */}
                        {cliente && lineas.length > 0 && (
                            <section data-surface="card" className="p-3 md:p-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-4 items-start">
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
                                            <PortalTextarea label="¿Por qué el descuento? (lo ve quien aprueba)" name="motivo-descuento" value={motivoDescuento}
                                                rows={2} compact onChange={(e) => setMotivoDescuento(e.target.value)}
                                                placeholder="Ej.: cliente nuevo, compra de volumen, igualar precio de la competencia" />
                                        </div>
                                    )}
                                    <FormasDePago filas={pagos} setFilas={setPagos} total={estimado.total} cliente={cliente}
                                        plazo={plazo} setPlazo={setPlazo} abierto={pagoAbierto} setAbierto={setPagoAbierto} />
                                    {excedeCredito && (
                                        <Notice variant="warning" compact>Pasa del crédito aprobado del cliente ({formatMoney(cliente.limite_credito)}).</Notice>
                                    )}
                                    {verNotas ? (
                                        <PortalTextarea label="Observaciones" name="notas" value={notas} rows={2} compact
                                            onChange={(e) => setNotas(e.target.value)} placeholder="Sale impresa en el documento." />
                                    ) : (
                                        <div><Button size="sm" variant="ghost" icon={Plus} onClick={() => setVerNotas(true)}>Observaciones</Button></div>
                                    )}
                                </div>
                                <div className="rounded-2xl border border-brand/20 bg-brand/5 p-3 flex flex-col gap-1.5">
                                    <FilaTotal rotulo={`Suma (${cuentan.length} producto${cuentan.length === 1 ? '' : 's'})`} valor={formatMoney(venta.suma)} />
                                    {venta.descuentos > 0 && <FilaTotal rotulo="Descuentos" valor={`−${formatMoney(venta.descuentos)}`} tono="text-success-text" />}
                                    {montoPorAprobar > 0 && <FilaTotal rotulo="Por aprobar (no incluido)" valor={`−${formatMoney(montoPorAprobar)}`} tono="text-warning-text" />}
                                    {!conIva && <FilaTotal rotulo="IVA 13%" valor={formatMoney(estimado.iva)} />}
                                    {estimado.retencion > 0 && <FilaTotal rotulo="Retención 1%" valor={`−${formatMoney(estimado.retencion)}`} />}
                                    {estimado.percepcion > 0 && <FilaTotal rotulo="Percepción 1%" valor={formatMoney(estimado.percepcion)} />}
                                    <FilaTotal rotulo="Total" valor={formatMoney(estimado.total)} fuerte />
                                    {conIva && estimado.iva > 0 && <p className="text-micro text-content-3 text-right">Incluye IVA de {formatMoney(estimado.iva)}</p>}
                                    {cambio > 0 && (
                                        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-success/10 px-3 py-1.5 mt-1">
                                            <span className="text-body-sm font-bold text-success-text">Cambio</span>
                                            <span className="text-title font-black text-success-text tabular-nums">{formatMoney(cambio)}</span>
                                        </div>
                                    )}
                                    <div className="pt-1">
                                        <Interruptor checked={imprimir} onChange={setImprimir} label="Imprimir el ticket al facturar" />
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* ── La barra de acción: siempre a mano, en computadora y teléfono ──
                            Total y botones pegados abajo: finalizar una venta no pide
                            desplazarse. En computadora se pega al fondo del contenido; en
                            el teléfono, al borde de la pantalla. */}
                        <div className="flex-1 hidden lg:block" />
                        <div ref={barra} data-surface="card"
                            className="fixed lg:sticky inset-x-0 bottom-0 z-tabs lg:z-content px-4 lg:px-4 pt-3 pb-[max(12px,var(--sa-bottom))] lg:py-3 lg:mb-3 flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-4">
                            <div className="flex items-end lg:items-center justify-between gap-3 lg:flex-1 min-w-0">
                                <p className={`min-w-0 text-caption truncate ${bloqueo ? 'text-content-2' : 'text-content-3'}`}>
                                    {bloqueo ?? `${lineas.length} producto${lineas.length === 1 ? '' : 's'} · ${conCantidad(unidadesTotal)} pieza${unidadesTotal === 1 ? '' : 's'}${cambio > 0 ? ` · cambio ${formatMoney(cambio)}` : ''}`}
                                </p>
                                <p className="text-title lg:text-display font-black text-brand-text tabular-nums shrink-0">{formatMoney(estimado.total)}</p>
                            </div>
                            <div className="flex gap-2">
                                <Button variant="secondary" icon={guardando === 'preventa' ? Loader2 : Save} disabled={!puedeGuardar}
                                    data-accion-preventa title="Guardar sin facturar: queda en Pendientes (F8)" onClick={() => guardar('preventa')} className="flex-1 sm:flex-none">
                                    Guardar preventa <kbd aria-hidden="true" className="hidden lg:inline ml-1 text-micro font-bold opacity-60">F8</kbd>
                                </Button>
                                {botonPrincipal}
                            </div>
                        </div>
                    </>
                )}
            </div>

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
        </GlassViewLayout>
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


