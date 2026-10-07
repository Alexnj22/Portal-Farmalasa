// Torogoz · el detalle de un pedido, NATIVO (`PedidoModal` del portal): quién
// lo tomó, la condición, el documento y su estado ante Hacienda, los productos
// con las cuentas del MISMO motor que arma el documento, los pagos con su
// comprobante, y lo que se puede hacer con él.
//
// ⚠️ «Facturar» y «Enviar a Hacienda» emiten o transmiten un documento fiscal:
// siempre con confirmación, y lo que contesta el servidor se muestra tal cual
// —incluido «quedó firmado y sin enviar», que NO es lo mismo que emitido—.
// Anular pide el motivo y vuelve a confirmar.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  LLEVA_COMPROBANTE, anularPedido, facturarPedido, fetchItemsDePedido, fetchPagos, fetchPedidos, mensajeDeDistribucion, reintentarDocumento,
} from '@nucleo/data/distribucion';
import { ESTADO_DOCUMENTO, FORMA_PAGO, TIPO_DOCUMENTO, rotuloTipoCliente } from '@nucleo/utils/distribucionComun';
import { VENTANA_PEDIDOS_DIAS, accionesDePedido, estadoDePedido } from '@nucleo/utils/distribucionPedidos';
import { calcularVenta } from '@nucleo/utils/distribucionMotor';
import { VERIFICACION_PAGO, nombreFormaPago } from '@nucleo/utils/distribucionFacturacion';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { BARRA_NATIVA } from '../../../componentes/PilaDePestana';
import { colorSistema } from '../../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../../componentes/formulario/Piezas';
import { Esqueleto } from '../../../componentes/inicio/Widget';
import { MARCA } from '../../../componentes/inicio/marca';
import Etiqueta from '../../../componentes/torogoz/rutas/Etiqueta';
import { pedidoRecordado } from '../../../componentes/torogoz/pedidos/elegido';
import { ACCIONES_DE_DINERO, SeHaceEnElPortal } from '../../../componentes/torogoz/soloConsulta';

const PETROLEO = '#0f6e7d';
const rutaDocumento = (dteId) => `/torogoz/documento/${dteId}`;

export default function DetallePedido() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeVender = !!hasPermission?.('distribucion', 'can_edit');
  const [pedido, setPedido] = useState(() => pedidoRecordado(id));
  const [items, setItems] = useState(null);
  const [pagos, setPagos] = useState(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      // Por un enlace (sin pasar por la lista) el pedido no está recordado:
      // se busca en la misma ventana que trae la lista.
      if (!pedidoRecordado(id)) {
        const p = (await fetchPedidos({ desde: sumarDias(hoySV(), -VENTANA_PEDIDOS_DIAS) })).find((x) => String(x.id) === String(id));
        if (!p) { setError('No se encontró este pedido (sólo se miran los últimos 60 días).'); return; }
        setPedido(p);
      }
      const [it, pg] = await Promise.all([fetchItemsDePedido(id), fetchPagos(id)]);
      setItems(it); setPagos(pg);
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!pedido) {
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: `Pedido ${id}`, headerLargeTitle: false }} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} contentInsetAdjustmentBehavior="automatic">
          {error ? <Aviso tono="freno" texto={error} /> : <Esqueleto lineas={5} />}
        </ScrollView>
      </>
    );
  }

  const est = estadoDePedido(pedido);
  const dte = pedido.dist_dte;
  const estDte = dte ? ESTADO_DOCUMENTO[dte.estado] : null;
  const base = accionesDePedido(pedido, puedeVender);
  // Sólo consulta (soloConsulta.js): facturar y transmitir se hacen en el
  // portal, y anular sólo queda para una preventa (sin documento).
  const puede = {
    ...base,
    facturar: base.facturar && ACCIONES_DE_DINERO,
    reintentar: base.reintentar && ACCIONES_DE_DINERO,
    anular: base.anular && (ACCIONES_DE_DINERO || !pedido.dte_id),
  };
  const enElPortal = !ACCIONES_DE_DINERO && (base.facturar || base.reintentar);
  const docPedido = pedido.tipo_documento ?? '01';
  const venta = calcularVenta((items ?? []).map((i) => ({
    cantidad: Number(i.cantidad), precioConIva: Number(i.precio_con_iva), descuentoConIva: Number(i.descuento) || 0,
  })), { tipoDoc: docPedido });

  // Lo que contesta el servidor se muestra tal cual: «sellado» es lo único que
  // cuenta como emitido; cualquier otro estado se avisa como pendiente.
  const accion = async (clave, fn, auditoria) => {
    setOcupado(clave);
    setError('');
    try {
      const r = await fn();
      useStaffStore.getState().appendAuditLog?.(auditoria, String(pedido.id), { ...(r ? { estado: r.estado } : {}), desde: 'app' });
      Haptics.notificationAsync(r?.estado && r.estado !== 'sellado' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
      const titulo = r?.estado ? (ESTADO_DOCUMENTO[r.estado]?.label ?? 'Listo') : 'Listo';
      const texto = r?.aviso ?? r?.mensaje ?? (r?.numero_control ? `Número de control ${r.numero_control}.` : '');
      if (clave === 'facturar' && r?.dte_id) {
        Alert.alert(titulo, texto, [{ text: 'Ver documento', onPress: () => router.replace(rutaDocumento(r.dte_id)) }]);
      } else {
        Alert.alert(titulo, texto, [{ text: 'OK', onPress: () => router.back() }]);
      }
    } catch (e) {
      setError(mensajeDeDistribucion(e));
    } finally {
      setOcupado(null);
    }
  };

  const facturar = () => Alert.alert('Facturar el pedido',
    `Se emite ${TIPO_DOCUMENTO[docPedido]?.largo ?? 'el documento'} por ${formatMoney(venta.total)} a ${pedido.dist_clientes?.nombre ?? 'el cliente'} y se envía a Hacienda.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Facturar', onPress: () => accion('facturar', () => facturarPedido(pedido.id), 'DISTRIBUCION_PEDIDO_FACTURADO') },
    ]);
  const reintentar = () => Alert.alert('Enviar a Hacienda', `${TIPO_DOCUMENTO[dte.tipo]?.largo ?? 'Documento'} ${dte.numero_control}`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Enviar', onPress: () => accion('reintentar', () => reintentarDocumento(pedido.dte_id), 'DISTRIBUCION_DTE_REINTENTO') },
  ]);
  const anular = () => Alert.alert(`¿Anular el pedido ${pedido.id}?`, `Motivo: ${motivo.trim()}`, [
    { text: 'No', style: 'cancel' },
    { text: 'Anular', style: 'destructive', onPress: () => accion('anular', () => anularPedido(pedido.id, motivo.trim()), 'DISTRIBUCION_PEDIDO_ANULADO') },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: `Pedido ${pedido.id}`, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <View style={{ gap: 6 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{pedido.dist_clientes?.nombre ?? 'Cliente'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Etiqueta variante={est.variant} texto={est.label} />
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{rotuloTipoCliente(pedido.dist_clientes?.tipo)}</Text>
          </View>
        </View>
        {error ? <Aviso tono="freno" texto={error} /> : null}

        <Seccion>
          <Dato primero rotulo="Tomado" valor={`${fechaTexto(pedido.created_at, { day: 'numeric', month: 'short' })}, ${hora12(pedido.created_at)}`} />
          <Dato rotulo="Por" valor={shortEmployeeName(pedido.employees) || '—'} />
          <Dato rotulo="Condición" valor={pedido.condicion === 2 ? `Crédito a ${pedido.plazo_dias} días`
            : `Contado · ${FORMA_PAGO.find((f) => f.value === pedido.forma_pago)?.label ?? pedido.forma_pago}`} />
          <Dato rotulo="Documento" valor={TIPO_DOCUMENTO[docPedido]?.largo} />
          {pedido.observaciones ? <Dato rotulo="Observaciones" valor={pedido.observaciones} /> : null}
        </Seccion>

        {dte ? (
          <Aviso tono={estDte?.variant === 'success' ? 'nota' : estDte?.variant === 'danger' ? 'freno' : 'cuidado'}
            texto={`${TIPO_DOCUMENTO[dte.tipo]?.largo ?? ''} ${dte.numero_control} — ${estDte?.label ?? dte.estado}. ${estDte?.ayuda ?? ''}`} />
        ) : null}

        <Seccion titulo="Productos">
          {items === null ? <Esqueleto /> : items.length ? (
            <>
              {items.map((i, k) => (
                <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: k ? 9 : 0, borderTopWidth: k ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15 }} numberOfLines={2}>{i.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'] }}>
                      {`${formatQty(i.cantidad, { decimalesMax: 4 })} × ${formatMoney(venta.renglones[k]?.precioUni ?? 0)} ${docPedido === '01' ? 'con IVA' : 'sin IVA'}`}
                    </Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(venta.renglones[k]?.importe ?? 0)}</Text>
                </View>
              ))}
              <Dato fuerte rotulo={docPedido === '01' ? 'Total' : `Total con IVA (${formatMoney(venta.iva)})`} valor={formatMoney(venta.total)} />
            </>
          ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin productos.</Text>}
        </Seccion>

        {pagos?.length ? (
          <Seccion titulo="Pagos">
            {pagos.map((p, k) => {
              const v = LLEVA_COMPROBANTE.has(p.forma) ? (VERIFICACION_PAGO[p.verificacion] ?? VERIFICACION_PAGO.pendiente) : null;
              return (
                <View key={p.id} style={{ gap: 6, paddingTop: k ? 9 : 0, borderTopWidth: k ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${nombreFormaPago(p.forma)}${p.referencia ? ` · ${p.referencia}` : ''}`}</Text>
                      {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{p.nota}</Text> : null}
                    </View>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{p.monto != null ? formatMoney(p.monto) : 'El resto'}</Text>
                  </View>
                  {v ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Etiqueta variante={v.variant} texto={v.label} />
                      {p.comprobante_url ? (
                        <Pressable hitSlop={8} onPress={() => openStoredFile(p.comprobante_url).catch((e) => Alert.alert('No se pudo abrir el comprobante', e?.message ?? String(e)))}>
                          <Text style={{ color: PETROLEO, fontSize: 14, fontWeight: '700' }}>Ver comprobante</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Seccion>
        ) : null}

        {anulando ? (
          <Seccion titulo="Motivo de la anulación">
            <Campo value={motivo} onChangeText={setMotivo} placeholder="Ej.: el cliente canceló" autoFocus />
          </Seccion>
        ) : null}

        <View style={{ gap: 10 }}>
          {enElPortal && !anulando ? (
            <SeHaceEnElPortal texto={base.facturar ? 'Facturar este pedido se hace desde el portal.' : 'Enviarlo a Hacienda se hace desde el portal.'} />
          ) : null}
          {puede.facturar && !anulando ? (
            <BotonGrande texto={ocupado === 'facturar' ? 'Facturando…' : 'Facturar'} color={PETROLEO} deshabilitado={!!ocupado || !items?.length} onPress={facturar} />
          ) : null}
          {puede.reintentar ? (
            <BotonGrande texto={ocupado === 'reintentar' ? 'Enviando…' : 'Enviar a Hacienda'} color={MARCA.ambar} deshabilitado={!!ocupado} onPress={reintentar} />
          ) : null}
          {puede.verDocumento ? (
            <BotonGrande borde texto="Ver ticket y PDF" color={PETROLEO} deshabilitado={!!ocupado} onPress={() => router.push(rutaDocumento(pedido.dte_id))} />
          ) : null}
          {puede.corregir && !anulando ? (
            <BotonGrande borde texto="Corregir" color={PETROLEO} deshabilitado={!!ocupado} onPress={() => router.push(`/torogoz/venta/${pedido.id}`)} />
          ) : null}
          {puede.volverAVender && !anulando ? (
            <BotonGrande borde texto="Volver a vender" color={PETROLEO} deshabilitado={!!ocupado} onPress={() => router.push(`/torogoz/venta?desde=${pedido.id}`)} />
          ) : null}
          {puede.anular && !anulando ? (
            <BotonGrande borde texto="Anular" color={MARCA.rojo} deshabilitado={!!ocupado} onPress={() => setAnulando(true)} />
          ) : null}
          {anulando ? (
            <>
              <BotonGrande texto={ocupado === 'anular' ? 'Anulando…' : 'Confirmar anulación'} color={MARCA.rojo} deshabilitado={!!ocupado || !motivo.trim()} onPress={anular} />
              <BotonGrande borde texto="No anular" color="#8D8D99" deshabilitado={!!ocupado} onPress={() => { setAnulando(false); setMotivo(''); }} />
            </>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
