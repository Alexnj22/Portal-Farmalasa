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
// 1 = velo con los colores de la marca; 0 = del mismo material, sólo relieve.
uniform float conColor;
float alto(float2 p, float e) {
  // Alfa suavizado: promedio en cruz, para que el bisel sea redondo y no un filo.
  return (logo.eval(p).a * 2.0 + logo.eval(p + float2(e, 0)).a + logo.eval(p - float2(e, 0)).a
        + logo.eval(p + float2(0, e)).a + logo.eval(p - float2(0, e)).a) / 6.0;
}
half4 main(float2 p) {
  // ACUÑADO dentro del material (2026-10-09, «que se fusione con el efecto de
  // la tarjeta, como si estuviera dentro»): la cara del logo deja ver el
  // material con un velo de los colores de la marca, y el relieve sale sólo
  // de luz y sombra en el bisel —que se mueven con la inclinación—.
  float e = max(1.0, res.x * 0.02);
  half4 c = logo.eval(p);
  float a = c.a;
  float3 marca = a > 0.001 ? c.rgb / a : float3(0.0);
  float2 g = float2(alto(p - float2(e, 0), e) - alto(p + float2(e, 0), e),
                    alto(p - float2(0, e), e) - alto(p + float2(0, e), e));
  float2 luz2 = normalize(float2(-0.5 + tilt.x * 1.2, -0.7 + tilt.y * 1.2));
  float borde = dot(g, luz2) * 2.6;
  float brilloB = clamp(borde, 0.0, 1.0);
  float sombraB = clamp(-borde, 0.0, 1.0);
  // Un reflejo que cruza la cara al inclinar.
  float2 uv = p / res;
  float v = (uv.x + uv.y * 0.6 - (0.75 + tilt.x * 0.9)) * 4.0;
  float barra = exp(-v * v) * a;
  // Capas premultiplicadas: velo de marca, sombra del bisel, luz del bisel.
  float aVelo = a * 0.62 * conColor;
  float3 col = marca * aVelo;
  float alf = aVelo;
  // Sin color (conColor = 0): la cara apenas más clara que el material, como
  // metal repujado, y el bisel más marcado para que el relieve se lea solo.
  float lift = a * 0.10 * (1.0 - conColor);
  col = col + float3(1.0) * lift; alf = alf + lift * (1.0 - alf);
  float aSom = sombraB * mix(0.80, 0.55, conColor);
  col = col * (1.0 - aSom); alf = alf + aSom * (1.0 - alf);
  float luzT = clamp(brilloB * 0.75 + barra * 0.25, 0.0, 1.0);
  col = col + float3(1.0) * luzT * (1.0 - alf * 0.3); alf = max(alf, luzT);
  return half4(col, alf);
}`;

let efecto;
function efectoLogo() {
  if (efecto === undefined) {
    try { efecto = Skia.RuntimeEffect.Make(SKSL); } catch { efecto = null; }
  }
  return efecto;
}

const FUENTE = require('../../assets/icono.png');

export default function LogoEnRelieve({ tam, x, y, estilo = 'color' }) {
  const img = useImage(FUENTE);
  const fx = efectoLogo();
  const uniforms = useDerivedValue(() => ({
    res: [tam, tam],
    tilt: [x ? x.value : 0, y ? y.value : 0],
    conColor: estilo === 'material' ? 0 : 1,
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
