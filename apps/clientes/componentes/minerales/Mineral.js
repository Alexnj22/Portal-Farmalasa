// El material de la tarjeta (2026-10-08): un shader de Skia por nivel o rango
// (componentes/minerales/shaders.js), vivo — la luz, las facetas y el
// arcoíris siguen la inclinación del teléfono y el dedo, y los destellos
// titilan. Es la misma fuente que genera las franjas de Apple Wallet.
//
// Sólo corre el reloj con la tarjeta a la vista (`activa`): fuera de pantalla
// el material queda quieto y no gasta batería. Si el shader no compilara,
// no dibuja nada y queda el degradado de debajo.
import { memo, useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Canvas, Group, Rect, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { PRELUDIO, SHADERS } from './shaders';
import { LIVIANO } from '../../lib/rendimiento';

const cache = {};
function efectoDe(material) {
  if (!(material in cache)) {
    try { cache[material] = SHADERS[material] ? Skia.RuntimeEffect.Make(PRELUDIO + SHADERS[material]) : null; }
    catch { cache[material] = null; }
  }
  return cache[material];
}

export const MATERIALES = Object.keys(SHADERS);

// Android (2026-10-13, «es lenta»; ajustado el 2026-10-14, ver `ESCALA`): el shader se calculaba a MEDIA resolución
// —un cuarto de los píxeles— y el lienzo se estira al doble; y el reloj avanza
// a 30 cuadros por segundo en vez de 60. Los materiales se miden en `p / res`,
// así que se ven iguales, apenas más suaves; en la GPU de un Android de gama
// media es la diferencia entre trabarse y no. Los textos y el logo van en sus
// propias capas encima y siguen nítidos.
const ANDROID = Platform.OS === 'android';
// Nitidez (2026-10-14, «que todo en la card se vea ultra nítido»): la media
// resolución se queda SÓLO donde hace falta. En modo liviano el material no se
// anima —se dibuja una vez y queda quieto (lib/rendimiento.js)—, así que
// dibujarlo entero cuesta un solo cuadro y no tiene sentido estirarlo. Con el
// material vivo, 3/4 de resolución en vez de 1/2: las aristas finas de las
// facetas y los destellos ya no salen escalonados (56 % de los píxeles contra
// el 25 % de antes y el 100 % de iOS). Los textos, el logo, el filo y el QR van
// en sus propias capas a la resolución del teléfono, como siempre.
const ESCALA = ANDROID && !LIVIANO ? 0.75 : 1;

// Margen de sobra (2026-10-14, Platino: «al girar se ve cortada, no cubre todo
// ni el efecto de movimiento»). El lienzo era EXACTAMENTE la tarjeta, y en
// Android medía la mitad y se estiraba al doble desde la esquina: la mitad de
// un ancho impar se redondea a píxeles y, al duplicarla, quedaba una franja de
// 1–2 px sin material a la derecha y abajo —el degradado de debajo asomaba
// como un filo—, y el estirado dependía de `transformOrigin`. Además, recién
// montado el lienzo no conocía su tamaño y dibujaba un cuadro con `res` = 1×1.
// Ahora:
//   · el lienzo sobra un 6 % por cada lado (12 % más grande), centrado; la
//     máscara redondeada de la cara recorta lo que sobra, así que ningún
//     redondeo ni ningún corrimiento deja ver un borde;
//   · las coordenadas del shader siguen siendo las de la TARJETA (`res` es la
//     tarjeta y el origen se corre al margen): el bisel del canto cae justo en
//     el borde de la cara, como antes;
//   · en Android la escala es alrededor del centro (sin `transformOrigin`);
//   · no se dibuja nada hasta conocer el tamaño.
const SOBRA = 0.06;

// `pausa` (valor compartido, 2026-10-15): mientras vale `true` —la pantalla se
// desplaza— el reloj no avanza y el lienzo no se redibuja. Es un valor del
// hilo de la interfaz y no una prop booleana: así el desplazamiento no vuelve
// a pintar a nadie con React (componentes/movimiento.js, `useMoviendoValor`).
//
// `luzSola` (el cupón, 2026-10-15): sin giroscopio, la luz va y viene sola
// sobre el material. Antes eran dos `withRepeat` que cambiaban en CADA cuadro
// de la pantalla —60 a 120 por segundo— y, como son uniformes del shader,
// redibujaban el material saltándose este reloj de 30. Ahora la luz sale del
// mismo reloj `t`, con la misma curva: un `Easing.inOut(sin)` de ida y vuelta
// es exactamente un coseno (x: ±0.6 cada 4.2 s; y: ±0.3 cada 5.6 s, y arranca
// donde arrancaba, en −0.6 / 0.3).
function Mineral({ material, x, y, activa = true, pausa = null, luzSola = false }) {
  const efecto = efectoDe(material);
  const [caja, setCaja] = useState(null);
  const tam = useSharedValue({ width: 1, height: 1 });
  const t = useSharedValue(3);
  const cuadro = useSharedValue(0);
  // El reloj del material se publica a 30 cuadros por segundo en los DOS
  // sistemas (2026-10-14, «se calienta»): en un iPhone con ProMotion corría a
  // 120 y el shader entero se recalculaba 120 veces por segundo para que unos
  // destellos titilen. Se acumula y se publica cada 1/30 s; el lienzo sólo se
  // redibuja cuando cambia `t` (o la inclinación, que va por su lado).
  const reloj = useFrameCallback((f) => {
    if (pausa && pausa.value) return;
    const paso = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    cuadro.value += paso;
    if (cuadro.value >= 0.032) { t.value += cuadro.value; cuadro.value = 0; }
  }, false);
  useEffect(() => { reloj.setActive(!!activa); }, [activa, reloj]);
  const uniforms = useDerivedValue(() => ({
    res: [Math.max(1, tam.value.width), Math.max(1, tam.value.height)],
    t: t.value,
    tilt: luzSola
      ? [-0.6 * Math.cos((Math.PI * (t.value - 3)) / 4.2), 0.3 * Math.cos((Math.PI * (t.value - 3)) / 5.6)]
      : [x ? x.value : 0, y ? y.value : 0],
  }));
  if (!efecto) return null;
  const alMedir = (e) => {
    const { width, height } = e.nativeEvent.layout;
    if (!width || !height) return;
    if (caja && Math.abs(caja.w - width) < 0.5 && Math.abs(caja.h - height) < 0.5) return;
    tam.value = { width, height };
    setCaja({ w: width, h: height });
  };
  let lienzo = null;
  if (caja) {
    const m = Math.ceil(Math.max(caja.w, caja.h) * SOBRA);
    const W = caja.w + 2 * m;
    const H = caja.h + 2 * m;
    // Android con material vivo: el lienzo mide `ESCALA` del tamaño y se
    // estira alrededor de SU centro, que se coloca en el centro de la tarjeta.
    const k = ESCALA;
    const estilo = k < 1
      ? { position: 'absolute', left: caja.w / 2 - (W * k) / 2, top: caja.h / 2 - (H * k) / 2, width: W * k, height: H * k, transform: [{ scale: 1 / k }] }
      : { position: 'absolute', left: -m, top: -m, width: W, height: H };
    lienzo = (
      // sRGB: el mismo espacio de color con que se diseñó y con que salen las
      // franjas de Wallet (en P3, por defecto en iOS, el zafiro se veía verdoso).
      <Canvas style={estilo} colorSpace="srgb" pointerEvents="none">
        <Group transform={[{ scale: k }, { translateX: m }, { translateY: m }]}>
          <Rect x={-m} y={-m} width={W} height={H}>
            <Shader source={efecto} uniforms={uniforms} />
          </Rect>
        </Group>
      </Canvas>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={alMedir}>
      {lienzo}
    </View>
  );
}

// Memorizado (2026-10-15): sus props son valores compartidos y constantes; que
// la tarjeta se repinte no tiene por qué rehacer el lienzo.
export default memo(Mineral);
