// Reservas de mi sala, NATIVO — el `WidgetReservas` del portal entero: lo que
// los clientes apartaron desde la app de clientes en esta sala (`?todas=1`:
// en todas, con alcance todas). Se busca por el código que muestra el cliente
// (R-000123, o el pedido del carrito P-XXXXXX con su total, si se pagó en
// línea y los datos para el crédito fiscal), y cada una se aparta y avisa, se
// marca retirada o se cancela — con confirmación. A quien no tiene la app se
// le avisa por WhatsApp con el mensaje del núcleo, y se anota que se avisó.
// Todo por las funciones de la base (`data/reservas`), las mismas del portal.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  cambiarEstadoReserva, codigoDeReserva, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, mensajeDeReservaLista, whatsappDe,
} from '@nucleo/data/reservas';
import { pilaDelCliente, reservasPendientes, reservasPorCodigo, resumenDelPedido } from '@nucleo/utils/reservasDeSala';
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
  const [filas, setFilas] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [ocupada, setOcupada] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala && !todas) { setFilas([]); return; }
    try { setFilas(await fetchReservasDeSucursal(sala, true)); } catch (e) { fallo('No se pudieron cargar', mensajeAmigable(e, '')); setFilas((f) => f ?? []); }
  }, [sala, todas]);
  useEffect(() => { cargar(); const t = setInterval(cargar, REFRESCO_MS); return () => clearInterval(t); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y refresco

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
      retirada: ['Marcar retirada', `${pilaDelCliente(r)} retiró ${r.cantidad} × ${r.producto}.`, 'Retirada'],
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
          } else listo(estado === 'retirada' ? 'Reserva retirada' : 'Reserva cancelada', '');
          cargar();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setOcupada(null); }
      } },
    ]);
  };

  const lista = filas || [];
  const buscado = codigo.trim().toUpperCase();
  const visibles = reservasPorCodigo(lista, codigo);
  const pedido = resumenDelPedido(visibles, codigo);
  const pendientes = reservasPendientes(lista);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reservas', headerLargeTitle: true,
        headerSearchBarOptions: { placeholder: 'Código R-… o P-…', autoCapitalize: 'characters', hideWhenScrolling: false, onChangeText: (e) => setCodigo(e.nativeEvent.text), onCancelButtonPress: () => setCodigo('') } }} />
      <ScrollView style={{ flex: 1 }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8, paddingBottom: 48, gap: 12 }} keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Text style={{ color: colorSistema.texto2, fontSize: 14, marginHorizontal: 20 }}>
          {!sala && !todas ? 'Las reservas son de una sala de ventas.' : `${todas ? 'Todas las salas' : nombreSala}${pendientes ? ` · ${pendientes} ${pendientes === 1 ? 'espera' : 'esperan'} que alguien las aparte` : ''}`}
        </Text>
        {pedido.renglones.length ? (
          <Seccion titulo={`Pedido ${pedido.pedido}`} pie={pedido.pagado ? 'Pagado en línea: en caja NO se cobra.' : 'Se cobra en caja.'}>
            <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{`${pedido.renglones.length} ${pedido.renglones.length === 1 ? 'producto' : 'productos'} · ${pilaDelCliente(pedido.renglones[0])} · total ${formatMoney(pedido.total)}`}</Text>
            {pedido.fiscal ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Facturar con crédito fiscal: ${pedido.fiscal.nombre} · NIT ${pedido.fiscal.nit} · NRC ${pedido.fiscal.nrc} · ${pedido.fiscal.giro} · ${pedido.fiscal.direccion}`}</Text> : null}
          </Seccion>
        ) : null}
        {filas && buscado && !visibles.length ? <View style={{ marginHorizontal: 16 }}><Aviso texto="No hay una reserva abierta con ese código en esta sala." /></View> : null}
        {filas && !lista.length && (sala || todas) ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Sin reservas. Cuando un cliente aparte algo desde la app, aparece aquí." /></View> : null}
        {visibles.map((r) => (
          <View key={r.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18} tinte={r.estado === 'pendiente' ? 'rgba(247,144,9,0.10)' : undefined}>
              <View style={{ padding: 12, gap: 6, opacity: ocupada === r.id ? 0.5 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${r.cantidad} × ${r.producto}`}</Text>
                  <Pildora texto={r.estado === 'pendiente' ? 'Por apartar' : 'Lista'} color={r.estado === 'pendiente' ? MARCA.ambar : MARCA.verde} />
                </View>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${todas && r.sala ? `${r.sala} · ` : ''}${r.pedido ? `${r.pedido} · ` : ''}${codigoDeReserva(r.id)} · ${pilaDelCliente(r)}${r.estado === 'lista' ? ` · retira antes de las ${hora12(r.vence_at)}` : ''}${r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}`}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {r.pago_estado === 'pagado' ? <Pildora texto="Pagada en línea" color={MARCA.verde} /> : null}
                  {r.documento === 'credito_fiscal' ? <Pildora texto="Crédito fiscal" color={MARCA.azulClaro} /> : null}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {r.estado === 'pendiente' ? <Accion texto="Apartar y avisar" color={MARCA.verde} onPress={() => mover(r, 'lista')} deshabilitado={!!ocupada} /> : (
                    <>
                      {!r.tiene_app ? <Accion texto="WhatsApp" onPress={() => avisarPorWhatsapp(r)} /> : null}
                      <Accion texto="Retirada" color={MARCA.verde} onPress={() => mover(r, 'retirada')} deshabilitado={!!ocupada} />
                    </>
                  )}
                  <Accion texto="Cancelar" color={MARCA.rojo} onPress={() => mover(r, 'cancelada')} deshabilitado={!!ocupada} />
                </View>
              </View>
            </Vidrio>
          </View>
        ))}
      </ScrollView>
    </>
  );
}
