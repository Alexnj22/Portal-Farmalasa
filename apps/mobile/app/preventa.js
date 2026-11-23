// Preventa, NATIVA — `PreventaView` del portal: vender desde el teléfono y que
// la venta llegue armada a caja. Antes se abría como el portal dentro de la app
// (usuario, 2026-11-17: «haz pantalla nativa de preventa»).
//
//   · «Vender»: el cliente (buscar, su ficha, lo que suele llevar y sus
//     últimas compras), los productos (buscar o escanear; lote, presentación,
//     cantidad y precio), el comprobante, cómo paga, los puntos, la nota, lo
//     que falta para enviar con qué hacer, y «Enviar a caja». Corregir
//     reescribe la MISMA preventa en caja.
//   · «Preventas»: las de la sucursal (hoy, 7 o 30 días), con Corregir,
//     Repetir y Anular.
//
// Todo lo que decide es del núcleo, lo mismo que el portal: el precio lo
// calcula la base (`cotizarPreventa`) en cada cambio y otra vez al enviar
// (`enviarPreventaDirecta` frena si el total cambió); `problemasDeVenta` dice
// qué impide enviar. Guarda borrador por sucursal.
//
// Lo que en el portal es un diálogo, aquí es su pantalla nativa: «Otras
// sucursales» abre Pedir a otra sala con el producto, «Apartar o encargar»
// abre la suya, y completar los datos del cliente abre su ficha. Al volver se
// vuelve a cotizar.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Stack, router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import {
  anularPreventa, cotizarPreventa, enviarPreventaDirecta, fetchClienteDePreventa, fetchPreventasDeSala, fotosDeProductos, lotesDePreventa,
} from '@nucleo/data/preventas';
import {
  MAX_PRODUCTOS, PAGOS, agregarConCantidad, agregarLinea, desgloseDeVenta, descuentoDePuntos, faltanParaCcf, lineasDeVenta, lineasParaCotizar, lineasParaEnviar,
  maximoDePuntos, problemasDeVenta, queCompletar, totalesDe,
} from '@nucleo/utils/preventaDirecta';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tomarSaldoUsado } from '../componentes/reservas/saldoUsado';
import { ligarSaldoAPreventa, soltarSaldoAFavor } from '@nucleo/data/reservas';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_FIJA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Vacio } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import Subfiltro from '../componentes/Subfiltro';
import FijoArriba from '../componentes/FijoArriba';
import Refrescar from '../componentes/Refrescar';
import Vidrio from '../componentes/Vidrio';
import Escaner from '../componentes/Escaner';
import { Presionable as Pressable } from '../componentes/Tocable';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, avisar } from '../componentes/Progreso';
import { Eleccion } from '../componentes/torogoz/venta/Piezas';
import Linea, { BotonChico, Miniatura, sinTeclas } from '../componentes/preventa/Linea';
import Cliente from '../componentes/preventa/Cliente';
import Tarjeta from '../componentes/preventa/Tarjeta';

const PESTANAS = [{ id: 'nueva', label: 'Vender' }, { id: 'hoy', label: 'Preventas' }];
const DOCUMENTOS = [{ value: 'consumidor_final', label: 'Factura · consumidor final' }, { value: 'credito_fiscal', label: 'Crédito fiscal · con NIT y NRC' }];
const DIAS = [{ id: '1', label: 'Hoy' }, { id: '7', label: '7 días' }, { id: '30', label: '30 días' }];
const VACIA = { cliente: null, lineas: [], documento: 'consumidor_final', pago: 'contado', puntos: '', nota: '', corrigiendo: null, saldo: null };
const claveDe = (l) => `${l.producto_id}-${l.factor}`;

function Fila({ rotulo, valor, color, fuerte }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
      <Text style={{ color: fuerte ? colorSistema.texto : colorSistema.texto2, fontSize: fuerte ? 16 : 14, fontWeight: fuerte ? '700' : '400' }}>{rotulo}</Text>
      <Text style={{ color: color ?? colorSistema.texto, fontSize: fuerte ? 28 : 15, fontWeight: fuerte ? '900' : '600', fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}

// ── Buscar producto (o escanear) ───────────────────────────────────────────
function BuscarProducto({ onElegir }) {
  const [texto, setTexto] = useState('');
  const q = useTextoRebotado(texto, 150);
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  useEffect(() => {
    let vivo = true;
    if (q.trim().length < 2) { setResultados([]); setBuscando(false); return undefined; }
    setBuscando(true);
    buscarProductosMinMax(q, 8).then(({ filas }) => { if (vivo) { setResultados(filas ?? []); setBuscando(false); } });
    return () => { vivo = false; };
  }, [q]);
  const elegir = (p) => { setTexto(''); setResultados([]); onElegir(p); };
  const alEscanear = async (codigo) => {
    const { filas } = await buscarProductosMinMax(codigo, 2);
    if (!filas?.length) { avisar('No está en el catálogo', `Nada con el código ${codigo}.`); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setEscaneando(false);
    elegir(filas[0]);
    return true;
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar producto" autoCorrect={false}
            clearButtonMode="while-editing" accessibilityLabel="Buscar producto" returnKeyType="search"
            onSubmitEditing={() => { if (resultados[0]) elegir(resultados[0]); }} />
        </View>
        <BotonChico texto="Escanear" onPress={() => setEscaneando(true)} />
      </View>
      {resultados.map((p, i) => (
        <Pressable key={p.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); elegir(p); }} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 4,
            borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
          <Miniatura src={p.foto_url} tamano={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{p.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{[p.principio_activo, p.laboratorio_nombre].filter(Boolean).join(' · ')}</Text>
          </View>
          <Text style={{ color: MARCA.azulClaro, fontSize: 20, fontWeight: '700' }}>+</Text>
        </Pressable>
      ))}
      {buscando ? <Aviso texto="Buscando…" /> : null}
      {!buscando && q.trim().length >= 2 && !resultados.length
        ? <Aviso texto={`Sin resultados para «${q.trim()}». Prueba con el principio activo o menos letras.`} /> : null}
      <Escaner visible={escaneando} titulo="Agregar un producto" ayuda="Apunta al código de barras del producto"
        onCodigo={alEscanear} onCerrar={() => setEscaneando(false)} />
    </View>
  );
}

// ── Lo que falta para enviar, con qué hacer ────────────────────────────────
function Pendientes({ problemas, revisando, onResolver }) {
  if (revisando && !problemas.length) return <Aviso texto="Revisando precios y existencia…" />;
  if (!problemas.length) return null;
  const vacia = problemas.length === 1 && problemas[0].clave === 'vacia';
  return (
    <View style={{ borderRadius: 16, padding: 12, gap: 10, backgroundColor: vacia ? 'rgba(127,127,127,0.13)' : `${MARCA.rojo}14`,
      borderWidth: vacia ? 0 : 1, borderColor: `${MARCA.rojo}55` }} accessibilityRole="summary">
      {!vacia ? <Text style={{ color: MARCA.rojo, fontSize: 13, fontWeight: '800' }}>Antes de enviar · {problemas.length}</Text> : null}
      {problemas.map((p) => (
        <View key={p.clave} style={{ gap: 4 }}>
          <Text style={{ color: vacia ? colorSistema.texto2 : MARCA.rojo, fontSize: 14, fontWeight: '700' }}>{sinTeclas(p.titulo)}</Text>
          {p.ayuda ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{sinTeclas(p.ayuda)}</Text> : null}
          {p.acciones.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
              {p.acciones.filter((a) => a.id !== 'buscar').map((a) => <BotonChico key={`${a.id}-${a.label}`} texto={a.label} onPress={() => onResolver(p, a)} />)}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ── Lo que quedó en caja ───────────────────────────────────────────────────
function Hecho({ resultado, onOtra, onVer }) {
  return (
    <View style={{ gap: 14 }}>
      <Vidrio radio={22}>
        <View style={{ padding: 24, gap: 8, alignItems: 'center' }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '800' }}>{resultado.corregida ? 'Corrección guardada en caja' : 'Preventa en caja'}</Text>
          <Text style={{ color: MARCA.azulClaro, fontSize: 44, fontWeight: '900', fontVariant: ['tabular-nums'] }}>#{resultado.referencia}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 16, textAlign: 'center' }}>
            {resultado.cliente ?? 'Cliente frecuente'} · {formatMoney(resultado.total_caja ?? resultado.total)}
            {resultado.puntos > 0 ? ` · ${resultado.puntos} puntos canjeados` : ''}
          </Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Dile al cliente que pase a caja con el número #{resultado.referencia}.</Text>
          {(resultado.avisos ?? []).map((a) => <Aviso key={a} tono="cuidado" texto={a} />)}
          {resultado.saldo ? <Aviso texto={resultado.saldo.alCredito
            ? `Caja la factura al crédito por el total. Después, en Reservas › Saldo por aplicar, abona los ${formatMoney(Number(resultado.saldo.monto))} del saldo ${resultado.saldo.codigo}. Lo que falte se cobra en Cuentas por cobrar.`
            : `Caja la factura al contado por el total y cobra lo que falte. Después, en Reservas › Saldo por aplicar, haz el vale por los ${formatMoney(Number(resultado.saldo.monto))} del saldo ${resultado.saldo.codigo}.`} /> : null}
        </View>
      </Vidrio>
      <BotonGrande texto="Nueva preventa" onPress={onOtra} />
      <BotonGrande texto="Ver preventas" borde onPress={onVer} />
    </View>
  );
}

export default function Preventa() {
  const { user, hasPermission, getScope } = useAuth();
  const todas = getScope('preventa') === 'ALL';
  const puedeVender = hasPermission('preventa', 'can_edit');
  const puedeAutorizar = hasPermission('preventa', 'can_approve');
  const puedeEditarClientes = hasPermission('clientes', 'can_edit');
  const puedeCrearClientes = hasPermission('clientes_crear');
  const puedeApartar = hasPermission('reservas', 'can_edit') || hasPermission('dash_reservas', 'can_edit');
  const miSala = user?.branchId ?? user?.branch_id ?? null;
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA')
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true })), [branches]);
  const [salaElegida, setSalaElegida] = useState(null);
  const sala = todas ? Number(salaElegida ?? miSala ?? salas[0]?.id) || null : miSala;
  const nombreSala = salas.find((b) => Number(b.id) === Number(sala))?.name ?? '';
  const [pestana, setPestana] = useState('nueva');

  // ── El borrador: una venta por sucursal ───────────────────────────────
  const claveBorrador = `preventa-${sala ?? 'x'}`;
  const [borrador, setBorrador] = useState({ clave: claveBorrador, venta: { ...VACIA, ...(loadDraft(claveBorrador) ?? {}) } });
  const venta = borrador.clave === claveBorrador ? borrador.venta : { ...VACIA, ...(loadDraft(claveBorrador) ?? {}) };
  const setVenta = useCallback((v) => setBorrador((b) => {
    const actual = b.clave === claveBorrador ? b.venta : { ...VACIA, ...(loadDraft(claveBorrador) ?? {}) };
    return { clave: claveBorrador, venta: typeof v === 'function' ? v(actual) : v };
  }), [claveBorrador]);
  useEffect(() => {
    if (borrador.clave !== claveBorrador) return;
    if (borrador.venta.lineas.length || borrador.venta.cliente) saveDraft(claveBorrador, borrador.venta);
    else clearDraft(claveBorrador);
  }, [borrador, claveBorrador]);
  const cambiar = (cambio) => setVenta((v) => ({ ...v, ...cambio }));

  // ── Cotizar en cada cambio (y al volver de otra pantalla) ─────────────
  const [cotizacion, setCotizacion] = useState(null);
  const [cotizando, setCotizando] = useState(false);
  const [errorCotizar, setErrorCotizar] = useState('');
  const [vuelta, setVuelta] = useState(0);
  useFocusEffect(useCallback(() => { setVuelta((n) => n + 1); }, []));
  const pedido = useMemo(() => JSON.stringify(lineasParaCotizar(venta.lineas)), [venta.lineas]);
  const clienteId = venta.cliente?.id ?? null;
  useEffect(() => {
    if (!sala) return undefined;
    let vivo = true;
    const t = setTimeout(() => {
      setCotizando(true);
      cotizarPreventa(sala, clienteId, JSON.parse(pedido))
        .then((c) => { if (vivo) { setCotizacion(c); setErrorCotizar(''); } })
        .catch((e) => { if (vivo) setErrorCotizar(mensajeAmigable(e, 'No se pudieron revisar los precios.')); })
        .finally(() => { if (vivo) setCotizando(false); });
    }, 200);
    return () => { vivo = false; clearTimeout(t); };
  }, [sala, clienteId, pedido, vuelta]);

  // ── La ficha del cliente ──────────────────────────────────────────────
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (!sala || !clienteId) { Promise.resolve().then(() => { if (vivo) setInfo(null); }); return () => { vivo = false; }; }
    fetchClienteDePreventa(sala, clienteId)
      .then((d) => { if (vivo) setInfo(d); })
      .catch((e) => { if (vivo) { setInfo(null); console.error('preventa: ficha del cliente', e); } });
    return () => { vivo = false; };
  }, [sala, clienteId, vuelta]);

  // ── Fotos de los productos que entraron sin el buscador ───────────────
  const [fotos, setFotos] = useState(() => new Map());
  const sinFoto = venta.lineas.filter((l) => !l.foto_url && !fotos.has(l.producto_id)).map((l) => l.producto_id).join(',');
  useEffect(() => {
    if (!sinFoto) return undefined;
    let vivo = true;
    fotosDeProductos(sinFoto.split(',')).then((m) => {
      if (vivo) setFotos((prev) => new Map([...prev, ...sinFoto.split(',').map((id) => [Number(id), m.get(Number(id)) ?? null])]));
    });
    return () => { vivo = false; };
  }, [sinFoto]);

  // ── Los lotes de cada producto en la sucursal ─────────────────────────
  const [lotes, setLotes] = useState(() => new Map());
  const idsDeLotes = [...new Set(venta.lineas.map((l) => l.producto_id))].sort((a, b) => a - b).join(',');
  useEffect(() => {
    let vivo = true;
    if (!sala || !idsDeLotes) { Promise.resolve().then(() => { if (vivo) setLotes(new Map()); }); return () => { vivo = false; }; }
    lotesDePreventa(sala, idsDeLotes.split(','))
      .then((m) => { if (vivo) setLotes(m); })
      .catch((e) => { if (vivo) console.error('preventa: lotes', e); });
    return () => { vivo = false; };
  }, [sala, idsDeLotes, vuelta]);

  const filaDe = (l) => (cotizacion?.lineas ?? []).find((x) => x.producto_id === l.producto_id && x.factor === l.factor);
  const totales = totalesDe(cotizacion);
  const puntos = Math.trunc(Number(venta.puntos) || 0);
  const descPuntos = descuentoDePuntos(puntos, info?.puntos?.valor);
  const aPagar = Math.max(0, Math.round((totales.total - descPuntos) * 100) / 100);
  // Crédito fiscal o cliente que retiene: sumas, IVA y retención antes de
  // enviar, como el portal (v2.1579.5). Sólo se MUESTRA.
  const desgloseVenta = useMemo(() => (venta.cliente
    ? desgloseDeVenta({ lineas: cotizacion?.lineas, documento: venta.documento, retencionPct: info?.retencion_pct, descuento: descPuntos })
    : null), [venta.cliente, venta.documento, cotizacion?.lineas, info?.retencion_pct, descPuntos]);
  const maxPuntos = maximoDePuntos(info, totales.total);
  // Saldo a favor (2026-11-21): es un PAGO, no un descuento (gemelo del portal).
  // La factura sale por el total; el saldo apartado se aplica después en
  // Reservas. Salió de efectivo y lo demás en efectivo: contado; si no, crédito.
  const saldoUsado = Number(venta.saldo?.monto ?? 0);
  const topeDeSaldo = Math.max(0, Math.round((aPagar - saldoUsado) * 100) / 100);
  const saldoAlCredito = Boolean(venta.saldo) && !(venta.saldo.efectivo && venta.pago === 'contado');
  const pagoQueViaja = saldoAlCredito ? 'credito' : venta.pago;
  useFocusEffect(useCallback(() => {
    const apartado = tomarSaldoUsado();
    if (apartado?.uso_id) setVenta((v) => ({ ...v, saldo: apartado }));
  }, [setVenta]));
  const quitarSaldo = async () => {
    const sa = venta.saldo;
    cambiar({ saldo: null });
    if (!sa?.uso_id) return;
    try { await soltarSaldoAFavor(sa.uso_id, 'Se quitó de la preventa'); }
    catch (e) { fallo('No se pudo devolver el saldo', `${mensajeAmigable(e)} Suéltalo desde Reservas.`); }
  };

  const problemas = useMemo(() => {
    if (errorCotizar) return [{ clave: 'cotizar', titulo: errorCotizar, ayuda: 'Revisa la conexión e intenta de nuevo.', acciones: [{ id: 'reintentar', label: 'Reintentar' }] }];
    return problemasDeVenta({ lineas: venta.lineas, cotizacion: cotizando ? null : cotizacion, documento: venta.documento,
      pago: venta.pago, puntos, infoCliente: info, hayCliente: Boolean(venta.cliente) })
      .map((p) => ({ ...p, acciones: p.acciones.filter((a) => (a.id !== 'apartar' || puedeApartar) && (a.id !== 'editar' || puedeEditarClientes)) }));
  }, [errorCotizar, venta.lineas, venta.documento, venta.pago, venta.cliente, cotizacion, cotizando, puntos, info, puedeApartar, puedeEditarClientes]);
  const revisando = !errorCotizar && venta.lineas.length > 0 && (cotizando || !cotizacion);
  const problemaDeLinea = (l) => problemas.find((p) => p.linea === claveDe(l));
  const clienteConProblema = problemas.some((p) => p.clave === 'ccf' || p.clave === 'credito');
  const faltanCcf = venta.documento === 'credito_fiscal' && venta.cliente && cotizacion ? faltanParaCcf(cotizacion.cliente) : [];

  const ponerLinea = (i, cambio) => cambiar({ lineas: venta.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) });
  const quitarLinea = (i) => cambiar({ lineas: venta.lineas.filter((_, j) => j !== i) });
  const agregarProducto = (p) => {
    if (venta.lineas.length >= MAX_PRODUCTOS && !venta.lineas.some((l) => l.producto_id === Number(p.id) && l.factor === 1)) {
      avisar('Llegaste al tope', `Una preventa lleva hasta ${MAX_PRODUCTOS} productos. Envía esta y empieza otra.`);
      return;
    }
    cambiar({ lineas: agregarLinea(venta.lineas, p, 1) });
  };
  // Lo de una compra pasada entra con SU cantidad y SU presentación, como el portal.
  const deCompra = (lineas, p) => agregarConCantidad(lineas, { id: p.producto_id, nombre: p.nombre, foto_url: p.foto_url },
    Number(p.factor) || 1, Number(p.cantidad) || 1);
  const agregarDeCompra = (p) => {
    const f = Number(p.factor) || 1;
    if (venta.lineas.length >= MAX_PRODUCTOS && !venta.lineas.some((l) => l.producto_id === Number(p.producto_id) && l.factor === f)) {
      avisar('Llegaste al tope', `Una preventa lleva hasta ${MAX_PRODUCTOS} productos. Envía esta y empieza otra.`);
      return;
    }
    cambiar({ lineas: deCompra(venta.lineas, p) });
  };
  const agregarVarios = (productos) => {
    let lineas = venta.lineas;
    for (const p of productos) {
      if (lineas.length >= MAX_PRODUCTOS) break;
      lineas = deCompra(lineas, p);
    }
    cambiar({ lineas });
    listo('Agregados', `${productos.length} producto(s) de esa compra, con sus cantidades.`);
  };
  const elegirCliente = (c) => cambiar({ cliente: c ? { id: c.id, name: c.name, phone: c.phone ?? null } : null, puntos: '' });
  // Como el portal: la ficha se abre marcando qué le falta para el documento
  // elegido (`queCompletar`); viaja por la dirección como JSON.
  const editarCliente = () => {
    if (!venta.cliente) return;
    const completar = queCompletar(venta.documento, info ?? cotizacion?.cliente);
    router.push({ pathname: '/cliente/[id]', params: { id: String(venta.cliente.id), ...(completar ? { completar: JSON.stringify(completar) } : {}) } });
  };
  // Con el reparto del aviso, el pedido abre con la primera sucursal y su
  // cantidad puestas y las demás ya en la solicitud (2026-11-23).
  const otrasSucursales = (linea, reparto = null) => {
    const conReparto = Array.isArray(reparto) && reparto.length > 0 && reparto[0].erp_sucursal_id != null;
    router.push(linea
      ? { pathname: '/pedir-traslado', params: { producto: String(linea.producto_id), descripcion: filaDe(linea)?.nombre ?? linea.nombre ?? '',
          ...(conReparto ? { origen: String(reparto[0].erp_sucursal_id),
            reparto: JSON.stringify(reparto.map((r) => ({ erp_sucursal_id: r.erp_sucursal_id, unidades: r.unidades }))) } : {}) } }
      : '/pedir-traslado');
  };
  const apartar = () => router.push({ pathname: '/reserva-anticipo', params: { sala: String(sala) } });

  const resolver = (p, a) => {
    const i = p.linea ? venta.lineas.findIndex((l) => claveDe(l) === p.linea) : -1;
    const linea = i >= 0 ? venta.lineas[i] : null;
    switch (a.id) {
      case 'ajustar': if (i >= 0) ponerLinea(i, { cantidad: a.valor }); break;
      case 'otras': otrasSucursales(linea, a.valor); break;
      case 'apartar': apartar(); break;
      case 'quitar': if (i >= 0) quitarLinea(i); break;
      case 'editar': editarCliente(); break;
      case 'factura': cambiar({ documento: 'consumidor_final' }); break;
      case 'ccf': cambiar({ documento: 'credito_fiscal' }); break;
      case 'contado': cambiar({ pago: 'contado' }); break;
      case 'puntos': cambiar({ puntos: a.valor ? String(a.valor) : '' }); break;
      case 'reintentar': setVuelta((n) => n + 1); break;
      default: break;
    }
  };

  // ── Las preventas de la sucursal ──────────────────────────────────────
  const [dias, setDias] = useState('1');
  const [lista, setLista] = useState(null);
  const [errorLista, setErrorLista] = useState('');
  const [recargando, setRecargando] = useState(false);
  const recargar = useCallback(async () => {
    if (!sala) return;
    try { setLista(await fetchPreventasDeSala(sala, Number(dias))); setErrorLista(''); }
    catch (e) { setErrorLista(mensajeAmigable(e, 'No se pudieron leer las preventas.')); }
  }, [sala, dias]);
  useEffect(() => { recargar(); }, [recargar, vuelta]);

  // ── Enviar o corregir ─────────────────────────────────────────────────
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const bloqueada = problemas.length > 0 || revisando;
  const enviar = async () => {
    if (bloqueada || enviando || !puedeVender) return;
    setEnviando(true);
    const notaSaldo = venta.saldo ? `Saldo ${venta.saldo.codigo} $${saldoUsado.toFixed(2)}: facturar total` : '';
    const r = await enviarPreventaDirecta({
      branchId: sala, customerId: clienteId, documento: venta.documento, pago: pagoQueViaja, puntos,
      nota: [notaSaldo, venta.nota].filter(Boolean).join(' · ').slice(0, 120),
      lineas: lineasParaEnviar(venta.lineas), preventaId: venta.corrigiendo?.id ?? null,
      totalEsperado: aPagar,
    });
    setEnviando(false);
    if (!r?.ok) { fallo('No llegó a caja', `${r?.error ?? 'Algo falló.'} Revisa la venta e intenta de nuevo.`); setVuelta((n) => n + 1); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const idPreventa = Number(typeof r.preventa === 'object' ? r.preventa?.id : r.preventa);
    if (venta.saldo?.uso_id && idPreventa > 0) {
      ligarSaldoAPreventa(venta.saldo.uso_id, idPreventa).catch((e) => console.error('preventa: ligar saldo', e));
    }
    setResultado({ ...r, total: aPagar, puntos, cliente: venta.cliente?.name ?? null,
      saldo: venta.saldo ? { ...venta.saldo, alCredito: saldoAlCredito } : null });
    setVenta(VACIA);
    clearDraft(claveBorrador);
    recargar();
  };

  const desdeGuardada = (p) => ({
    ...VACIA, lineas: lineasDeVenta(p.venta).map((l) => (puedeAutorizar ? l : { ...l, lista: null })),
    cliente: p.customer_id ? { id: p.customer_id, name: p.cliente } : null,
  });
  const corregir = (p) => {
    setVenta({
      ...desdeGuardada(p),
      documento: p.venta?.documento === 'credito_fiscal' ? 'credito_fiscal' : 'consumidor_final',
      pago: p.venta?.pago ?? 'contado', puntos: p.venta?.puntos ? String(p.venta.puntos) : '',
      corrigiendo: { id: p.id, codigo: p.codigo, referencia: p.externo_ref },
    });
    setResultado(null);
    setPestana('nueva');
  };
  const repetir = (p) => { setVenta(desdeGuardada(p)); setResultado(null); setPestana('nueva'); };
  const nombreDe = (p) => (p.externo_ref ? `#${p.externo_ref}` : p.codigo);
  const anular = (p) => Alert.alert(`¿Anular la preventa ${nombreDe(p)}?`, 'Se borra de caja y ya no se puede facturar. No se puede deshacer.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: async () => {
      const r = await anularPreventa(p.id);
      if (!r?.ok && r?.no_en_caja) {
        Alert.alert(`La ${nombreDe(p)} ya no está en caja`, '¿La borraron en caja? Si es así, se marca anulada aquí. Si se facturó, aparece como facturada en un momento.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sí, la borraron', style: 'destructive', onPress: async () => {
            const r2 = await anularPreventa(p.id, true);
            if (!r2?.ok) { fallo('No se pudo anular', r2?.error ?? 'Intenta de nuevo.'); return; }
            listo('Preventa anulada', `La ${nombreDe(p)} ya no está en caja.`);
            recargar();
          } },
        ]);
        return;
      }
      if (!r?.ok) { fallo('No se pudo anular', r?.error ?? 'Intenta de nuevo.'); return; }
      listo('Preventa anulada', `La ${nombreDe(p)} ya no está en caja.`);
      recargar();
    } },
  ]);
  const hayVenta = Boolean(venta.lineas.length || venta.cliente || venta.corrigiendo);
  const vaciar = () => Alert.alert(venta.corrigiendo ? '¿Dejar de corregir?' : '¿Vaciar la venta?',
    venta.corrigiendo ? 'La preventa en caja queda como estaba.' : 'Se quitan el cliente y los productos.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: venta.corrigiendo ? 'Dejar de corregir' : 'Vaciar', style: 'destructive', onPress: () => setVenta(VACIA) },
    ]);

  const enCaja = (lista ?? []).filter((p) => p.estado === 'viva').length;
  const pestanas = PESTANAS.map((t) => (t.id === 'hoy' && enCaja ? { ...t, label: `Preventas (${enCaja})` } : t));
  const opcionesSala = salas.map((b) => ({ value: String(b.id), label: b.name }));

  return (
    <>
      <Stack.Screen options={{ ...BARRA_FIJA, title: 'Preventa' }} />
      {sala ? (
        <FijoArriba>
          <Segmentos opciones={pestanas} activa={pestana} onCambiar={setPestana} />
        </FijoArriba>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
          refreshControl={pestana === 'hoy' ? <Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await recargar(); setRecargando(false); }} /> : undefined}>
          {!sala ? <Vacio titulo="Sin sucursal" detalle="Tu usuario no tiene sucursal asignada." /> : null}
          {sala && todas && opcionesSala.length > 1 ? (
            <Vidrio radio={18}><View style={{ paddingHorizontal: 14 }}>
              <Eleccion rotulo="Sucursal" valor={String(sala)} opciones={opcionesSala} onCambiar={(v) => v && setSalaElegida(v)} />
            </View></Vidrio>
          ) : null}

          {sala && pestana === 'nueva' ? (
            resultado ? (
              <Hecho resultado={resultado} onOtra={() => setResultado(null)} onVer={() => { setResultado(null); setPestana('hoy'); }} />
            ) : (
              <>
                <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                  Llega a caja de <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{nombreSala}</Text> con tu nombre como vendedor.
                </Text>
                {venta.corrigiendo ? (
                  <View style={{ borderRadius: 16, padding: 12, gap: 8, backgroundColor: `${MARCA.azulInfo}1F` }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 14 }}>
                      Corrigiendo la preventa {venta.corrigiendo.referencia ? `#${venta.corrigiendo.referencia}` : venta.corrigiendo.codigo}. Al guardar, cambia la misma en caja.
                    </Text>
                    <BotonChico texto="Cancelar" onPress={() => setVenta(VACIA)} />
                  </View>
                ) : null}

                <Cliente cliente={venta.cliente} info={info} cotizacion={cotizacion} alerta={clienteConProblema} faltanCcf={faltanCcf}
                  puedeEditar={puedeEditarClientes} puedeCrear={puedeCrearClientes} onElegir={elegirCliente}
                  onAgregar={(p) => (p.cantidad != null
                    ? agregarDeCompra(p)
                    : agregarProducto({ id: p.producto_id, nombre: p.nombre, foto_url: p.foto_url }))}
                  onAgregarVarios={agregarVarios} />

                <Vidrio radio={20}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700' }}>
                      Productos{venta.lineas.length ? ` · ${venta.lineas.length}${venta.lineas.length >= MAX_PRODUCTOS - 5 ? ` de ${MAX_PRODUCTOS}` : ''}` : ''}
                    </Text>
                    <BuscarProducto onElegir={agregarProducto} />
                    {!venta.lineas.length ? <Aviso texto="Busca o escanea un producto para empezar." /> : null}
                  </View>
                </Vidrio>

                {venta.lineas.map((l, i) => (
                  <Linea key={claveDe(l)} linea={l} fila={filaDe(l)} cotizando={cotizando} problema={problemaDeLinea(l)} onResolver={resolver}
                    foto={l.foto_url ?? fotos.get(l.producto_id) ?? null} puedeAutorizar={puedeAutorizar} listaCliente={cotizacion?.lista}
                    lotes={lotes.get(l.producto_id)} onCambiar={(c) => ponerLinea(i, c)} onQuitar={() => quitarLinea(i)} />
                ))}

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <BotonChico texto="Otras sucursales" onPress={() => otrasSucursales(null)} />
                  {puedeApartar ? <BotonChico texto="Apartar o encargar" onPress={apartar} /> : null}
                </View>

                <Vidrio radio={20}>
                  <View style={{ padding: 14, gap: 10 }}>
                    <Eleccion rotulo="Comprobante" valor={venta.documento} opciones={DOCUMENTOS} onCambiar={(v) => cambiar({ documento: v })} />
                    <Eleccion rotulo="Tipo de pago" valor={venta.pago} opciones={PAGOS} onCambiar={(v) => cambiar({ pago: v || 'contado' })} />
                    {problemas.some((p) => p.clave === 'credito') ? <Aviso tono="freno" texto="El crédito necesita un cliente con datos." /> : null}

                    {info?.saldos_favor?.length > 0 || venta.saldo ? (
                      <View style={{ borderRadius: 14, padding: 12, gap: 8, backgroundColor: `${MARCA.azulClaro}1A` }}>
                        {(info?.saldos_favor ?? []).map((sf) => (
                          <View key={sf.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>
                              <Text style={{ fontWeight: '900' }}>{formatMoney(Number(sf.monto))}</Text> a favor · {sf.codigo} · vence {fechaTexto(sf.vence, { day: 'numeric', month: 'short' })}
                            </Text>
                            {venta.saldo?.reserva_id === sf.id
                              ? <BotonChico texto={`−${formatMoney(saldoUsado)} · Quitar`} color={colorSistema.texto2} onPress={quitarSaldo} />
                              : !venta.saldo && topeDeSaldo > 0
                                ? <BotonChico texto="Usar" color={MARCA.azulClaro} onPress={() => router.push({ pathname: '/reserva-saldo', params: { id: String(sf.id), codigo: sf.codigo, tope: topeDeSaldo.toFixed(2), preventa: '1' } })} /> : null}
                          </View>
                        ))}
                        {!venta.saldo && topeDeSaldo <= 0 ? <Aviso texto="Agrega productos para poder usarlo." /> : null}
                        {venta.saldo ? <Aviso texto={saldoAlCredito
                          ? 'Va al crédito por el total. Cuando caja la facture, aplica el saldo en Reservas y cobra lo que falte en Cuentas por cobrar.'
                          : 'Va al contado por el total. Cuando caja la facture, aplica el saldo en Reservas: sale un vale por el saldo.'} /> : null}
                      </View>
                    ) : null}

                    {info?.puntos?.puede_canjear ? (
                      <View style={{ borderRadius: 14, padding: 12, gap: 8, backgroundColor: `${MARCA.verde}1A` }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }}>
                            <Text style={{ fontWeight: '900' }}>{info.puntos.disponibles}</Text> puntos · desde {info.puntos.minimo_canje}
                          </Text>
                          {puntos > 0 && descPuntos > 0 ? <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '900' }}>−{formatMoney(descPuntos)}</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Campo multiline={false} keyboardType="number-pad" value={String(venta.puntos ?? '')} placeholder="Puntos a usar"
                              accessibilityLabel="Puntos a canjear" onChangeText={(t) => cambiar({ puntos: t.replace(/\D/g, '').slice(0, 5) })}
                              style={{ borderWidth: problemas.some((p) => p.clave === 'puntos') ? 1 : 0, borderColor: MARCA.rojo }} />
                          </View>
                          {maxPuntos >= info.puntos.minimo_canje && String(maxPuntos) !== String(venta.puntos)
                            ? <BotonChico texto={`Usar ${maxPuntos}`} color={MARCA.verde} onPress={() => cambiar({ puntos: String(maxPuntos) })} /> : null}
                          {puntos > 0 ? <BotonChico texto="No usar" color={colorSistema.texto2} onPress={() => cambiar({ puntos: '' })} /> : null}
                        </View>
                        {info.puntos.comprometidos > 0 ? <Aviso texto={`${info.puntos.comprometidos} ya apartados en otra preventa.`} /> : null}
                      </View>
                    ) : null}

                    <View style={{ gap: 4, borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 10 }}>
                      <Fila rotulo="Productos · unidades" valor={`${totales.productos} · ${totales.unidades}`} />
                      {totales.ahorro > 0 || descPuntos > 0 ? <Fila rotulo="Subtotal" valor={formatMoney(totales.total)} /> : null}
                      {totales.ahorro > 0 ? <Fila rotulo="Ahorra por su precio" valor={formatMoney(totales.ahorro)} color={MARCA.verde} /> : null}
                      {descPuntos > 0 ? <Fila rotulo={`Puntos (${puntos})`} valor={`−${formatMoney(descPuntos)}`} color={MARCA.verde} /> : null}
                      {desgloseVenta ? (
                        <>
                          <Fila rotulo={`Sumas${desgloseVenta.ccf ? ' sin IVA' : ''}`} valor={formatMoney(desgloseVenta.sumas)} />
                          {desgloseVenta.ccf ? <Fila rotulo="IVA 13 %" valor={formatMoney(desgloseVenta.iva)} /> : null}
                          {desgloseVenta.retencion > 0
                            ? <Fila rotulo={`Retención ${Number(info?.retencion_pct)} %`} valor={`−${formatMoney(desgloseVenta.retencion)}`} />
                            : null}
                        </>
                      ) : null}
                      {saldoUsado > 0 ? <Fila rotulo="Total de la factura" valor={formatMoney(desgloseVenta ? desgloseVenta.total : aPagar)} /> : null}
                      {saldoUsado > 0 ? <Fila rotulo={`Saldo a favor (${venta.saldo.codigo})`} valor={`−${formatMoney(saldoUsado)}`} color={MARCA.azulClaro} /> : null}
                      <Fila rotulo={saldoUsado > 0 ? 'Le falta pagar' : 'A pagar'} valor={formatMoney(Math.max(0, (desgloseVenta ? desgloseVenta.total : aPagar) - saldoUsado))} fuerte color={cotizando ? colorSistema.texto2 : colorSistema.texto} />
                      {desgloseVenta ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>La caja confirma el monto al cobrar.</Text> : null}
                    </View>

                    <Campo multiline={false} value={venta.nota} maxLength={60} placeholder="Nota para caja (opcional)"
                      accessibilityLabel="Nota para caja" onChangeText={(t) => cambiar({ nota: t })} />
                  </View>
                </Vidrio>

                <Pendientes problemas={problemas} revisando={revisando} onResolver={resolver} />

                <BotonGrande deshabilitado={!puedeVender || bloqueada || enviando} onPress={enviar}
                  texto={enviando ? 'Enviando…' : problemas.length > 0
                    ? `Resuelve ${problemas.length} pendiente${problemas.length > 1 ? 's' : ''}`
                    : venta.corrigiendo ? 'Guardar corrección' : 'Enviar a caja'} />
                {hayVenta ? <BotonGrande texto={venta.corrigiendo ? 'Dejar de corregir' : 'Vaciar venta'} borde color={MARCA.rojo} onPress={vaciar} /> : null}
                {!puedeVender ? <Aviso texto="Puedes mirar, pero no enviar preventas." /> : null}
              </>
            )
          ) : null}

          {sala && pestana === 'hoy' ? (
            <>
              <Subfiltro opciones={DIAS} activa={dias} onCambiar={setDias} />
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{enCaja} en caja sin facturar</Text>
              {errorLista ? <Aviso tono="freno" texto={errorLista} /> : null}
              {lista === null && !errorLista ? <Aviso texto="Cargando…" /> : null}
              {lista && !lista.length ? <Vacio titulo="Sin preventas" detalle="No hay preventas en este periodo." /> : null}
              <View style={{ gap: 12, marginHorizontal: -16 }}>
                {(lista ?? []).map((p) => (
                  <Tarjeta key={p.id} p={p} puedeVender={puedeVender}
                    onCorregir={() => corregir(p)} onRepetir={() => repetir(p)} onAnular={() => anular(p)} />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
