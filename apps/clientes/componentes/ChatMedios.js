// Notas de voz y documentos del chat (2026-10-20, «como las apps de
// mensajería»).
//
//   · `useMicrofono` (2026-10-20, como WhatsApp): mantener el micrófono graba
//     y soltarlo manda; deslizar a la izquierda cancela, hacia arriba bloquea;
//     un toque graba manos libres con el punto rojo que late, el tiempo, una
//     onda que sigue la voz, la papelera y enviar. Tope de 2 minutos (se
//     manda sola al llegar). Graba en m4a/AAC, que se escucha en iPhone, en
//     Android y en el navegador del portal.
//   · `NotaDeVoz`: el globo con ▶︎/❚❚, la barra de avance (se toca para saltar),
//     la duración y la velocidad 1× → 1.5× → 2× (2026-10-21, como WhatsApp y
//     como el portal y la app del personal), del color del globo.
//   · `Documento`: la tarjeta de un PDF; tocarla lo abre en el visor del
//     sistema (Safari / Chrome personalizado), de donde se puede compartir.
//
// `expo-audio` es un módulo NATIVO: una compilación vieja no lo trae y el
// require falla. Entonces la grabadora no se ofrece y la nota de voz se
// abre como archivo — nunca cierra la app.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Keyboard, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import Presionable from './Presionable';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { sinBloquear } from '../lib/bloqueo';
import { suave, useTema } from '../tema/tema';

let Audio = null;
try { Audio = require('expo-audio'); } catch { Audio = null; }
export const HAY_AUDIO = !!Audio && Platform.OS !== 'web';
const TOPE_MS = 120_000;
const VELOCIDADES = [1, 1.5, 2];
// La velocidad elegida se recuerda para las siguientes notas (mientras la app viva).
let velocidadElegida = 1;

const mmss = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// El micrófono como WhatsApp (2026-10-20, pedido del dueño: «¿funciona como
// whatsapp? de tenerlo seleccionado para enviarse de un solo, y al tocarlo
// que empiece a grabar, con la opción de cancelar, enviar»). Antes el toque
// abría una barra con Cancelar/Enviar y nada más.
//
//   · MANTENER el micrófono graba; SOLTARLO la manda de una vez.
//   · Mientras se mantiene: deslizar a la IZQUIERDA cancela («‹ Desliza para
//     cancelar») y deslizar hacia ARRIBA la bloquea (el candado) para seguir
//     grabando sin el dedo.
//   · Un TOQUE corto también sirve —quien no conoce el gesto toca y ya—:
//     arranca bloqueada, con el tiempo corriendo, el punto rojo, la papelera y
//     enviar. Es lo que hace que nadie quede trabado buscando cómo grabar.
//   · Menos de 1 s no se manda: «Mantén presionado para grabar», como
//     WhatsApp. Una nota de medio segundo es casi siempre un toque sin querer.
//   · Háptico al empezar, al bloquear, al cancelar y al enviar: con el dedo
//     encima del botón, la vibración es la única señal de que el gesto entró.
//
// El permiso se pide ANTES de grabar y nunca durante el gesto: el diálogo del
// sistema cancela el toque a la mitad. Por eso, si todavía no está dado, el
// primer toque sólo lo pide y la grabación empieza con el siguiente.
//
// El estado de la grabación (el tiempo, la onda) vive en `SesionDeVoz`, no en
// la barra ni en la pantalla del chat: refresca ~8 veces por segundo, y la
// pantalla del chat es pesada — que lo hiciera ella era re-dibujar la lista
// entera mientras se habla.
const TOQUE_MS = 300;        // menos que esto entre apoyar y soltar = un toque
const MINIMO_MS = 1000;      // notas más cortas se descartan
const UMBRAL_CANCELAR = 110; // pt a la izquierda
const UMBRAL_BLOQUEO = 70;   // pt hacia arriba
const AVISO_CORTA = 'Mantén presionado para grabar';

/**
 * Pide el micrófono. `true` si se puede grabar. Si se negó, explica cómo
 * activarlo y ofrece abrir Ajustes — nunca cierra la app.
 */
export async function permisoMicrofono() {
  if (!HAY_AUDIO) return false;
  try {
    const p = await sinBloquear(() => Audio.requestRecordingPermissionsAsync());
    if (p?.granted) return true;
    const donde = Platform.OS === 'ios'
      ? 'Abre Ajustes › Farmacia Salud y activa Micrófono.'
      : 'Abre Ajustes › Aplicaciones › Farmacia Salud › Permisos y activa Micrófono.';
    Alert.alert('Sin acceso al micrófono', `Para mandar notas de voz, la app necesita el micrófono. ${donde}`, [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Abrir Ajustes', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ]);
  } catch { /* sin permiso */ }
  return false;
}

/**
 * El micrófono de la barra del chat. Devuelve:
 *   · `fase`: 'nada' | 'manteniendo' (el dedo encima) | 'bloqueada' (manos libres)
 *   · `boton`: el micrófono, para el lugar de siempre en la barra. Tiene que
 *     quedarse MONTADO mientras se graba: si se desmonta, el gesto se corta.
 *   · `capa`: lo que tapa la barra mientras se graba (va encima de la fila).
 *   · `encima`: el candado y el aviso, por arriba de la barra.
 * `alEnviar({ uri, duracion })` recibe la nota terminada.
 */
export function useMicrofono({ alEnviar, apagado }) {
  const [fase, setFase] = useState('nada');
  const [aviso, setAviso] = useState(null);
  const faseRef = useRef('nada');
  const control = useRef(null);
  const permiso = useRef(null);
  const t0 = useRef(0);
  const ultimo = useRef({ alEnviar, apagado });
  ultimo.current = { alEnviar, apagado };
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const resuelto = useSharedValue(1);

  // Saber de antemano si hay permiso: así el primer toque ya graba.
  useEffect(() => {
    if (!HAY_AUDIO) return;
    Audio.getRecordingPermissionsAsync().then((p) => { if (permiso.current == null) permiso.current = !!p?.granted; }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!aviso) return undefined;
    const id = setTimeout(() => setAviso(null), 2200);
    return () => clearTimeout(id);
  }, [aviso]);

  // Las transiciones, estables (el gesto se arma una vez). Leen la fase de
  // `faseRef` y no del estado: el gesto llega antes de que React re-dibuje.
  const acciones = useMemo(() => {
    const ponerFase = (f) => { faseRef.current = f; setFase(f); };
    const bloquear = () => {
      if (faseRef.current !== 'manteniendo') return;
      ponerFase('bloqueada');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    };
    return {
      bloquear,
      empezar() {
        if (!HAY_AUDIO || faseRef.current !== 'nada' || ultimo.current.apagado) return;
        if (permiso.current !== true) {
          permisoMicrofono().then((ok) => { permiso.current = ok; if (ok) setAviso(AVISO_CORTA); });
          return;
        }
        Keyboard.dismiss();
        setAviso(null);
        t0.current = Date.now();
        ponerFase('manteniendo');
      },
      // Soltar: un toque corto pasa a manos libres; si se mantuvo, se manda.
      soltar() {
        if (faseRef.current !== 'manteniendo') return;
        if (Date.now() - t0.current < TOQUE_MS) { bloquear(); return; }
        if (control.current) control.current.terminar(true); else ponerFase('nada');
      },
      cancelar() {
        if (faseRef.current === 'nada') return;
        if (control.current) control.current.terminar(false); else ponerFase('nada');
      },
      // Lo que reporta la sesión al terminar: null (cancelada), 'corta',
      // 'error' o la nota { uri, duracion }.
      fin(r) {
        ponerFase('nada');
        if (r === 'error') return;
        if (r == null) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); return; }
        if (r === 'corta') { Haptics.selectionAsync().catch(() => {}); setAviso(AVISO_CORTA); return; }
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        ultimo.current.alEnviar?.(r);
      },
    };
  }, []);
  const { empezar, soltar, cancelar, bloquear } = acciones;

  // El gesto: Pan desde el primer píxel (`minDistance(0)`) para enterarse del
  // dedo al apoyarlo, y sin cancelarse al salir del botón — el dedo viaja
  // lejos al deslizar. El umbral se mide en el hilo de la interfaz; a React
  // sólo llega el cambio de fase.
  const gesto = useMemo(() => Gesture.Pan().minDistance(0).shouldCancelWhenOutside(false)
    .onBegin(() => {
      resuelto.value = 0; dx.value = 0; dy.value = 0;
      runOnJS(empezar)();
    })
    .onUpdate((e) => {
      if (resuelto.value) return;
      dx.value = Math.min(0, e.translationX);
      dy.value = Math.min(0, e.translationY);
      if (e.translationX < -UMBRAL_CANCELAR) { resuelto.value = 1; runOnJS(cancelar)(); }
      else if (e.translationY < -UMBRAL_BLOQUEO) { resuelto.value = 1; runOnJS(bloquear)(); }
    })
    .onFinalize(() => {
      const ya = resuelto.value;
      resuelto.value = 1;
      dx.value = withSpring(0, { damping: 18 });
      dy.value = withSpring(0, { damping: 18 });
      if (!ya) runOnJS(soltar)();
    }), [empezar, soltar, cancelar, bloquear, dx, dy, resuelto]);

  // VoiceOver / TalkBack no pueden mantener: activarlo abre la grabación
  // manos libres, con la papelera y enviar a la vista.
  const alAccesible = () => {
    if (faseRef.current !== 'nada') return;
    acciones.empezar();
    if (faseRef.current === 'manteniendo') acciones.bloquear();
  };

  if (!HAY_AUDIO) return { fase: 'nada', boton: null, capa: null, encima: null };
  return {
    fase,
    boton: <BotonMicrofono gesto={gesto} fase={fase} dx={dx} dy={dy} apagado={apagado} alAccesible={alAccesible} />,
    capa: fase !== 'nada' ? <SesionDeVoz fase={fase} controlRef={control} dx={dx} alFin={acciones.fin} /> : null,
    encima: <EncimaDeVoz fase={fase} dy={dy} aviso={aviso} />,
  };
}

// El micrófono: 44 de toque con un círculo de 34, como el «+» y la cámara.
// Mantenido, crece y se pinta del color de la marca, y sigue al dedo — es
// lo que en WhatsApp dice «estás grabando» sin leer nada.
function BotonMicrofono({ gesto, fase, dx, dy, apagado, alAccesible }) {
  const t = useTema();
  const activo = useSharedValue(0);
  useEffect(() => { activo.value = withTiming(fase === 'manteniendo' ? 1 : 0, { duration: 160 }); }, [fase, activo]);
  const circulo = useAnimatedStyle(() => ({
    transform: [
      { translateX: dx.value * 0.9 * activo.value },
      { translateY: Math.max(dy.value, -UMBRAL_BLOQUEO) * activo.value },
      { scale: 1 + activo.value * 0.65 },
    ],
  }));
  const fondo = useAnimatedStyle(() => ({ opacity: activo.value }));
  return (
    <GestureDetector gesture={gesto}>
      <Animated.View accessible accessibilityRole="button" accessibilityLabel="Grabar una nota de voz"
        accessibilityHint="Mantén presionado para grabar y suelta para enviar. Toca para grabar sin mantener."
        accessibilityState={{ disabled: !!apagado }} accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') alAccesible(); }}
        pointerEvents={fase === 'bloqueada' ? 'none' : 'auto'}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: fase === 'bloqueada' ? 0 : apagado ? 0.4 : 1 }}>
        <Animated.View style={[{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(118,118,128,0.14)' }, circulo]}>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 17, backgroundColor: t.color.magenta }, fondo]} />
          <Icono sf="mic.fill" respaldo="🎤" tam={18} color={fase === 'manteniendo' ? '#FFFFFF' : t.color.magentaTexto} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

// Por arriba de la barra: el candado mientras se mantiene (sube con el dedo,
// que es la pista de hacia dónde llevarlo) y el aviso «Mantén presionado».
function EncimaDeVoz({ fase, dy, aviso }) {
  const t = useTema();
  const sube = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.max(dy.value, -UMBRAL_BLOQUEO) * 0.45 }],
    opacity: 1 - Math.min(1, -dy.value / UMBRAL_BLOQUEO) * 0.4,
  }));
  const fondo = t.oscuro ? '#2C2C2E' : '#FFFFFF';
  return (
    <>
      {fase === 'manteniendo' ? (
        <Animated.View pointerEvents="none" importantForAccessibility="no-hide-descendants"
          style={[{ position: 'absolute', right: 10, bottom: '100%', marginBottom: 10, width: 40, paddingVertical: 10, gap: 6,
            alignItems: 'center', borderRadius: 20, backgroundColor: fondo,
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }, sube]}>
          <Icono sf="lock.open.fill" respaldo="🔓" tam={16} color={colorSistema.texto2} />
          <Icono sf="chevron.up" respaldo="⌃" tam={14} color={colorSistema.texto3} />
        </Animated.View>
      ) : null}
      {aviso ? (
        <View pointerEvents="none" accessibilityLiveRegion="polite"
          style={{ position: 'absolute', right: 10, bottom: '100%', marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
            backgroundColor: fondo, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colorSistema.texto }}>{aviso}</Text>
        </View>
      ) : null}
    </>
  );
}

// La grabación en curso. Empieza a grabar al montarse y se queda montada al
// pasar de «manteniendo» a «bloqueada» (mismo lugar del árbol): la nota es
// una sola, el gesto sólo cambia cómo se ve. `controlRef.current.terminar(mandar)`
// la cierra desde el gesto.
function SesionDeVoz({ fase, controlRef, dx, alFin }) {
  const t = useTema();
  const grabador = Audio.useAudioRecorder({ ...Audio.RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const estado = Audio.useAudioRecorderState(grabador, 120);
  const [ondas, setOndas] = useState(() => Array(28).fill(0.08));
  const terminado = useRef(false);
  const latido = useSharedValue(1);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // Sin `allowsRecording` iOS rechaza grabar; con `playsInSilentMode`
        // se graba (y se oye) aunque el teléfono esté en silencio.
        await Audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await grabador.prepareToRecordAsync();
        if (!vivo || terminado.current) return;
        grabador.record();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } catch {
        if (vivo && !terminado.current) {
          terminado.current = true;
          Alert.alert('No se pudo grabar', 'Intenta de nuevo.');
          alFin('error');
        }
      }
    })();
    latido.value = withRepeat(withSequence(withTiming(0.25, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
    return () => {
      vivo = false;
      if (!terminado.current) { try { grabador.stop(); } catch { /* ya parado */ } }
      Audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // La onda sigue la voz: el nivel (dB) llevado a 0–1, corriendo de derecha a izquierda.
  useEffect(() => {
    const db = Number(estado?.metering);
    if (!Number.isFinite(db)) return;
    const nivel = Math.max(0.08, Math.min(1, (db + 55) / 50));
    setOndas((a) => [...a.slice(1), nivel]);
  }, [estado?.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const terminar = async (mandar) => {
    if (terminado.current) return;
    terminado.current = true;
    // El estado llega cada 120 ms: el tiempo del grabador es el más fresco.
    let ms = estado?.durationMillis ?? 0;
    try { ms = Math.max(ms, (grabador.currentTime || 0) * 1000); } catch { /* sin dato */ }
    try { await grabador.stop(); } catch { /* ya parado o nunca empezó */ }
    if (!mandar) { alFin(null); return; }
    if (ms < MINIMO_MS || !grabador.uri) { alFin('corta'); return; }
    alFin({ uri: grabador.uri, duracion: Math.max(1, Math.round(ms / 1000)) });
  };
  controlRef.current = { terminar };
  useEffect(() => () => { controlRef.current = null; }, [controlRef]);
  // Al llegar al tope, se manda sola (también con el dedo encima).
  useEffect(() => { if ((estado?.durationMillis ?? 0) >= TOPE_MS) terminar(true); }, [estado?.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const punto = useAnimatedStyle(() => ({ opacity: latido.value }));
  const desliza = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }],
    opacity: interpolate(dx.value, [-UMBRAL_CANCELAR, 0], [0.15, 1], Extrapolation.CLAMP),
  }));
  const tiempo = mmss(estado?.durationMillis);
  const bloqueada = fase === 'bloqueada';
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: bloqueada ? 0 : 44,
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10 }}
      accessible={!bloqueada} accessibilityLabel={`Grabando nota de voz, ${tiempo}`}>
      {bloqueada ? (
        <Presionable onPress={() => terminar(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Descartar la nota de voz"
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
          <Icono sf="trash" respaldo="🗑" tam={20} color={colorSistema.rojo} />
        </Presionable>
      ) : null}
      <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, marginLeft: bloqueada ? 0 : 6, backgroundColor: colorSistema.rojo }, punto]} />
      <Text accessibilityLabel={bloqueada ? `Grabando, ${tiempo}` : undefined}
        style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto, fontVariant: ['tabular-nums'], width: 44 }}>{tiempo}</Text>
      {bloqueada ? (
        <>
          <View style={{ flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }} importantForAccessibility="no-hide-descendants">
            {ondas.map((v, i) => (
              <View key={i} style={{ flex: 1, height: Math.max(3, v * 28), borderRadius: 2, backgroundColor: suave(t.color.magenta, 0.35 + v * 0.65) }} />
            ))}
          </View>
          <Presionable onPress={() => terminar(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Enviar la nota de voz"
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta }}>
            <Icono sf="arrow.up" respaldo="↑" tam={18} color="#FFFFFF" />
          </Presionable>
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center' }} pointerEvents="none">
          <Animated.Text style={[{ fontSize: 15, color: colorSistema.texto3 }, desliza]}>‹ Desliza para cancelar</Animated.Text>
        </View>
      )}
    </View>
  );
}

/** El globo de una nota de voz. `a` = { url, clave, duracion }. */
export function NotaDeVoz({ a, mio }) {
  if (!HAY_AUDIO || !a?.url) return <Documento a={{ ...a, nombre: 'Nota de voz' }} mio={mio} />;
  return <NotaDeVozViva a={a} mio={mio} />;
}

function NotaDeVozViva({ a, mio }) {
  const t = useTema();
  const reproductor = Audio.useAudioPlayer(a.url, { updateInterval: 200 });
  const estado = Audio.useAudioPlayerStatus(reproductor);
  const [ancho, setAncho] = useState(0);
  const [velocidad, setVelocidad] = useState(velocidadElegida);
  const total = (estado?.duration || a.duracion || 0) * 1000;
  const va = (estado?.currentTime || 0) * 1000;
  const avance = total ? Math.min(1, va / total) : 0;
  const sonando = !!estado?.playing;
  // Terminó: vuelve al principio, listo para escucharse otra vez.
  useEffect(() => { if (estado?.didJustFinish) { try { reproductor.seekTo(0); reproductor.pause(); } catch { /* sin audio */ } } }, [estado?.didJustFinish, reproductor]);
  const alternar = async () => {
    Haptics.selectionAsync().catch(() => {});
    if (sonando) { reproductor.pause(); return; }
    await Audio.setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    try { reproductor.setPlaybackRate(velocidad, 'high'); } catch { /* sin velocidad: suena a 1× */ }
    reproductor.play();
  };
  const cambiarVelocidad = () => {
    const v = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
    velocidadElegida = v;
    setVelocidad(v);
    Haptics.selectionAsync().catch(() => {});
    try { reproductor.setPlaybackRate(v, 'high'); } catch { /* sin velocidad */ }
  };
  const color = mio ? '#FFFFFF' : t.color.magentaTexto;
  const pista = mio ? 'rgba(255,255,255,0.35)' : suave(t.color.magenta, 0.25);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: 236, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 18,
      backgroundColor: mio ? t.color.magenta : (t.oscuro ? '#26252A' : '#FFFFFF') }}>
      <Presionable onPress={alternar} hitSlop={6} accessibilityRole="button" accessibilityLabel={sonando ? 'Pausar la nota de voz' : 'Escuchar la nota de voz'}
        style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: mio ? 'rgba(255,255,255,0.22)' : suave(t.color.magenta, 0.14) }}>
        <Icono sf={sonando ? 'pause.fill' : 'play.fill'} respaldo={sonando ? '❚❚' : '▶'} tam={16} color={color} />
      </Presionable>
      <View style={{ flex: 1, gap: 4 }}>
        <Presionable sinAcuse onLayout={(e) => setAncho(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel="Avance de la nota de voz"
          onPress={(e) => { if (ancho && total) reproductor.seekTo(((e.nativeEvent.locationX / ancho) * total) / 1000); }}
          style={{ height: 18, justifyContent: 'center' }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: pista }}>
            <View style={{ width: `${avance * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
          </View>
          <View style={{ position: 'absolute', left: Math.max(0, avance * ancho - 6), width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
        </Presionable>
        <Text style={{ fontSize: 12, color: mio ? 'rgba(255,255,255,0.85)' : colorSistema.texto3, fontVariant: ['tabular-nums'] }}>
          {sonando || va > 0 ? mmss(va) : mmss(total)}
        </Text>
      </View>
      <Presionable onPress={cambiarVelocidad} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Velocidad ${velocidad}×, tocar para cambiar`}
        style={{ minWidth: 40, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
          backgroundColor: mio ? 'rgba(255,255,255,0.22)' : suave(t.color.magenta, 0.14) }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color, fontVariant: ['tabular-nums'] }}>{`${velocidad}×`}</Text>
      </Presionable>
    </View>
  );
}

/** La tarjeta de un documento (PDF). `a` = { url, nombre }. */
export function Documento({ a, mio }) {
  const t = useTema();
  const abrir = () => {
    if (!a?.url) return;
    Haptics.selectionAsync().catch(() => {});
    sinBloquear(() => WebBrowser.openBrowserAsync(a.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET })).catch(() => {});
  };
  return (
    <Presionable onPress={abrir} accessibilityRole="button" accessibilityLabel={`Abrir ${a?.nombre ?? 'el documento'}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: 236, padding: 10, borderRadius: 18,
        backgroundColor: mio ? t.color.magenta : (t.oscuro ? '#26252A' : '#FFFFFF') }}>
      <View style={{ width: 40, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: mio ? 'rgba(255,255,255,0.2)' : suave('#E5484D', 0.14) }}>
        <Icono sf="doc.fill" respaldo="📄" tam={20} color={mio ? '#FFFFFF' : '#E5484D'} />
        <Text style={{ position: 'absolute', bottom: 3, fontSize: 8, fontWeight: '900', color: mio ? '#FFFFFF' : '#E5484D' }}>PDF</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={{ fontSize: 15, fontWeight: '700', color: mio ? '#FFFFFF' : colorSistema.texto }}>{a?.nombre || 'Documento'}</Text>
        <Text style={{ fontSize: 12, color: mio ? 'rgba(255,255,255,0.85)' : colorSistema.texto3 }}>Toca para abrir</Text>
      </View>
    </Presionable>
  );
}

/** Elige un PDF (hasta 8 MB). `{ uri, nombre }`, `null` si se canceló, o `{ error }`. */
export async function elegirPdf() {
  let Docs = null;
  try { Docs = require('expo-document-picker'); } catch { return { error: 'Actualiza la app para mandar documentos.' }; }
  try {
    const r = await sinBloquear(() => Docs.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false }));
    const d = r?.assets?.[0];
    if (r?.canceled || !d?.uri) return null;
    if (Number(d.size) > 8 * 1024 * 1024) return { error: 'El documento pesa más de 8 MB.' };
    return { uri: d.uri, nombre: String(d.name ?? 'Documento.pdf').slice(0, 120) };
  } catch {
    return { error: 'No se pudo abrir el documento. Intenta de nuevo.' };
  }
}
