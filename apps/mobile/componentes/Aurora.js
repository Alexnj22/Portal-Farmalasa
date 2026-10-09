// El fondo de TODA la app (usuario, 2026-09-30: «el fondo aurora debe servir
// para toda la app»): manchas suaves con los colores del logo —verde y
// magenta— y el azul y el violeta de la marca, sobre un fondo casi neutro. Es
// lo que le da personalidad de Farmalasa a una app hecha con controles del
// sistema, y lo que hace que el vidrio de iOS se vea: el vidrio sin nada
// detrás es gris.
//
// Los colores salen de los tokens del portal (`src/index.css` → tokens.json):
// `--logo-green`, `--logo-magenta`, `--brand`, `--brand-purple`.
import { StyleSheet, useColorScheme, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

const MANCHAS = [
  { id: 'verde', color: '#8EC30F', cx: '12%', cy: '8%', r: '55%' },
  { id: 'magenta', color: '#981D97', cx: '92%', cy: '18%', r: '60%' },
  { id: 'azul', color: '#0052CC', cx: '85%', cy: '78%', r: '65%' },
  { id: 'violeta', color: '#6929C4', cx: '8%', cy: '70%', r: '55%' },
];

export default function Aurora() {
  const oscuro = useColorScheme() === 'dark';
  const base = oscuro ? '#08070D' : '#F3F2F8';
  const fuerza = oscuro ? 0.42 : 0.30;
  // En Android, el SVG de pantalla completa se volvía a pintar en la CPU cada
  // vez que algo se movía encima (las pantallas son transparentes): como
  // textura de la GPU se pinta una vez (2026-10-09, «es lento»).
  return (
    <View pointerEvents="none" renderToHardwareTextureAndroid style={[StyleSheet.absoluteFill, { backgroundColor: base }]}>
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
