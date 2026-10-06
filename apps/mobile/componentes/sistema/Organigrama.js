// El organigrama visual de los cargos, de SÓLO LECTURA: una caja por cargo y una
// línea a su superior (sólida) y a su superior matricial (punteada). La
// disposición —quién va dónde— sale del núcleo (`disposicionDelOrganigrama`),
// así que el dibujo no inventa ninguna jerarquía: sólo pinta la de la tabla.
//
// Es más ancho que el teléfono casi siempre, así que vive dentro de un
// ScrollView horizontal (lo vertical lo desplaza la pantalla) que se acerca con
// los dedos (`maximumZoomScale`, propio de iOS). Tocar una caja avisa a la pantalla.
import { useMemo } from 'react';
import { ScrollView, useColorScheme, useWindowDimensions } from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { disposicionDelOrganigrama } from '@nucleo/utils/jerarquiaDeCargos';
import { MARCA } from '../inicio/marca';

const CAJA_W = 132;
const CAJA_H = 52;
const PASO_X = 148;
const PASO_Y = 92;
const MARGEN = 16;

/** Parte un nombre largo en dos renglones de ≤18 letras (lo que cabe en la caja). */
function renglones(nombre) {
  const palabras = String(nombre || '').split(/\s+/);
  const a = [];
  const b = [];
  for (const p of palabras) {
    if (!b.length && [...a, p].join(' ').length <= 18) a.push(p);
    else b.push(p);
  }
  const segundo = b.join(' ');
  return [a.join(' ') || segundo.slice(0, 18), a.length ? (segundo.length > 18 ? `${segundo.slice(0, 17)}…` : segundo) : ''];
}

export default function Organigrama({ roles, ocupantes = {}, onTocar, elegido }) {
  const { width } = useWindowDimensions();
  // SVG no lee los colores del sistema (`PlatformColor`): se eligen por el modo.
  const oscuro = useColorScheme() === 'dark';
  const tinta = oscuro ? '#FFFFFF' : '#1C1B1F';
  const tinta2 = oscuro ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const d = useMemo(() => disposicionDelOrganigrama(roles), [roles]);
  const ancho = d.ancho * PASO_X + MARGEN * 2;
  const alto = d.alto * PASO_Y + MARGEN * 2;
  const pos = useMemo(() => Object.fromEntries(d.nodos.map((n) => [n.id, {
    cx: MARGEN + n.x * PASO_X + CAJA_W / 2, top: MARGEN + n.y * PASO_Y,
  }])), [d]);

  return (
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ minWidth: width }} maximumZoomScale={2.5} minimumZoomScale={0.4}
      showsHorizontalScrollIndicator={false}>
      <Svg width={ancho} height={alto}>
        {d.lineas.map((l) => {
          const a = pos[l.desde];
          const b = pos[l.hasta];
          if (!a || !b) return null;
          const y1 = a.top + CAJA_H;
          const y2 = b.top;
          const ym = (y1 + y2) / 2;
          return (
            <Path key={`${l.tipo}-${l.desde}-${l.hasta}`} d={`M${a.cx},${y1} V${ym} H${b.cx} V${y2}`} fill="none"
              stroke={l.tipo === 'matricial' ? MARCA.ambar : tinta2} strokeOpacity={l.tipo === 'matricial' ? 0.8 : 0.45}
              strokeWidth={1.5} strokeDasharray={l.tipo === 'matricial' ? '4 4' : undefined} />
          );
        })}
        {d.nodos.map((n) => {
          const p = pos[n.id];
          const [r1, r2] = renglones(n.name);
          const esElegido = elegido === n.id;
          const color = n.scope === 'GLOBAL' ? MARCA.violetaClaro : MARCA.azulClaro;
          return (
            <G key={n.id} onPress={onTocar ? () => onTocar(n.id) : undefined}>
              <Rect x={p.cx - CAJA_W / 2} y={p.top} width={CAJA_W} height={CAJA_H} rx={12}
                fill={color} fillOpacity={esElegido ? 0.4 : 0.16} stroke={color} strokeWidth={esElegido ? 2 : 1} />
              <SvgText x={p.cx} y={p.top + (r2 ? 20 : 27)} fontSize={11.5} fontWeight="700" fill={tinta} textAnchor="middle">{r1}</SvgText>
              {r2 ? <SvgText x={p.cx} y={p.top + 34} fontSize={11.5} fontWeight="700" fill={tinta} textAnchor="middle">{r2}</SvgText> : null}
              <SvgText x={p.cx} y={p.top + CAJA_H - 5} fontSize={9.5} fill={tinta2} textAnchor="middle">
                {`${ocupantes[n.id] ?? 0} ${ocupantes[n.id] === 1 ? 'persona' : 'personas'}`}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </ScrollView>
  );
}
