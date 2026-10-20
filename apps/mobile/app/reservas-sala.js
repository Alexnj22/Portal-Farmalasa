// Reservas de mi sala, NATIVO — el `WidgetReservas` del portal entero: lo que
// los clientes apartaron desde la app de clientes en esta sala (`?todas=1`:
// en todas, con alcance todas). Se busca por el código que muestra el cliente
// (R-000123, o el pedido del carrito P-XXXXXX con su total, si se pagó en
// línea y los datos para el crédito fiscal), y cada una se aparta y avisa, se
// retira (`reserva-retirar`: lo pagado se aplica a la factura) o se cancela. A quien no tiene la app se
// le avisa por WhatsApp con el mensaje del núcleo, y se anota que se avisó.
// Todo por las funciones de la base (`data/reservas`), las mismas del portal.
// Las que tienen receta («en revisión») se abren en `reserva-receta` para
// aprobarla, pedir otra foto o rechazarla; pasadas las 4 h se marcan urgentes.
// Desde acá también se aparta o encarga en el mostrador (`reserva-anticipo`).
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  cambiarEstadoReserva, codigoDeReserva, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, mensajeDeReservaLista, usarSaldoAFavor, whatsappDe, HORAS_RECETA_URGENTE,
} from '@nucleo/data/reservas';
import { esPagoDePrueba, pilaDelCliente, reservasAbiertas, reservasPendientes, reservasPorCodigo, resumenDelPedido, saldosAFavor } from '@nucleo/utils/reservasDeSala';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

const REFRESCO_MS = 2 * 60 * 1000;

// Cuánto lleva esperando una receta, en palabras cortas («25 min», «3 h 10 min»), como el portal.
function esperaDeReceta(desde, ahora) {
  const ms = desde ? Math.max(0, ahora - Date.parse(desde)) : 0;
  const min = Math.floor(ms / 60000);
  const horas = Math.floor(min / 60);
  return { horas: ms / 3600000, texto: horas ? `${horas} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min` };
}

function Accion({ texto, color = MARCA.azulClaro, onPress, deshabilitado }) {
  return (
    <Pressable onPress={onPress} disabled={deshabilitado} hitSlop={6} accessibilityRole="button"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, backgroundColor: `${color}26`, opacity: deshabilitado ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

export default function ReservasDeSala() {
  const { todas: todasParam } = useLocalSearchParams();
  const { user } = useAuth();
  const todas = todasParam === '1';
  const sala = todas ? null : (user?.branchId ?? user?.branch_id ?? null);
  const nombreSala = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(sala))?.name) || '';
  // Bodega no tiene reservas propias: no reserva con anticipo (igual que el portal).
  const esBodega = useStaffStore((s) => s.branches?.find((b) => String(b.id) === String(sala))?.type === 'BODEGA');
  const [ahora, setAhora] = useState(0);
  const [filas, setFilas] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [ocupada, setOcupada] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala && !todas) { setFilas([]); return; }
    try { setFilas(await fetchReservasDeSucursal(sala, true)); setAhora(Date.now()); } catch (e) { fallo('No se pudieron cargar', mensajeAmigable(e, '')); setFilas((f) => f ?? []); }
  }, [sala, todas]);
  useEffect(() => { const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]);
  // Al volver de revisar una receta o de reservar con anticipo, se relee.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const avisarPorWhatsapp = (r) => {
    const numero = whatsappDe(r.telefono);
    if (!numero) { Alert.alert('Sin teléfono válido', 'La ficha del cliente no tiene un teléfono válido para WhatsApp.'); return; }
    const texto = mensajeDeReservaLista(r, r.sala ?? nombreSala);
    Alert.alert('Avisar por WhatsApp', `Al +${numero}:\n\n${texto}`, [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Abrir WhatsApp', onPress: async () => {
        await Linking.openURL(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`).catch(() => {});
        await Promise.resolve(marcarAvisadaPorWhatsapp(r.id)).catch(() => {});
        cargar();
      } },
    ]);
  };

  const mover = (r, estado) => {
    const textos = {
      lista: ['Apartar y avisar', `Se aparta ${r.cantidad} × ${r.producto}${r.tiene_app ? ' y se le avisa al cliente en la app.' : '. El cliente no tiene la app: después se le avisa por WhatsApp.'}`, 'Apartar'],
      cancelada: ['Cancelar la reserva', `${codigoDeReserva(r.id)} · ${r.cantidad} × ${r.producto} se cancela.`, 'Cancelar reserva'],
    }[estado];
    Alert.alert(textos[0], textos[1], [
      { text: 'Volver', style: 'cancel' },
      { text: textos[2], style: estado === 'cancelada' ? 'destructive' : 'default', onPress: async () => {
        setOcupada(r.id);
        try {
          await cambiarEstadoReserva(r.id, estado);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          if (estado === 'lista') {
            if (r.tiene_app) listo('Reserva lista', 'Le avisamos al cliente en la app.');
            else avisarPorWhatsapp({ ...r, estado: 'lista' });
          } else listo('Reserva cancelada', '');
          cargar();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); }
      } },
    ]);
  };

  // El anticipo de una reserva vencida queda a favor del cliente 30 días: la
  // sala lo marca cuando lo aplica en caja (`reserva_usar_saldo_favor`, la
  // misma del widget del portal).
  const usarSaldo = (r) => {
    Alert.alert('Saldo a favor aplicado en caja', `${formatMoney(Number(r.saldo_favor))} a favor de ${pilaDelCliente(r)} (${codigoDeReserva(r.id)}). Márcalo sólo cuando ya se descontó en caja.`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Ya se aplicó', onPress: async () => {
        setOcupada(r.id);
        try {
          await usarSaldoAFavor(r.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Saldo a favor aplicado', `${formatMoney(Number(r.saldo_favor))} de ${pilaDelCliente(r)}`);
          cargar();
        } catch (e) { fallo('No se pudo aplicar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); }
      } },
    ]);
  };

  const lista = filas || [];
  const abiertas = reservasAbiertas(lista);
  const saldos = saldosAFavor(lista);
  const buscado = codigo.trim().toUpperCase();
  const visibles = reservasPorCodigo(lista, codigo);
  const pedido = resumenDelPedido(visibles, codigo);
  const pendientes = reservasPendientes(lista);
  const recetas = abiertas.filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;
  const verReceta = (r) => router.push({ pathname: '/reserva-receta', params: todas ? { id: String(r.id), todas: '1' } : { id: String(r.id), sala: String(sala) } });

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reservas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Código R-… o P-…', autoCapitalize: 'characters', hideWhenScrolling: false, onChangeText: (e) => setCodigo(e.nativeEvent.text), onCancelButtonPress: () => setCodigo('') } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {!sala && !todas ? 'Las reservas son de una sala de ventas.' : `${todas ? 'Todas las salas' : nombreSala}${recetas ? ` · ${recetas} ${recetas === 1 ? 'receta por revisar' : 'recetas por revisar'}` : ''}${pendientes ? ` · ${pendientes} ${pendientes === 1 ? 'espera' : 'esperan'} que alguien las aparte` : ''}`}
        </Text>
        {!todas && sala && !esBodega ? (
          <View style={{ marginHorizontal: 16, flexDirection: 'row' }}>
            <Accion texto="Apartar o encargar" onPress={() => router.push('/reserva-anticipo')} />
          </View>
        ) : null}
        {pedido.renglones.length ? (
          <Seccion titulo={`Pedido ${pedido.pedido}`} pie={pedido.pagado ? 'Pagado en línea: en caja NO se cobra.' : 'Se cobra en caja.'}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${pedido.renglones.length} ${pedido.renglones.length === 1 ? 'producto' : 'productos'} · ${pilaDelCliente(pedido.renglones[0])} · total ${formatMoney(pedido.total)}`}</Text>
            {pedido.fiscal ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Facturar con crédito fiscal: ${pedido.fiscal.nombre} · NIT ${pedido.fiscal.nit} · NRC ${pedido.fiscal.nrc} · ${pedido.fiscal.giro} · ${pedido.fiscal.direccion}`}</Text> : null}
          </Seccion>
        ) : null}
        {filas && buscado && !visibles.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="No hay una reserva abierta con ese código en esta sala." /></View> : null}
        {filas && !abiertas.length && !saldos.length && (sala || todas) ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sin reservas. Cuando un cliente aparte algo desde la app, aparece aquí." /></View> : null}
        {saldos.length && !buscado ? (
          <Seccion titulo="Saldos a favor" pie="Anticipos de reservas vencidas: valen 30 días y se descuentan en caja.">
            {saldos.map((r, i) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: ocupada === r.id ? 0.5 : 1 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${formatMoney(Number(r.saldo_favor))} a favor de ${pilaDelCliente(r)}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${codigoDeReserva(r.id)} · ${r.producto}${r.saldo_favor_vence ? ` · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}` : ''}${todas && r.sala ? ` · ${r.sala}` : ''}`}</Text>
                </View>
                <Accion texto="Aplicado en caja" color={MARCA.verde} onPress={() => usarSaldo(r)} deshabilitado={!!ocupada} />
              </View>
            ))}
          </Seccion>
        ) : null}
        {visibles.map((r) => {
          const enRevision = r.estado === 'en_revision';
          const espera = enRevision ? esperaDeReceta(r.receta_subida_at, ahora) : null;
          const urgente = enRevision && r.receta_estado === 'pendiente' && espera.horas >= HORAS_RECETA_URGENTE;
          return (
          <View key={r.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} tinte={urgente ? 'rgba(240,68,56,0.12)' : r.estado === 'pendiente' || enRevision ? 'rgba(247,144,9,0.10)' : undefined}>
              <View style={{ padding: 12, gap: 6, opacity: ocupada === r.id ? 0.5 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${r.cantidad} × ${r.producto}`}</Text>
                  <Pildora texto={enRevision ? 'Receta' : r.estado === 'pendiente' ? 'Por apartar' : 'Lista'} color={urgente ? MARCA.rojo : enRevision || r.estado === 'pendiente' ? MARCA.ambar : MARCA.verde} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${todas && r.sala ? `${r.sala} · ` : ''}${r.entrega === 'domicilio' ? `A DOMICILIO: ${r.direccion_entrega ?? ''}${Number(r.costo_envio) > 0 ? ` (envío ${formatMoney(Number(r.costo_envio))})` : ''} · ` : ''}${r.pedido ? `${r.pedido} · ` : ''}${codigoDeReserva(r.id)} · ${pilaDelCliente(r)}${r.estado === 'lista' ? ` · retira antes de las ${hora12(r.vence_at)}` : ''}${r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {enRevision && r.receta_estado === 'pendiente' ? <Pildora texto={`Receta por revisar · ${espera.texto}`} color={urgente ? MARCA.rojo : MARCA.ambar} /> : null}
                  {enRevision && r.receta_estado === 'otra_foto' ? <Pildora texto="Esperando nueva foto del cliente" color={MARCA.azulClaro} /> : null}
                  {/* (2026-10-19) Un cobro en línea de PRUEBA no es dinero: se cobra en caja. */}
                  {esPagoDePrueba(r) ? <Pildora texto="PAGO DE PRUEBA — cobrar en caja" color={MARCA.rojo} />
                    : r.pago_estado === 'pagado' ? <Pildora texto={r.origen === 'sucursal' ? 'Pagada' : 'Pagada en línea'} color={MARCA.verde} /> : null}
                  {r.pago_estado === 'anticipo' && Number(r.anticipo) > 0 ? <Pildora texto={`Anticipo ${formatMoney(Number(r.anticipo))} · saldo ${formatMoney(Number(r.precio ?? 0) * Number(r.cantidad ?? 1) - Number(r.anticipo))}`} color={MARCA.ambar} /> : null}
                  {r.documento === 'credito_fiscal' ? <Pildora texto="Crédito fiscal" color={MARCA.azulClaro} /> : null}
                </View>
                {urgente ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '600' }}>{`Lleva más de ${HORAS_RECETA_URGENTE} h: ya se avisó a supervisión.`}</Text> : null}
                {enRevision && r.receta_estado === 'otra_foto' && r.receta_motivo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Se pidió otra foto: ${r.receta_motivo}`}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {enRevision ? (r.receta_ruta && r.puede_revisar_receta ? <Accion texto="Ver receta" color={r.receta_estado === 'pendiente' ? MARCA.verde : MARCA.azulClaro} onPress={() => verReceta(r)} /> : null) : r.estado === 'pendiente' ? <Accion texto="Apartar y avisar" color={MARCA.verde} onPress={() => mover(r, 'lista')} deshabilitado={!!ocupada} /> : (
                    <>
                      {!r.tiene_app ? <Accion texto="WhatsApp" onPress={() => avisarPorWhatsapp(r)} /> : null}
                      <Accion texto="Retirar" color={MARCA.verde} deshabilitado={!!ocupada}
                        onPress={() => router.push({ pathname: '/reserva-retirar', params: { id: String(r.id), tipo: 'reserva', sala: String(r.branch_id ?? sala) } })} />
                    </>
                  )}
                  <Accion texto="Cancelar" color={MARCA.rojo} onPress={() => mover(r, 'cancelada')} deshabilitado={!!ocupada} />
                </View>
              </View>
            </Vidrio>
          </View>
          );
        })}
      </ScrollView>
    </>
  );
}
