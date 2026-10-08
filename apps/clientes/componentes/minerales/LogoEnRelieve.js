// El logo acuñado en la tarjeta (2026-10-08, «que se vea en relieve del
// material y se mueva al inclinar»). Un shader lee el contorno del logo (su
// canal alfa) como un mapa de alturas: calcula la normal de cada borde, lo
// ilumina con una luz que sigue la inclinación del teléfono y el dedo, le pone
// un brillo especular y proyecta su sombra al lado contrario. La cara conserva
// los colores de la marca, para que se lea sobre cualquier material.
//
// Si el shader no compila o la imagen no carga, queda el logo plano.
import { Image, View } from 'react-native';
import { Canvas, Fill, ImageShader, Shader, Skia, useImage } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

const SKSL = `
uniform shader logo;
uniform float2 res;
uniform float2 tilt;
float alto(float2 p, float e) {
  // Alfa suavizado: promedio en cruz, para que el bisel sea redondo y no un filo.
  return (logo.eval(p).a * 2.0 + logo.eval(p + float2(e, 0)).a + logo.eval(p - float2(e, 0)).a
        + logo.eval(p + float2(0, e)).a + logo.eval(p - float2(0, e)).a) / 6.0;
}
half4 main(float2 p) {
  float e = max(1.0, res.x * 0.018);
  half4 c = logo.eval(p);
  float2 g = float2(alto(p - float2(e, 0), e) - alto(p + float2(e, 0), e),
                    alto(p - float2(0, e), e) - alto(p + float2(0, e), e));
  float3 n = normalize(float3(g * 2.2, 0.55));
  float3 luz = normalize(float3(-0.45 + tilt.x * 1.1, -0.65 + tilt.y * 1.1, 0.75));
  float dif = clamp(dot(n, luz), 0.0, 1.0);
  float3 r = reflect(-luz, n);
  float spec = pow(max(r.z, 0.0), 22.0);
  // Un reflejo ancho que cruza la cara con la inclinación, como un esmalte.
  float2 uv = p / res;
  float barra = exp(-pow((uv.x + uv.y * 0.6 - (0.75 + tilt.x * 0.9)) * 4.0, 2.0));
  float3 cara = c.rgb * (0.62 + 0.55 * dif) + float3(1.0) * (spec * 0.9 + barra * 0.22) * c.a;
  // La sombra: el logo corrido al lado contrario de la luz, difuso.
  float2 corre = float2(-luz.x, -luz.y) * res.x * 0.045 + float2(0.0, res.x * 0.02);
  float sombra = alto(p - corre, e * 2.0) * 0.55;
  float a = c.a;
  return half4(cara * a + float3(0.0) * (1.0 - a), a + sombra * (1.0 - a));
}`;

let efecto;
function efectoLogo() {
  if (efecto === undefined) {
    try { efecto = Skia.RuntimeEffect.Make(SKSL); } catch { efecto = null; }
  }
  return efecto;
}

const FUENTE = require('../../assets/icono.png');

export default function LogoEnRelieve({ tam, x, y }) {
  const img = useImage(FUENTE);
  const fx = efectoLogo();
  const uniforms = useDerivedValue(() => ({
    res: [tam, tam],
    tilt: [x ? x.value : 0, y ? y.value : 0],
  }));
  if (!fx || !img) {
    return <View style={{ width: tam, height: tam }}><Image source={FUENTE} style={{ width: tam, height: tam }} /></View>;
  }
  // Margen para la sombra: el lienzo es un poco más grande que el logo.
  const m = Math.round(tam * 0.12);
  return (
    <View style={{ width: tam, height: tam }}>
      <Canvas style={{ position: 'absolute', left: -m, top: -m, width: tam + m * 2, height: tam + m * 2 }} pointerEvents="none">
        <Fill>
          <Shader source={fx} uniforms={uniforms}>
            <ImageShader image={img} fit="contain" rect={{ x: m, y: m, width: tam, height: tam }} tx="decal" ty="decal" />
          </Shader>
        </Fill>
      </Canvas>
    </View>
  );
}
