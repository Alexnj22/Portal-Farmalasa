// El material de la tarjeta (2026-10-08): un shader de Skia por nivel o rango
// (componentes/minerales/shaders.js), vivo — la luz, las facetas y el
// arcoíris siguen la inclinación del teléfono y el dedo, y los destellos
// titilan. Es la misma fuente que genera las franjas de Apple Wallet.
//
// Sólo corre el reloj con la tarjeta a la vista (`activa`): fuera de pantalla
// el material queda quieto y no gasta batería. Si el shader no compilara,
// no dibuja nada y queda el degradado de debajo.
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
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

export default function Mineral({ material, x, y, activa = true }) {
  const efecto = efectoDe(material);
  const tam = useSharedValue({ width: 0, height: 0 });
  const t = useSharedValue(3);
  const reloj = useFrameCallback((f) => {
    t.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
  }, false);
  useEffect(() => { reloj.setActive(!!activa); }, [activa, reloj]);
  const uniforms = useDerivedValue(() => ({
    res: [Math.max(1, tam.value.width), Math.max(1, tam.value.height)],
    t: t.value,
    tilt: [x ? x.value : 0, y ? y.value : 0],
  }));
  if (!efecto) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} onSize={tam} pointerEvents="none">
      <Fill><Shader source={efecto} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}
