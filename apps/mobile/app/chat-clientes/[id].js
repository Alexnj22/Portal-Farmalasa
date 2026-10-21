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
//
// Desde el 2026-10-21 se siente como la app de puntos y como el portal (los
// tres usan `@nucleo/data/chatHilo`): lo ya visto se pinta en el primer cuadro
// y la lectura fresca lo pone al día detrás; el mensaje propio aparece al tocar
// Enviar (con un reloj), se vuelve ✓ al confirmarse y lo reemplaza el real; si
// falla queda «No se envió · Toca para reintentar». Las notas de voz se
// escuchan dentro del globo con velocidad 1×/1.5×/2× (`Voz.js`).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@nucleo/context/AuthContext';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { useEquipoDelChat } from '@nucleo/hooks/useBandejaDelChat';
import { COLUMNAS_PRESENCIA, EMOJIS_DE_REACCION, MENSAJES_POR_PAGINA, fetchConversaciones, fetchMensajes, fetchMensajesCambiados, fetchPresenciaDeConversaciones, fetchReacciones, quitarFotoDeCliente, reaccionarAMensaje, resolverConversacion, responderConversacion, subirAudioDelEquipo, subirFotoDelEquipo, tomarConversacion } from '@nucleo/data/chatClientes';
import { fusionar, guardarHilo, leerHilo } from '@nucleo/data/chatHilo';
import { escribeAhora, useRelojDeEscritura } from '@nucleo/hooks/escrituraDelChat';
import { cambiaDeDia, empiezaTanda, etiquetaDeDia, nombreCortoDeCliente, nombreDeAutor, nombreDeCliente, recorteDeMensaje } from '@nucleo/utils/chatClientes';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { estrellas, miReaccion } from '@nucleo/utils/chatPersonal';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import Tocable from '../../componentes/Tocable';
import Avatar from '../../componentes/Avatar';
import { ErrorConReintento } from '../../componentes/ListaPaginada';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';
import { ClienteAvatar, EstadoEnTexto, EtiquetasDeCliente } from '../../componentes/chat/Piezas';
import { Host, Icon } from '@expo/ui';
import { iconoDe } from '../../tema/iconos';
import Asignacion from '../../componentes/chat/Asignacion';
import PanelCliente from '../../componentes/chat/PanelCliente';
import Compositor from '../../componentes/chat/Compositor';
import { conversacionRecordada, recordarConversacion } from '../../componentes/chat/elegida';
import DeslizarParaResponder from '../../componentes/chat/DeslizarParaResponder';
import MenuDeMensaje from '../../componentes/chat/MenuDeMensaje';
import { EtiquetasDeConversacion } from '../../componentes/chat/Etiquetas';
import { NotaDeVoz } from '../../componentes/chat/Voz';

const MAX_FOTO = 8 * 1024 * 1024; // el `file_size_limit` del bucket


function SeparadorDeDia({ valor }) {
  return (
    <View style={{ alignItems: 'center', paddingTop: 14, paddingBottom: 4 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
        backgroundColor: 'rgba(127,127,127,0.14)', overflow: 'hidden' }}>{etiquetaDeDia(valor)}</Text>
    </View>
  );
}

// Abrir la nota de voz o el PDF del cliente en el visor del sistema (2026-10-20).
const abrirArchivo = (url) => {
  if (!url) return;
  Haptics.selectionAsync().catch(() => {});
  WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => {});
};

// Un mensaje (rehecho el 2026-10-20, «que se vea muy estético también»): globos
// agrupados como iMessage —dentro de una tanda la esquina del lado del autor se
// achica—, la tarjeta del producto con su foto, las notas de voz y los PDF del
// cliente, lo que el cliente EDITÓ o ELIMINÓ, y las respuestas automáticas con
// su rótulo, del lado del equipo.
const Burbuja = memo(function Burbuja({ m, nuevaTanda, finDeTanda, autor, onFoto, cita, reacciones, entrega, onOpciones, clienteFoto, onReintentar }) {
  if (m.autor === 'sistema' && !m.automatica) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 6, paddingHorizontal: 24 }}>
        <Text style={{ textAlign: 'center', color: colorSistema.texto2, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
          backgroundColor: 'rgba(127,127,127,0.12)', overflow: 'hidden' }}>{m.texto}</Text>
      </View>
    );
  }
  const auto = m.autor === 'sistema';
  const delEquipo = m.autor === 'equipo' || auto;
  const adj = m.adjunto;
  const tinta = delEquipo && !auto ? '#fff' : colorSistema.texto;
  const R = 20, r = 6;
  const esquinas = delEquipo
    ? { borderTopRightRadius: nuevaTanda ? R : r, borderBottomRightRadius: finDeTanda ? R : r }
    : { borderTopLeftRadius: nuevaTanda ? R : r, borderBottomLeftRadius: finDeTanda ? R : r };
  const fondo = auto ? 'rgba(105,41,196,0.10)' : delEquipo ? MARCA.azul : 'rgba(127,127,127,0.15)';
  const tarjeta = delEquipo && !auto ? 'rgba(255,255,255,0.16)' : 'rgba(127,127,127,0.12)';
  return (
    <View style={{ alignItems: delEquipo ? 'flex-end' : 'flex-start', paddingHorizontal: 12, paddingLeft: delEquipo ? 12 : 44, paddingTop: nuevaTanda ? 10 : 2 }}>
      {!delEquipo && finDeTanda && clienteFoto ? <View style={{ position: 'absolute', left: 10, bottom: 18 }}>{clienteFoto}</View> : null}
      {nuevaTanda && delEquipo ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {auto ? (
            <Text style={{ color: MARCA.violeta, fontSize: 12, fontWeight: '700' }}>✦ Respuesta automática</Text>
          ) : (
            <>
              <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '600' }}>{nombreDeCliente(shortEmployeeName(autor))}</Text>
              <Avatar empleado={autor} tamano={16} />
            </>
          )}
        </View>
      ) : null}
      <Pressable onLongPress={m.temporal ? undefined : () => onOpciones?.(m)} onPress={m.fallido ? () => onReintentar?.(m) : undefined} delayLongPress={300} accessibilityHint="Desliza a la derecha para responder; mantén presionado para reaccionar o copiar"
        style={({ pressed }) => ({ maxWidth: '82%', borderRadius: R, paddingHorizontal: 12, paddingVertical: 8, gap: 6, backgroundColor: fondo, ...esquinas,
          opacity: m.borrado_at ? 0.55 : m.pendiente ? 0.75 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
          ...(m.fallido ? { borderWidth: 2, borderColor: MARCA.rojo } : null),
          ...(auto ? { borderWidth: 1, borderColor: 'rgba(105,41,196,0.28)' } : null) })}>
        {cita ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: delEquipo && !auto ? 'rgba(255,255,255,0.7)' : MARCA.azulClaro, paddingLeft: 8, opacity: 0.9 }}>
            <Text style={{ color: tinta, fontSize: 12, fontWeight: '700' }}>{cita.quien}</Text>
            <Text style={{ color: tinta, fontSize: 13 }} numberOfLines={2}>{cita.texto}</Text>
          </View>
        ) : null}
        {m.foto_ruta ? (m.foto_url ? (
          <Pressable onPress={() => onFoto(m.foto_url)} accessibilityLabel="Ampliar la foto">
            <Image source={{ uri: m.foto_url }} style={{ width: 210, height: 240, borderRadius: 14 }} resizeMode="cover" />
          </Pressable>
        ) : <Text style={{ color: tinta, fontSize: 13, opacity: 0.8 }}>Foto no disponible</Text>) : null}
        {adj?.tipo === 'producto' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 8, backgroundColor: tarjeta, minWidth: 200 }}>
            {adj.foto ? <Image source={{ uri: adj.foto }} style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: '#fff' }} />
              : <View style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.18)' }}><Text style={{ fontSize: 20 }}>💊</Text></View>}
            <View style={{ flex: 1 }}>
              <Text style={{ color: tinta, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{adj.nombre}</Text>
              {adj.precio != null ? <Text style={{ color: tinta, fontSize: 13, opacity: 0.9 }}>{formatMoney(Number(adj.precio))}</Text> : null}
            </View>
          </View>
        ) : null}
        {adj?.tipo === 'oferta' ? (
          <View style={{ borderRadius: 14, padding: 10, backgroundColor: tarjeta }}>
            <Text style={{ color: tinta, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, opacity: 0.8 }}>OFERTA</Text>
            <Text style={{ color: tinta, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{adj.titulo}</Text>
          </View>
        ) : null}
        {adj?.tipo === 'audio' ? <NotaDeVoz key={m.archivo_url ?? 'sin-archivo'} url={m.archivo_url} duracion={adj.duracion} delEquipo={delEquipo && !auto} tinta={tinta} /> : null}
        {adj?.tipo === 'pdf' ? (
          <Pressable onPress={() => abrirArchivo(m.archivo_url)} disabled={!m.archivo_url} accessibilityRole="button" accessibilityLabel="Abrir el documento"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 8, backgroundColor: tarjeta, minWidth: 200 }}>
            <View style={{ width: 36, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(240,68,56,0.14)' }}>
              <Text style={{ color: MARCA.rojo, fontSize: 10, fontWeight: '900' }}>PDF</Text>
            </View>
            <Text style={{ flex: 1, color: tinta, fontSize: 14, fontWeight: '700' }} numberOfLines={2}>{adj.nombre || 'Documento'}</Text>
          </Pressable>
        ) : null}
        {m.texto ? <Text style={{ color: tinta, fontSize: 16, lineHeight: 21, textDecorationLine: m.borrado_at ? 'line-through' : 'none' }}>{m.texto}</Text> : null}
        {m.borrado_at ? <Text style={{ color: tinta, fontSize: 12, fontWeight: '700', opacity: 0.85 }}>El cliente eliminó este mensaje</Text> : null}
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
      {m.fallido ? (
        <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '700', marginTop: 3 }}>No se envió · Toca para reintentar</Text>
      ) : m.temporal ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 11, marginTop: 2 }}>{m.pendiente ? '🕓 Enviando…' : '✓ Enviado'}</Text>
      ) : finDeTanda ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 11, marginTop: 2 }}>
          {cuandoLlego(m.created_at)}{m.editado_at && !m.borrado_at ? ' · Editado' : ''}{entrega ? <Text style={{ fontWeight: entrega === 'Visto' ? '700' : '400', color: entrega === 'Visto' ? MARCA.azulClaro : colorSistema.texto2 }}>{` · ${entrega}`}</Text> : null}
        </Text>
      ) : null}
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
  // Lo ya visto se pinta en el primer cuadro (ver `chatHilo`).
  const [enMemoria] = useState(() => leerHilo(id));
  const [mensajes, setMensajes] = useState(() => enMemoria?.mensajes ?? null);
  const [hayAnteriores, setHayAnteriores] = useState(() => enMemoria?.hayAnteriores ?? false);
  const [cargandoAnteriores, setCargandoAnteriores] = useState(false);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('mensajes');
  const [foto, setFoto] = useState(null);
  const [respondiendoA, setRespondiendoA] = useState(null);
  const [menu, setMenu] = useState(null);
  const [reacciones, setReacciones] = useState(() => enMemoria?.reacciones ?? new Map());
  const [presencia, setPresencia] = useState(null);
  const mensajesRef = useRef(null);
  const reaccionIds = useRef(new Set());
  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);
  // Lo que se ve queda en memoria para la próxima vez (sin los temporales).
  useEffect(() => {
    if (mensajes) guardarHilo(id, { mensajes: mensajes.filter((m) => !m.temporal), hayAnteriores, reacciones });
  }, [id, mensajes, hayAnteriores, reacciones]);

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
    const lista = (ids || []).filter((x) => x != null && !String(x).startsWith('tmp-'));
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
      // Los temporales (lo que se está enviando) se conservan al final.
      setMensajes((prev) => [...filas, ...(prev ?? []).filter((m) => m.temporal)]); setHayAnteriores(filas.length >= MENSAJES_POR_PAGINA);
      asegurarEquipo(filas.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
      leerReacciones(filas.map((m) => m.id));
    }).catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudieron cargar los mensajes.')); });
    if (puedeResponder) Promise.resolve(tomarConversacion(id)).catch(() => {});
    return () => { vivo = false; if (puedeResponder) Promise.resolve(tomarConversacion(id, true)).catch(() => {}); };
  }, [id, puedeResponder, asegurarEquipo, leerReacciones]);

  // Desde cuándo se buscan lo editado y lo eliminado por el cliente (2026-10-20).
  const cambiosDesde = useRef(new Date().toISOString());
  const traerNuevos = useCallback(async () => {
    const actuales = mensajesRef.current;
    if (!actuales) return;
    try {
      const desde = cambiosDesde.current;
      cambiosDesde.current = new Date(Date.now() - 5000).toISOString();
      const [nuevos, cambiados] = await Promise.all([
        fetchMensajes(id, { despuesDe: actuales.filter((m) => !m.temporal).at(-1)?.id ?? null }), fetchMensajesCambiados(id, desde),
      ]);
      if (cambiados.length) {
        const porId = new Map(cambiados.map((x) => [x.id, x]));
        setMensajes((prev) => (prev ?? []).map((x) => (porId.has(x.id) ? { ...x, ...porId.get(x.id) } : x)));
      }
      if (!nuevos.length) return;
      setMensajes((prev) => fusionar(prev, nuevos));
      asegurarEquipo(nuevos.flatMap((m) => [m.employee_id, m.cita?.employee_id]));
      leerReacciones(nuevos.map((m) => m.id));
      if (puedeResponder && nuevos.some((m) => m.autor === 'cliente')) Promise.resolve(tomarConversacion(id)).catch(() => {});
    } catch { /* el siguiente refresco lo vuelve a intentar */ }
  }, [id, puedeResponder, asegurarEquipo, leerReacciones]);
  useRefrescoEnVivo(traerNuevos, { ms: 20_000, tabla: 'app_chat_mensajes', esperaMs: 250 });

  // ── Enviar: el globo aparece AL TOCAR (igual que el portal y la app de puntos) ──
  const enviarMensaje = useCallback(async (envio, previo = null) => {
    const tmpId = previo?.id ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const r = envio.respuestaA;
    const temporal = {
      id: tmpId, temporal: true, pendiente: true, envio,
      autor: 'equipo', employee_id: user?.id ?? null, texto: String(envio.texto ?? '').trim() || null,
      foto_ruta: envio.foto ? 'local' : null, foto_url: envio.foto ?? null,
      adjunto: envio.voz ? { tipo: 'audio', duracion: envio.voz.duracion } : envio.adjunto ?? null,
      archivo_url: envio.voz?.uri ?? null, created_at: new Date().toISOString(),
      cita: r ? { id: r.id, autor: r.autor, employee_id: r.employee_id, texto: r.texto, foto_ruta: r.foto_ruta } : null,
    };
    setMensajes((prev) => (previo ? (prev ?? []).map((m) => (m.id === tmpId ? temporal : m)) : [...(prev ?? []), temporal]));
    try {
      let fotoRuta = null;
      if (envio.foto) {
        const body = await (await fetch(envio.foto)).arrayBuffer();
        if (body.byteLength > MAX_FOTO) throw new Error('La foto pesa más de 8 MB.');
        fotoRuta = await subirFotoDelEquipo(c.customer_id, { body, contentType: 'image/jpeg' });
      }
      let adjunto = envio.adjunto ?? null;
      if (envio.voz) {
        const body = await (await fetch(envio.voz.uri)).arrayBuffer();
        adjunto = { tipo: 'audio', ruta: await subirAudioDelEquipo(c.customer_id, { body }), nombre: null, duracion: envio.voz.duracion };
      }
      await responderConversacion(id, { texto: envio.texto, fotoRuta, adjunto, respuestaA: r?.id ?? null });
      await traerNuevos();
      // Si el real todavía no llegó, por lo menos que diga «enviado».
      setMensajes((prev) => (prev ?? []).map((m) => (m.id === tmpId ? { ...m, pendiente: false, enviado: true } : m)));
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setMensajes((prev) => (prev ?? []).map((m) => (m.id === tmpId ? { ...m, pendiente: false, fallido: true } : m)));
    }
  }, [id, user?.id, c?.customer_id, traerNuevos]);
  const reintentar = useCallback((m) => enviarMensaje(m.envio, { ...m, fallido: false }), [enviarMensaje]);

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

  // `emoji: null` quita la mía (igual que el portal).
  const reaccionar = useCallback(async (m, emoji) => {
    try { await reaccionarAMensaje(m.id, emoji); Haptics.selectionAsync().catch(() => {}); leerReacciones([m.id]); }
    catch (e) { fallo('No se pudo reaccionar', mensajeAmigable(e)); }
  }, [leerReacciones]);
  // Mantener presionado: la barra de reacciones y el menú corto (`MenuDeMensaje`).
  const opciones = useCallback((m) => {
    if (m.autor === 'sistema') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setMenu(m);
  }, []);
  const responderA = useCallback((m) => { if (puedeResponder && m.autor !== 'sistema') setRespondiendoA(m); }, [puedeResponder]);
  const copiar = (m) => Promise.resolve(Clipboard.setStringAsync(String(m.texto ?? '')))
    .then(() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); listo('Copiado'); })
    .catch(() => fallo('No se pudo copiar'));

  // La conversación con su presencia encima (la que llega en vivo).
  const cv = c ? { ...c, ...(presencia ?? {}) } : c;
  const nombreCliente = cv ? nombreDeCliente(cv.cliente) : '';
  let ultimoDelEquipo = null;
  for (let i = (mensajes?.length ?? 0) - 1; i >= 0; i -= 1) { if (mensajes[i].autor === 'equipo' && !mensajes[i].temporal) { ultimoDelEquipo = mensajes[i].id; break; } }
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
  const invertidos = (mensajes ?? []).map((m, i, todos) => ({ m, nuevaTanda: empiezaTanda(m, todos[i - 1]) || cambiaDeDia(m, todos[i - 1]), nuevoDia: cambiaDeDia(m, todos[i - 1]),
    finDeTanda: !todos[i + 1] || empiezaTanda(todos[i + 1], m) || cambiaDeDia(todos[i + 1], m) })).reverse();
  const fotoCliente = c ? <ClienteAvatar cliente={c.cliente} fotoUrl={c.foto_url} tamano={26} conversacion={c} /> : null;

  return (
    <>
      {/* La barra (2026-10-21, la misma decisión que el portal): foto con su
          aro de nivel, nombre y estado en la barra del sistema, como una app
          de mensajería, y la ficha detrás de un toque. Antes iban cinco
          renglones (insignias, asignación, calificación, teléfono, botones,
          etiquetas y las pestañas) que se comían media pantalla del chat. */}
      <Stack.Screen options={{ ...BARRA_NATIVA, headerTransparent: false, headerStyle: { backgroundColor: colorSistema.fondo },
        // Deslizar a la derecha es RESPONDER un mensaje (2026-10-21: «no puedo
        // deslizar para contestar, me saca»): con el gesto de pantalla completa
        // la pila se lo quedaba y cerraba el hilo. Volver sigue desde el borde.
        fullScreenGestureEnabled: false,
        title: c ? nombreDeCliente(c.cliente) : 'Conversación',
        headerTitle: c ? () => (
          <Pressable onPress={() => setPestana((p) => (p === 'cliente' ? 'mensajes' : 'cliente'))} accessibilityRole="button"
            accessibilityLabel={pestana === 'cliente' ? 'Volver a los mensajes' : `Ver la ficha de ${nombreDeCliente(c.cliente)}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: 240 }}>
            <ClienteAvatar cliente={c.cliente} fotoUrl={c.foto_url} tamano={36} conversacion={c} animado />
            <View style={{ flexShrink: 1 }}>
              <Text numberOfLines={1} style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{nombreCortoDeCliente(c.cliente)}</Text>
              <EstadoEnTexto conversacion={c} ahora={ahora} atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} />
            </View>
          </Pressable>
        ) : undefined,
        headerRight: c ? () => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Tocable onPress={() => setPestana((p) => (p === 'cliente' ? 'mensajes' : 'cliente'))} hitSlop={8} accessibilityRole="button"
              accessibilityLabel={pestana === 'cliente' ? 'Volver a los mensajes' : 'Ver la ficha del cliente'}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: pestana === 'cliente' ? 'rgba(127,127,127,0.18)' : 'transparent' }}>
              <Host matchContents><Icon name={iconoDe(pestana === 'cliente' ? 'MessageCircle' : 'User')} size={20} color={colorSistema.acento} /></Host>
            </Tocable>
            {puedeResponder && c.estado === 'abierta' ? (
              <Tocable onPress={resolver} hitSlop={8} accessibilityRole="button" accessibilityLabel="Marcar como resuelta"
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}>
                <Host matchContents><Icon name={iconoDe('CheckCircle2')} size={20} color={MARCA.verde} /></Host>
              </Tocable>
            ) : null}
          </View>
        ) : undefined,
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? alto : 0}>
        {pestana === 'cliente' && c ? (
          <ScrollView style={{ flex: 1 }}>
            <PanelCliente customerId={c.customer_id} arriba={(
              <View style={{ gap: 10 }}>
                {/* El nombre entero: la barra lleva el corto. */}
                <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{nombreDeCliente(c.cliente)}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><EtiquetasDeCliente c={c} /></View>
                {cv ? <Asignacion conversacion={cv} equipo={equipo} sinAsignar={cv.estado !== 'resuelta'} /> : null}
                {estrellas(cv?.calificacion) ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                    {`Calificó ${estrellas(cv.calificacion)}${cv.calificacion_comentario ? ` «${cv.calificacion_comentario}»` : ''}`}
                  </Text>
                ) : null}
                <EtiquetasDeConversacion conversacion={cv} puedeEditar={puedeResponder}
                  onCambio={(etiquetas) => setC((x) => (x ? { ...x, etiquetas } : x))} />
                {puedeResponder && (c.foto_ruta || c.foto_url) ? (
                  <Tocable onPress={quitarFoto} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.14)' }}>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600' }}>Quitar foto de perfil</Text>
                  </Tocable>
                ) : null}
              </View>
            )} />
          </ScrollView>
        ) : (
          <>
            {error && !mensajes ? <ErrorConReintento mensaje={error} onReintentar={() => { setError(null); setC(conversacionRecordada(id)); }} /> : null}
            {!mensajes && !error ? <ActivityIndicator style={{ marginTop: 32 }} /> : null}
            {mensajes ? (
              <FlatList inverted style={{ flex: 1 }} data={invertidos} keyExtractor={(x) => String(x.m.id)}
                renderItem={({ item }) => (
                  <View>
                  {item.nuevoDia ? <SeparadorDeDia valor={item.m.created_at} /> : null}
                  <DeslizarParaResponder activo={puedeResponder && item.m.autor !== 'sistema' && !item.m.temporal} onResponder={() => responderA(item.m)}>
                  <Burbuja m={item.m} nuevaTanda={item.nuevaTanda} finDeTanda={item.finDeTanda} onFoto={setFoto} onOpciones={opciones} clienteFoto={fotoCliente}
                    autor={item.m.employee_id ? equipo.get(item.m.employee_id) ?? { id: item.m.employee_id } : null}
                    cita={item.m.cita ? { quien: nombreDeAutor(item.m.cita, equipo, nombreCliente), texto: recorteDeMensaje(item.m.cita) } : null}
                    reacciones={resumirReacciones(reacciones.get(item.m.id))}
                    entrega={item.m.id === ultimoDelEquipo ? entrega : null} onReintentar={reintentar} />
                  </DeslizarParaResponder>
                  </View>
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
              <Compositor conversacion={c} onEnviar={enviarMensaje} respondiendoA={respondiendoA} onQuitarRespuesta={() => setRespondiendoA(null)}
                equipo={equipo} cliente={nombreCliente} />
            ) : null}
            {c && !puedeResponder ? (
              <View style={{ padding: 16 }}><Aviso texto="Puedes leer las conversaciones; para responder hace falta el permiso de editar." /></View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>

      <MenuDeMensaje mensaje={menu} delEquipo={menu?.autor === 'equipo'} puedeResponder={puedeResponder}
        mia={menu ? miReaccion(reacciones.get(menu.id), user?.id) : null}
        onReaccionar={(e) => reaccionar(menu, e)} onResponder={() => responderA(menu)} onCopiar={() => copiar(menu)}
        onCerrar={() => setMenu(null)} />

      <Modal visible={!!foto} transparent animationType="fade" onRequestClose={() => setFoto(null)}>
        <Pressable onPress={() => setFoto(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Cerrar la foto">
          {foto ? <Image source={{ uri: foto }} style={{ width: '100%', height: '80%' }} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}
