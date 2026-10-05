// El fondo de toda la app: manchas suaves con el verde y el magenta del logo.
// Misma idea que la app del personal, con los dos colores del programa.
import { StyleSheet, useColorScheme, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import tokens from '@nucleo/constants/tokens.json';

const T = tokens.temas.solid;
const MANCHAS = [
  { id: 'verde', color: T['logo-green'], cx: '10%', cy: '6%', r: '60%' },
  { id: 'magenta', color: T['logo-magenta'], cx: '95%', cy: '30%', r: '60%' },
  { id: 'verde2', color: T['logo-green'], cx: '80%', cy: '95%', r: '55%' },
];

export default function Aurora() {
  const oscuro = useColorScheme() === 'dark';
  const base = oscuro ? '#0A090E' : '#F5F4F8';
  const fuerza = oscuro ? 0.32 : 0.22;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: base }]}>
      <Svg width="100%" height="100%">
        <Defs>
          {MANCHAS.map((m) => (
            <RadialGradient key={m.id} id={m.id} cx={m.cx} cy={m.cy} r={m.r} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={m.color} stopOpacity={fuerza} />
              <Stop offset="1" stopColor={m.color} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {MANCHAS.map((m) => <Rect key={m.id} x="0" y="0" width="100%" height="100%" fill={`url(#${m.id})`} />)}
      </Svg>
    </View>
  );
}
