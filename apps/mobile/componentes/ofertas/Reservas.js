// Reservas de la app de clientes, NATIVO — `WidgetReservas` del portal: lo que
// los clientes apartaron desde la app. Cualquier dependiente de la sala las
// prepara, con las MISMAS funciones de la base:
//   · PENDIENTE → «Apartar y avisar»: queda lista, empiezan las 24 h y la app
//     le avisa sola al cliente. Si NO tiene la app, se abre WhatsApp con el
//     mensaje ya escrito (`mensajeDeReservaLista`) y se anota quién avisó.
//   · LISTA → «Retirada» cuando la paga y se la lleva.
//   · Cualquiera de las dos se puede cancelar.
// Buscar por código (R-000123 o el pedido P-XXXXXX, con el escáner o a mano) y
// sumar el pedido salen del núcleo (`reservasDeSala`). `todas`: todas las salas
// (la pestaña de Ofertas para clientes); si no, la sala de quien la abre.
// Las que tienen receta por revisar abren `reserva-receta` (aprobar, pedir
// otra foto o rechazar), como el «Ver receta» del portal.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  cambiarEstadoReserva, codigoDeReserva, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, mensajeDeReservaLista, whatsappDe, HORAS_RECETA_URGENTE,
} from '@nucleo/data/reservas';
import { pilaDelCliente, plazoDeRetiro, reservasPendientes, reservasPorCodigo, resumenDelPedido } from '@nucleo/utils/reservasDeSala';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import Tocable from '../Tocable';

const REFRESCO_MS = 2 * 60 * 1000;

export default function Reservas({ sala, todas = false, recarga }) {
  const nombreSala = useStaffStore((s) => (s.branches || []).find((b) => String(b.id) === String(sala))?.name ?? '');
  const [filas, setFilas] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [ocupada, setOcupada] = useState(null);

  const cargar = useCallback(async () => {
    if (!sala && !todas) { setFilas([]); return; }
    try { setFilas(await fetchReservasDeSucursal(todas ? null : sala, true)); }
    catch (e) { setFilas((x) => x ?? []); fallo('No se pudieron cargar las reservas', mensajeAmigable(e)); }
  }, [sala, todas]);
  useEffect(() => {
    cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga y refresco cada 2 min, como el portal
    const t = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar, recarga]);
  // Al volver de revisar una receta, se relee.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const avisarPorWhatsapp = (r) => {
    const numero = whatsappDe(r.telefono);
    const mensaje = mensajeDeReservaLista(r, r.sala ?? nombreSala);
    if (!numero) { Alert.alert('Sin WhatsApp', 'El teléfono del cliente no tiene la forma de un número de El Salvador.'); return; }
    Alert.alert('Avisar por WhatsApp', mensaje, [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Abrir WhatsApp', onPress: async () => {
        try {
          await Linking.openURL(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`);
          await marcarAvisadaPorWhatsapp(r.id);
          cargar();
        } catch (e) { fallo('No se pudo abrir WhatsApp', mensajeAmigable(e)); }
      } },
    ]);
  };

  const mover = (r, estado) => {
    // Cuánto queda lista lo dice el servidor (`horas_al_preparar`: pagada, 7
    // días; si no, las del nivel del cliente), no un «24 horas» fijo.
    const h = Number(r.horas_al_preparar);
    const plazo = h > 0 ? `Queda lista ${h >= 48 && h % 24 === 0 ? `${h / 24} días` : `${h} horas`}` : 'Queda lista';
    const textos = {
      lista: ['Apartar y avisar', r.tiene_app ? `${plazo} y la app le avisa sola al cliente.` : `${plazo}. El cliente no tiene la app: después se abre WhatsApp para avisarle.`],
      retirada: ['Reserva retirada', 'El cliente la pagó y se la llevó.'],
      cancelada: ['Cancelar la reserva', `${r.cantidad} × ${r.producto} deja de estar apartado.`],
    }[estado];
    Alert.alert(textos[0], textos[1], [
      { text: 'Volver', style: 'cancel' },
      { text: estado === 'cancelada' ? 'Cancelar reserva' : 'Confirmar', style: estado === 'cancelada' ? 'destructive' : 'default', onPress: async () => {
        setOcupada(r.id); trabajando('Guardando…');
        try {
          await cambiarEstadoReserva(r.id, estado);
          if (estado === 'lista' && !r.tiene_app) { listo('Reserva lista', 'Ahora avísale por WhatsApp.'); avisarPorWhatsapp(r); }
          else listo(estado === 'lista' ? 'Reserva lista' : estado === 'retirada' ? 'Reserva retirada' : 'Reserva cancelada', estado === 'lista' ? 'Le avisamos al cliente en la app.' : '');
          cargar();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Intenta de nuevo.')); }
        setOcupada(null);
      } },
    ]);
  };

  const visibles = useMemo(() => reservasPorCodigo(filas, codigo), [filas, codigo]);
  const pedido = useMemo(() => resumenDelPedido(visibles, codigo), [visibles, codigo]);
  const pendientes = reservasPendientes(filas);
  const recetas = (filas || []).filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;
  const ahora = Date.now();
  const verReceta = (r) => router.push({ pathname: '/reserva-receta', params: todas ? { id: String(r.id), todas: '1' } : { id: String(r.id), sala: String(sala) } });

  if (filas == null) return <ActivityIndicator style={{ marginTop: 24 }} />;
  if (!sala && !todas) return <View style={{ marginHorizontal: 16 }}><Aviso texto="Las reservas son de una sala de ventas, y tu ficha no tiene sala." /></View>;
  return (
    <>
      <View style={{ marginHorizontal: 16, gap: 8 }}>
        {recetas ? <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>{`${recetas} ${recetas === 1 ? 'receta por revisar' : 'recetas por revisar'}`}</Text> : null}
        {pendientes ? <Text style={{ color: MARCA.ambar, fontSize: 14, fontWeight: '700' }}>{`${pendientes} ${pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte`}</Text> : null}
        <Campo multiline={false} autoCapitalize="characters" autoCorrect={false} placeholder="Código de la reserva (R-… o P-…)" value={codigo} onChangeText={setCodigo} />
        {pedido.renglones.length ? (
          <Vidrio radio={16}>
            <View style={{ padding: 12, gap: 4 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
                {`Pedido ${pedido.pedido} · ${pedido.renglones.length} ${pedido.renglones.length === 1 ? 'producto' : 'productos'} · ${pilaDelCliente(pedido.renglones[0])} · total ${formatMoney(pedido.total)}`}
              </Text>
              <Text style={{ color: pedido.pagado ? MARCA.verde : colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>{pedido.pagado ? 'Pagado en línea: en caja no se cobra' : 'Se cobra en caja'}</Text>
              {pedido.fiscal ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`Facturar con crédito fiscal: ${pedido.fiscal.nombre} · NIT ${pedido.fiscal.nit} · NRC ${pedido.fiscal.nrc} · ${pedido.fiscal.giro} · ${pedido.fiscal.direccion}`}
                </Text>
              ) : null}
            </View>
          </Vidrio>
        ) : null}
        {codigo.trim() && !visibles.length ? <Aviso texto="No hay una reserva abierta con ese código." /> : null}
      </View>
      {visibles.map((r) => {
        const enRevision = r.estado === 'en_revision';
        const horas = enRevision && r.receta_subida_at ? (ahora - Date.parse(r.receta_subida_at)) / 3600000 : 0;
        const urgente = enRevision && r.receta_estado === 'pendiente' && horas >= HORAS_RECETA_URGENTE;
        return (
        <View key={r.id} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={18} tinte={urgente ? 'rgba(240,68,56,0.12)' : r.estado === 'pendiente' || enRevision ? 'rgba(247,144,9,0.12)' : undefined}>
            <View style={{ padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{`${r.cantidad} × ${r.producto}`}</Text>
                <Pildora texto={enRevision ? (r.receta_estado === 'otra_foto' ? 'Esperando foto' : urgente ? 'Receta urgente' : 'Receta por revisar') : r.estado === 'pendiente' ? 'Por apartar' : 'Lista'} color={urgente ? MARCA.rojo : enRevision || r.estado === 'pendiente' ? MARCA.ambar : MARCA.verde} />
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {[todas && r.sala ? r.sala : null, r.pedido, codigoDeReserva(r.id), pilaDelCliente(r),
                  r.estado === 'lista' ? plazoDeRetiro(r) : null, r.avisado_via === 'whatsapp' ? 'avisado por WhatsApp' : null].filter(Boolean).join(' · ')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {r.pago_estado === 'pagado' ? <Pildora texto={r.origen === 'sucursal' ? 'Pagada' : 'Pagada en línea'} color={MARCA.verde} /> : null}
                {r.pago_estado === 'anticipo' && Number(r.anticipo) > 0 ? <Pildora texto={`Anticipo ${formatMoney(Number(r.anticipo))}`} color={MARCA.ambar} /> : null}
                {r.documento === 'credito_fiscal' ? <Pildora texto="CCF" color={MARCA.azulClaro} /> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 16, flexWrap: 'wrap' }}>
                {enRevision ? (r.receta_ruta ? (
                  <Tocable onPress={() => verReceta(r)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Ver receta</Text>
                  </Tocable>
                ) : null) : r.estado === 'pendiente' ? (
                  <Tocable disabled={ocupada === r.id} onPress={() => mover(r, 'lista')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Apartar y avisar</Text>
                  </Tocable>
                ) : (
                  <>
                    {!r.tiene_app ? (
                      <Tocable onPress={() => avisarPorWhatsapp(r)} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                        <Text style={{ color: MARCA.verde, fontSize: 15, fontWeight: '600' }}>Avisar por WhatsApp</Text>
                      </Tocable>
                    ) : null}
                    <Tocable disabled={ocupada === r.id} onPress={() => mover(r, 'retirada')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>Retirada</Text>
                    </Tocable>
                  </>
                )}
                <Tocable disabled={ocupada === r.id} onPress={() => mover(r, 'cancelada')} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Cancelar</Text>
                </Tocable>
              </View>
            </View>
          </Vidrio>
        </View>
        );
      })}
      {!filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin reservas: cuando un cliente aparte algo desde la app, aparece aquí</Text> : null}
    </>
  );
}
