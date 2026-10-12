// Una conversación del chat con clientes, NATIVA — la `Conversacion` del
// portal: el cliente arriba (tipo, nivel, estado, teléfono), los mensajes (los
// del cliente a la izquierda; los del equipo a la derecha con la foto y el
// nombre corto de quien contestó, en tandas), fotos, productos y ofertas
// enviados, y el cuadro para responder. La pestaña «Cliente» trae su contexto
// (compras, puntos, reservas, tratamientos).
//
// Igual que el portal: al abrirla se TOMA (`chat_tomar`, el resto ve «… está
// respondiendo») y al salir se suelta; cada mensaje nuevo del cliente con el
// hilo abierto la vuelve a tomar. Los mensajes llegan en vivo
// (`useRefrescoEnVivo` sobre `app_chat_mensajes`).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { useEquipoDelChat } from '@nucleo/hooks/useBandejaDelChat';
import { COLUMNAS_PRESENCIA, EMOJIS_DE_REACCION, MENSAJES_POR_PAGINA, fetchConversaciones, fetchMensajes, fetchPresenciaDeConversaciones, fetchReacciones, quitarFotoDeCliente, reaccionarAMensaje, resolverConversacion, tomarConversacion } from '@nucleo/data/chatClientes';
import { escribeAhora, useRelojDeEscritura } from '@nucleo/hooks/escrituraDelChat';
import { empiezaTanda, nombreDeAutor, nombreDeCliente, recorteDeMensaje } from '@nucleo/utils/chatClientes';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Tocable from '../../componentes/Tocable';
import Avatar from '../../componentes/Avatar';
import { ErrorConReintento } from '../../componentes/ListaPaginada';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';
import { ChipsDeEstado, ClienteAvatar, EtiquetasDeCliente } from '../../componentes/chat/Piezas';
import PanelCliente from '../../componentes/chat/PanelCliente';
import Compositor from '../../componentes/chat/Compositor';
import { conversacionRecordada, recordarConversacion } from '../../componentes/chat/elegida';

const Burbuja = memo(function Burbuja({ m, nuevaTanda, autor, onFoto, cita, reacciones, entrega, onOpciones }) {
  if (m.autor === 'sistema') {
    return <Text style={{ textAlign: 'center', color: colorSistema.texto2, fontSize: 12, paddingVertical: 6, marginHorizontal: 24 }}>{m.texto}</Text>;
  }
  const delEquipo = m.autor === 'equipo';
  const adj = m.adjunto;
  const tinta = delEquipo ? '#fff' : colorSistema.texto;
  return (
    <View style={{ alignItems: delEquipo ? 'flex-end' : 'flex-start', paddingHorizontal: 12, paddingTop: nuevaTanda ? 10 : 2 }}>
      {nuevaTanda && delEquipo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600' }}>{shortEmployeeName(autor)}</Text>
          <Avatar empleado={autor} tamano={20} />
        </View>
      ) : null}
      <Pressable onLongPress={() => onOpciones?.(m)} delayLongPress={300} accessibilityHint="Mantén presionado para reaccionar o responder"
        style={{ maxWidth: '82%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 6,
        backgroundColor: delEquipo ? MARCA.azul : 'rgba(127,127,127,0.16)', borderBottomRightRadius: delEquipo ? 6 : 18, borderBottomLeftRadius: delEquipo ? 18 : 6 }}>
        {cita ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: delEquipo ? 'rgba(255,255,255,0.7)' : MARCA.azulClaro, paddingLeft: 8, opacity: 0.9 }}>
            <Text style={{ color: tinta, fontSize: 12, fontWeight: '700' }}>{cita.quien}</Text>
            <Text style={{ color: tinta, fontSize: 13 }} numberOfLines={2}>{cita.texto}</Text>
          </View>
        ) : null}
        {m.foto_ruta ? (m.foto_url ? (
          <Pressable onPress={() => onFoto(m.foto_url)} accessibilityLabel="Ampliar la foto">
            <Image source={{ uri: m.foto_url }} style={{ width: 200, height: 200, borderRadius: 12 }} resizeMode="cover" />
          </Pressable>
        ) : <Text style={{ color: tinta, fontSize: 13, opacity: 0.8 }}>Foto no disponible</Text>) : null}
        {adj?.tipo === 'producto' ? (
          <View style={{ borderRadius: 10, padding: 8, backgroundColor: delEquipo ? 'rgba(0,0,0,0.2)' : 'rgba(127,127,127,0.14)' }}>
            <Text style={{ color: tinta, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{`📦 ${adj.nombre}`}</Text>
            {adj.precio != null ? <Text style={{ color: tinta, fontSize: 13 }}>{formatMoney(Number(adj.precio))}</Text> : null}
          </View>
        ) : null}
        {adj?.tipo === 'oferta' ? (
          <View style={{ borderRadius: 10, padding: 8, backgroundColor: delEquipo ? 'rgba(0,0,0,0.2)' : 'rgba(127,127,127,0.14)' }}>
            <Text style={{ color: tinta, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{`🏷 ${adj.titulo}`}</Text>
          </View>
        ) : null}
        {m.texto ? <Text style={{ color: tinta, fontSize: 16 }} selectable>{m.texto}</Text> : null}
      </Pressable>
      {reacciones?.length ? (
        <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
          {reacciones.map((x) => (
            <View key={x.emoji} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, height: 24, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.18)' }}>
              <Text style={{ fontSize: 13 }}>{x.emoji}</Text>
              {x.n > 1 ? <Text style={{ color: colorSistema.texto2, fontSize: 12, marginLeft: 3 }}>{x.n}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <Text style={{ color: colorSistema.texto2, fontSize: 11, marginTop: 2 }}>
        {cuandoLlego(m.created_at)}{entrega ? <Text style={{ fontWeight: entrega === 'Visto' ? '700' : '400', color: entrega === 'Visto' ? MARCA.azulClaro : colorSistema.texto2 }}>{` · ${entrega}`}</Text> : null}
      </Text>
    </View>
  );
});

export default function ConversacionDelChat() {
  const { id } = useLocalSearchParams();
  const { hasPermission, user } = useAuth();
  const puedeResponder = !!hasPermission?.('chat_clientes', 'can_edit');
  // La barra va SÓLIDA en el chat (no transparente): el hilo y el cuadro de
  // respuesta tienen que quedar debajo de ella, y el teclado se corre por su alto.
  const alto = useSafeAreaInsets().top + 44;
  const ahora = useNowTick(30_000);
  const { equipo, asegurarEquipo } = useEquipoDelChat();
  const [c, setC] = useState(() => conversacionRecordada(id));
  const [mensajes, setMensajes] = useState(null);
  const [hayAnteriores, setHayAnteriores] = useState(false);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('mensajes');
  const [foto, setFoto] = useState(null);
  const [respondiendoA, setRespondiendoA] = useState(null);
  const [reacciones, setReacciones] = useState(() => new Map());
  const [presencia, setPresencia] = useState(null);
  const mensajesRef = useRef(null);
  const reaccionIds = useRef(new Set());
  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);

  // Sin la conversación en memoria (se abrió directo), se busca en la bandeja.
  useEffect(() => {
    if (c) return;
    let vivo = true;
    Promise.all([fetchConversaciones('abierta'), fetchConversaciones('resuelta')])
      .then(([a, r]) => { const x = [...a, ...r].find((k) => String(k.id) === String(id)); if (vivo && x) { recordarConversacion(x); setC(x); } else if (vivo) setError('Ya no está disponible: puede que alguien ya la haya resuelto o borrado.'); })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e)); });
    return () => { vivo = false; };
  }, [c, id]);

  // ── Reacciones: `Map<mensajeId, filas>`, en vivo (igual que el portal) ──
  const leerReacciones = useCallback(async (ids) => {
    const lista = (ids || []).filter((x) => x != null);
    if (!lista.length) return;
    try {
      const filas = await fetchReacciones(lista);
      filas.forEach((f) => reaccionIds.current.add(f.id));
      setReacciones((prev) => {
        const nuevo = new Map(prev);
        lista.forEach((mid) => nuevo.delete(Number(mid)));
        filas.forEach((f) => nuevo.set(f.mensaje_id, [...(nuevo.get(f.mensaje_id) ?? []), f]));
        return nuevo;
      });
    } catch { /* el siguiente aviso lo vuelve a intentar */ }
  }, []);
  const releerReacciones = useCallback(() => leerReacciones((mensajesRef.current ?? []).map((m) => m.id)), [leerReacciones]);
  const ignorarReaccion = useCallback((payload) => {
    if (payload?.eventType === 'DELETE') return !reaccionIds.current.has(payload.old?.id);
    return !(mensajesRef.current ?? []).some((m) => m.id === payload?.new?.mensaje_id);
  }, []);
  useRefrescoEnVivo(releerReacciones, { ms: 30_000, tabla: 'app_chat_reacciones', esperaMs: 250, ignorar: ignorarReaccion });

  // ── Presencia: quién escribe y si el cliente ya leyó lo nuestro ─────────
  // Llega en el aviso de realtime de la conversación; el reloj es el respaldo.
  const leerPresencia = useCallback(async () => {
    try { const m = await fetchPresenciaDeConversaciones([id]); setPresencia(m.get(Number(id)) ?? null); } catch { /* sin presencia no se rompe nada */ }
  }, [id]);
  const avisoDePresencia = useCallback((payload) => {
    const nueva = payload?.new;
    if (String(nueva?.id) !== String(id)) return true;
    setPresencia(Object.fromEntries(COLUMNAS_PRESENCIA.map((k) => [k, nueva[k] ?? null])));
    return true;
  }, [id]);
  useRefrescoEnVivo(leerPresencia, { ms: 15_000, tabla: 'app_chat_conversaciones', ignorar: avisoDePresencia });
  useEffect(() => { leerPresencia(); }, [leerPresencia]);

  // Primera página + tomarla; al salir, soltarla.
  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchMensajes(id)).then((filas) => {
      if (!vivo) return;
      setMensajes(filas); setHayAnteriores(filas.length >= MENSAJES_POR_PAGINA);
      asegurarEquipo(filas.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
      leerReacciones(filas.map((m) => m.id));
    }).catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudieron cargar los mensajes.')); });
    if (puedeResponder) Promise.resolve(tomarConversacion(id)).catch(() => {});
    return () => { vivo = false; if (puedeResponder) Promise.resolve(tomarConversacion(id, true)).catch(() => {}); };
  }, [id, puedeResponder, asegurarEquipo, leerReacciones]);

  const traerNuevos = useCallback(async () => {
    const actuales = mensajesRef.current;
    if (!actuales) return;
    try {
      const nuevos = await fetchMensajes(id, { despuesDe: actuales[actuales.length - 1]?.id ?? null });
      if (!nuevos.length) return;
      setMensajes((prev) => { const ids = new Set((prev ?? []).map((m) => m.id)); return [...(prev ?? []), ...nuevos.filter((m) => !ids.has(m.id))]; });
      asegurarEquipo(nuevos.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
      leerReacciones(nuevos.map((m) => m.id));
      if (puedeResponder && nuevos.some((m) => m.autor === 'cliente')) Promise.resolve(tomarConversacion(id)).catch(() => {});
    } catch { /* el siguiente refresco lo vuelve a intentar */ }
  }, [id, puedeResponder, asegurarEquipo, leerReacciones]);
  useRefrescoEnVivo(traerNuevos, { ms: 20_000, tabla: 'app_chat_mensajes', esperaMs: 250 });

  const verAnteriores = async () => {
    const primero = mensajes?.[0]?.id;
    if (primero == null || cargandoAnteriores || !hayAnteriores) return;
    setCargandoAnteriores(true);
    try {
      const viejos = await fetchMensajes(id, { antesDe: primero });
      setMensajes((prev) => [...viejos, ...(prev ?? [])]);
      setHayAnteriores(viejos.length >= MENSAJES_POR_PAGINA);
      asegurarEquipo(viejos.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
      leerReacciones(viejos.map((m) => m.id));
    } catch (e) { fallo('No se pudieron cargar', mensajeAmigable(e)); }
    finally { setCargandoAnteriores(false); }
  };

  const resolver = () => Alert.alert('Marcar como resuelta', 'Si el cliente vuelve a escribir, se abre sola.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Resolver', onPress: () => Promise.resolve(resolverConversacion(id))
      .then(() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); listo('Conversación resuelta'); volver('/chat-clientes'); })
      .catch((e) => fallo('No se pudo resolver', mensajeAmigable(e))) },
  ]);
  const quitarFoto = () => Alert.alert('¿Quitar la foto de perfil?', `La foto de ${nombreDeCliente(c?.cliente)} deja de verse en el portal y en su app. Puede subir otra cuando quiera.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Quitar foto', style: 'destructive', onPress: () => Promise.resolve(quitarFotoDeCliente(c.customer_id))
      .then(() => { listo('Foto quitada', 'El cliente puede subir otra desde la app.'); setC((x) => ({ ...x, foto_url: null, foto_ruta: null })); })
      .catch((e) => fallo('No se pudo quitar', mensajeAmigable(e))) },
  ]);

  const reaccionar = useCallback(async (m, emoji) => {
    try { await reaccionarAMensaje(m.id, emoji); Haptics.selectionAsync().catch(() => {}); leerReacciones([m.id]); }
    catch (e) { fallo('No se pudo reaccionar', mensajeAmigable(e)); }
  }, [leerReacciones]);
  const opciones = useCallback((m) => {
    if (m.autor === 'sistema') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const acciones = [
      ...(puedeResponder ? EMOJIS_DE_REACCION.map((e) => ({ texto: e, hacer: () => reaccionar(m, e) })) : []),
      ...(puedeResponder ? [{ texto: 'Responder', hacer: () => setRespondiendoA(m) }] : []),
    ];
    if (!acciones.length) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: [...acciones.map((a) => a.texto), 'Cancelar'], cancelButtonIndex: acciones.length },
        (i) => { if (i < acciones.length) acciones[i].hacer(); });
    } else {
      Alert.alert('Mensaje', undefined, [...acciones.map((a) => ({ text: a.texto, onPress: a.hacer })), { text: 'Cancelar', style: 'cancel' }]);
    }
  }, [puedeResponder, reaccionar]);

  // La conversación con su presencia encima (la que llega en vivo).
  const cv = c ? { ...c, ...(presencia ?? {}) } : c;
  const nombreCliente = cv ? nombreDeCliente(cv.cliente) : '';
  let ultimoDelEquipo = null;
  for (let i = (mensajes?.length ?? 0) - 1; i >= 0; i -= 1) { if (mensajes[i].autor === 'equipo') { ultimoDelEquipo = mensajes[i].id; break; } }
  const sinLeerCliente = cv?.sin_leer_cliente == null ? null : Number(cv.sin_leer_cliente);
  const entrega = sinLeerCliente == null ? null : sinLeerCliente === 0 ? 'Visto' : 'Enviado';
  const reloj = useRelojDeEscritura([cv?.cliente_escribiendo_at, cv?.escribiendo_at]);
  const escribeCliente = escribeAhora(cv?.cliente_escribiendo_at, reloj);
  const otroId = cv?.escribiendo_por && String(cv.escribiendo_por) !== String(user?.id) ? cv.escribiendo_por : null;
  const escribeOtro = otroId != null && escribeAhora(cv?.escribiendo_at, reloj);
  useEffect(() => { if (escribeOtro && !equipo.has(otroId)) asegurarEquipo([otroId]); }, [escribeOtro, otroId, equipo, asegurarEquipo]);
  const resumirReacciones = (filas) => {
    const n = new Map(); (filas ?? []).forEach((f) => n.set(f.emoji, (n.get(f.emoji) ?? 0) + 1));
    return [...n].map(([emoji, k]) => ({ emoji, n: k }));
  };
  const invertidos = (mensajes ?? []).map((m, i, todos) => ({ m, nuevaTanda: empiezaTanda(m, todos[i - 1]) })).reverse();
  const tel = String(c?.telefono ?? '').replace(/\D/g, '');

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, headerTransparent: false, headerStyle: { backgroundColor: colorSistema.fondo }, title: c ? nombreDeCliente(c.cliente) : 'Conversación' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? alto : 0}>
        {c ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8, borderBottomWidth: 0.5, borderBottomColor: colorSistema.separador }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ClienteAvatar cliente={c.cliente} fotoUrl={c.foto_url} tamano={44} />
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                  <EtiquetasDeCliente c={c} />
                  <ChipsDeEstado conversacion={c} ahora={ahora} atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} />
                </View>
                {tel ? (
                  <Pressable onPress={() => Linking.openURL(`tel:${tel}`).catch(() => {})} hitSlop={6}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14 }}>{`📞 ${c.telefono}`}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {puedeResponder ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {c.estado === 'abierta' ? (
                  <Tocable onPress={resolver} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: 'rgba(18,183,106,0.16)' }}>
                    <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>Marcar como resuelta</Text>
                  </Tocable>
                ) : null}
                {c.foto_ruta || c.foto_url ? (
                  <Tocable onPress={quitarFoto} accessibilityRole="button" style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.14)' }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>Quitar foto de perfil</Text>
                  </Tocable>
                ) : null}
              </View>
            ) : null}
            <Segmentos margen={0} activa={pestana} onCambiar={setPestana} opciones={[{ id: 'mensajes', label: 'Mensajes' }, { id: 'cliente', label: 'Cliente' }]} />
          </View>
        ) : null}

        {pestana === 'cliente' && c ? (
          <ScrollView style={{ flex: 1 }}><PanelCliente customerId={c.customer_id} /></ScrollView>
        ) : (
          <>
            {error && !mensajes ? <ErrorConReintento mensaje={error} onReintentar={() => { setError(null); setC(conversacionRecordada(id)); }} /> : null}
            {!mensajes && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
            {mensajes ? (
              <FlatList inverted style={{ flex: 1 }} data={invertidos} keyExtractor={(x) => String(x.m.id)}
                renderItem={({ item }) => (
                  <Burbuja m={item.m} nuevaTanda={item.nuevaTanda} onFoto={setFoto} onOpciones={opciones}
                    autor={item.m.employee_id ? equipo.get(item.m.employee_id) ?? { id: item.m.employee_id } : null}
                    cita={item.m.cita ? { quien: nombreDeAutor(item.m.cita, equipo, nombreCliente), texto: recorteDeMensaje(item.m.cita) } : null}
                    reacciones={resumirReacciones(reacciones.get(item.m.id))}
                    entrega={item.m.id === ultimoDelEquipo ? entrega : null} />
                )}
                onEndReached={verAnteriores} onEndReachedThreshold={0.3} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
                initialNumToRender={20} windowSize={11} contentContainerStyle={{ paddingVertical: 8 }}
                ListFooterComponent={cargandoAnteriores ? <ActivityIndicator style={{ marginVertical: 12 }} /> : null}
                ListEmptyComponent={<Text style={{ color: colorSistema.texto2, textAlign: 'center', marginVertical: 24, transform: [{ scaleY: -1 }] }}>Todavía no hay mensajes.</Text>} />
            ) : null}
            {escribeCliente || escribeOtro ? (
              <View accessibilityLiveRegion="polite" style={{ paddingHorizontal: 16, paddingVertical: 4, gap: 2 }}>
                {escribeCliente ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontStyle: 'italic' }}>{`${nombreCliente.split(' ')[0] || 'El cliente'} está escribiendo…`}</Text> : null}
                {escribeOtro ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>{`${equipo.get(otroId) ? shortEmployeeName(equipo.get(otroId)) : 'Alguien del equipo'} está escribiendo…`}</Text> : null}
              </View>
            ) : null}
            {c && puedeResponder ? (
              <Compositor conversacion={c} onEnviado={traerNuevos} respondiendoA={respondiendoA} onQuitarRespuesta={() => setRespondiendoA(null)}
                equipo={equipo} cliente={nombreCliente} />
            ) : null}
            {c && !puedeResponder ? (
              <View style={{ padding: 16 }}><Aviso texto="Puedes leer las conversaciones; para responder hace falta el permiso de editar." /></View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>

      <Modal visible={!!foto} transparent animationType="fade" onRequestClose={() => setFoto(null)}>
        <Pressable onPress={() => setFoto(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Cerrar la foto">
          {foto ? <Image source={{ uri: foto }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}
