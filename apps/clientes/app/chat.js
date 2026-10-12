// «Pregúntale a la farmacia» (2026-10-12): un chat estilo Messenger con el
// equipo de Farmacia Salud. Lo del cliente a la derecha; lo del equipo a la
// izquierda, con la foto y el nombre corto de quien contestó (los arma el
// servidor). Se mandan textos y fotos; el equipo además puede mandar un
// producto o una oferta, que se ven como tarjetas que se tocan para abrirlos.
//
// No hay conexión en vivo: mientras la pantalla está a la vista se pregunta
// cada 5 s por lo NUEVO (`desde_id`), y enseguida al llegar el push de una
// respuesta. Hacia atrás, de a 30 (`antes_id`). Fuera de 7:00–21:00 (hora de
// El Salvador) se avisa que la respuesta llega mañana.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import { Vacio } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { useCuenta } from '../lib/cuenta';
import { alLlegarAviso, marcarChatALaVista } from '../lib/avisos';
import { elegirFoto, preguntarOrigen, subirFoto } from '../lib/fotos';
import { dolares, nombrePropio } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';

const CADA_MS = 5000;

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
    const reloj = setInterval(nuevos, CADA_MS);
    // Llegó el push de una respuesta: se pregunta ya, sin esperar los 5 s.
    const quitar = alLlegarAviso((a) => { if (typeof a.url === 'string' && a.url.startsWith('/chat')) nuevos(); });
    const app = AppState.addEventListener('change', (e) => { if (e === 'active') nuevos(); });
    return () => { marcarChatALaVista(false); clearInterval(reloj); quitar(); app.remove(); };
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
    const tmp = { id: `tmp-${Date.now()}`, autor: 'cliente', texto: tx, foto_url: uri, created_at: new Date().toISOString(), enviando: true };
    alFondo.current = true;
    setMensajes((ant) => [...(ant ?? []), tmp]);
    try {
      let fotoRuta = null;
      if (uri) {
        const s = await subirFoto(pedir, 'chat_subir_url', {}, uri);
        if (!s.ok) throw new Error(s.mensaje);
        fotoRuta = s.ruta;
      }
      const r = await pedir('chat_enviar', { texto: tx, foto_ruta: fotoRuta });
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
      Alert.alert('No se envió', e?.message ?? 'Revisa tu conexión e intenta de nuevo.');
      return false;
    } finally {
      enviarYa.current = false;
      setEnviando(false);
    }
  };
  const enviarTexto = async () => {
    const tx = texto.trim();
    if (!tx || enviando) return;
    setTexto('');
    if (!(await mandar({ texto: tx }))) setTexto(tx);
  };
  const enviarFoto = async () => {
    if (enviando) return;
    const origen = await preguntarOrigen('Enviar una foto', 'Por ejemplo, la caja del medicamento o tu receta.');
    if (!origen) return;
    const f = await elegirFoto(origen);
    if (!f) return;
    if (f.error) { Alert.alert('No se pudo usar la foto', f.error); return; }
    await mandar({ uri: f.uri });
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

  const arriba = Platform.OS === 'ios' ? ins.top + 52 : 0;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
          <Burbuja m={f.m} primero={f.primero} ultimo={f.ultimo} alVerFoto={setFotoGrande} />
        ))}
      />

      {/* La barra para escribir. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8,
        paddingBottom: Math.max(ins.bottom, 10), borderTopWidth: 0.5, borderTopColor: colorSistema.separador,
        backgroundColor: t.oscuro ? 'rgba(18,16,24,0.92)' : 'rgba(255,255,255,0.92)' }}>
        <Pressable onPress={enviarFoto} disabled={enviando} accessibilityRole="button" accessibilityLabel="Enviar una foto" hitSlop={6}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: enviando ? 0.4 : 1,
            transform: [{ scale: pressed ? 0.92 : 1 }] })}>
          <Icono sf="camera.fill" respaldo="📷" tam={22} color={t.color.magentaTexto} />
        </Pressable>
        <TextInput value={texto} onChangeText={(v) => setTexto(v.slice(0, 2000))} placeholder="Escribe tu mensaje" placeholderTextColor={colorSistema.texto3}
          multiline maxLength={2000} accessibilityLabel="Mensaje"
          style={{ flex: 1, fontSize: 16, color: colorSistema.texto, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 14,
            paddingTop: 11, paddingBottom: 11, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }} />
        <Pressable onPress={enviarTexto} disabled={!texto.trim() || enviando} accessibilityRole="button" accessibilityLabel="Enviar"
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
            backgroundColor: texto.trim() ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
            transform: [{ scale: pressed ? 0.92 : 1 }] })}>
          {enviando ? <ActivityIndicator color="#FFFFFF" /> : <Icono sf="arrow.up" respaldo="↑" tam={18} color={texto.trim() ? '#FFFFFF' : colorSistema.texto3} />}
        </Pressable>
      </View>

      <Modal visible={!!fotoGrande} animationType="fade" transparent presentationStyle="overFullScreen" onRequestClose={() => setFotoGrande(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', paddingTop: ins.top + 8, paddingBottom: ins.bottom + 8 }}>
          <Pressable onPress={() => setFotoGrande(null)} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={12}
            style={{ alignSelf: 'flex-end', paddingHorizontal: 18, minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>Cerrar</Text>
          </Pressable>
          {fotoGrande ? <Image source={{ uri: fotoGrande }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Foto" /> : null}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// Un mensaje. Del cliente: a la derecha, en magenta. Del equipo: a la
// izquierda, con la foto (o las iniciales) y el nombre arriba del primero de
// una racha. Del sistema: centrado, en gris.
function Burbuja({ m, primero, ultimo, alVerFoto }) {
  const t = useTema();
  const mio = m.autor === 'cliente';
  if (m.autor === 'sistema') {
    return <Text style={{ alignSelf: 'center', fontSize: 13, color: colorSistema.texto3, textAlign: 'center', marginVertical: 6, maxWidth: '85%' }}>{m.texto}</Text>;
  }
  const fondo = mio ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.95)');
  const colorTexto = mio ? '#FFFFFF' : colorSistema.texto;
  const nombre = m.equipo?.nombre ? nombrePropio(m.equipo.nombre) : 'Farmacia Salud';
  return (
    <View style={{ flexDirection: 'row', justifyContent: mio ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: primero ? 8 : 0 }}>
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
            ...(mio ? {} : { borderWidth: 0.5, borderColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }) }}>
            <Text selectable style={{ fontSize: 16, lineHeight: 21, color: colorTexto }}>{m.texto}</Text>
          </View>
        ) : null}
        {ultimo ? (
          <Text style={{ fontSize: 11, color: colorSistema.texto3, marginHorizontal: 4 }}>{m.enviando ? 'Enviando…' : horaDe(m.created_at)}</Text>
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
