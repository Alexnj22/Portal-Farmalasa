// Notas de voz y documentos del chat (2026-10-20, «como las apps de
// mensajería»).
//
//   · `Grabadora`: reemplaza la barra mientras se graba — un punto rojo que
//     late, el tiempo, una onda que sigue la voz, «Cancelar» y «Enviar». Tope
//     de 2 minutos (se manda sola al llegar). Graba en m4a/AAC, que se escucha
//     en iPhone, en Android y en el navegador del portal.
//   · `NotaDeVoz`: el globo con ▶︎/❚❚, la barra de avance (se toca para saltar)
//     y la duración, del color del globo.
//   · `Documento`: la tarjeta de un PDF; tocarla lo abre en el visor del
//     sistema (Safari / Chrome personalizado), de donde se puede compartir.
//
// `expo-audio` es un módulo NATIVO: una compilación vieja no lo trae y el
// require falla. Entonces la grabadora no se ofrece y la nota de voz se
// abre como archivo — nunca cierra la app.
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
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

const mmss = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Pide el micrófono. `true` si se puede grabar. */
export async function permisoMicrofono() {
  if (!HAY_AUDIO) return false;
  try {
    const p = await sinBloquear(() => Audio.requestRecordingPermissionsAsync());
    if (p?.granted) return true;
    Alert.alert('Sin micrófono', 'Permite el micrófono en los ajustes del teléfono para mandar notas de voz.');
  } catch { /* sin permiso */ }
  return false;
}

/**
 * La barra de grabación. `alEnviar({ uri, duracion })` al terminar;
 * `alCancelar()` si se descarta. Empieza a grabar al montarse.
 */
export function Grabadora({ alEnviar, alCancelar }) {
  if (!HAY_AUDIO) return null;
  return <GrabadoraViva alEnviar={alEnviar} alCancelar={alCancelar} />;
}

function GrabadoraViva({ alEnviar, alCancelar }) {
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
        await Audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await grabador.prepareToRecordAsync();
        if (!vivo) return;
        grabador.record();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      } catch {
        if (vivo) { Alert.alert('No se pudo grabar', 'Intenta de nuevo.'); alCancelar(); }
      }
    })();
    latido.value = withRepeat(withSequence(withTiming(0.35, { duration: 500 }), withTiming(1, { duration: 500 })), -1);
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
    const duracion = estado?.durationMillis ?? 0;
    try { await grabador.stop(); } catch { /* ya parado */ }
    if (!mandar) { Haptics.selectionAsync().catch(() => {}); alCancelar(); return; }
    if (duracion < 800 || !grabador.uri) { alCancelar(); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    alEnviar({ uri: grabador.uri, duracion: Math.round(duracion / 1000) });
  };
  // Al llegar al tope, se manda sola.
  useEffect(() => { if ((estado?.durationMillis ?? 0) >= TOPE_MS) terminar(true); }, [estado?.durationMillis]); // eslint-disable-line react-hooks/exhaustive-deps

  const punto = useAnimatedStyle(() => ({ opacity: latido.value }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, minHeight: 52 }}
      accessible accessibilityLabel={`Grabando nota de voz, ${mmss(estado?.durationMillis)}`}>
      <Presionable onPress={() => terminar(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancelar la nota de voz"
        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Icono sf="trash" respaldo="🗑" tam={20} color={colorSistema.rojo} />
      </Presionable>
      <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorSistema.rojo }, punto]} />
      <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto, fontVariant: ['tabular-nums'], width: 44 }}>{mmss(estado?.durationMillis)}</Text>
      <View style={{ flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 2 }} importantForAccessibility="no-hide-descendants">
        {ondas.map((v, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(3, v * 28), borderRadius: 2, backgroundColor: suave(t.color.magenta, 0.35 + v * 0.65) }} />
        ))}
      </View>
      <Presionable onPress={() => terminar(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Enviar la nota de voz"
        style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.magenta }}>
        <Icono sf="arrow.up" respaldo="↑" tam={18} color="#FFFFFF" />
      </Presionable>
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
    reproductor.play();
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
      <Icono sf="mic.fill" respaldo="🎤" tam={14} color={mio ? 'rgba(255,255,255,0.8)' : colorSistema.texto3} />
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
