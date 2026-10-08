// La luz de la tarjeta de socio, dibujada con Skia en el hilo de la interfaz:
//
//   · un HOLOGRAMA: un arcoíris tenue que se corre con la inclinación, en modo
//     de mezcla «overlay», como el sello de una tarjeta de verdad;
//   · un DESTELLO: una luz redonda que sigue al ángulo del teléfono (o del
//     dedo), donde la tarjeta «refleja» el techo;
//   · un BARRIDO: una franja de luz que cruza sola cada pocos segundos, para
//     que la tarjeta se vea viva aunque el teléfono esté quieto.
//
// `x` e `y` van de −1 a 1 (ya suavizados por quien llama); `barrido` de 0 a 1.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, LinearGradient, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

const ARCOIRIS = [
  'rgba(255,0,128,0)', 'rgba(255,90,90,0.35)', 'rgba(255,214,10,0.35)', 'rgba(142,255,120,0.35)',
  'rgba(90,200,250,0.35)', 'rgba(175,82,222,0.35)', 'rgba(255,0,128,0)',
];

// `sinArcoiris`: sobre una tarjeta de material (2026-10-08) el holograma la
// teñía (el zafiro salía verdoso); el material ya trae su propia luz.
export default function BrilloTarjeta({ x, y, barrido, sinArcoiris = false }) {
  const [t, setT] = useState({ w: 0, h: 0 });
  const { w, h } = t;

  const holoInicio = useDerivedValue(() => vec(w * (-0.6 + x.value * 0.8), h * (-0.4 + y.value * 0.6)));
  const holoFin = useDerivedValue(() => vec(w * (1.6 + x.value * 0.8), h * (1.4 + y.value * 0.6)));
  const centro = useDerivedValue(() => vec(w * (0.5 + x.value * 0.7), h * (0.35 + y.value * 0.7)));
  const radio = useDerivedValue(() => w * (0.55 + Math.abs(x.value) * 0.25));
  const barridoInicio = useDerivedValue(() => vec(w * (-1 + barrido.value * 2.6), 0));
  const barridoFin = useDerivedValue(() => vec(w * (-0.6 + barrido.value * 2.6), h));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}
      onLayout={(e) => setT({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w ? (
        <Canvas style={StyleSheet.absoluteFill}>
          {!sinArcoiris ? (
            <Rect x={0} y={0} width={w} height={h} blendMode="overlay">
              <LinearGradient start={holoInicio} end={holoFin} colors={ARCOIRIS} />
            </Rect>
          ) : null}
          <Rect x={0} y={0} width={w} height={h} blendMode="screen">
            <RadialGradient c={centro} r={radio} colors={['rgba(255,255,255,0.42)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']} positions={[0, 0.45, 1]} />
          </Rect>
          <Rect x={0} y={0} width={w} height={h} blendMode="screen">
            <LinearGradient start={barridoInicio} end={barridoFin}
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']} positions={[0.35, 0.5, 0.65]} />
          </Rect>
        </Canvas>
      ) : null}
    </View>
  );
}
