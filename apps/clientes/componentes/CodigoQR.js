// El QR NÍTIDO (2026-10-14, «el código sale un poco pixeleado», iPhone 17 Pro
// Max a 3×). `react-native-qrcode-svg` dibuja cada fila como una línea con
// `strokeWidth` = tamaño / módulos: el QR de la tarjeta son 33 módulos en
// 118 pt → 3,576 pt = 10,73 px por módulo. Ningún borde caía en un píxel
// entero, así que cada uno salía suavizado (gris) y entre filas vecinas
// quedaba una costura: a la vista, un código borroso; al lector, menos
// contraste.
//
// Aquí el módulo mide un número ENTERO de píxeles físicos
// (`floor(tam × PixelRatio / módulos)`) y el dibujo se hace en píxeles: el
// `viewBox` está en píxeles y el `Svg` mide exactamente eso dividido entre la
// densidad, así que cada borde cae justo en el borde de un píxel (Yoga ya
// redondea la posición de la vista a la grilla de píxeles). Rectángulos
// rellenos —una corrida por fila— en un solo `Path`, sin trazos: no hay
// costuras. El QR queda unos puntos más chico que `tam` (nunca más grande),
// y la zona blanca alrededor la sigue poniendo quien lo monta.
//
// Costo: el mismo de antes —un `Path` estático que se calcula una vez por
// código (`useMemo`)—; no se redibuja con el giro ni con la inclinación.
import { useMemo } from 'react';
import { PixelRatio, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import genMatrix from 'react-native-qrcode-svg/src/genMatrix';

export default function CodigoQR({ value, size = 118, color = '#000000', backgroundColor = '#FFFFFF', ecl = 'M' }) {
  const qr = useMemo(() => {
    try {
      const matriz = genMatrix(String(value), ecl);
      const n = matriz.length;
      const densidad = PixelRatio.get();
      const modulo = Math.max(1, Math.floor((size * densidad) / n));
      let d = '';
      for (let i = 0; i < n; i++) {
        const fila = matriz[i];
        let j = 0;
        while (j < n) {
          if (!fila[j]) { j++; continue; }
          const ini = j;
          while (j < n && fila[j]) j++;
          d += `M${ini * modulo} ${i * modulo}h${(j - ini) * modulo}v${modulo}h${-(j - ini) * modulo}z`;
        }
      }
      const px = n * modulo;
      return { d, px, pt: px / densidad };
    } catch {
      return null;
    }
  }, [value, size, ecl]);
  if (!qr) return <View style={{ width: size, height: size, backgroundColor }} />;
  return (
    <Svg width={qr.pt} height={qr.pt} viewBox={`0 0 ${qr.px} ${qr.px}`}>
      <Rect x={0} y={0} width={qr.px} height={qr.px} fill={backgroundColor} />
      <Path d={qr.d} fill={color} />
    </Svg>
  );
}
