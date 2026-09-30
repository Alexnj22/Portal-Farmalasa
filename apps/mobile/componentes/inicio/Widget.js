// Las piezas comunes de los widgets del Inicio — el equivalente nativo del
// `WidgetCard` del tablero del portal. Todos los widgets se arman con esto, para
// que se vean y se toquen igual:
//
//   · `Widget`   — la tarjeta de vidrio con su encabezado: el ícono en un cuadro
//                  de color, el título, un contador opcional y «Ver todo ›».
//                  Tocar el encabezado abre el módulo; el cuerpo decide solo.
//   · `Renglon`  — una fila de lista (ícono o foto, título, detalle, lo de la
//                  derecha y «›» si se puede tocar).
//   · `Vacio`    — lo que dice un widget sin nada, en una línea y sin drama.
//   · `Esqueleto`— las barras grises mientras llega el dato: un widget que
//                  aparece de golpe empuja todo lo de abajo.
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

const tocar = (fn) => (fn ? () => { Haptics.selectionAsync().catch(() => {}); fn(); } : undefined);

export function Chip({ icono, color, tamano = 26 }) {
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: tamano * 0.3, backgroundColor: `${color}2E`, alignItems: 'center', justifyContent: 'center' }}>
      <Host matchContents><Icon name={iconoDe(icono)} size={tamano * 0.58} color={color} /></Host>
    </View>
  );
}

export function Cuenta({ n, color }) {
  if (!n) return null;
  return (
    <View style={{ minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: color }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] }}>{n > 99 ? '99+' : n}</Text>
    </View>
  );
}

export default function Widget({ titulo, icono, color, cuenta, onAbrir, accion = 'Ver todo', children, relleno = true }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={22}>
        <Pressable onPress={tocar(onAbrir)} disabled={!onAbrir}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 9, opacity: pressed ? 0.6 : 1 })}>
          <Chip icono={icono} color={color} />
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{titulo}</Text>
          <Cuenta n={cuenta} color={color} />
          {onAbrir ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{accion} ›</Text> : null}
        </Pressable>
        <View style={relleno ? { paddingHorizontal: 14, paddingBottom: 14 } : { paddingBottom: 6 }}>{children}</View>
      </Vidrio>
    </View>
  );
}

export function Renglon({ izquierda, titulo, detalle, derecha, colorDerecha, onPress, primero = false, lineas = 1 }) {
  return (
    <Pressable onPress={tocar(onPress)} disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
      {izquierda}
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '500' }} numberOfLines={lineas}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{detalle}</Text> : null}
      </View>
      {derecha == null ? null : typeof derecha === 'string' || typeof derecha === 'number' ? (
        <Text style={{ color: colorDerecha ?? colorSistema.texto2, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{derecha}</Text>
      ) : derecha}
      {onPress ? <Text style={{ color: colorSistema.texto2, fontSize: 18, fontWeight: '300' }}>›</Text> : null}
    </Pressable>
  );
}

export function Vacio({ texto, bien = false }) {
  return (
    <Text style={{ color: bien ? '#12B76A' : colorSistema.texto2, fontSize: 15, paddingVertical: 4 }}>
      {texto}{bien ? ' ✓' : ''}
    </Text>
  );
}

export function Esqueleto({ lineas = 3 }) {
  const v = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.7, duration: 650, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  return (
    <View style={{ gap: 10, paddingVertical: 4 }}>
      {Array.from({ length: lineas }).map((_, i) => (
        <Animated.View key={i} style={{ height: 14, width: `${90 - i * 18}%`, borderRadius: 7, backgroundColor: 'rgba(127,127,127,0.35)', opacity: v }} />
      ))}
    </View>
  );
}
