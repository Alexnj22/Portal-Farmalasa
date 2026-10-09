// El sello de Equipo (2026-10-08): el personal lleva la tarjeta de SU nivel de
// cliente o de su rango de mayorista —el material lo da eso— y encima este
// sello, como la lámina holográfica de seguridad de un documento. Tornasol que
// cambia de color con la inclinación, con líneas de difracción finas y un
// destello que lo cruza.
import { Text, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useEffect } from 'react';
import LogoEnRelieve from './LogoEnRelieve';

const SKSL = `
uniform float2 res;
uniform float2 tilt;
uniform float t;
float3 tono(float h) {
  return clamp(abs(fract(h + float3(0.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
half4 main(float2 p) {
  float2 uv = p / res;
  float ang = uv.x * 0.7 + uv.y * 0.4 + tilt.x * 1.3 - tilt.y * 0.7 + t * 0.03;
  // Base perla plateada, con el tornasol apenas teñido encima.
  float3 perla = mix(float3(0.80, 0.80, 0.86), float3(0.95, 0.95, 0.98), uv.y);
  float3 iris = mix(perla, tono(ang) * 0.5 + 0.5, 0.42);
  // Líneas de difracción finas, sutiles.
  float r = length(p - float2(-res.x * 0.3, res.y * 1.4));
  float lineas = 0.5 + 0.5 * sin(r * 2.2);
  iris = mix(iris, tono(ang + 0.3) * 0.5 + 0.5, lineas * 0.12);
  // Un destello que cruza con la inclinación (al cuadrado con v*v: pow con base negativa corta duro).
  float v = (uv.x - uv.y * 0.5 - (0.3 + tilt.x * 1.2 + sin(t * 0.6) * 0.15)) * 4.0;
  float barra = exp(-v * v);
  return half4(iris + float3(1.0) * barra * 0.2, 1.0);
}`;

let efecto;
const efectoSello = () => {
  if (efecto === undefined) { try { efecto = Skia.RuntimeEffect.Make(SKSL); } catch { efecto = null; } }
  return efecto;
};

export default function SelloEquipo({ x, y, activa = true, ancho = 74, alto = 30 }) {
  const fx = efectoSello();
  const t = useSharedValue(0);
  const reloj = useFrameCallback((f) => { t.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000); }, false);
  useEffect(() => { reloj.setActive(!!activa); }, [activa, reloj]);
  const uniforms = useDerivedValue(() => ({ res: [ancho, alto], tilt: [x ? x.value : 0, y ? y.value : 0], t: t.value }));
  return (
    <View style={{ width: ancho, height: alto, borderRadius: 8, overflow: 'hidden', backgroundColor: '#D9D4E8',
      borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.7)' }}>
      {fx ? (
        <Canvas style={{ position: 'absolute', width: ancho, height: alto }} pointerEvents="none">
          <Fill><Shader source={fx} uniforms={uniforms} /></Fill>
        </Canvas>
      ) : null}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <LogoEnRelieve tam={alto * 0.56} x={x} y={y} />
        <Text maxFontSizeMultiplier={1} style={{ fontSize: alto * 0.36, fontWeight: '900', letterSpacing: 1.2, color: 'rgba(30,20,45,0.78)' }}>EQUIPO</Text>
      </View>
    </View>
  );
}
