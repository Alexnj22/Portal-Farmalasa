// «Pregúntale a la farmacia» (2026-10-12): un chat estilo Messenger con el
// equipo de Farmacia Salud. Lo del cliente a la derecha; lo del equipo a la
// izquierda, con la foto y el nombre corto de quien contestó (los arma el
// servidor). Se mandan textos y fotos; el equipo además puede mandar un
// producto o una oferta, que se ven como tarjetas que se tocan para abrirlos.
//
// No hay conexión en vivo: mientras la pantalla está a la vista se pregunta
// cada 5 s por lo NUEVO (`desde_id`) —cada 3 s si alguien del equipo está
// escribiendo o atendiendo—, y enseguida al llegar el push de una respuesta.
// Con cada respuesta llega `vivo` (2026-10-12): quién escribe ahora, quién
// atiende y si el equipo ya vio lo último del cliente («Visto»/«Enviado»).
// Mientras el cliente escribe se avisa (`chat_escribiendo`), a lo sumo cada 3 s.
// Hacia atrás, de a 30 (`antes_id`). Fuera de horario se avisa cuándo se responde.
//
// Reacciones y respuestas (2026-10-12): mantener presionado un mensaje abre su
// menú (6 reacciones, Responder, Copiar); deslizarlo a la derecha lo responde.
// Las piezas viven en componentes/ChatPiezas.js. Las reacciones propias se
// ven al instante; las del equipo en mensajes viejos llegan al volver a entrar
// (la consulta cada pocos segundos trae sólo lo NUEVO).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import { Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { alLlegarAviso, marcarChatALaVista } from '../lib/avisos';
import { subirFoto } from '../lib/fotos';
import { dolares, nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { LIVIANO } from '../lib/rendimiento';
import { usarVistaPreviaFoto } from '../componentes/VistaPreviaFoto';
import { Cita, Compositor, copiar, Deslizable, MenuMensaje, preguntarAdjunto, Reacciones, Respondiendo, useMedir } from '../componentes/ChatPiezas';
import { suave, useTema } from '../tema/tema';

const CADA_MS = 5000;
// Con alguien del equipo escribiendo o atendiendo, la respuesta está cerca.
const CADA_RAPIDO_MS = 3000;
// «Está escribiendo» le dura 6 s al equipo: avisar cada 3 s lo mantiene encendido.
const ESCRIBIENDO_CADA_MS = 3000;
const SIN_VIVO = { escribiendo: null, atiende: null, visto: false };

const horaDe = (iso) => {
  const d = new Date(iso);
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const diaDe = (iso) => {
  const d = new Date(iso);
  const hoy = new Date();
  const clave = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (clave(d) === clave(hoy)) return 'Hoy';
  if (clave(d) === clave(new Date(hoy.getTime() - 86400_000))) return 'Ayer';
  try { return d.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' }); } catch { return `${d.getDate()}/${d.getMonth() + 1}`; }
};
const iniciales = (n) => String(n ?? '').trim().split(/\s+/).slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase() || '·';
// La hora de El Salvador (UTC-6, sin horario de verano), por si el servidor no contestó.
// Mientras llega el horario real del servidor: 7:00 a 22:00 de El Salvador.
const fueraDeHorarioLocal = () => { const h = new Date(Date.now() - 6 * 3600_000).getUTCHours(); return h < 7 || h >= 22; };

export default function Chat() {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const pedir = useSesion((s) => s.pedir);
  const [mensajes, setMensajes] = useState(null);
  const [hayMas, setHayMas] = useState(false);
  const [fuera, setFuera] = useState(fueraDeHorarioLocal());
  // El texto del horario lo arma el servidor con el horario REAL de las sucursales (2026-10-12).
  const [horario, setHorario] = useState(null);
  const [error, setError] = useState(null);
  const [pendiente, setPendiente] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [cargandoViejos, setCargandoViejos] = useState(false);
  const [fotoGrande, setFotoGrande] = useState(null);
  const lista = useRef(null);
  const ultimoId = useRef(0);
  const preguntando = useRef(false);
  const alFondo = useRef(true);
  const [vivo, setVivo] = useState(SIN_VIVO);
  const rapido = useRef(false);
  const avisoEscribiendo = useRef(0);
  const anotarVivo = (v) => {
    const x = v ? { escribiendo: v.escribiendo || null, atiende: v.atiende || null, visto: !!v.visto } : SIN_VIVO;
    rapido.current = !!(x.escribiendo || x.atiende);
    setVivo((a) => (a.escribiendo === x.escribiendo && a.atiende === x.atiende && a.visto === x.visto ? a : x));
  };
  const foto = usarVistaPreviaFoto();
  // Responder citando y el menú de un mensaje (2026-10-12).
  const [respondiendo, setRespondiendo] = useState(null); // { id, autor, texto, foto, nombre }
  const [menu, setMenu] = useState(null); // { m, caja }
  const [resaltado, setResaltado] = useState(null);

  // El id más nuevo que ya se tiene (los temporales no cuentan).
  const anotarUltimo = (arr) => {
    for (const m of arr) if (typeof m.id === 'number' && m.id > ultimoId.current) ultimoId.current = m.id;
  };
  const leido = useCallback(() => {
    pedir('chat_leido').catch?.(() => {});
    // El punto de «sin leer» de Cuenta se apaga sin esperar al próximo resumen.
    useCuenta.setState((x) => (x.resumen ? { resumen: { ...x.resumen, chat_sin_leer: 0 } } : x));
  }, [pedir]);

  const cargar = useCallback(async () => {
    const r = await pedir('chat_mensajes');
    if (r?.pendiente) { setPendiente(true); setMensajes([]); return; }
    if (!r?.ok) { setError(r?.mensaje ?? 'Revisa tu conexión.'); setMensajes((x) => x ?? []); return; }
    setError(null);
    setFuera(!!r.fuera_de_horario);
    if (r.horario) setHorario(r.horario);
    if ('vivo' in r) anotarVivo(r.vivo);
    setHayMas(!!r.hay_mas);
    anotarUltimo(r.mensajes);
    setMensajes(r.mensajes);
    if (r.sin_leer) leido();
  }, [pedir, leido]);

  // Lo nuevo desde el último que se tiene.
  const nuevos = useCallback(async () => {
    if (preguntando.current || AppState.currentState !== 'active') return;
    if (!ultimoId.current) { await cargar(); return; }
    preguntando.current = true;
    try {
      const r = await pedir('chat_mensajes', { desde_id: ultimoId.current });
      // Lo «en vivo» cambia aunque no haya mensajes nuevos.
      if (r?.ok && 'vivo' in r) anotarVivo(r.vivo);
      if (!r?.ok || !r.mensajes?.length) { if (r?.ok) setFuera(!!r.fuera_de_horario); return; }
      setFuera(!!r.fuera_de_horario);
      if (r.horario) setHorario(r.horario);
      anotarUltimo(r.mensajes);
      setMensajes((ant) => {
        const vistos = new Set((ant ?? []).map((m) => m.id));
        return [...(ant ?? []), ...r.mensajes.filter((m) => !vistos.has(m.id))];
      });
      if (r.mensajes.some((m) => m.autor !== 'cliente')) leido();
    } finally {
      preguntando.current = false;
    }
  }, [pedir, cargar, leido]);

  useFocusEffect(useCallback(() => {
    marcarChatALaVista(true);
    if (mensajes == null) cargar(); else nuevos();
    // Un reloj que se reprograma solo: 3 s con el equipo activo, 5 s si no.
    let reloj = null;
    let vivoAca = true;
    const tic = async () => {
      await nuevos();
      if (vivoAca) reloj = setTimeout(tic, rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    };
    reloj = setTimeout(tic, rapido.current ? CADA_RAPIDO_MS : CADA_MS);
    // Llegó el push de una respuesta: se pregunta ya, sin esperar los 5 s.
    const quitar = alLlegarAviso((a) => { if (typeof a.url === 'string' && a.url.startsWith('/chat')) nuevos(); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') nuevos(); });
    return () => { vivoAca = false; marcarChatALaVista(false); clearTimeout(reloj); quitar(); app.remove(); };
  }, [cargar, nuevos])); // eslint-disable-line react-hooks/exhaustive-deps -- `mensajes` sólo decide la primera carga

  const anteriores = async () => {
    if (cargandoViejos || !mensajes?.length) return;
    const primero = mensajes.find((m) => typeof m.id === 'number');
    if (!primero) return;
    setCargandoViejos(true);
    const r = await pedir('chat_mensajes', { antes_id: primero.id });
    setCargandoViejos(false);
    if (!r?.ok) return;
    alFondo.current = false;
    setHayMas(!!r.hay_mas);
    setMensajes((ant) => {
      const vistos = new Set((ant ?? []).map((m) => m.id));
      return [...r.mensajes.filter((m) => !vistos.has(m.id)), ...(ant ?? [])];
    });
  };

  // Enviar: aparece al instante (temporal) y se reemplaza por el del servidor.
  const enviarYa = useRef(false);
  const mandar = async ({ texto: tx = null, uri = null }) => {
    if (enviarYa.current) return;
    enviarYa.current = true;
    setEnviando(true);
    const cita = respondiendo;
    setRespondiendo(null);
    const tmp = { id: `tmp-${Date.now()}`, autor: 'cliente', texto: tx, foto_url: uri, created_at: new Date().toISOString(), enviando: true,
      responde_a: cita ? { id: cita.id, autor: cita.autor, texto: cita.texto, foto: cita.foto } : null, reacciones: [] };
    alFondo.current = true;
    setMensajes((ant) => [...(ant ?? []), tmp]);
    try {
      let fotoRuta = null;
      if (uri) {
        const s = await subirFoto(pedir, 'chat_subir_url', {}, uri);
        if (!s.ok) throw new Error(s.mensaje);
        fotoRuta = s.ruta;
      }
      const r = await pedir('chat_enviar', { texto: tx, foto_ruta: fotoRuta, ...(cita ? { respuesta_a: cita.id } : {}) });
      if (!r?.ok) throw new Error(r?.mensaje ?? 'No se pudo enviar. Revisa tu conexión.');
      if (typeof r.fuera_de_horario === 'boolean') setFuera(r.fuera_de_horario);
      if (r.horario) setHorario(r.horario);
      anotarUltimo([r.mensaje]);
      setMensajes((ant) => {
        const sin = (ant ?? []).filter((m) => m.id !== r.mensaje.id && m.id !== r.automatico?.id).map((m) => (m.id === tmp.id ? r.mensaje : m));
        return r.automatico ? [...sin, r.automatico] : sin;
      });
      if (r.automatico) anotarUltimo([r.automatico]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return true;
    } catch (e) {
      setMensajes((ant) => (ant ?? []).filter((m) => m.id !== tmp.id));
      if (cita) setRespondiendo(cita);
      Alert.alert('No se envió', e?.message ?? 'Revisa tu conexión e intenta de nuevo.');
      return false;
    } finally {
      enviarYa.current = false;
      setEnviando(false);
    }
  };
  // «El cliente está escribiendo»: a lo sumo una vez cada 3 s, nunca con el campo vacío.
  const alEscribir = (v) => {
    setTexto(v.slice(0, 2000));
    if (!v.trim() || pendiente) return;
    const ahora = Date.now();
    if (ahora - avisoEscribiendo.current < ESCRIBIENDO_CADA_MS) return;
    avisoEscribiendo.current = ahora;
    pedir('chat_escribiendo').catch?.(() => {});
  };
  const enviarTexto = async () => {
    const tx = texto.trim();
    if (!tx || enviando) return;
    setTexto('');
    if (!(await mandar({ texto: tx }))) setTexto(tx);
  };
  // «+» pregunta Tomar foto / Elegir de Fotos; la cámara de la barra va directo.
  // Siempre pasa por la vista previa (con zoom) antes de enviarse.
  const enviarFoto = async (origenDado) => {
    if (enviando) return;
    const origen = origenDado ?? await preguntarAdjunto();
    if (!origen) return;
    const f = await foto.elegir({ origen });
    if (!f) return;
    await mandar({ uri: f.uri });
  };

  // Reaccionar: al instante en pantalla, y si el servidor no lo acepta se
  // vuelve atrás. Tocar la misma reacción la quita.
  const reaccionar = async (m, emoji) => {
    if (typeof m.id !== 'number') return;
    const antes = m.reacciones ?? [];
    const yaEra = antes.find((r) => r.mia)?.emoji === emoji;
    const nuevas = [...antes.filter((r) => !r.mia), ...(yaEra ? [] : [{ emoji, mia: true }])];
    const poner = (lista) => setMensajes((ant) => (ant ?? []).map((x) => (x.id === m.id ? { ...x, reacciones: lista } : x)));
    poner(nuevas);
    Haptics.selectionAsync().catch(() => {});
    const r = await pedir('chat_reaccionar', { mensaje_id: m.id, emoji: yaEra ? null : emoji });
    if (!r?.ok) { poner(antes); Alert.alert('No se guardó la reacción', r?.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'); }
  };
  const responderA = (m) => {
    if (typeof m.id !== 'number') return;
    setRespondiendo({ id: m.id, autor: m.autor, texto: m.texto ?? null, foto: !!m.foto_url,
      nombre: m.autor === 'equipo' ? (m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud') : null });
  };
  const nombreDe = (id) => {
    const x = (mensajes ?? []).find((y) => y.id === id);
    return x?.equipo?.nombre ? nombrePropio(x.equipo.nombre) : null;
  };

  if (mensajes == null) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (pendiente) {
    return (
      <View style={{ flex: 1, padding: 16, paddingTop: Platform.OS === 'ios' ? ins.top + 60 : 16 }}>
        <Vacio titulo="Todavía no puedes escribirnos aquí" icono="bubble.left.and.bubble.right.fill" respaldo="💬">
          Cuando completes tu registro en cualquier sucursal podrás chatear con la farmacia desde la app.
        </Vacio>
      </View>
    );
  }

  // Las filas: un separador por día y, del equipo, el nombre cuando cambia quien escribe.
  const filas = [];
  let dia = null;
  mensajes.forEach((m, i) => {
    const d = diaDe(m.created_at);
    if (d !== dia) { dia = d; filas.push({ clave: `d:${d}:${i}`, dia: d }); }
    const previo = mensajes[i - 1];
    const siguiente = mensajes[i + 1];
    const mismoAutor = (a, b) => a && b && a.autor === b.autor && (a.autor !== 'equipo' || a.equipo?.nombre === b.equipo?.nombre) && diaDe(a.created_at) === diaDe(b.created_at);
    filas.push({ clave: `m:${m.id}`, m, primero: !mismoAutor(previo, m), ultimo: !mismoAutor(m, siguiente) });
  });

  // «Visto» / «Enviado» debajo del último mensaje del cliente, si es lo
  // último de la conversación (los avisos del sistema no cuentan).
  const ultimoReal = [...mensajes].reverse().find((m) => m.autor !== 'sistema');
  const idConEstado = ultimoReal?.autor === 'cliente' && !ultimoReal.enviando ? ultimoReal.id : null;

  // Tocar la cita lleva al mensaje original, si ya está cargado, y lo resalta.
  const irA = (id) => {
    const i = filas.findIndex((f) => f.m?.id === id);
    if (i < 0) return;
    alFondo.current = false;
    try { lista.current?.scrollToIndex({ index: i, viewPosition: 0.4, animated: true }); } catch { /* fuera de lo medido */ }
    setResaltado(id);
    setTimeout(() => setResaltado((x) => (x === id ? null : x)), 1400);
  };

  const arriba = Platform.OS === 'ios' ? ins.top + 52 : 0;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* «Te atiende Ana» bajo el título, mientras alguien tiene la conversación. */}
      <Stack.Screen options={{ headerTitle: () => <TituloChat atiende={vivo.atiende ? nombrePropio(vivo.atiende) : null} /> }} />
      <FlatList
        ref={lista}
        data={filas}
        keyExtractor={(f) => f.clave}
        contentContainerStyle={{ paddingTop: arriba + 8, paddingHorizontal: 12, paddingBottom: 12, gap: 2, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onScroll={({ nativeEvent: e }) => { alFondo.current = e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 80; }}
        scrollEventThrottle={100}
        onContentSizeChange={() => { if (alFondo.current) lista.current?.scrollToEnd({ animated: false }); }}
        onScrollToIndexFailed={(e) => {
          lista.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true });
          setTimeout(() => { try { lista.current?.scrollToIndex({ index: e.index, viewPosition: 0.4, animated: true }); } catch { /* sin medir */ } }, 250);
        }}
        ListHeaderComponent={(
          <View style={{ gap: 10, marginBottom: 8 }}>
            {/* Estado de la farmacia (2026-10-12): en línea o fuera de horario, siempre a la vista. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, padding: 12,
              backgroundColor: fuera ? suave(t.color.aviso, 0.18) : suave(t.color.verde, 0.16) }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: fuera ? colorSistema.texto3 : t.color.verde }} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: fuera ? t.color.avisoTexto : t.color.verdeTexto }}>
                  {fuera ? 'Farmacia fuera de horario' : 'Farmacia en línea'}
                </Text>
                <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
                  {horario?.texto || (fuera ? 'Escríbenos igual: te responderemos a la brevedad cuando abramos.'
                    : 'Te respondemos en unos minutos.')}
                </Text>
              </View>
            </View>
            {error ? <Text style={{ fontSize: 14, color: colorSistema.rojo, textAlign: 'center' }}>{error}</Text> : null}
            {hayMas ? (
              <Pressable onPress={anteriores} disabled={cargandoViejos} accessibilityRole="button"
                style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 14 }}>
                {cargandoViejos ? <ActivityIndicator /> : null}
                <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto2 }}>Ver mensajes anteriores</Text>
              </Pressable>
            ) : null}
            {!mensajes.length ? (
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 28, paddingHorizontal: 20 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
                  <Icono sf="bubble.left.and.bubble.right.fill" respaldo="💬" tam={28} color={t.color.magentaTexto} />
                </View>
                <Text style={{ fontSize: 19, fontWeight: '800', color: colorSistema.texto, textAlign: 'center' }}>¿En qué te ayudamos?</Text>
                <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2, textAlign: 'center' }}>
                  Pregúntanos por un medicamento, si hay en tu sucursal o por tus reservas. Te responde el equipo de Farmacia Salud.
                </Text>
              </View>
            ) : null}
          </View>
        )}
        renderItem={({ item: f }) => (f.dia ? (
          <Text style={{ alignSelf: 'center', fontSize: 12, fontWeight: '700', color: colorSistema.texto3, marginVertical: 10, textTransform: 'capitalize' }}>{f.dia}</Text>
        ) : (
          <Burbuja m={f.m} primero={f.primero} ultimo={f.ultimo} alVerFoto={setFotoGrande}
            estado={f.m.id === idConEstado ? (vivo.visto ? 'Visto' : 'Enviado') : null}
            resaltado={resaltado === f.m.id} nombreCitado={f.m.responde_a ? nombreDe(f.m.responde_a.id) : null}
            alResponder={() => responderA(f.m)} alMenu={(caja) => setMenu({ m: f.m, caja })}
            alReaccionar={(e) => reaccionar(f.m, e)} alIrA={irA} />
        ))}
        ListFooterComponent={vivo.escribiendo ? <Escribiendo nombre={nombrePropio(vivo.escribiendo)} /> : null}
      />

      {/* La barra para escribir, como iMessage (componentes/ChatPiezas). */}
      <Compositor texto={texto} alEscribir={alEscribir} alEnviar={enviarTexto} alAdjuntar={enviarFoto} enviando={enviando}
        encima={respondiendo ? <Respondiendo cita={respondiendo} alCancelar={() => setRespondiendo(null)} /> : null} />

      <Modal visible={!!fotoGrande} animationType="fade" transparent presentationStyle="overFullScreen" onRequestClose={() => setFotoGrande(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', paddingTop: ins.top + 8, paddingBottom: ins.bottom + 8 }}>
          <Pressable onPress={() => setFotoGrande(null)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}
            style={{ alignSelf: 'flex-end', paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>Cerrar</Text>
          </Pressable>
          {fotoGrande ? <Image source={{ uri: fotoGrande }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Foto" /> : null}
        </View>
      </Modal>
      {foto.vista}
      {menu ? (
        <MenuMensaje menu={menu} alCerrar={() => setMenu(null)}
          alReaccionar={(e) => { const m = menu.m; setMenu(null); reaccionar(m, e); }}
          alResponder={() => { const m = menu.m; setMenu(null); responderA(m); }}
          alCopiar={() => {
            const m = menu.m; setMenu(null);
            if (copiar(m.texto)) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }} />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// El título del chat, con «Te atiende Ana» debajo cuando alguien la atiende.
function TituloChat({ atiende }) {
  const t = useTema();
  return (
    <View style={{ alignItems: Platform.OS === 'ios' ? 'center' : 'flex-start' }} accessible accessibilityRole="header"
      accessibilityLabel={atiende ? `Pregúntale a la farmacia. Te atiende ${atiende}` : 'Pregúntale a la farmacia'}>
      <Text numberOfLines={1} style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Pregúntale a la farmacia</Text>
      {atiende ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.color.verde }} />
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: t.color.verdeTexto }}>Te atiende {atiende}</Text>
        </View>
      ) : null}
    </View>
  );
}

// «Ana está escribiendo…» con tres puntos que saltan (quietos si se pide
// reducir el movimiento o el teléfono es liviano).
function Escribiendo({ nombre }) {
  const t = useTema();
  const reducir = useReducedMotion() || LIVIANO;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 }} accessible accessibilityLiveRegion="polite"
      accessibilityLabel={`${nombre} está escribiendo`}>
      <View style={{ width: 30 }} />
      <View style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, borderBottomLeftRadius: 6, paddingHorizontal: 14, height: 38,
          backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)',
          borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', alignSelf: 'flex-start' }}>
          {[0, 1, 2].map((i) => <Punto key={i} i={i} quieto={reducir} />)}
        </View>
        <Text style={{ fontSize: 11, color: colorSistema.texto3, marginHorizontal: 4 }}>{nombre} está escribiendo…</Text>
      </View>
    </View>
  );
}

function Punto({ i, quieto }) {
  const y = useSharedValue(0);
  useEffect(() => {
    if (quieto) { y.value = 0; return; }
    y.value = withDelay(i * 150, withRepeat(withSequence(withTiming(-4, { duration: 260 }), withTiming(0, { duration: 260 }), withTiming(0, { duration: 380 })), -1));
  }, [quieto, i, y]);
  const animado = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colorSistema.texto3 }, animado]} />;
}

// Un mensaje. Del cliente: a la derecha, en magenta. Del equipo: a la
// izquierda, con la foto (o las iniciales) y el nombre arriba del primero de
// una racha. Del sistema: centrado, en gris.
function Burbuja({ m, primero, ultimo, alVerFoto, estado, resaltado, nombreCitado, alResponder, alMenu, alReaccionar, alIrA }) {
  const t = useTema();
  const [ref, medir] = useMedir();
  const mio = m.autor === 'cliente';
  const real = typeof m.id === 'number';
  if (m.autor === 'sistema') {
    return <Text style={{ alignSelf: 'center', fontSize: 13, color: colorSistema.texto3, textAlign: 'center', marginVertical: 6, maxWidth: '85%' }}>{m.texto}</Text>;
  }
  const fondo = mio ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)');
  const colorTexto = mio ? '#FFFFFF' : colorSistema.texto;
  const nombre = m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud';
  return (
    <View style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: primero ? 8 : 0,
      borderRadius: 14, backgroundColor: resaltado ? suave(t.color.magenta, 0.12) : 'transparent' }}>
      {!mio ? (
        <View style={{ width: 30 }}>
          {ultimo ? (
            m.equipo?.foto_url ? (
              <Image source={{ uri: m.equipo.foto_url }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colorSistema.separador }} contentFit="cover"
                accessibilityLabel={`Foto de ${nombre}`} />
            ) : (
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.3 : 0.16) }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>{iniciales(nombre)}</Text>
              </View>
            )
          ) : null}
        </View>
      ) : null}
      <View style={{ maxWidth: '78%', gap: 3, alignItems: mio ? 'flex-end' : 'flex-start' }}>
        {!mio && primero ? <Text style={{ fontSize: 12, fontWeight: '700', color: colorSistema.texto2, marginLeft: 4 }}>{nombre}</Text> : null}
        {/* Deslizar a la derecha responde; mantener presionado abre el menú. */}
        <Deslizable alResponder={() => { if (real) alResponder(); }} alMantener={() => { if (real) medir(alMenu); }}>
          <View ref={ref} collapsable={false} style={{ gap: 3, alignItems: mio ? 'flex-end' : 'flex-start' }}>
            {m.responde_a && !m.texto ? (
              <View style={{ maxWidth: 260 }}><Cita c={m.responde_a} mio={false} nombreEquipo={nombreCitado} alTocar={() => alIrA(m.responde_a.id)} /></View>
            ) : null}
            {m.foto_url ? (
              <Pressable onPress={() => alVerFoto(m.foto_url)} accessibilityRole="imagebutton" accessibilityLabel="Ver foto">
                <Image source={{ uri: m.foto_url }} style={{ width: 200, height: 240, borderRadius: 18, backgroundColor: colorSistema.separador, opacity: m.enviando ? 0.6 : 1 }}
                  contentFit="cover" />
              </Pressable>
            ) : null}
            {m.adjunto ? <Adjunto a={m.adjunto} /> : null}
            {m.texto ? (
              <View style={{ backgroundColor: fondo, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, opacity: m.enviando ? 0.7 : 1,
                borderBottomRightRadius: mio && ultimo ? 6 : 20, borderBottomLeftRadius: !mio && ultimo ? 6 : 20,
                ...(resaltado ? { borderWidth: 2, borderColor: mio ? '#FFFFFF' : t.color.magenta } : mio ? {} : { borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }) }}>
                {m.responde_a ? <Cita c={m.responde_a} mio={mio} nombreEquipo={nombreCitado} alTocar={() => alIrA(m.responde_a.id)} /> : null}
                {/* Sin `selectable`: mantener presionado es el menú (con «Copiar»). */}
                <Text style={{ fontSize: 16, lineHeight: 21, color: colorTexto }}>{m.texto}</Text>
              </View>
            ) : null}
          </View>
        </Deslizable>
        <Reacciones lista={m.reacciones} mio={mio} alTocar={alReaccionar} />
        {ultimo ? (
          <Text style={{ fontSize: 11, color: colorSistema.texto3, marginHorizontal: 4 }}>{m.enviando ? 'Enviando…' : estado ? `${horaDe(m.created_at)} · ${estado}` : horaDe(m.created_at)}</Text>
        ) : null}
      </View>
    </View>
  );
}

// Un producto o una oferta que mandó el equipo: se toca para abrirlo.
function Adjunto({ a }) {
  const t = useTema();
  const producto = a.tipo === 'producto';
  const abrir = () => { Haptics.selectionAsync().catch(() => {}); navegar(producto ? `/producto/${a.id}` : `/oferta/${a.id}`); };
  return (
    <Pressable onPress={abrir} accessibilityRole="button" accessibilityLabel={producto ? `Ver ${a.nombre}` : `Ver la oferta ${a.titulo}`}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, padding: 12, minWidth: 220,
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : '#FFFFFF', borderWidth: 1, borderColor: suave(t.color.magenta, 0.35),
        transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
        <Icono sf={producto ? 'pills.fill' : 'tag.fill'} respaldo={producto ? '💊' : '%'} tam={18} color={t.color.magentaTexto} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: colorSistema.texto3 }}>{producto ? 'PRODUCTO' : 'OFERTA'}</Text>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colorSistema.texto }} numberOfLines={2}>{producto ? a.nombre : a.titulo}</Text>
        {producto && a.precio != null ? <Text style={{ fontSize: 14, fontWeight: '800', color: colorSistema.texto }}>{dolares(a.precio)}</Text> : null}
      </View>
      <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
    </Pressable>
  );
}
