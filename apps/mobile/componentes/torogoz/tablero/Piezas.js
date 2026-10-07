// Las piezas del Inicio de Torogoz: la dona de participación (las rutas, los
// tipos de cliente), la fila de ranking con su barra proporcional, la barra
// apilada de las formas de pago y la variación contra el período anterior.
// Mismo gesto que el portal: tocar un sector o una fila filtra por esa ruta o
// ese vendedor; tocarlo otra vez suelta el filtro.
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { G, Path } from 'react-native-svg';
import { formatMoney, formatMoneyCorto } from '@nucleo/utils/formatNumber';
import { variacionPct } from '@nucleo/utils/distribucionTablero';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';

/** La paleta del tablero, por posición: la misma lista que la dona y sus filas. */
export const PALETA = ['#0f6e7d', MARCA.verde, '#6929C4', '#1192E8', '#FA4D56', '#B28600', MARCA.ambar, '#8D8D99'];
export const colorDe = (i) => PALETA[i % PALETA.length];

const tocar = (fn) => () => { Haptics.selectionAsync().catch(() => {}); fn(); };

/** «+12.4% vs. anterior», en verde o rojo; «sin período anterior» si no hay con qué comparar. */
export function Variacion({ actual, antes }) {
  const v = variacionPct(actual, antes);
  if (v == null) return <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>sin período anterior</Text>;
  const sube = v >= 0;
  return (
    <Text style={{ color: sube ? MARCA.verde : MARCA.rojo, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
      {sube ? '▲ +' : '▼ '}{v.toFixed(1)}%<Text style={{ color: colorSistema.texto2, fontWeight: '400' }}> vs. anterior</Text>
    </Text>
  );
}

function arco(cx, cy, rExt, rInt, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(rExt, a0);
  const [x1, y1] = p(rExt, a1);
  const [x2, y2] = p(rInt, a1);
  const [x3, y3] = p(rInt, a0);
  return `M${x0},${y0} A${rExt},${rExt} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${rInt},${rInt} 0 ${grande} 0 ${x3},${y3} Z`;
}

/**
 * Una dona de participación. `datos`: [{ [clave], [valor] }]. Con `onElegir`,
 * tocar un sector lo elige y otro toque lo suelta. En el centro, el sector
 * elegido o el total.
 */
export function Dona({ datos = [], clave, valor = 'ventas', activo = null, onElegir, tamano = 170, rotulo = (x) => x }) {
  const filas = datos.map((d) => ({ ...d, v: Number(d[valor]) || 0 })).filter((d) => d.v > 0);
  const total = filas.reduce((s, d) => s + d.v, 0);
  const [aparece] = useState(() => new Animated.Value(0));
  useEffect(() => { Animated.timing(aparece, { toValue: 1, duration: 420, useNativeDriver: true }).start(); }, [aparece]);
  const r = tamano / 2;
  const hueco = 0.025;
  let a = 0;
  const elegida = filas.find((d) => d[clave] === activo);
  if (!total) {
    return (
      <View style={{ width: tamano, height: tamano, borderRadius: r, borderWidth: tamano * 0.13, borderColor: 'rgba(127,127,127,0.15)', alignSelf: 'center' }} />
    );
  }
  return (
    <Animated.View style={{ width: tamano, height: tamano, alignSelf: 'center', opacity: aparece, transform: [{ scale: aparece.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
      <Svg width={tamano} height={tamano}>
        <G>
          {filas.map((d, i) => {
            const barrido = (d.v / total) * Math.PI * 2;
            const a0 = a + (filas.length > 1 ? hueco : 0);
            const a1 = a + barrido - (filas.length > 1 ? hueco : 0);
            a += barrido;
            const color = colorDe(datos.findIndex((x) => x[clave] === d[clave]));
            const apagado = activo && activo !== d[clave];
            const elegir = onElegir ? tocar(() => onElegir(d[clave] === activo ? null : d[clave])) : undefined;
            return (
              <Path key={String(d[clave])} d={filas.length === 1 ? arco(r, r, r, r * 0.6, 0, Math.PI * 2 - 0.0001) : arco(r, r, activo === d[clave] ? r : r - 4, r * 0.6, a0, Math.max(a0 + 0.01, a1))}
                fill={color} opacity={apagado ? 0.3 : 1} onPress={elegir} />
            );
          })}
        </G>
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tamano * 0.22 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{elegida ? rotulo(elegida[clave]) : 'Total'}</Text>
        <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1} adjustsFontSizeToFit>
          {formatMoneyCorto(elegida ? elegida.v : total)}
        </Text>
        {elegida ? <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>{`${Math.round((elegida.v / total) * 100)}%`}</Text> : null}
      </View>
    </Animated.View>
  );
}

/** Una fila de ranking: lo de la izquierda, título, valor y una barra proporcional. Tocable si `onPress`. */
export function FilaRanking({ izquierda, titulo, detalle, valor, proporcion = 0, activo = false, onPress, color = '#0f6e7d', primero = false }) {
  return (
    <Pressable onPress={onPress ? tocar(onPress) : undefined} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: activo } : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: activo ? 8 : 0,
        borderRadius: 12, backgroundColor: activo ? `${color}26` : 'transparent', borderTopWidth: primero || activo ? 0 : 0.5,
        borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1, minHeight: 44 })}>
      {izquierda}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{titulo}</Text>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
          <View style={{ height: 6, borderRadius: 3, width: `${Math.max(2, Math.round(proporcion * 100))}%`, backgroundColor: color }} />
        </View>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{detalle}</Text> : null}
      </View>
    </Pressable>
  );
}

/** El número de posición de un ranking (1, 2, 3…). */
export function Puesto({ n }) {
  return <Text style={{ width: 20, textAlign: 'right', color: colorSistema.texto2, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n}</Text>;
}

/** El punto de color de una categoría. */
export function Punto({ color, tamano = 10 }) {
  return <View style={{ width: tamano, height: tamano, borderRadius: tamano / 2, backgroundColor: color }} />;
}

/** Las formas de pago: una barra apilada (el ancho de cada tramo ES la proporción) y su leyenda. */
export function FormasDePago({ reparto = [] }) {
  if (!reparto.length) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin cobros en el período.</Text>;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, backgroundColor: 'rgba(127,127,127,0.13)' }}>
        {reparto.map((f, i) => <View key={f.forma} style={{ width: `${f.proporcion * 100}%`, backgroundColor: colorDe(i) }} />)}
      </View>
      {reparto.map((f, i) => (
        <View key={f.forma} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Punto color={colorDe(i)} />
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{f.rotulo}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14, fontVariant: ['tabular-nums'] }}>{`${formatMoney(f.monto)} · ${f.pct}%`}</Text>
        </View>
      ))}
    </View>
  );
}
