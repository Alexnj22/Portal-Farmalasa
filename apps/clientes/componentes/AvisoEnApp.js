// El aviso que llega con la app ABIERTA (2026-10-09). En lugar del banner del
// sistema, uno propio arriba: el ícono y el color de la clase de aviso (los
// mismos de la bandeja), el título y el texto. Tocarlo lleva a la pantalla de
// la que habla; deslizarlo hacia arriba lo cierra; si no se toca, se va solo.
//
// Sólo se adueña del aviso mientras puede mostrarlo (con sesión y sin el
// bloqueo encima): si no, `lib/avisos.js` deja salir el del sistema.
//
// Todo el movimiento es desplazamiento y escala, SIN opacidad de entrada: el
// Liquid Glass no se dibuja si su contenedor nace transparente (animacion.js).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import Icono from './Icono';
import Vidrio from './Vidrio';
import { colorSistema } from './sistema';
import { estiloDeAviso, tipoDeUrl } from './estiloDeAviso';
import { alLlegarAviso, usarBannerPropio } from '../lib/avisos';
import { useSesion } from '../lib/sesion';
import { useBloqueo } from '../lib/bloqueo';
import { navegar } from '../lib/navegar';
import { suave, useTema } from '../tema/tema';

const DURACION = 5500;
const FUERA = -180;
const RESORTE = { damping: 20, stiffness: 220, mass: 0.8 };

export default function AvisoEnApp() {
  const token = useSesion((s) => s.token);
  const bloqueada = useBloqueo((s) => s.bloqueada);
  const puede = Platform.OS !== 'web' && !!token && !bloqueada;
  const [aviso, setAviso] = useState(null);
  const reloj = useRef(null);
  const y = useSharedValue(FUERA);
  const escala = useSharedValue(1);

  // Mientras se puede mostrar, el sistema no pone el suyo encima.
  useEffect(() => {
    usarBannerPropio(puede);
    return () => usarBannerPropio(false);
  }, [puede]);

  const quitar = useCallback(() => { setAviso(null); }, []);
  const cerrar = useCallback(() => {
    clearTimeout(reloj.current);
    y.value = withTiming(FUERA, { duration: 220 }, (fin) => { if (fin) runOnJS(quitar)(); });
  }, [y, quitar]);
  const programar = useCallback(() => {
    clearTimeout(reloj.current);
    reloj.current = setTimeout(cerrar, DURACION);
  }, [cerrar]);
  const pausar = useCallback(() => { clearTimeout(reloj.current); }, []);

  useEffect(() => {
    if (!puede) return undefined;
    return alLlegarAviso((a) => {
      if (!a.titulo && !a.cuerpo) return;
      // Uno nuevo reemplaza al que estaba: baja otra vez desde arriba.
      y.value = FUERA;
      setAviso(a);
      y.value = withSpring(0, RESORTE);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
      programar();
    });
  }, [puede, y, programar]);

  // Si el bloqueo cae encima (o se cierra la sesión), el aviso se va.
  useEffect(() => { if (!puede) { clearTimeout(reloj.current); setAviso(null); y.value = FUERA; } }, [puede, y]);
  useEffect(() => () => clearTimeout(reloj.current), []);

  const abrir = useCallback(() => {
    const url = aviso?.url;
    Haptics.selectionAsync().catch(() => {});
    cerrar();
    if (typeof url === 'string' && url.startsWith('/')) navegar(url);
  }, [aviso, cerrar]);

  const arrastre = Gesture.Pan()
    .activeOffsetY([-6, 6])
    // Al ACTIVARSE el arrastre (no al tocar): un toque que no arrastra no deja el reloj parado.
    .onStart(() => { runOnJS(pausar)(); })
    .onUpdate((e) => {
      // Hacia arriba sigue al dedo; hacia abajo, con resistencia.
      y.value = e.translationY < 0 ? e.translationY : e.translationY * 0.18;
    })
    .onEnd((e) => {
      if (e.translationY < -28 || e.velocityY < -450) {
        y.value = withTiming(FUERA, { duration: 180 }, (fin) => { if (fin) runOnJS(quitar)(); });
      } else {
        y.value = withSpring(0, RESORTE);
        runOnJS(programar)();
      }
    });
  const toque = Gesture.Tap()
    .onBegin(() => { escala.value = withSpring(0.97, { damping: 20, stiffness: 400 }); })
    .onFinalize(() => { escala.value = withSpring(1, { damping: 14, stiffness: 300 }); })
    .onEnd(() => { runOnJS(abrir)(); });
  const gesto = Gesture.Exclusive(arrastre, toque);

  const animado = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { scale: escala.value }] }));

  if (!aviso) return null;
  return <Banner aviso={aviso} gesto={gesto} animado={animado} />;
}

function Banner({ aviso, gesto, animado }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const e = estiloDeAviso(t, aviso.tipo ?? tipoDeUrl(aviso.url));
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: ins.top + 6, left: 0, right: 0, alignItems: 'center', zIndex: 1100 }}>
      <GestureDetector gesture={gesto}>
        <Animated.View style={[{ width: '100%', maxWidth: 560, paddingHorizontal: 10 }, animado]}
          accessible accessibilityRole={aviso.url ? 'button' : 'alert'}
          accessibilityLabel={`${aviso.titulo}. ${aviso.cuerpo}`}
          accessibilityHint={aviso.url ? 'Abre el aviso. Desliza hacia arriba para cerrarlo.' : 'Desliza hacia arriba para cerrarlo.'}>
          <View style={{ borderRadius: 24, shadowColor: '#000', shadowOpacity: t.oscuro ? 0.45 : 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }}>
            <Vidrio radio={24} tinte={suave(e.fuerte, t.oscuro ? 0.16 : 0.1)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingLeft: 12, paddingRight: 16 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(e.fuerte, t.oscuro ? 0.3 : 0.18) }}>
                  <Icono sf={e.sf} respaldo={e.respaldo} tam={20} color={e.texto} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colorSistema.texto }}>{aviso.titulo}</Text>
                    <Text style={{ fontSize: 12, color: colorSistema.texto3 }}>ahora</Text>
                  </View>
                  {aviso.cuerpo ? <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto2 }}>{aviso.cuerpo}</Text> : null}
                </View>
              </View>
              {/* La manija: dice que se puede deslizar. */}
              <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 6, backgroundColor: t.oscuro ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.16)' }} />
            </Vidrio>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
