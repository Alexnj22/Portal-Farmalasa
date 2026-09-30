// Un número del día, como un widget pequeño de iOS (pedido del usuario del
// 2026-09-30: «los elementos son como widgets, deben ser interactivos»):
// arriba el ícono y el rótulo —con «›» si abre algo—, el número grande, una
// línea de apoyo y, si la hay, una forma que se lee de un vistazo (la curva
// de ventas del día, la barra de cuántos llegaron). Si pide acción (`pide`),
// el número toma el color de estado. En vidrio sobre la aurora.
import { Pressable, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { iconoDe } from '../../tema/iconos';

export default function Kpi({ icono, rotulo, valor, apoyo, color, pide = false, onPress, visual }) {
  return (
    <Pressable style={{ flex: 1 }} disabled={!onPress}
      onPress={onPress ? () => { Haptics.selectionAsync().catch(() => {}); onPress(); } : undefined}>
      {({ pressed }) => (
        <Vidrio radio={22} interactivo={!!onPress} style={{ transform: [{ scale: pressed ? 0.97 : 1 }] }}>
          <View style={{ padding: 14, gap: 4, minHeight: 112 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: `${color}2E`, alignItems: 'center', justifyContent: 'center' }}>
                <Host matchContents><Icon name={iconoDe(icono)} size={14} color={color} /></Host>
              </View>
              <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{rotulo}</Text>
              {onPress ? <Text style={{ color: colorSistema.texto2, fontSize: 17, fontWeight: '300', marginTop: -2 }}>›</Text> : null}
            </View>
            <Text style={{ color: pide ? color : colorSistema.texto, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, fontVariant: ['tabular-nums'], marginTop: 6 }}
              numberOfLines={1} adjustsFontSizeToFit>{valor}</Text>
            {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{apoyo}</Text> : null}
            {visual ? <View style={{ marginTop: 'auto', paddingTop: 6 }}>{visual}</View> : null}
          </View>
        </Vidrio>
      )}
    </Pressable>
  );
}

export function FilaDeKpis({ children }) {
  return <View style={{ flexDirection: 'row', gap: 12, marginHorizontal: 16 }}>{children}</View>;
}

/** La curva del día: cuánto se vendió en cada hora, suavizada, con relleno. */
export function Curva({ valores = [], color, alto = 28 }) {
  const n = valores.length;
  if (n < 2 || !valores.some((v) => v > 0)) return null;
  const max = Math.max(...valores);
  const ancho = 100;
  const pts = valores.map((v, i) => [(i / (n - 1)) * ancho, alto - 2 - (v / max) * (alto - 4)]);
  const d = pts.reduce((acc, [x, y], i) => {
    if (!i) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');
  const id = `g${color.replace('#', '')}`;
  return (
    <Svg width="100%" height={alto} viewBox={`0 0 ${ancho} ${alto}`} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.45" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={`${d} L${ancho},${alto} L0,${alto} Z`} fill={`url(#${id})`} />
      <Path d={d} stroke={color} strokeWidth={1.6} fill="none" vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

/** Una barra de avance: `parte` de `total`. */
export function Avance({ parte = 0, total = 0, color }) {
  const pct = total > 0 ? Math.min(1, parte / total) : 0;
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}
