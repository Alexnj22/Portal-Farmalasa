// La vista previa de una foto ANTES de usarla (2026-10-12). Pedido del
// usuario: «que dé una vista previa, permita hacer zoom, etc. para confirmar
// que está como quiere, y la opción de seleccionar otra». Vale para TODA foto
// que el cliente toma o elige: la receta (RecetaFoto y «Subir otra foto» de
// Mis reservas), la foto del chat y la de perfil.
//
// Uso: `const foto = usarVistaPreviaFoto();` y
//   const f = await foto.elegir({ titulo, mensaje, pista, circular, origen });
// (`origen` 'camara' | 'galeria' salta la pregunta: el «+» del chat ya la hizo)
// y renderizar `{foto.vista}` en la pantalla. `f` es `{ uri, ancho, alto }`
// (ya achicada por lib/fotos) o `null` si la persona canceló.
//
// La vista va DENTRO de la pantalla que la pide y no en la raíz a propósito:
// un Modal se presenta desde el controlador de quien lo dibuja, y desde la
// raíz no podría salir encima de una hoja ya abierta (Reservar, por ejemplo).
//
// Pellizcar acerca, arrastrar mueve la foto acercada y dos toques alternan
// entre la foto entera y ×2.5 en ese punto. «Elegir otra» vuelve a abrir la
// cámara o la galería —la misma de antes—, y se puede cambiar de una a la otra.
//
// La foto de perfil (2026-10-14) es un RECORTE, no una vista previa: la foto
// llena el círculo (`cover`) y se mueve y acerca DENTRO de la guía; dos botones
// la giran 90° a la izquierda o a la derecha (una selfie de lado ya no queda de
// lado). «Usar esta foto» corta el cuadrado que se ve en el círculo y lo guarda
// como JPEG de 800 px: lo que se sube es exactamente lo que se vio. La receta y
// el chat siguen igual (la foto entera, sin recortar).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, StatusBar, Text, View } from 'react-native';
import Presionable from './Presionable';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { elegirFoto, preguntarOrigen } from '../lib/fotos';
import { useTema } from '../tema/tema';

const ESCALA_MAX = 5;
const ESCALA_DOBLE = 2.5;
const RESORTE = { damping: 22, stiffness: 220 };

/** La pista de la receta: lo que tiene que leerse en la foto. */
export const PISTA_RECETA = 'Asegúrate de que se lea el nombre del medicamento, la dosis, la fecha y la firma o sello.';

/**
 * Elegir una foto con vista previa. Devuelve `{ elegir, vista }`: `elegir`
 * pregunta cámara o galería, abre la vista previa y resuelve con la foto
 * confirmada o `null`; `vista` se renderiza en la pantalla.
 */
export function usarVistaPreviaFoto() {
  const [estado, setEstado] = useState(null); // { foto, origen, opciones }
  const resolver = useRef(null);

  const terminar = useCallback((valor) => {
    const r = resolver.current;
    resolver.current = null;
    setEstado(null);
    r?.(valor);
  }, []);
  // Si la pantalla se va con la vista abierta, quien esperaba recibe `null`.
  useEffect(() => () => { resolver.current?.(null); resolver.current = null; }, []);

  const elegir = useCallback(async (opciones = {}) => {
    if (resolver.current) return null;
    const origen = opciones.origen ?? await preguntarOrigen(opciones.titulo ?? 'Agregar foto', opciones.mensaje);
    if (!origen) return null;
    const f = await elegirFoto(origen);
    if (!f) return null;
    if (f.error) { Alert.alert('No se pudo usar la foto', f.error); return null; }
    return new Promise((listo) => {
      resolver.current = listo;
      setEstado({ foto: f, origen, opciones });
    });
  }, []);

  const vista = estado ? (
    <VistaPreviaFoto estado={estado} alCambiar={(foto, origen) => setEstado((e) => (e ? { ...e, foto, origen } : e))}
      alUsar={(f) => terminar(f ?? estado.foto)} alCancelar={() => terminar(null)} />
  ) : null;
  return { elegir, vista };
}

function VistaPreviaFoto({ estado, alCambiar, alUsar, alCancelar }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const { foto, origen, opciones } = estado;
  const [eligiendo, setEligiendo] = useState(false);
  const otro = origen === 'camara' ? 'galeria' : 'camara';

  const otra = async (de) => {
    if (eligiendo) return;
    Haptics.selectionAsync().catch(() => {});
    setEligiendo(true);
    try {
      const f = await elegirFoto(de);
      if (f?.error) Alert.alert('No se pudo usar la foto', f.error);
      else if (f) alCambiar(f, de);
    } finally {
      setEligiendo(false);
    }
  };
  // Perfil: el recorte del círculo (y el giro) se aplica al usarla.
  const recorte = useRef(null);
  const [girando, setGirando] = useState(false);
  const ocupado = eligiendo || girando;
  const usar = async () => {
    if (ocupado) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (!opciones.circular || !recorte.current) { alUsar(); return; }
    setGirando(true);
    const f = await recorte.current().catch(() => null);
    setGirando(false);
    if (!f) { Alert.alert('No se pudo preparar la foto', 'Intenta de nuevo o elige otra.'); return; }
    alUsar(f);
  };
  const girar = async (grados) => {
    if (ocupado) return;
    Haptics.selectionAsync().catch(() => {});
    setGirando(true);
    try {
      const img = await ImageManipulator.manipulate(foto.uri).rotate(grados).renderAsync();
      const g = await img.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
      alCambiar({ uri: g.uri, ancho: g.width, alto: g.height }, origen);
    } catch {
      Alert.alert('No se pudo girar la foto', 'Intenta de nuevo.');
    } finally {
      setGirando(false);
    }
  };

  return (
    <Modal visible animationType="fade" presentationStyle="overFullScreen" transparent statusBarTranslucent onRequestClose={alCancelar}>
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000000' }}>
        <View style={{ paddingTop: ins.top + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' }}>
          <Presionable onPress={alCancelar} accessibilityRole="button" hitSlop={8}
            style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 17, color: '#FFFFFF' }}>Cancelar</Text>
          </Presionable>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#FFFFFF' }}>
            {opciones.circular ? 'Tu foto de perfil' : 'Revisa la foto'}
          </Text>
          {/* El mismo ancho que «Cancelar», para que el título quede centrado. */}
          <View style={{ minWidth: 86 }} />
        </View>
        {opciones.pista ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 16, marginTop: 6, padding: 12, borderRadius: 14,
            backgroundColor: 'rgba(255,255,255,0.12)' }}>
            <Icono sf="info.circle" respaldo="i" tam={16} color="#FFFFFF" />
            <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: '#FFFFFF' }}>{opciones.pista}</Text>
          </View>
        ) : null}

        {opciones.circular
          ? <Recorte key={foto.uri} foto={foto} recorte={recorte} />
          : <Lienzo key={foto.uri} foto={foto} circular={false} />}

        {opciones.circular ? (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28, paddingBottom: 6 }}>
            {[[-90, 'rotate.left', '⟲', 'Girar a la izquierda'], [90, 'rotate.right', '⟳', 'Girar a la derecha']].map(([g, sf, resp, rot]) => (
              <Presionable key={g} onPress={() => girar(g)} disabled={ocupado} accessibilityRole="button" accessibilityLabel={rot} hitSlop={6}
                style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'rgba(255,255,255,0.16)', opacity: ocupado ? 0.5 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] })}>
                <Icono sf={sf} respaldo={resp} tam={20} color="#FFFFFF" />
              </Presionable>
            ))}
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(ins.bottom, 12) + 4, gap: 10 }}>
          <Text style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
            {opciones.circular ? 'Mueve y pellizca la foto para encuadrarla en el círculo.' : 'Pellizca o toca dos veces para acercar.'}
          </Text>
          <Presionable onPress={usar} disabled={ocupado} accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
              backgroundColor: t.color.magenta, opacity: ocupado ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            {girando ? <ActivityIndicator color="#FFFFFF" /> : <Icono sf="checkmark" respaldo="✓" tam={17} color="#FFFFFF" />}
            <Text style={{ fontSize: 17, fontWeight: '800', color: '#FFFFFF' }}>Usar esta foto</Text>
          </Presionable>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Presionable onPress={() => otra(origen)} disabled={eligiendo} accessibilityRole="button"
              accessibilityLabel={origen === 'camara' ? 'Tomar otra foto' : 'Elegir otra foto de la galería'}
              style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                backgroundColor: 'rgba(255,255,255,0.16)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              {eligiendo ? <ActivityIndicator color="#FFFFFF" /> : <Icono sf={origen === 'camara' ? 'camera.fill' : 'photo.on.rectangle'} respaldo="↺" tam={16} color="#FFFFFF" />}
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{origen === 'camara' ? 'Tomar otra' : 'Elegir otra'}</Text>
            </Presionable>
            <Presionable onPress={() => otra(otro)} disabled={eligiendo} accessibilityRole="button"
              accessibilityLabel={otro === 'camara' ? 'Tomar la foto con la cámara' : 'Elegir de la galería'}
              style={({ pressed }) => ({ flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <Icono sf={otro === 'camara' ? 'camera.fill' : 'photo.on.rectangle'} respaldo={otro === 'camara' ? '📷' : '🖼'} tam={16} color="#FFFFFF" />
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFFFF' }}>{otro === 'camara' ? 'Cámara' : 'Galería'}</Text>
            </Presionable>
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

// La foto con zoom: pellizcar, arrastrar (acercada) y dos toques.
function Lienzo({ foto, circular }) {
  const [caja, setCaja] = useState({ w: 0, h: 0 });
  const escala = useSharedValue(1);
  const base = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);
  const ancho = useSharedValue(0);
  const alto = useSharedValue(0);

  // Lo que ocupa la foto entera dentro del lienzo (`contain`).
  const prop = foto.ancho && foto.alto ? foto.ancho / foto.alto : 3 / 4;
  let fw = caja.w, fh = caja.w / prop;
  if (fh > caja.h) { fh = caja.h; fw = caja.h * prop; }
  useEffect(() => { ancho.value = fw; alto.value = fh; }, [fw, fh, ancho, alto]);

  const acotar = (v, e, lado, lienzo) => {
    'worklet';
    const max = Math.max(0, (lado * e - lienzo) / 2);
    return Math.min(max, Math.max(-max, v));
  };
  const asentar = () => {
    'worklet';
    if (escala.value < 1) { escala.value = withSpring(1, RESORTE); x.value = withSpring(0, RESORTE); y.value = withSpring(0, RESORTE); return; }
    if (escala.value > ESCALA_MAX) escala.value = withSpring(ESCALA_MAX, RESORTE);
    const e = Math.min(escala.value, ESCALA_MAX);
    x.value = withSpring(acotar(x.value, e, ancho.value, caja.w), RESORTE);
    y.value = withSpring(acotar(y.value, e, alto.value, caja.h), RESORTE);
  };

  const pellizco = Gesture.Pinch()
    .onStart(() => { base.value = escala.value; x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => {
      const nueva = Math.max(0.7, Math.min(ESCALA_MAX * 1.2, base.value * e.scale));
      // Acercar hacia los dedos: el punto bajo ellos se queda donde está.
      const fx = e.focalX - caja.w / 2, fy = e.focalY - caja.h / 2;
      const k = nueva / base.value;
      x.value = fx - (fx - x0.value) * k;
      y.value = fy - (fy - y0.value) * k;
      escala.value = nueva;
    })
    .onEnd(() => { asentar(); });
  const arrastre = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => {
      if (escala.value <= 1) return;
      x.value = x0.value + e.translationX;
      y.value = y0.value + e.translationY;
    })
    .onEnd(() => { asentar(); });
  const dosToques = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (escala.value > 1.05) {
        escala.value = withTiming(1); x.value = withTiming(0); y.value = withTiming(0);
        return;
      }
      const fx = e.x - caja.w / 2, fy = e.y - caja.h / 2;
      escala.value = withTiming(ESCALA_DOBLE);
      x.value = withTiming(acotar(-fx * (ESCALA_DOBLE - 1), ESCALA_DOBLE, ancho.value, caja.w));
      y.value = withTiming(acotar(-fy * (ESCALA_DOBLE - 1), ESCALA_DOBLE, alto.value, caja.h));
    });
  const gesto = Gesture.Simultaneous(pellizco, arrastre, dosToques);

  const animado = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: escala.value }] }));

  // La guía redonda de la foto de perfil: el círculo es el cuadrado central de
  // la foto, que es lo que muestra el avatar (`cover`). Fuera se oscurece.
  const d = Math.min(fw, fh);
  const BORDE = 1200;
  return (
    <GestureDetector gesture={gesto}>
      <View style={{ flex: 1, overflow: 'hidden', marginVertical: 8 }} onLayout={(e) => setCaja({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessible accessibilityRole="image" accessibilityLabel={circular ? 'Vista previa de tu foto de perfil' : 'Vista previa de la foto'}>
        <Animated.View style={[{ flex: 1 }, animado]}>
          <Image source={{ uri: foto.uri }} style={{ flex: 1 }} contentFit="contain" transition={Platform.OS === 'web' ? 0 : 150} />
        </Animated.View>
        {circular && d > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: d + BORDE * 2, height: d + BORDE * 2, borderRadius: d / 2 + BORDE, borderWidth: BORDE, borderColor: 'rgba(0,0,0,0.55)' }} />
            <View style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }} />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

// El recorte de la foto de perfil (2026-10-14). La guía es un círculo de
// diámetro D en el centro; la foto, a escala 1, lo CUBRE (su lado corto mide
// D). Se puede mover y acercar (hasta ×5), pero siempre queda cubriendo el
// círculo: al soltar, vuelve con un resorte al borde más cercano.
const LADO_PERFIL = 800;
function Recorte({ foto, recorte }) {
  const [caja, setCaja] = useState({ w: 0, h: 0 });
  const escala = useSharedValue(1);
  const base = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);

  const D = Math.max(0, Math.min(caja.w, caja.h) - 32);
  const prop = foto.ancho && foto.alto ? foto.ancho / foto.alto : 1;
  // La foto a escala 1: el lado corto mide D.
  const fw = prop >= 1 ? D * prop : D;
  const fh = prop >= 1 ? D : D / prop;

  const acotar = (v, e, lado) => {
    'worklet';
    const max = Math.max(0, (lado * e - D) / 2);
    return Math.min(max, Math.max(-max, v));
  };
  const asentar = () => {
    'worklet';
    const e = Math.min(ESCALA_MAX, Math.max(1, escala.value));
    if (e !== escala.value) escala.value = withSpring(e, RESORTE);
    x.value = withSpring(acotar(x.value, e, fw), RESORTE);
    y.value = withSpring(acotar(y.value, e, fh), RESORTE);
  };
  const pellizco = Gesture.Pinch()
    .onStart(() => { base.value = escala.value; x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => {
      const nueva = Math.max(0.8, Math.min(ESCALA_MAX * 1.2, base.value * e.scale));
      const fx = e.focalX - caja.w / 2, fy = e.focalY - caja.h / 2;
      const k = nueva / base.value;
      x.value = fx - (fx - x0.value) * k;
      y.value = fy - (fy - y0.value) * k;
      escala.value = nueva;
    })
    .onEnd(() => { asentar(); });
  const arrastre = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => { x.value = x0.value + e.translationX; y.value = y0.value + e.translationY; })
    .onEnd(() => { asentar(); });
  const gesto = Gesture.Simultaneous(pellizco, arrastre);
  const animado = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: escala.value }] }));

  // Lo que se ve en el círculo, en píxeles de la foto: el centro del círculo
  // está a (−x, −y)/escala del centro de la foto (en puntos de pantalla a
  // escala 1), y el lado es D/escala. `k` pasa de puntos a píxeles.
  recorte.current = async () => {
    if (!D || !foto.ancho || !foto.alto) return foto;
    const e = Math.min(ESCALA_MAX, Math.max(1, escala.value));
    const k = foto.ancho / fw;
    const lado = Math.min(foto.ancho, foto.alto, Math.round((D / e) * k));
    const cx = foto.ancho / 2 - (acotar(x.value, e, fw) / e) * k;
    const cy = foto.alto / 2 - (acotar(y.value, e, fh) / e) * k;
    const originX = Math.round(Math.min(foto.ancho - lado, Math.max(0, cx - lado / 2)));
    const originY = Math.round(Math.min(foto.alto - lado, Math.max(0, cy - lado / 2)));
    const ctx = ImageManipulator.manipulate(foto.uri).crop({ originX, originY, width: lado, height: lado });
    if (lado > LADO_PERFIL) ctx.resize({ width: LADO_PERFIL, height: LADO_PERFIL });
    const img = await ctx.renderAsync();
    const g = await img.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
    return { uri: g.uri, ancho: g.width, alto: g.height };
  };

  const BORDE = 1200;
  return (
    <GestureDetector gesture={gesto}>
      <View style={{ flex: 1, overflow: 'hidden', marginVertical: 8, alignItems: 'center', justifyContent: 'center' }}
        onLayout={(e) => setCaja({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessible accessibilityRole="image" accessibilityLabel="Tu foto de perfil. Arrastra para moverla y pellizca para acercarla.">
        {D > 0 ? (
          <Animated.View style={[{ width: fw, height: fh }, animado]}>
            <Image source={{ uri: foto.uri }} style={{ width: fw, height: fh }} contentFit="cover" transition={Platform.OS === 'web' ? 0 : 150} />
          </Animated.View>
        ) : null}
        {D > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: D + BORDE * 2, height: D + BORDE * 2, borderRadius: D / 2 + BORDE, borderWidth: BORDE, borderColor: 'rgba(0,0,0,0.6)' }} />
            <View style={{ position: 'absolute', width: D, height: D, borderRadius: D / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' }} />
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
