// Encargos de la sala, NATIVO — gemela de `WidgetEncargos` del portal: lo que
// no hay en la red y Compras o Bodega consigue. Lo ven la sala del retiro y
// Bodega (`branchId` null = todos). Se confirma con precio y fecha (o se dice
// que no se puede), se marca pedido, llegó y entregado; un producto que no
// tenemos se vincula al catálogo cuando Bodega lo crea. Lo que llegó se retira
// en 7 días con UNA prórroga; si no se retira, lo pagado pasa a saldo a favor.
// A quien no tiene la app se le avisa por WhatsApp desde aquí.
// El estado y las reglas salen del núcleo (`reservasDeSala`).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  cancelarEncargoSinPago, encargoYaVendido, fetchEncargos, mensajeDeEncargo, prorrogarEncargo, registrarAvisoDeReserva, responderEncargo, ventasCandidatasDeEncargos, whatsappDe,
} from '@nucleo/data/reservas';
import { ROTULOS_DE_ENCARGO as ROT, cifraDeEncargo, encargoPorCobrar, pasosDeEncargo, siguientePasoDeEncargo, modoDeProrroga, textoDeProrroga, encargoSinVincular, encargoVencido, estadoDeEncargo, pilaDelCliente, encargoACargo, encargoPasaASaldo,
  encargoCancelableSinPago, encargoVendibleAfuera, ventaProbableDeEncargo } from '@nucleo/utils/reservasDeSala';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';
import Pressable from '../Tocable';
import { Accion, colorDeTono } from './piezas';

const corta = (d) => fechaTexto(d, { day: 'numeric', month: 'short' });
const cuando = (v) => fechaTexto(v, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// «Ya se vendió», como el portal (`YaVendido` de `WidgetEncargos`): el encargo
// se cobró en caja como una venta normal. Se elige la venta entre las que
// coinciden (sala, producto, monto, fecha) y el encargo queda entregado sin
// meter dinero a la caja otra vez.
function YaVendido({ e, onCerrar, onListo }) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [elegida, setElegida] = useState(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    let vivo = true;
    ventasCandidatasDeEncargos([e.id])
      .then((r) => { if (!vivo) return; const l = r?.[e.id] ?? []; setLista(l); if (ventaProbableDeEncargo(l[0])) setElegida(l[0].item_id); })
      .catch((err) => { if (vivo) { setError(err); setLista([]); } });
    return () => { vivo = false; };
  }, [e.id]);
  const pistas = (v) => [v.mismo_producto && 'Mismo producto', v.mismo_monto && 'Mismo monto',
    v.mismo_cliente ? 'Mismo cliente' : v.mismo_apellido && 'Nombre parecido'].filter(Boolean);
  const amarrar = (nota) => {
    setEnviando(true);
    encargoYaVendido(e.id, elegida, nota)
      .then((r) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Encargo entregado', `Quedó amarrado a la venta ${r?.factura ?? ''}. El dinero ya entró a la caja con esa venta.`);
        onListo();
      })
      .catch((err) => fallo('No se pudo amarrar a la venta', mensajeAmigable(err, 'Intenta de nuevo.')))
      .finally(() => setEnviando(false));
  };
  const confirmar = () => {
    const v = lista.find((x) => x.item_id === elegida);
    Alert.prompt(`¿Es la venta ${v?.factura ?? ''}?`, 'El encargo queda entregado y no entra dinero a la caja. Ya entró con esa venta.\n\nNota (opcional):', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Es esta venta', onPress: (texto) => amarrar(String(texto ?? '').slice(0, 120)) },
    ], 'plain-text', '', 'default');
  };
  return (
    <View style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: colorSistema.relleno }}>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>Elige la venta en la que se cobró</Text>
      {lista == null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Buscando ventas…</Text> : null}
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 13 }}>{mensajeAmigable(error, 'No se pudieron leer las ventas.')}</Text> : null}
      {lista && !lista.length && !error ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          {`No encontré ventas de este producto ni por ${e.anticipo ? formatMoney(e.anticipo) : 'este monto'} en la sucursal desde el ${fechaTexto(e.creado, { day: 'numeric', month: 'long' })}. Si se vendió en otra sucursal o con otro precio, avisa a un supervisor o administrador.`}
        </Text>
      ) : null}
      {(lista ?? []).map((v) => (
        <Pressable key={v.item_id} onPress={() => setElegida(v.item_id)} accessibilityRole="button" accessibilityState={{ selected: elegida === v.item_id }}
          style={({ pressed }) => ({ minHeight: 44, padding: 10, borderRadius: 10, borderWidth: elegida === v.item_id ? 2 : 0.5,
            borderColor: elegida === v.item_id ? MARCA.azulClaro : colorSistema.separador, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{`${v.factura} · ${fechaTexto(v.fecha, { weekday: 'short', day: 'numeric', month: 'short' })} ${hora12(v.hora)}`}</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{formatMoney(v.total)}</Text>
          </View>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${Number(v.cantidad)} × ${v.producto} · ${shortEmployeeName(v.cliente ?? '') || 'Sin nombre'}`}</Text>
          {pistas(v).length ? <Text style={{ color: MARCA.verde, fontSize: 12, fontWeight: '600' }}>{pistas(v).join(' · ')}</Text> : null}
        </Pressable>
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {lista?.length ? <Accion texto="Es esta venta" color={MARCA.verde} deshabilitado={!elegida || enviando} onPress={confirmar} /> : null}
        <Accion texto="Volver" onPress={onCerrar} deshabilitado={enviando} />
      </View>
    </View>
  );
}

// El recorrido del encargo con quién hizo cada paso, y qué toca ahora — los
// mismos pasos y el mismo texto que la tarjeta del portal (salen del núcleo).
function Pasos({ e, cobraAqui }) {
  const ahora = siguientePasoDeEncargo(e, { cobraAqui });
  return (
    <View style={{ gap: 3 }}>
      {pasosDeEncargo(e).map((p) => (
        <Text key={p.clave} style={{ color: p.hecho ? colorSistema.texto : colorSistema.texto2, fontSize: 13 }}>
          <Text style={{ color: p.hecho ? MARCA.verde : colorSistema.texto2 }}>{p.hecho ? '✓ ' : '○ '}</Text>
          <Text style={{ fontWeight: p.hecho ? '600' : '400' }}>{p.titulo}</Text>
          {p.hecho && (p.persona || p.quien || p.at)
            ? <Text style={{ color: colorSistema.texto2 }}>{` · ${[p.persona ? shortEmployeeName(p.persona) : p.quien, p.at ? cuando(p.at) : null].filter(Boolean).join(' · ')}`}</Text>
            : null}
        </Text>
      ))}
      {ahora ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginTop: 2 }}><Text style={{ fontWeight: '700', color: colorSistema.texto }}>Ahora: </Text>{ahora}</Text> : null}
    </View>
  );
}

// `salaDeCobro` (2026-11-04): la sala donde quien mira puede cobrar; ahí el
// encargo que espera el pago trae «Cobrar», que abre «Por cobrar» ya elegido.
export default function Encargos({ branchId = null, soloLectura = false, recarga = 0, salaDeCobro = null }) {
  const [filas, setFilas] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  // «Ya se vendió»: las ventas que pueden ser la de cada encargo, y el que se está amarrando.
  const [ventas, setVentas] = useState({});
  const [vendiendo, setVendiendo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const lista = await fetchEncargos(branchId, true);
      setFilas(lista);
      // Lo que ya se facturó como venta normal: se avisa en la tarjeta para que
      // nadie lo cobre otra vez. Si falla, la tarjeta sigue sin el aviso.
      const ids = (lista ?? []).filter(encargoVendibleAfuera).map((e) => e.id);
      ventasCandidatasDeEncargos(ids).then(setVentas).catch((err) => console.warn('Encargos: ventas candidatas', err));
    } catch { setFilas((f) => f ?? []); }
  }, [branchId]);
  useEffect(() => { const t = setInterval(cargar, 120_000); return () => clearInterval(t); }, [cargar]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // `recarga` cambia al tirar la lista hacia abajo: se relee también.
  useEffect(() => { if (recarga) cargar(); }, [recarga, cargar]);

  const mover = (e, accion, titulo, texto) => {
    Alert.alert(titulo, texto, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Sí', onPress: async () => {
        setOcupado(e.id);
        try {
          if (accion === 'prorrogar') {
            const r = await prorrogarEncargo(e.id);
            listo('Plazo prorrogado', `Puede retirarlo hasta el ${fechaTexto(r?.retirar_hasta, { day: 'numeric', month: 'long' })}. No admite otra prórroga.`);
          } else {
            await responderEncargo(e.id, accion);
            listo('Encargo actualizado', '');
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          cargar();
        } catch (err) { fallo('No se pudo actualizar', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(null); }
      } },
    ]);
  };
  const abrir = (e, modo) => router.push({ pathname: '/encargo-accion', params: { id: String(e.id), modo, sala: branchId == null ? '' : String(branchId) } });
  // Desde el reglamento v2 el aviso por WhatsApp queda anotado (cláusula 9).
  const whatsapp = (e) => {
    Linking.openURL(`https://wa.me/${whatsappDe(e.telefono)}?text=${encodeURIComponent(mensajeDeEncargo(e))}`)
      .catch((err) => console.warn(`Encargos: no se abrió WhatsApp para el encargo ${e.codigo}`, err));
    if (e.registrar_llamada) {
      registrarAvisoDeReserva({ encargo: e.id, canal: 'whatsapp' }).then(cargar)
        .catch((err) => console.warn(`Encargos: no se anotó el aviso por WhatsApp del encargo ${e.codigo}`, err));
    }
  };
  const llamar = (e) => router.push({ pathname: '/reserva-llamada', params: {
    encargo: String(e.id), codigo: e.codigo, cliente: pilaDelCliente(e), telefono: String(e.telefono ?? '') } });

  // El cliente ya no quiere un encargo que no pagó: se cancela con el motivo, como el portal.
  const cancelarSinPago = (e) => {
    Alert.prompt(`Cancelar ${e.codigo}`,
      `${e.cantidad} × ${e.producto}\n\nTodavía no lo pagó. No se le cobra ni se le devuelve nada, y no se pide al proveedor. Si tiene la app, le llega el aviso. No se deshace. Si después lo quiere, lo encarga de nuevo.\n\nMotivo:`, [
        { text: 'Volver', style: 'cancel' },
        { text: 'Cancelar el encargo', style: 'destructive', onPress: async (texto) => {
          const motivo = String(texto ?? '').trim().slice(0, 300);
          if (motivo.length < 3) { fallo('Falta el motivo', 'Escribe por qué se cancela (al menos 3 letras).'); return; }
          setOcupado(e.id);
          try {
            await cancelarEncargoSinPago(e.id, motivo);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            listo('Encargo cancelado', 'No se le cobró nada. Si tiene la app, le llega el aviso.');
            cargar();
          } catch (err) { fallo('No se pudo cancelar', mensajeAmigable(err, 'Intenta de nuevo.')); } finally { setOcupado(null); }
        } },
      ], 'plain-text', '', 'default');
  };
  // La venta casi segura de un encargo (la primera de la lista, si convence).
  const ventaProbable = (e) => (encargoVendibleAfuera(e) && ventaProbableDeEncargo(ventas?.[e.id]?.[0])) ? ventas[e.id][0] : null;

  const cobrable = (e) => !soloLectura && salaDeCobro != null && encargoPorCobrar(e) && String(e.branch_id) === String(salaDeCobro);

  if (!filas?.length) return null;
  const hoy = hoySV();
  return (
    <Seccion titulo={`Encargos · ${filas.length}`} pie="Lo que no hay en ninguna sucursal. Compras lo consigue y confirma el precio.">
      {filas.map((e, i) => {
        const est = estadoDeEncargo(e);
        const sinVincular = encargoSinVincular(e);
        const vencido = encargoVencido(e, hoy);
        const cargo = encargoACargo(e);
        const probable = ventaProbable(e);
        const vendible = !soloLectura && encargoVendibleAfuera(e);
        return (
          <View key={e.id} style={{ gap: 6, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: ocupado === e.id ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                {`${e.cantidad} × ${e.producto}${e.producto_nuevo ? (e.product_id ? ` → ${e.producto_catalogo ?? 'vinculado'}` : ' · producto nuevo') : ''}`}
              </Text>
              <Pildora texto={est.texto} color={colorDeTono(est.tono)} />
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {`${e.codigo}${e.reserva ? ` · resto de ${e.reserva}` : ''} · ${pilaDelCliente(e)} · retira en ${e.sala}${e.fecha_estimada ? ` · llega ${corta(e.fecha_estimada)}` : ''}${cifraDeEncargo(e) ? ` · ${cifraDeEncargo(e).cobrado ? '' : 'por cobrar '}${formatMoney(cifraDeEncargo(e).valor)}` : ''}${e.retirar_hasta ? ` · retira hasta ${corta(e.retirar_hasta)}${textoDeProrroga(e, { encargo: true })}` : ''}`}
            </Text>
            {probable ? <Aviso tono="cuidado" texto={`Parece que ya se vendió en ${probable.factura} del ${corta(probable.fecha)}. Misma sucursal, mismo producto y mismo monto. No lo cobres otra vez.`} /> : null}
            {(sinVincular && e.sugerido) || vencido || e.nivel?.prioridad || cargo ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {e.nivel?.prioridad ? <Pildora texto={`Cliente ${e.nivel.nombre}`} color={MARCA.azulClaro} /> : null}
                {sinVincular && e.sugerido ? <Pildora texto={`¿Ya está en el catálogo? «${e.sugerido}»`} color={MARCA.azulClaro} /> : null}
                {vencido ? <Pildora texto="Sin retirar · llamar" color={MARCA.ambar} /> : null}
                {cargo ? <Pildora texto={`${cargo.sinAnticipo ? 'Sin anticipo' : 'Con adelanto'} · responde ${shortEmployeeName(cargo.persona)}`} color={MARCA.ambar} /> : null}
              </View>
            ) : null}
            <Pasos e={e} cobraAqui={cobrable(e)} />
            {vendiendo === e.id ? <YaVendido e={e} onCerrar={() => setVendiendo(null)} onListo={() => { setVendiendo(null); cargar(); }} /> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {/* Si parece que ya se vendió, eso va antes que cobrar otra vez. */}
              {vendible && probable && vendiendo !== e.id ? <Accion texto={ROT.ya_vendido} color={MARCA.verde} onPress={() => setVendiendo(e.id)} /> : null}
              {cobrable(e) ? <Accion texto={ROT.cobrar} color={probable ? MARCA.azulClaro : MARCA.verde}
                onPress={() => router.push({ pathname: '/reserva-anticipo', params: { sala: String(salaDeCobro), vista: 'cobrar', elegir: `e${e.id}` } })} /> : null}
              {!soloLectura && !e.reserva && !e.tiene_app && ['confirmado', 'listo'].includes(e.estado) && whatsappDe(e.telefono)
                ? <Accion texto={ROT.whatsapp} onPress={() => whatsapp(e)} /> : null}
              {e.foto_url ? <Accion texto={ROT.foto} onPress={() => openStoredFile(e.foto_url).catch((err) => fallo('No se pudo abrir la foto', err?.message ?? ''))} /> : null}
              {!soloLectura && e.estado === 'solicitado' ? (
                <>
                  <Accion texto={ROT.confirmar} color={MARCA.verde} onPress={() => abrir(e, 'confirmar')} />
                  <Accion texto={ROT.rechazar} color={MARCA.rojo} onPress={() => abrir(e, 'rechazar')} />
                </>
              ) : null}
              {!soloLectura && sinVincular ? <Accion texto={ROT.vincular} onPress={() => abrir(e, 'vincular')} /> : null}
              {!soloLectura && e.estado === 'aceptado' ? <Accion texto={ROT.pedido} deshabilitado={!!ocupado}
                onPress={() => mover(e, 'pedido', 'Marcar como pedido', `${e.codigo} · ${e.cantidad} × ${e.producto} ya se pidió.`)} /> : null}
              {!soloLectura && (e.estado === 'aceptado' || e.estado === 'pedido') ? <Accion texto={ROT.llego} color={MARCA.verde} deshabilitado={!!ocupado || sinVincular}
                onPress={() => mover(e, 'listo', 'Marcar que llegó', `${e.codigo} · ${e.cantidad} × ${e.producto} ya está en la sucursal.`)} /> : null}
              {!soloLectura && sinVincular && (e.estado === 'aceptado' || e.estado === 'pedido')
                ? <Text style={{ color: colorSistema.texto2, fontSize: 12, alignSelf: 'center' }}>Primero vincula el producto ya creado en el catálogo.</Text> : null}
              {!soloLectura && e.estado === 'listo' ? <Accion texto={ROT.entregar} color={MARCA.verde}
                onPress={() => router.push({ pathname: '/reserva-retirar', params: { id: String(e.id), tipo: 'encargo', sala: String(e.branch_id ?? branchId) } })} /> : null}
              {!soloLectura && e.registrar_llamada ? <Accion texto={ROT.llamada} onPress={() => llamar(e)} /> : null}
              {!soloLectura && e.puede_cambiar_fecha ? <Accion texto={ROT.fecha} onPress={() => abrir(e, 'fecha')} /> : null}
              {!soloLectura && e.puede_no_entrego ? <Accion texto={ROT.no_entrego} color={MARCA.rojo} onPress={() => abrir(e, 'no_entrego')} /> : null}
              {!soloLectura && modoDeProrroga(e, { encargo: true }) === 'directa' ? <Accion texto={ROT.prorrogar} deshabilitado={!!ocupado}
                onPress={() => mover(e, 'prorrogar', 'Prorrogar el plazo', 'Una sola prórroga de 7 días para retirarlo. No admite otra.')} /> : null}
              {!soloLectura && modoDeProrroga(e, { encargo: true }) === 'pedir' ? <Accion texto={ROT.pedir_prorroga}
                onPress={() => router.push({ pathname: '/reserva-prorroga', params: { modo: 'pedir', tipo: 'encargo', ids: String(e.id), titulo: e.codigo,
                  vence: e.retirar_hasta ? `${e.retirar_hasta}T12:00:00` : '' } })} /> : null}
              {!soloLectura && encargoPasaASaldo(e)
                ? <Accion texto={ROT.saldo} onPress={() => abrir(e, 'saldo')} /> : null}
              {vendible && !probable && vendiendo !== e.id ? <Accion texto={ROT.ya_vendido} onPress={() => setVendiendo(e.id)} /> : null}
              {!soloLectura && encargoCancelableSinPago(e) ? <Accion texto={ROT.cancelar} color={MARCA.rojo} deshabilitado={!!ocupado} onPress={() => cancelarSinPago(e)} /> : null}
            </View>
          </View>
        );
      })}
    </Seccion>
  );
}
