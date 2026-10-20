// El visor de fotos del chat (2026-10-20, «como las apps de mensajería»): a
// pantalla completa, con TODAS las fotos de la conversación para pasar de una
// a otra deslizando de lado, como la galería de WhatsApp o de iMessage.
//
//   · Pellizcar acerca (hasta 4×) y, acercada, se arrastra; dos toques
//     alternan entre la foto entera y 2.5× donde se tocó.
//   · Sin acercar, arrastrarla hacia abajo (o arriba) la cierra: el fondo se
//     aclara a medida que se aleja, y si no llega, vuelve con un resorte.
//   · Acercada, el deslizamiento de lado no cambia de foto: primero se aleja.
//
// Todo en el hilo de la interfaz (gesture-handler + Reanimated), igual en
// iPhone y en Android.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, FlatList, Modal, StatusBar, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';

const RESORTE = { damping: 22, stiffness: 240 };
const MAX = 4;

export default function VisorFotos({ fotos, inicio = 0, alCerrar }) {
  const ins = useSafeAreaInsets();
  const { width: W, height: H } = Dimensions.get('window');
  const [i, setI] = useState(inicio);
  const [acercada, setAcercada] = useState(false);
  const fondo = useSharedValue(1);
  const lista = useRef(null);
  const visible = !!fotos?.length;
  useEffect(() => { if (visible) { setI(inicio); fondo.value = 1; } }, [visible, inicio, fondo]);
  const cerrar = useCallback(() => { Haptics.selectionAsync().catch(() => {}); alCerrar(); }, [alCerrar]);
  const estiloFondo = useAnimatedStyle(() => ({ opacity: fondo.value }));
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" presentationStyle="overFullScreen" onRequestClose={cerrar} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' }, estiloFondo]} />
        <FlatList
          ref={lista}
          data={fotos}
          horizontal
          pagingEnabled
          scrollEnabled={!acercada}
          initialScrollIndex={Math.min(inicio, fotos.length - 1)}
          getItemLayout={(_, k) => ({ length: W, offset: W * k, index: k })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(f, k) => `${f.cacheKey ?? f.uri}-${k}`}
          onMomentumScrollEnd={(e) => setI(Math.round(e.nativeEvent.contentOffset.x / W))}
          renderItem={({ item }) => (
            <FotoZoom fuente={item} ancho={W} alto={H} fondo={fondo} alCerrar={alCerrar} alAcercar={setAcercada} />
          )}
        />
        <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: ins.top + 6, left: 0, right: 0, flexDirection: 'row',
          alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }, estiloFondo]}>
          <Presionable onPress={cerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar"
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' }}>
            <Icono sf="xmark" respaldo="✕" tam={17} color="#FFFFFF" />
          </Presionable>
          {fotos.length > 1 ? (
            <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' }}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{i + 1} de {fotos.length}</Text>
            </View>
          ) : <View />}
          <View style={{ width: 40 }} />
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function FotoZoom({ fuente, ancho, alto, fondo, alCerrar, alAcercar }) {
  const escala = useSharedValue(1);
  const base = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const x0 = useSharedValue(0);
  const y0 = useSharedValue(0);
  // Acercada o no cambia QUÉ hace el arrastre: acercada, mueve la foto en
  // cualquier dirección; sin acercar, sólo lo vertical (cerrar) y lo de lado
  // es de la lista (pasar de foto).
  const [zoom, setZoom] = useState(false);
  const avisar = (v) => { setZoom(v); alAcercar(v); };
  // Que la foto acercada no se salga de la pantalla más de lo que mide.
  const limitar = (v, lado, e) => { 'worklet'; const m = (lado * (e - 1)) / 2; return Math.max(-m, Math.min(m, v)); };
  const alejar = () => {
    'worklet';
    escala.value = withSpring(1, RESORTE); x.value = withSpring(0, RESORTE); y.value = withSpring(0, RESORTE);
    runOnJS(avisar)(false);
  };
  const pellizco = Gesture.Pinch()
    .onStart(() => { base.value = escala.value; })
    .onUpdate((e) => { escala.value = Math.max(0.8, Math.min(MAX + 0.5, base.value * e.scale)); })
    .onEnd(() => {
      if (escala.value <= 1.02) { alejar(); return; }
      if (escala.value > MAX) escala.value = withSpring(MAX, RESORTE);
      runOnJS(avisar)(true);
    });
  let arrastre = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => { x0.value = x.value; y0.value = y.value; })
    .onUpdate((e) => {
      if (escala.value > 1.02) {
        x.value = limitar(x0.value + e.translationX, ancho, escala.value);
        y.value = limitar(y0.value + e.translationY, alto, escala.value);
      } else {
        y.value = e.translationY;
        fondo.value = Math.max(0.2, 1 - Math.abs(e.translationY) / (alto * 0.6));
      }
    })
    .onEnd((e) => {
      if (escala.value > 1.02) return;
      if (Math.abs(e.translationY) > 140 || Math.abs(e.velocityY) > 1100) {
        y.value = withTiming(Math.sign(e.translationY || 1) * alto, { duration: 180 });
        runOnJS(alCerrar)();
      } else {
        y.value = withSpring(0, RESORTE);
        fondo.value = withTiming(1, { duration: 160 });
      }
    });
  if (!zoom) arrastre = arrastre.activeOffsetY([-12, 12]).failOffsetX([-18, 18]);
  const dosToques = Gesture.Tap().numberOfTaps(2).onEnd((e) => {
    if (escala.value > 1.02) { alejar(); return; }
    const e2 = 2.5;
    escala.value = withSpring(e2, RESORTE);
    x.value = withSpring(limitar((ancho / 2 - e.x) * (e2 - 1), ancho, e2), RESORTE);
    y.value = withSpring(limitar((alto / 2 - e.y) * (e2 - 1), alto, e2), RESORTE);
    runOnJS(avisar)(true);
  });
  const gestos = Gesture.Simultaneous(pellizco, arrastre, dosToques);
  const estilo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: escala.value }] }));
  return (
    <GestureDetector gesture={gestos}>
      <Animated.View style={[{ width: ancho, height: alto, alignItems: 'center', justifyContent: 'center' }, estilo]}>
        <Image source={fuente} cachePolicy="memory-disk" recyclingKey={fuente.cacheKey ?? fuente.uri} contentFit="contain"
          style={{ width: ancho, height: alto }} accessibilityLabel="Foto" />
      </Animated.View>
    </GestureDetector>
  );
}
