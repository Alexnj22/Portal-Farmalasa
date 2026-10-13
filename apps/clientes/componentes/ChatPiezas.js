// Las piezas del chat «Pregúntale a la farmacia» (2026-10-12), aparte de la
// pantalla (app/chat.js) para que se lea:
//
//   · `Compositor`: la barra para escribir, como iMessage en iPhone —barra
//     translúcida pegada al teclado, «+» a la izquierda (Tomar foto / Elegir
//     de Fotos), la píldora del texto que crece hasta ~5 líneas y, a la
//     derecha, la cámara con el campo vacío o el botón redondo de enviar con
//     texto—. Pedido del usuario: «el espacio de texto, subir foto y enviar,
//     no lo veo nativo. se ve raro en iOS». En Android, lo mismo en Material
//     (superficie tonal, sin vidrio) y la hoja de abajo de HojasAndroid.
//   · `Respondiendo`: la tira «Respondiendo a Ana: …» con ✕, sobre la barra.
//   · `Deslizable`: deslizar un mensaje a la derecha para responderlo y
//     mantenerlo presionado para el menú, con háptica.
//   · `MenuMensaje`: el menú del mensaje (las 6 reacciones + Responder +
//     Copiar) sobre un fondo desenfocado, pegado al globo.
//   · `Reacciones` y `Cita`: las píldoras bajo el globo y el bloque citado.
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { colorSistema } from './sistema';
import { LIVIANO } from '../lib/rendimiento';
import { suave, useTema } from '../tema/tema';

export const EMOJIS = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
const IOS = Platform.OS === 'ios';

// El portapapeles de React Native: sigue en el núcleo (deprecado, sin módulo
// aparte instalado). Se pide por su ruta para no disparar el aviso del índice.
let Portapapeles = null;
try { Portapapeles = require('react-native/Libraries/Components/Clipboard/Clipboard').default; } catch { Portapapeles = null; }
export function copiar(texto) {
  try { Portapapeles?.setString(String(texto ?? '')); return !!Portapapeles; } catch { return false; }
}

const resumenDeCita = (c) => (c?.texto ? c.texto : c?.foto ? '📷 Foto' : 'Mensaje');

// ── La barra para escribir ───────────────────────────────────────────────
/** El «+»: «Consultar un producto» / «Tomar foto» / «Elegir de Fotos», con la hoja del sistema (en Android, la de HojasAndroid). */
export function preguntarAdjunto() {
  return new Promise((listo) => {
    ActionSheetIOS.showActionSheetWithOptions({
      title: 'Adjuntar', message: 'Un producto del catálogo, la caja del medicamento o tu receta.',
      options: ['Consultar un producto', 'Tomar foto', IOS ? 'Elegir de Fotos' : 'Elegir de la galería', 'Cancelar'], cancelButtonIndex: 3,
    }, (i) => listo(i === 0 ? 'producto' : i === 1 ? 'camara' : i === 2 ? 'galeria' : null));
  });
}

// El teclado a la vista (2026-10-13): con el teclado abierto la barra no lleva
// el margen del indicador de inicio — quedaba una franja vacía entre la barra
// y el teclado, que no se ve en ninguna app del sistema.
function useTecladoAbierto() {
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const [mostrar, ocultar] = IOS ? ['keyboardWillShow', 'keyboardWillHide'] : ['keyboardDidShow', 'keyboardDidHide'];
    const a = Keyboard.addListener(mostrar, () => setAbierto(true));
    const b = Keyboard.addListener(ocultar, () => setAbierto(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  return abierto;
}

// `listo`: hay algo para mandar aunque el texto esté vacío (un producto elegido).
export function Compositor({ texto, alEscribir, alEnviar, alAdjuntar, enviando, encima, campoRef, listo = false }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const teclado = useTecladoAbierto();
  const hay = !!texto.trim() || listo;
  const tinte = t.color.magenta;
  const contenido = (
    <>
      {encima}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, paddingHorizontal: 6, paddingTop: 6, paddingBottom: teclado ? 6 : Math.max(ins.bottom, 8) }}>
        <Redondo sf="plus" respaldo="+" etiqueta="Adjuntar un producto o una foto" alTocar={() => alAdjuntar(null)} apagado={enviando} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', minHeight: 36, marginVertical: 4, borderRadius: 18,
          backgroundColor: IOS ? (t.oscuro ? 'rgba(28,28,30,0.9)' : 'rgba(255,255,255,0.95)') : (t.oscuro ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'),
          ...(IOS ? { borderWidth: StyleSheet.hairlineWidth, borderColor: t.oscuro ? 'rgba(255,255,255,0.22)' : 'rgba(60,60,67,0.3)' } : {}) }}>
          <TextInput ref={campoRef} value={texto} onChangeText={alEscribir} placeholder={listo ? 'Agrega una pregunta (opcional)' : 'Mensaje'} placeholderTextColor={colorSistema.placeholder}
            multiline maxLength={2000} accessibilityLabel="Mensaje" maxFontSizeMultiplier={1.8} textAlignVertical="center"
            style={{ flex: 1, fontSize: 17, lineHeight: 22, color: colorSistema.texto, maxHeight: 22 * 5 + 16,
              paddingLeft: 14, paddingRight: hay ? 4 : 14, paddingTop: IOS ? 7 : 6, paddingBottom: IOS ? 7 : 6 }} />
          {hay ? (
            <Pressable onPress={alEnviar} disabled={enviando} accessibilityRole="button" accessibilityLabel="Enviar" hitSlop={8}
              style={({ pressed }) => ({ width: 30, height: 30, margin: 3, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
                backgroundColor: tinte, opacity: enviando ? 0.5 : 1, transform: [{ scale: pressed ? 0.88 : 1 }] })}>
              <Icono sf="arrow.up" respaldo="↑" tam={15} color="#FFFFFF" />
            </Pressable>
          ) : null}
        </View>
        {/* Con el campo vacío, el atajo a la cámara (como iMessage / WhatsApp). */}
        {!hay ? <Redondo sf="camera.fill" respaldo="📷" etiqueta="Tomar una foto" alTocar={() => alAdjuntar('camara')} apagado={enviando} /> : null}
      </View>
    </>
  );
  if (IOS) {
    return (
      <BlurView intensity={80} tint={t.oscuro ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador }}>
        {contenido}
      </BlurView>
    );
  }
  return <View style={{ backgroundColor: t.oscuro ? '#1E1B24' : '#FFFFFF', elevation: 8 }}>{contenido}</View>;
}

// El «+» y la cámara: toque de 44 con un círculo visible de 34, como iMessage.
function Redondo({ sf, respaldo, etiqueta, alTocar, apagado }) {
  const t = useTema();
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); alTocar(); }} disabled={apagado} accessibilityRole="button" accessibilityLabel={etiqueta}
      hitSlop={4} style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: apagado ? 0.4 : 1, transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
        backgroundColor: t.oscuro ? 'rgba(255,255,255,0.14)' : 'rgba(118,118,128,0.14)' }}>
        <Icono sf={sf} respaldo={respaldo} tam={18} color={t.color.magentaTexto} />
      </View>
    </Pressable>
  );
}

/** «Respondiendo a Ana: …» sobre la barra, con ✕ para cancelar. */
export function Respondiendo({ cita, alCancelar }) {
  const t = useTema();
  const quien = cita.autor === 'cliente' ? 'ti' : (cita.nombre || 'Farmacia Salud');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 4, paddingTop: 8 }}
      accessible accessibilityLabel={`Respondiendo a ${quien}: ${resumenDeCita(cita)}`}>
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: t.color.magenta }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }} numberOfLines={1}>Respondiendo a {quien}</Text>
        <Text style={{ fontSize: 14, color: colorSistema.texto2 }} numberOfLines={1}>{resumenDeCita(cita)}</Text>
      </View>
      <Pressable onPress={alCancelar} accessibilityRole="button" accessibilityLabel="Cancelar la respuesta" hitSlop={6}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Icono sf="xmark.circle.fill" respaldo="✕" tam={20} color={colorSistema.texto3} />
      </Pressable>
    </View>
  );
}

// ── Deslizar para responder y mantener para el menú ─────────────────────
const UMBRAL = 56;
export function Deslizable({ children, alResponder, alMantener }) {
  const t = useTema();
  const reducir = useReducedMotion() || LIVIANO;
  const x = useSharedValue(0);
  const paso = useSharedValue(false);
  const vibrar = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
  const pan = Gesture.Pan()
    .activeOffsetX(14).failOffsetX(-14).failOffsetY([-12, 12])
    .onUpdate((e) => {
      const v = Math.max(0, e.translationX);
      x.value = v > UMBRAL ? UMBRAL + (v - UMBRAL) * 0.25 : v;
      if (v > UMBRAL && !paso.value) { paso.value = true; runOnJS(vibrar)(); }
      if (v <= UMBRAL && paso.value) paso.value = false;
    })
    .onEnd(() => { if (paso.value) runOnJS(alResponder)(); })
    .onFinalize(() => { paso.value = false; x.value = reducir ? withTiming(0, { duration: 120 }) : withSpring(0, { damping: 18, stiffness: 220 }); });
  const mantener = Gesture.LongPress().minDuration(380).onStart(() => { runOnJS(alMantener)(); });
  const gesto = Gesture.Race(pan, mantener);
  const globo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const flecha = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [10, UMBRAL], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(x.value, [10, UMBRAL], [0.5, 1], 'clamp') }],
  }));
  return (
    <GestureDetector gesture={gesto}>
      <View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 4, top: 0, bottom: 0, justifyContent: 'center' }, flecha]}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(t.color.magenta, t.oscuro ? 0.3 : 0.16) }}>
            <Icono sf="arrowshape.turn.up.left.fill" respaldo="↩" tam={14} color={t.color.magentaTexto} />
          </View>
        </Animated.View>
        <Animated.View style={globo}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

// ── El menú del mensaje ─────────────────────────────────────────────────
export function MenuMensaje({ menu, alReaccionar, alResponder, alCopiar, alCopiarProducto, alCerrar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const reducir = useReducedMotion() || LIVIANO;
  const escala = useSharedValue(reducir ? 1 : 0.85);
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!reducir) escala.value = withSpring(1, { damping: 16, stiffness: 300 });
  }, [reducir, escala]);
  const animado = useAnimatedStyle(() => ({ transform: [{ scale: escala.value }] }));
  const { m, caja } = menu;
  const mio = m.autor === 'cliente';
  const mia = (m.reacciones ?? []).find((r) => r.mia)?.emoji ?? null;
  const conProducto = m.adjunto?.tipo === 'producto' && !!alCopiarProducto;
  const ALTO_EMOJIS = 52, ALTO_ACCIONES = 52 * (1 + (m.texto ? 1 : 0) + (conProducto ? 1 : 0)), GAP = 8;
  // Las reacciones arriba del globo y las acciones abajo; si no caben, se
  // corren para quedar dentro de la pantalla (el globo queda donde estaba).
  const top = Math.max(ins.top + 8, Math.min(caja.y - ALTO_EMOJIS - GAP, H - ins.bottom - 16 - ALTO_EMOJIS - ALTO_ACCIONES - GAP * 2 - Math.min(caja.h, 120)));
  const abajo = Math.min(H - ins.bottom - 16 - ALTO_ACCIONES, Math.max(top + ALTO_EMOJIS + GAP + Math.min(caja.h, H / 2), caja.y + caja.h + GAP));
  const anchoEmojis = EMOJIS.length * 44 + 12;
  const izq = Math.max(12, Math.min(W - anchoEmojis - 12, mio ? caja.x + caja.w - anchoEmojis : caja.x));
  const izqAcc = Math.max(12, Math.min(W - 250 - 12, mio ? caja.x + caja.w - 250 : caja.x));
  const panel = t.oscuro ? 'rgba(44,44,46,0.96)' : 'rgba(255,255,255,0.97)';
  const sombra = { shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10 };
  const Fila = ({ sf, respaldo, texto, alTocar, borde }) => (
    <Pressable onPress={alTocar} accessibilityRole="menuitem"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, paddingHorizontal: 16,
        backgroundColor: pressed ? (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
        ...(borde ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colorSistema.separador } : {}) })}>
      <Text style={{ fontSize: 17, color: colorSistema.texto }}>{texto}</Text>
      <Icono sf={sf} respaldo={respaldo} tam={18} color={colorSistema.texto} />
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={alCerrar} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={alCerrar} accessibilityRole="button" accessibilityLabel="Cerrar el menú">
        {IOS && !LIVIANO ? <BlurView intensity={28} tint={t.oscuro ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />}
      </Pressable>
      <Animated.View style={[{ position: 'absolute', top, left: izq, flexDirection: 'row', gap: 0, paddingHorizontal: 6, height: ALTO_EMOJIS, alignItems: 'center',
        borderRadius: ALTO_EMOJIS / 2, backgroundColor: panel }, sombra, animado]} accessibilityRole="menu">
        {EMOJIS.map((e) => (
          <Pressable key={e} onPress={() => alReaccionar(e)} accessibilityRole="menuitem" accessibilityLabel={`Reaccionar con ${e}`} accessibilityState={{ selected: mia === e }}
            style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
              backgroundColor: mia === e ? suave(t.color.magenta, 0.25) : 'transparent', transform: [{ scale: pressed ? 1.25 : 1 }] })}>
            <Text style={{ fontSize: 26 }} allowFontScaling={false}>{e}</Text>
          </Pressable>
        ))}
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', top: abajo, left: izqAcc, width: 250, borderRadius: 14, overflow: 'hidden', backgroundColor: panel }, sombra, animado]}>
        <Fila sf="arrowshape.turn.up.left.fill" respaldo="↩" texto="Responder" alTocar={alResponder} />
        {m.texto ? <Fila sf="doc.on.doc" respaldo="⧉" texto="Copiar" alTocar={alCopiar} borde /> : null}
        {conProducto ? <Fila sf="pills" respaldo="⧉" texto="Copiar nombre del producto" alTocar={alCopiarProducto} borde /> : null}
      </Animated.View>
    </Modal>
  );
}

// ── Reacciones bajo el globo ────────────────────────────────────────────
export function Reacciones({ lista, mio, alTocar }) {
  const t = useTema();
  const grupos = [];
  for (const r of lista ?? []) {
    const g = grupos.find((x) => x.emoji === r.emoji);
    if (g) { g.n += 1; g.mia = g.mia || r.mia; } else grupos.push({ emoji: r.emoji, n: 1, mia: !!r.mia });
  }
  if (!grupos.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -6, justifyContent: mio ? 'flex-end' : 'flex-start', paddingHorizontal: 6 }}>
      {grupos.map((g) => (
        <Pressable key={g.emoji} onPress={() => alTocar(g.emoji)} hitSlop={4} accessibilityRole="button"
          accessibilityLabel={`${g.emoji} ${g.n > 1 ? g.n : ''}${g.mia ? ', tu reacción. Toca para quitarla' : '. Toca para reaccionar igual'}`}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 26, paddingHorizontal: 7, borderRadius: 13,
            backgroundColor: g.mia ? suave(t.color.magenta, t.oscuro ? 0.35 : 0.18) : (t.oscuro ? '#2C2C2E' : '#FFFFFF'),
            borderWidth: 1, borderColor: g.mia ? t.color.magenta : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'),
            transform: [{ scale: pressed ? 0.92 : 1 }] })}>
          <Text style={{ fontSize: 14 }} allowFontScaling={false}>{g.emoji}</Text>
          {g.n > 1 ? <Text style={{ fontSize: 12, fontWeight: '700', color: g.mia ? t.color.magentaTexto : colorSistema.texto2 }}>{g.n}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

// ── El bloque citado dentro del globo ───────────────────────────────────
export function Cita({ c, mio, nombreEquipo, alTocar }) {
  const t = useTema();
  const quien = c.autor === 'cliente' ? 'Tú' : c.autor === 'sistema' ? 'Farmacia Salud' : (nombreEquipo || 'Farmacia Salud');
  const fondo = mio ? 'rgba(255,255,255,0.2)' : (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)');
  const barra = mio ? 'rgba(255,255,255,0.85)' : t.color.magenta;
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityLabel={`Responde a ${quien}: ${resumenDeCita(c)}. Toca para verlo`}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 8, borderRadius: 12, padding: 8, marginBottom: 6, backgroundColor: fondo, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 3, borderRadius: 2, backgroundColor: barra }} />
      <View style={{ flexShrink: 1, gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: mio ? '#FFFFFF' : t.color.magentaTexto }} numberOfLines={1}>{quien}</Text>
        <Text style={{ fontSize: 14, color: mio ? 'rgba(255,255,255,0.9)' : colorSistema.texto2 }} numberOfLines={2}>{resumenDeCita(c)}</Text>
      </View>
    </Pressable>
  );
}

/** Mide un globo en la ventana para pegarle el menú. */
export function useMedir() {
  const ref = useRef(null);
  const medir = (fn) => ref.current?.measureInWindow?.((x, y, w, h) => fn({ x, y, w, h }));
  return [ref, medir];
}
