// El material de la tarjeta (2026-10-08): un shader de Skia por nivel o rango
// (componentes/minerales/shaders.js), vivo — la luz, las facetas y el
// arcoíris siguen la inclinación del teléfono y el dedo, y los destellos
// titilan. Es la misma fuente que genera las franjas de Apple Wallet.
//
// Sólo corre el reloj con la tarjeta a la vista (`activa`): fuera de pantalla
// el material queda quieto y no gasta batería. Si el shader no compilara,
// no dibuja nada y queda el degradado de debajo.
import { useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { PRELUDIO, SHADERS } from './shaders';

const cache = {};
function efectoDe(material) {
  if (!(material in cache)) {
    try { cache[material] = SHADERS[material] ? Skia.RuntimeEffect.Make(PRELUDIO + SHADERS[material]) : null; }
    catch { cache[material] = null; }
  }
  return cache[material];
}

export const MATERIALES = Object.keys(SHADERS);

// Android (2026-10-13, «es lenta»): el shader se calcula a MEDIA resolución
// —un cuarto de los píxeles— y el lienzo se estira al doble; y el reloj avanza
// a 30 cuadros por segundo en vez de 60. Los materiales se miden en `p / res`,
// así que se ven iguales, apenas más suaves; en la GPU de un Android de gama
// media es la diferencia entre trabarse y no. Los textos y el logo van en sus
// propias capas encima y siguen nítidos.
const ANDROID = Platform.OS === 'android';
const LIENZO_ANDROID = { position: 'absolute', left: 0, top: 0, width: '50%', height: '50%', transform: [{ scale: 2 }], transformOrigin: 'top left' };

export default function Mineral({ material, x, y, activa = true }) {
  const efecto = efectoDe(material);
  const tam = useSharedValue({ width: 0, height: 0 });
  const t = useSharedValue(3);
  const cuadro = useSharedValue(0);
  const reloj = useFrameCallback((f) => {
    const paso = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    if (!ANDROID) { t.value += paso; return; }
    // Android: se acumula y se publica cada 1/30 s (cada dos cuadros a 60 Hz,
    // cada cuatro a 120): el lienzo sólo se redibuja cuando cambia `t`.
    cuadro.value += paso;
    if (cuadro.value >= 0.032) { t.value += cuadro.value; cuadro.value = 0; }
  }, false);
  useEffect(() => { reloj.setActive(!!activa); }, [activa, reloj]);
  const uniforms = useDerivedValue(() => ({
    res: [Math.max(1, tam.value.width), Math.max(1, tam.value.height)],
    t: t.value,
    tilt: [x ? x.value : 0, y ? y.value : 0],
  }));
  if (!efecto) return null;
  return (
    // sRGB: el mismo espacio de color con que se diseñó y con que salen las
    // franjas de Wallet (en P3, por defecto en iOS, el zafiro se veía verdoso).
    <Canvas style={ANDROID ? LIENZO_ANDROID : StyleSheet.absoluteFill} onSize={tam} colorSpace="srgb" pointerEvents="none">
      <Fill><Shader source={efecto} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}
