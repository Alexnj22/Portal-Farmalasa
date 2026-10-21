// Las notas de voz del chat con clientes, NATIVAS (2026-10-21, «ambos chats
// deben compartir funcionalidades… la sensación debe ser la misma»). Es la
// pareja de `apps/clientes/componentes/ChatMedios.js` (la app de puntos) y de
// `NotaDeVoz`/`useGrabadora` del portal web:
//
//   · `NotaDeVoz`: ▶︎/❚❚, la barra de avance (se toca para saltar), el tiempo y
//     la velocidad 1× → 1.5× → 2×, como WhatsApp. Antes la nota se abría en el
//     navegador del sistema, fuera del chat.
//   · `Grabadora`: un toque en el micrófono graba; el punto rojo late, corre el
//     tiempo, y se descarta (papelera) o se envía. Tope de 2 minutos, igual que
//     la app de puntos: al llegar se envía sola. Menos de 1 s no se manda.
//
// Graba m4a/AAC (`RecordingPresets.HIGH_QUALITY`): lo que el bucket acepta y lo
// que escuchan el iPhone del cliente, Android y el navegador del portal.
//
// `expo-audio` es NATIVO: una compilación vieja no lo trae y el `require` falla.
// Entonces no se ofrece grabar y la nota se abre como archivo — nunca se cierra
// la app.
import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Linking, Platform, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Host, Icon } from '@expo/ui';
import { colorSistema } from '../Formulario';
import Tocable from '../Tocable';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';

let Audio = null;
try { Audio = require('expo-audio'); } catch { Audio = null; }
export const HAY_AUDIO = !!Audio && Platform.OS !== 'web';

const TOPE_MS = 120_000;
const MINIMO_MS = 1000;
const VELOCIDADES = [1, 1.5, 2];
// La velocidad elegida se recuerda para las siguientes notas (mientras la app viva).
let velocidadElegida = 1;

const mmss = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const Glifo = ({ nombre, tam = 18, color }) => <Host matchContents><Icon name={iconoDe(nombre)} size={tam} color={color} /></Host>;

const abrirArchivo = (url) => {
  if (!url) return;
  Haptics.selectionAsync().catch(() => {});
  WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }).catch(() => {});
};

/** Pide el micrófono. `true` si se puede grabar; si se negó, explica cómo activarlo. */
export async function permisoMicrofono() {
  if (!HAY_AUDIO) return false;
  try {
    const p = await Audio.requestRecordingPermissionsAsync();
    if (p?.granted) return true;
    const donde = Platform.OS === 'ios'
      ? 'Abre Ajustes › FarmaSalud y activa Micrófono.'
      : 'Abre Ajustes › Aplicaciones › FarmaSalud › Permisos y activa Micrófono.';
    Alert.alert('Sin acceso al micrófono', `Para mandar notas de voz, la app necesita el micrófono. ${donde}`, [
      { text: 'Ahora no', style: 'cancel' },
      { text: 'Abrir Ajustes', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ]);
  } catch { /* sin permiso */ }
  return false;
}

/** El globo de una nota de voz. `delEquipo`: va sobre el azul de la marca. */
export function NotaDeVoz({ url, duracion, delEquipo, tinta }) {
  if (!url) {
    return <Text style={{ color: tinta, fontSize: 13, opacity: 0.8 }}>🎤 Nota de voz no disponible</Text>;
  }
  if (!HAY_AUDIO) {
    return (
      <Pressable onPress={() => abrirArchivo(url)} accessibilityRole="button" accessibilityLabel="Escuchar la nota de voz"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200 }}>
        <Glifo nombre="Play" color={tinta} />
        <Text style={{ color: tinta, fontSize: 14, fontWeight: '700' }}>Nota de voz · toca para escuchar</Text>
      </Pressable>
    );
  }
  return <NotaDeVozViva url={url} duracion={duracion} delEquipo={delEquipo} tinta={tinta} />;
}

function NotaDeVozViva({ url, duracion, delEquipo, tinta }) {
  const reproductor = Audio.useAudioPlayer(url, { updateInterval: 200 });
  const estado = Audio.useAudioPlayerStatus(reproductor);
  const [ancho, setAncho] = useState(0);
  const [velocidad, setVelocidad] = useState(velocidadElegida);
  const total = (estado?.duration || duracion || 0) * 1000;
  const va = (estado?.currentTime || 0) * 1000;
  const avance = total ? Math.min(1, va / total) : 0;
  const sonando = !!estado?.playing;
  // Terminó: vuelve al principio, lista para escucharse otra vez.
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
  const pista = delEquipo ? 'rgba(255,255,255,0.35)' : 'rgba(127,127,127,0.30)';
  const color = delEquipo ? '#fff' : MARCA.azul;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: 236 }}>
      <Pressable onPress={alternar} hitSlop={6} accessibilityRole="button" accessibilityLabel={sonando ? 'Pausar la nota de voz' : 'Escuchar la nota de voz'}
        style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
          backgroundColor: delEquipo ? 'rgba(255,255,255,0.22)' : MARCA.azul, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        <Glifo nombre={sonando ? 'Pause' : 'Play'} tam={16} color="#fff" />
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Pressable onLayout={(e) => setAncho(e.nativeEvent.layout.width)} accessibilityRole="adjustable" accessibilityLabel="Avance de la nota de voz"
          onPress={(e) => { if (ancho && total) reproductor.seekTo(((e.nativeEvent.locationX / ancho) * total) / 1000); }}
          style={{ height: 18, justifyContent: 'center' }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: pista }}>
            <View style={{ width: `${avance * 100}%`, height: 4, borderRadius: 2, backgroundColor: color }} />
          </View>
          <View style={{ position: 'absolute', left: Math.max(0, avance * ancho - 6), width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
        </Pressable>
        <Text style={{ fontSize: 12, color: tinta, opacity: 0.8, fontVariant: ['tabular-nums'] }}>{sonando || va > 0 ? mmss(va) : mmss(total)}</Text>
      </View>
      <Pressable onPress={cambiarVelocidad} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Velocidad ${velocidad}×, tocar para cambiar`}
        style={({ pressed }) => ({ minWidth: 40, height: 26, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
          backgroundColor: delEquipo ? 'rgba(255,255,255,0.22)' : 'rgba(127,127,127,0.18)', transform: [{ scale: pressed ? 0.94 : 1 }] })}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: tinta, fontVariant: ['tabular-nums'] }}>{`${velocidad}×`}</Text>
      </Pressable>
    </View>
  );
}

/**
 * La grabación en curso: tapa la fila del cuadro de respuesta. Empieza a grabar
 * al montarse; `alFin({ uri, duracion })` al enviar, `alFin(null)` al descartar.
 */
export function Grabadora({ alFin }) {
  const grabador = Audio.useAudioRecorder(Audio.RecordingPresets.HIGH_QUALITY);
  const estado = Audio.useAudioRecorderState(grabador, 200);
  const terminado = useRef(false);
  const [latido] = useState(() => new Animated.Value(1));

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // Sin `allowsRecording` iOS rechaza grabar; con `playsInSilentMode` se
        // graba aunque el teléfono esté en silencio.
        await Audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await grabador.prepareToRecordAsync();
        if (!vivo || terminado.current) return;
        grabador.record();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } catch {
        if (vivo && !terminado.current) { terminado.current = true; Alert.alert('No se pudo grabar', 'Intenta de nuevo.'); alFin(null); }
      }
    })();
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(latido, { toValue: 0.25, duration: 500, useNativeDriver: true }),
      Animated.timing(latido, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]));
    anim.start();
    return () => {
      vivo = false;
      anim.stop();
      if (!terminado.current) { try { grabador.stop(); } catch { /* ya parado */ } }
      Audio.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- una grabación por montaje

  const terminar = async (mandar) => {
    if (terminado.current) return;
    terminado.current = true;
    let ms = estado?.durationMillis ?? 0;
    try { ms = Math.max(ms, (grabador.currentTime || 0) * 1000); } catch { /* sin dato */ }
    try { await grabador.stop(); } catch { /* ya parado */ }
    if (!mandar) { Haptics.selectionAsync().catch(() => {}); alFin(null); return; }
    if (ms < MINIMO_MS || !grabador.uri) { Alert.alert('Nota muy corta', 'Graba al menos un segundo.'); alFin(null); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    alFin({ uri: grabador.uri, duracion: Math.max(1, Math.round(ms / 1000)) });
  };
  // Al llegar al tope, se envía sola.
  useEffect(() => { if ((estado?.durationMillis ?? 0) >= TOPE_MS) terminar(true); }, [estado?.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const tiempo = mmss(estado?.durationMillis);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 }} accessibilityLiveRegion="polite">
      <Tocable onPress={() => terminar(false)} accessibilityRole="button" accessibilityLabel="Descartar la nota de voz" hitSlop={6}
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Glifo nombre="Trash2" tam={22} color={MARCA.rojo} />
      </Tocable>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 22,
        backgroundColor: 'rgba(127,127,127,0.14)' }}>
        <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: MARCA.rojo, opacity: latido }} />
        <Text accessibilityLabel={`Grabando, ${tiempo}`} style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{tiempo}</Text>
        <Text style={{ flex: 1, fontSize: 14, color: colorSistema.texto2 }} numberOfLines={1}>Grabando nota de voz…</Text>
      </View>
      <Tocable onPress={() => terminar(true)} accessibilityRole="button" accessibilityLabel="Enviar la nota de voz"
        style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: MARCA.azul }}>
        <Glifo nombre="ArrowUp" tam={20} color="#fff" />
      </Tocable>
    </View>
  );
}
