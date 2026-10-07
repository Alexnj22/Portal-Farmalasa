// La venta de Torogoz en el teléfono — el ESTADO y las acciones, sin pantalla.
//
// Es la misma vista del portal (`views/DistribucionVentaView.jsx`) partida en
// dos: acá vive lo que hace —cargar, reservar, guardar, facturar, vender sin
// señal— y la pantalla sólo pinta. Las cuentas no se repiten: salen de
// `@nucleo/utils/distribucionVenta` (`armarVenta`), las mismas que usa el
// portal, así un carrito no puede facturarse en uno y frenarse en el otro.
//
// Lo que el teléfono NO hace (y el portal sí), a propósito:
//   · adjuntar el comprobante de un pago en la venta: se adjunta después desde
//     el pedido, igual que cuando la subida falla en el portal;
//   · mandar el documento por correo apenas se sella: el PDF se arma con la
//     librería del navegador; queda «pendiente de enviar» en Facturación;
//   · imprimir el ticket provisional de una venta sin señal: la venta queda
//     en la cola con su código de generación, que se muestra en pantalla.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import {
  fetchEmisor, fetchClientes, fetchCatalogo, fetchListasYPrecios, fetchPedidoParaCorregir, fetchPedidos,
  crearPedido, actualizarPedido, facturarPedido, mensajeDeDistribucion, guardarPagos,
  pedirDescuento, anularPedido, reservar, fetchReservasVigentes, fetchCreditoCliente, fetchMiCaja,
} from '@nucleo/data/distribucion';
import { fetchLotes } from '@nucleo/data/distribucionInventario';
import { guardarVentaSinSenal, esErrorDeRed, uuidV4 } from '@nucleo/data/distribucionSinSenal';
import { filaNueva } from '@nucleo/utils/distribucionPagos';
import { leerMonto, soloVentaLibre } from '@nucleo/utils/distribucionComun';
import { indexarPrecios, presentacionesDe, descuentoDelCatalogo } from '@nucleo/utils/distribucionPrecios';
import { indexarLotes, repartir, repartirTodo } from '@nucleo/utils/distribucionLotes';
import {
  conCantidad, renglonNuevo, contextoLotes, lotesDeLaVenta, quienTiene as quienTieneEn, porLoteDe as porLoteDeCarrito,
  armarVenta, renglonesParaGuardar, pagosParaGuardar, cabeceraDePago,
} from '@nucleo/utils/distribucionVenta';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { listo } from '../../Progreso';
import { ACCIONES_DE_DINERO } from '../soloConsulta';

const anotar = (accion, id, detalle) => useStaffStore.getState().appendAuditLog?.(accion, String(id), { ...detalle, desde: 'app' });
const aviso = (titulo, texto) => Alert.alert(titulo, texto || undefined, [{ text: 'Aceptar' }]);
const pendientesDesde = () => fetchPedidos({ estados: ['confirmado'], desde: sumarDias(hoySV(), -60) });

/**
 * `pedidoId`: corrige/finaliza esa preventa. `desde`: venta nueva con el
 * cliente y los productos de otra. `clienteInicial`: venta nueva con ese cliente.
 */
export default function useVenta({ pedidoId = null, desde = null, clienteInicial = null }) {
  const corrigiendo = !!pedidoId;
  const { hasPermission, user } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const puedeConfigurar = !!hasPermission?.('distribucion_config', 'can_edit');
  const puedeDescontar = !!hasPermission?.('distribucion_descuentos', 'can_edit');

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
  const [tipoDoc, setTipoDoc] = useState('01');
  const [pagos, setPagos] = useState(() => [filaNueva()]);
  const [plazo, setPlazo] = useState('');
  const [notas, setNotas] = useState('');
  const [uuid, setUuid] = useState(() => uuidV4());
  const [guardando, setGuardando] = useState(null); // 'preventa' | 'aprobacion' | 'facturar'
  const [error, setError] = useState('');
  const [motivoDescuento, setMotivoDescuento] = useState('');
  const [lotesCrudos, setLotesCrudos] = useState(null);
  const [desdeCamionElegido, setDesdeCamion] = useState(null);
  const [reservas, setReservas] = useState([]);
  const [miReserva, setMiReserva] = useState(null);
  const [avisoReserva, setAvisoReserva] = useState('');
  const [ahora, setAhora] = useState(() => Date.now());
  const [credito, setCredito] = useState(null);
  const [miCaja, setMiCaja] = useState(undefined);
  const [pendientes, setPendientes] = useState(null);

  const sesion = corrigiendo ? pedido?.pedido.client_uuid ?? null : uuid;
  const tieneCamion = !!lotesCrudos?.some(l => l.en_camion_de === user?.id && Number(l.existencia) > 0);
  const desdeCamion = corrigiendo ? !!pedido?.pedido.desde_camion : (desdeCamionElegido ?? tieneCamion);
  const { lotesIdx, existencias } = useMemo(
    () => lotesDeLaVenta({ lotesCrudos, desdeCamion, yo: user?.id, reservas, sesion }),
    [lotesCrudos, desdeCamion, user?.id, reservas, sesion],
  );
  const quienTiene = useCallback((pid) => quienTieneEn(lotesIdx, pid), [lotesIdx]);
  const idx = useMemo(() => indexarPrecios(precios, listas), [precios, listas]);
  const listaBase = idx.listas[0]?.id ?? null;
  const ctxLotes = useMemo(() => contextoLotes(idx, lotesIdx), [idx, lotesIdx]);

  // ── La carga: lo mismo que la vista del portal ──
  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      setErrorCarga('');
      try {
        const [e, cs, cat, lp, ped, lotes, pend, base] = await Promise.all([
          fetchEmisor(), fetchClientes(), fetchCatalogo(), fetchListasYPrecios(),
          corrigiendo ? fetchPedidoParaCorregir(Number(pedidoId)) : Promise.resolve(null),
          // La existencia es AYUDA (el candado lo pone la base al facturar).
          fetchLotes().catch((err) => { console.error('venta: existencias', err); return null; }),
          corrigiendo ? Promise.resolve(null) : pendientesDesde().catch((err) => { console.error('venta: pendientes', err); return null; }),
          desde ? fetchPedidoParaCorregir(Number(desde)).catch((err) => { console.error('venta: volver a vender', err); return null; }) : Promise.resolve(null),
        ]);
        if (!vivo) return;
        setPendientes(pend);
        if (base) {
          // Mismo cliente, documento y productos; sin descuentos ni pagos.
          const c = cs.find(x => x.id === base.pedido.cliente_id);
          setClienteId(String(base.pedido.cliente_id));
          setListaVenta(c?.lista_id ? String(c.lista_id) : '');
          setTipoDoc(base.pedido.tipo_documento ?? (c?.contribuyente ? '03' : '01'));
          setCarrito(base.items.map(i => renglonNuevo(i.product_id, i.presentacion ?? 'UNIDAD', {
            cantidad: conCantidad(Number(i.cantidad)),
            lote_id: null,
            lista_id: i.lista_id && c?.lista_id && Number(i.lista_id) !== Number(c.lista_id) ? String(i.lista_id) : '',
          })));
          listo('Venta nueva con los mismos productos', 'Revisa las cantidades antes de guardar.');
        }
        if (clienteInicial && !base) {
          const c = cs.find(x => String(x.id) === String(clienteInicial));
          if (c) {
            setClienteId(String(c.id));
            setTipoDoc(c.contribuyente ? '03' : '01');
            setListaVenta(c.lista_id ? String(c.lista_id) : '');
            setPlazo(c.plazo_dias ? String(c.plazo_dias) : '');
          }
        }
        setEmisor(e); setClientes(cs); setCatalogo(cat); setListas(lp.listas); setPrecios(lp.precios); setPedido(ped);
        const camionAlAbrir = ped ? !!ped.pedido.desde_camion
          : !!lotes?.some(l => l.en_camion_de === user?.id && Number(l.existencia) > 0);
        const li = lotes
          ? indexarLotes(lotes.filter(l => (l.en_camion_de ?? null) === (camionAlAbrir ? user?.id ?? null : null)))
          : new Map();
        if (lotes) setLotesCrudos(lotes);
        const ctxAlAbrir = contextoLotes(indexarPrecios(lp.precios, lp.listas), li);
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
            const monto = Number(i.descuento_estado === 'pendiente' ? i.descuento_pedido : i.descuento) || 0;
            const descTipo = enPct || !monto ? 'pct' : 'monto';
            const descValor = enPct ? String(Number(i.descuento_pct))
              : monto ? (doc === '01' ? monto : monto / 1.13).toFixed(2) : '';
            const cantidad = conCantidad(Number(i.cantidad));
            return renglonNuevo(i.product_id, i.presentacion ?? 'UNIDAD', {
              lista_id: i.lista_id ? String(i.lista_id) : '',
              lote_id: i.lote_id ?? null,
              cantidad, descTipo, descValor,
              descEstado: i.descuento_estado ?? 'aplicado',
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
        if (lotes) setCarrito(cs2 => repartirTodo(cs2, ctxAlAbrir));
      } catch (e) {
        if (vivo) setErrorCarga(mensajeDeDistribucion(e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [corrigiendo, pedidoId, desde]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── El borrador: la misma clave y la misma regla que el portal ──
  const { recuperado, descartar } = useBorrador(
    emisor && !corrigiendo ? `distribucion-venta-${emisor.id}` : null,
    { clienteId, listaVenta, tipoDoc, carrito, pagos: pagos.map(({ adjunto: _a, ...f }) => f), plazo, notas, uuid },
    { activo: !corrigiendo, vale: (v) => !!v?.clienteId || v?.carrito?.length > 0 },
  );
  const repuesto = useRef(false);
  useEffect(() => {
    if (corrigiendo || desde || clienteInicial || repuesto.current || !recuperado) return;
    repuesto.current = true;
    setClienteId(recuperado.clienteId ?? '');
    setListaVenta(recuperado.listaVenta ?? '');
    setTipoDoc(recuperado.tipoDoc ?? '01');
    setCarrito((recuperado.carrito ?? []).map(c => renglonNuevo(c.product_id, c.presentacion ?? null, c)));
    setPagos(recuperado.pagos?.length ? recuperado.pagos.map(f => ({ ...filaNueva(), ...f, adjunto: null })) : [filaNueva()]);
    setPlazo(recuperado.plazo ?? '');
    setNotas(recuperado.notas ?? '');
    if (recuperado.uuid) setUuid(recuperado.uuid);
  }, [corrigiendo, recuperado, desde, clienteInicial]);

  const cliente = useMemo(() => clientes.find(c => String(c.id) === String(clienteId)) ?? null, [clientes, clienteId]);
  const tieneCredito = !!cliente && cliente.plazo_dias > 0 && Number(cliente.limite_credito) > 0;
  const clienteCreditoId = tieneCredito ? cliente.id : null;
  useEffect(() => {
    if (!clienteCreditoId) { setCredito(null); return undefined; }
    let vivo = true;
    fetchCreditoCliente(clienteCreditoId).then(c => { if (vivo) setCredito(c); }).catch(e => console.error('venta: crédito', e));
    return () => { vivo = false; };
  }, [clienteCreditoId]);
  useEffect(() => {
    let vivo = true;
    fetchMiCaja(user?.id, hoySV()).then(k => { if (vivo) setMiCaja(k); }).catch(e => { console.error('venta: caja', e); if (vivo) setMiCaja(undefined); });
    return () => { vivo = false; };
  }, [user?.id]);

  const listaEfectiva = listaVenta ? Number(listaVenta) : listaBase;
  const permitido = useCallback((p) => p.activo && (!cliente || !soloVentaLibre(cliente.tipo) || (p.venta_libre && !p.controlado)), [cliente]);
  const porId = useMemo(() => new Map(catalogo.map(p => [String(p.product_id), p])), [catalogo]);

  // ── Reservar lo que lleva el carrito (0012) ──
  const porLoteDe = useCallback((cs) => porLoteDeCarrito(cs, ctxLotes.porDe), [ctxLotes]);
  const claveReserva = JSON.stringify(porLoteDe(carrito));
  const releerReservas = useCallback(() => {
    fetchReservasVigentes().then(setReservas).catch(e => console.error('venta: reservas', e));
  }, []);
  useEffect(() => {
    if (cargando || errorCarga || !emisor || !puedeVender || !sesion) return undefined;
    const t = setTimeout(async () => {
      try {
        const r = await reservar(sesion, { clienteId: clienteId || null, pedidoId: pedido?.pedido.id ?? null, porLote: JSON.parse(claveReserva) });
        setMiReserva(r?.vence_at ? r : null);
        setAvisoReserva('');
      } catch (e) {
        console.error('venta: reservar', e);
        setAvisoReserva(mensajeDeDistribucion(e));
      }
      releerReservas();
    }, 500);
    return () => clearTimeout(t);
  }, [claveReserva, sesion, clienteId, cargando, errorCarga, emisor, puedeVender, pedido, releerReservas]);
  // Salir de una venta que NO se guardó suelta lo apartado.
  const soltarAlSalir = useRef(null);
  useEffect(() => {
    soltarAlSalir.current = !corrigiendo && sesion && claveReserva !== '[]' ? sesion : null;
  }, [corrigiendo, sesion, claveReserva]);
  useEffect(() => () => {
    const s = soltarAlSalir.current;
    if (s) reservar(s, { porLote: [] }).catch(e => console.error('venta: soltar al salir', e));
  }, []);
  useEffect(() => {
    if (cargando) return undefined;
    const t = setInterval(() => { releerReservas(); setAhora(Date.now()); }, 15000);
    return () => clearInterval(t);
  }, [cargando, releerReservas]);
  const minutosReserva = miReserva?.vence_at ? Math.ceil((new Date(miReserva.vence_at).getTime() - ahora) / 60000) : null;

  // ── El carrito ──
  const cambiarYRepartir = (clave, cambios) => setCarrito(cs => repartir(
    cs.map(c => (c.clave === clave ? { ...c, ...(typeof cambios === 'function' ? cambios(c) : cambios) } : c)), clave, ctxLotes));
  const cambiar = (clave, cambios) => setCarrito(cs => cs.map(c => (c.clave === clave ? { ...c, ...cambios } : c)));
  const sumar = (clave, delta) => cambiarYRepartir(clave, (c) => ({ cantidad: conCantidad(Math.max(1, (leerMonto(c.cantidad) ?? 0) + delta)) }));
  const quitar = (clave) => setCarrito(cs => cs.filter(c => c.clave !== clave));

  /**
   * Agregar un producto. Sin existencia en ningún lote no se agrega: devuelve
   * lo que hay que anotar como venta perdida (la pantalla abre la hoja).
   */
  const agregar = (p) => {
    const pid = String(p.product_id);
    if (existencias && !(existencias.get(pid) > 0)) {
      const quien = quienTiene(pid);
      return {
        perdida: {
          producto: { product_id: pid, nombre: p.nombre, motivo: quien.length ? `No hay más: ${quien.join(' y ')} lo está vendiendo` : 'Sin existencia en ningún lote' },
          cantidad: 1,
        },
      };
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
      // El % del catálogo entra ya puesto (borrador 0029).
      const catPct = descuentoDelCatalogo(porId.get(pid), hoySV());
      const nuevo = renglonNuevo(pid, pres, catPct > 0 ? { descTipo: 'pct', descValor: String(catPct) } : {});
      clave = nuevo.clave;
      armado = [...carrito, nuevo];
    }
    setCarrito(repartir(armado, clave, ctxLotes));
    return { agregado: true };
  };

  const cambiarCliente = useCallback((v, lista = clientes) => {
    setClienteId(v || '');
    const c = lista.find(x => String(x.id) === String(v));
    setTipoDoc(c?.contribuyente ? '03' : '01');
    setListaVenta(c?.lista_id ? String(c.lista_id) : '');
    if (!c || !(c.plazo_dias > 0)) setPagos(ps => ps.map(f => (f.forma === '13' ? { ...f, forma: '01' } : f)));
    setPlazo(c?.plazo_dias ? String(c.plazo_dias) : '');
    setError('');
  }, [clientes]);

  /** Cambiar la lista de la venta cambia el precio de TODOS los productos. */
  const cambiarLista = (v) => {
    const nueva = v || '';
    if (nueva === String(listaEfectiva ?? '')) return;
    setListaVenta(nueva);
    if (!carrito.length) return;
    setCarrito(cs => cs.map(c => ({ ...c, lista_id: '' })));
    const nombre = idx.listas.find(l => String(l.id) === nueva)?.nombre ?? 'la lista elegida';
    listo('Precios actualizados', `${carrito.length} producto${carrito.length === 1 ? '' : 's'} a precio ${nombre}.`);
  };

  const cambiarFormaPago = (v) => {
    const forma = v || '01';
    setPagos([filaNueva(forma)]);
    if (forma === '13' && !plazo) setPlazo(String(cliente?.plazo_dias ?? ''));
  };

  // ── La venta entera, del núcleo ──
  const hoy = hoySV();
  const v = armarVenta({
    carrito, idx, porId, listaEfectiva, tipoDoc, cliente, emisor, lotesIdx, existencias, ctxLotes,
    permitido, puedeVender, puedeConfigurar, puedeDescontar, pagos, plazo, credito, hoy,
  });
  const esperandoAprobacion = !!pedido?.pedido.descuento_solicitud_id;
  const puedeGuardar = !v.bloqueoGuardar && !guardando;

  const empezarOtra = ({ soltar = false } = {}) => {
    if (soltar && sesion) reservar(sesion, { porLote: [] }).catch(e => console.error('venta: soltar reserva', e));
    setMiReserva(null);
    setClienteId(''); setListaVenta(''); setCarrito([]); setTipoDoc('01');
    setPagos([filaNueva()]); setPlazo(''); setNotas(''); setMotivoDescuento('');
    setUuid(uuidV4()); setError('');
    pendientesDesde().then(setPendientes).catch(e => console.error('venta: pendientes', e));
  };
  const releerPendientes = useCallback(() => {
    pendientesDesde().then(setPendientes).catch(e => console.error('venta: pendientes', e));
  }, []);

  /**
   * Guardar: 'preventa', 'aprobacion' (preventa + pedir el descuento) o
   * 'facturar'. Devuelve a dónde ir: `{ documento }`, `{ otra: true }` (la
   * pantalla queda lista para la siguiente), `{ sinSenal }` o `{ inicio }`.
   */
  const guardar = async (modo) => {
    const yFacturar = modo === 'facturar';
    // Sólo consulta (soloConsulta.js): la pantalla no ofrece facturar; esto es la red.
    if (yFacturar && !ACCIONES_DE_DINERO) return {};
    setGuardando(modo);
    setError('');
    const { lineas, venta, porAprobar, plazoNum } = v;
    const renglones = renglonesParaGuardar(lineas, listaEfectiva);
    const { condicion, formaPago } = cabeceraDePago(pagos);
    // Sin señal: la venta se guarda en el teléfono y sale en contingencia al
    // volver. Sólo una venta NUEVA: corregir una preventa necesita la base.
    const venderSinSenal = () => {
      const entrada = guardarVentaSinSenal({
        emisorId: emisor.id, clienteId: cliente.id, tipoDocumento: tipoDoc, condicion, plazoDias: plazoNum,
        formaPago, observaciones: notas, clientUuid: uuid, renglones, pagos: pagosParaGuardar(pagos),
        resumen: { cliente: cliente.nombre, total: venta.total, productos: lineas.length },
      });
      anotar('DISTRIBUCION_VENTA_SIN_SENAL', entrada.codigo_generacion, { cliente: cliente.id, total: venta.total });
      descartar();
      empezarOtra();
      return { sinSenal: entrada };
    };
    try {
      let id = pedido?.pedido.id;
      if (corrigiendo) {
        await actualizarPedido(id, { tipoDocumento: tipoDoc, condicion, plazoDias: plazoNum, formaPago, observaciones: notas, renglones });
      } else {
        id = await crearPedido({
          desdeCamion, emisorId: emisor.id, clienteId: cliente.id, tipoDocumento: tipoDoc,
          condicion, plazoDias: plazoNum, formaPago, observaciones: notas, clientUuid: uuid, renglones,
        });
      }
      if (sesion && !yFacturar) {
        await reservar(sesion, { clienteId: cliente.id, pedidoId: id, porLote: porLoteDe(carrito) })
          .catch(e => console.error('venta: reserva de la preventa', e));
      }
      const filasDePago = pagosParaGuardar(pagos);
      await guardarPagos(id, pagos.map((f, i) => ({
        ...filasDePago[i],
        ...(f.existente?.comprobante_url ? {
          comprobante_url: f.existente.comprobante_url, lectura: f.existente.lectura,
          monto_leido: f.existente.monto_leido, verificacion: f.existente.verificacion, nota: f.existente.nota,
        } : {}),
      })));
      let pedida = false;
      if (porAprobar.length || esperandoAprobacion) {
        try {
          pedida = !!(await pedirDescuento(id, motivoDescuento));
        } catch (e) {
          aviso('No se pudo pedir el descuento', `${mensajeDeDistribucion(e)} La venta quedó guardada: vuelve a abrirla para pedirlo.`);
        }
      }
      anotar(corrigiendo ? 'DISTRIBUCION_PEDIDO_CORREGIDO' : 'DISTRIBUCION_PEDIDO_CREADO', id, { modo, descuento_pedido: pedida });
      descartar();
      if (!yFacturar) {
        listo(pedida ? 'Enviada a aprobación' : 'Preventa guardada',
          pedida ? 'Queda como preventa hasta que aprueben el descuento.' : 'Queda en Pendientes para facturarla después.');
        empezarOtra();
        return { otra: true };
      }
      try {
        const factura = await facturarPedido(id);
        if (factura.estado === 'sellado') {
          listo('Recibido por Hacienda', `Sello listo · ${factura.numero_control}`);
        } else if (factura.estado === 'rechazado') {
          aviso('Hacienda lo rechazó', 'Corrige lo que indica y vuelve a facturar. La mercadería sigue apartada para este pedido.');
        } else {
          aviso('Facturado, falta el sello de Hacienda', factura.aviso ?? 'Quedó guardado: reenvíalo desde el documento o desde Facturación.');
        }
        return { documento: factura.dte_id };
      } catch (e) {
        // El pedido se guardó y la señal se cayó al facturar: a la cola.
        if (!corrigiendo && esErrorDeRed(e)) return venderSinSenal();
        aviso('Pedido guardado sin facturar', mensajeDeDistribucion(e));
        return { inicio: true };
      }
    } catch (e) {
      if (yFacturar && !corrigiendo && esErrorDeRed(e)) return venderSinSenal();
      setError(mensajeDeDistribucion(e));
      return null;
    } finally {
      setGuardando(null);
    }
  };

  /** Vaciar una venta nueva, o ANULAR la preventa que se está corrigiendo. */
  const borrar = async (motivo) => {
    if (!corrigiendo) {
      descartar();
      empezarOtra({ soltar: true });
      return { otra: true };
    }
    const id = pedido.pedido.id;
    try {
      await anularPedido(id, (motivo ?? '').trim() || 'Preventa borrada desde la venta');
      anotar('DISTRIBUCION_PEDIDO_ANULADO', id, { desde: 'venta' });
      listo('Preventa borrada', `La venta ${id} ya no sale en Pendientes.`);
      empezarOtra();
      return { otra: true };
    } catch (e) {
      setError(mensajeDeDistribucion(e));
      return null;
    }
  };

  /** Quitar del carrito lo que se anotó como venta perdida. */
  const alAnotarPerdida = (clave, cantidad) => {
    if (clave == null) return;
    setCarrito(cs => cs.flatMap(c => {
      if (c.clave !== clave) return [c];
      const queda = (leerMonto(c.cantidad) ?? 0) - cantidad;
      return queda > 0 ? [{ ...c, cantidad: conCantidad(queda) }] : [];
    }));
  };

  const releerClientes = async (elegir) => {
    const cs = await fetchClientes();
    setClientes(cs);
    if (elegir) cambiarCliente(String(elegir), cs);
  };

  const rotuloCredito = !tieneCredito ? null
    : credito && Number(credito.saldo) > 0
      ? `Debe ${formatMoney(credito.saldo)}${Number(credito.dias_atraso) > 0 ? ` · ${credito.dias_atraso} días de atraso` : ''} · disponible ${formatMoney(credito.disponible)}`
      : `Crédito ${formatMoney(cliente.limite_credito)} · ${cliente.plazo_dias} días`;

  return {
    // permisos y carga
    corrigiendo, puedeVender, puedeDescontar, cargando, errorCarga, emisor, pedido, user,
    // catálogos
    clientes, catalogo, idx, porId, permitido, listaBase, listaEfectiva, existencias, quienTiene,
    // la venta
    cliente, clienteId, cambiarCliente, tipoDoc, setTipoDoc, cambiarLista, carrito, setCarrito,
    agregar, cambiar, cambiarYRepartir, sumar, quitar, pagos, setPagos, cambiarFormaPago, plazo, setPlazo,
    notas, setNotas, motivoDescuento, setMotivoDescuento, tieneCredito, credito, rotuloCredito, miCaja,
    tieneCamion, desdeCamion, setDesdeCamion, minutosReserva, avisoReserva, esperandoAprobacion,
    ...v, puedeGuardar, guardando, error, setError,
    // acciones
    guardar, borrar, alAnotarPerdida, releerClientes, pendientes, releerPendientes,
  };
}
