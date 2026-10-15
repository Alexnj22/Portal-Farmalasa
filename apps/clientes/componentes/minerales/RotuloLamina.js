// El rótulo del nivel en LÁMINA (2026-10-14, Platino: «que se vea más
// exclusiva»). Las letras se pintan con Skia y su relleno es un degradado de
// metal con un arcoíris tenue que corre con la inclinación, como el foil
// estampado de una tarjeta de verdad; debajo, una sombra de 1 pt hace de
// relieve. Lienzo chico (el ancho del rótulo): no cuesta lo que el material.
//
// Si la fuente del sistema no se resuelve, queda el texto plano de siempre.
import { memo, useMemo } from 'react';
import { Platform, Text } from 'react-native';
import { Canvas, Group, LinearGradient, matchFont, Text as TextoSkia, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

const FAMILIA = Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' });
const LAMINA = ['#8E96A3', '#F4F7FB', '#B9C7E6', '#FFFFFF', '#E4C9F0', '#9AA2AF', '#F2F5FA'];

function RotuloLamina({ texto, tam = 15, espacio = 3, x, y, estiloRespaldo }) {
  const fuente = useMemo(() => {
    try { return matchFont({ fontFamily: FAMILIA, fontSize: tam, fontWeight: '900' }); } catch { return null; }
  }, [tam]);
  const letras = useMemo(() => {
    if (!fuente) return null;
    // Arranca en 1.5 pt y el lienzo sobra 3 pt (2026-10-14): en peso 900 la
    // «P» y la «O» sobresalen de su avance y el lienzo justo las recortaba.
    let cx = 1.5;
    return String(texto).split('').map((l) => {
      const p = { l, x: cx };
      cx += fuente.getTextWidth(l) + espacio;
      return p;
    }).concat([{ fin: cx - espacio }]);
  }, [fuente, texto, espacio]);
  const ancho = letras ? Math.ceil(letras[letras.length - 1].fin) + 3 : 0;
  const alto = Math.ceil(tam * 1.3);
  const ini = useDerivedValue(() => vec(-ancho * (0.8 - (x ? x.value : 0) * 0.7), 0));
  const fin = useDerivedValue(() => vec(ancho * (1.8 + (x ? x.value : 0) * 0.7), alto * (1 + (y ? y.value : 0))));
  if (!fuente || !letras || !ancho) return <Text maxFontSizeMultiplier={1.3} style={estiloRespaldo}>{texto}</Text>;
  const base = Math.round(tam * 1.02);
  const glifos = letras.slice(0, -1);
  return (
    <Canvas style={{ width: ancho, height: alto }} pointerEvents="none" accessible={false}>
      {/* La sombra del estampado: 1 pt abajo, oscura. */}
      <Group opacity={0.55}>
        {glifos.map((g, i) => <TextoSkia key={`s${i}`} x={g.x + 0.5} y={base + 1} text={g.l} font={fuente} color="#000000" />)}
      </Group>
      {glifos.map((g, i) => (
        <TextoSkia key={i} x={g.x} y={base} text={g.l} font={fuente}>
          <LinearGradient start={ini} end={fin} colors={LAMINA} />
        </TextoSkia>
      ))}
    </Canvas>
  );
}

export default memo(RotuloLamina);
