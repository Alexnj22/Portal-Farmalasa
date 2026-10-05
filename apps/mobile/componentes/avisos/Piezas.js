// Las piezas con que se arma la tarjeta de un aviso en la app: el anillo que
// dibuja un porcentaje, la insignia tintada, la grilla de datos (la «tabla»
// de la tarjeta del portal), las barras por sala y las listas. Todas en la
// paleta de la marca y sobre el vidrio de la tarjeta: nada sólido.
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Host, Icon } from '@expo/ui';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import Avatar from '../Avatar';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { iconoDe } from '../../tema/iconos';

// La escala de cumplimiento del portal (`tonoDeCumplimiento`): 100 o más es
// verde, de 95 a 100 ámbar, debajo rojo.
export const tonoDe = (pct) => (pct >= 100 ? MARCA.verde : pct >= 95 ? MARCA.ambar : MARCA.rojo);

export const FONDO = 'rgba(127,127,127,0.13)';

export function Anillo({ pct, color, texto, tamano = 46 }) {
  const r = (tamano - 6) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const col = color ?? tonoDe(pct);
  return (
    <View style={{ width: tamano, height: tamano, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={tamano} height={tamano} style={{ position: 'absolute' }}>
        <Circle cx={tamano / 2} cy={tamano / 2} r={r} stroke={`${col}33`} strokeWidth={4} fill="none" />
        <Circle cx={tamano / 2} cy={tamano / 2} r={r} stroke={col} strokeWidth={4} fill="none" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`} />
      </Svg>
      <Text style={{ color: col, fontSize: tamano * 0.27, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {texto ?? Math.round(p)}
      </Text>
    </View>
  );
}

export function Insignia({ icono, color = MARCA.azulClaro, tamano = 44 }) {
  return (
    <View style={{ width: tamano, height: tamano, borderRadius: tamano * 0.3, backgroundColor: `${color}2E`, alignItems: 'center', justifyContent: 'center' }}>
      <Host matchContents><Icon name={iconoDe(icono)} size={tamano * 0.5} color={color} /></Host>
    </View>
  );
}

// El violeta de la marca es oscuro: como TEXTO sobre el fondo oscuro de la app
// no se lee (medido en Cargos). El fondo conserva el tono; la letra va aclarada.
const LETRA_LEGIBLE = { [MARCA.violeta]: MARCA.violetaClaro };

export function Pildora({ texto, color }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: `${color}2E` }}>
      <Text style={{ color: LETRA_LEGIBLE[color] ?? color, fontSize: 13, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}

// La cifra grande con su contexto chico: «$6,809.38 de $7,781.63».
export function Cifra({ valor, de, color }) {
  return (
    <Text style={{ color: color ?? colorSistema.texto }}>
      <Text style={{ fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{valor}</Text>
      {de ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`  ${de}`}</Text> : null}
    </Text>
  );
}

export function Rotulo({ children }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>{children}</Text>;
}

// La grilla de datos: de a pares, con la celda sola a todo lo ancho — la
// misma regla de `CuerpoDeSolicitud` del portal.
export function Grilla({ celdas }) {
  const lista = celdas.filter(Boolean);
  if (!lista.length) return null;
  const filas = [];
  for (let i = 0; i < lista.length;) {
    const a = lista[i];
    const b = lista[i + 1];
    if (a.fila || !b || b.fila) { filas.push([a]); i += 1; } else { filas.push([a, b]); i += 2; }
  }
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, overflow: 'hidden' }}>
      {filas.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          {f.map((c, j) => (
            <View key={c.k ?? j} style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 9, gap: 3,
              borderLeftWidth: j ? 0.5 : 0, borderLeftColor: colorSistema.separador, alignItems: j ? 'flex-end' : 'flex-start' }}>
              {c.persona ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Avatar empleado={c.persona} tamano={30} />
                  <View style={{ flexShrink: 1 }}>
                    <Rotulo>{c.rotulo}</Rotulo>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName(c.persona) || c.valor}</Text>
                  </View>
                </View>
              ) : (
                <>
                  <Rotulo>{c.rotulo}</Rotulo>
                  <Text style={{ color: c.color ?? colorSistema.texto, fontSize: 15, fontWeight: '700', textAlign: j ? 'right' : 'left', fontVariant: ['tabular-nums'] }}
                    numberOfLines={c.lineas ?? 2}>{c.valor}</Text>
                </>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// Renglones simples: [izquierda, derecha, colorDeLaDerecha].
export function Lista({ filas, resto }) {
  if (!filas?.length) return null;
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12 }}>
      {filas.map(([a, b, color], i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
          <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={2}>{a}</Text>
          {b != null && b !== '' ? <Text style={{ color: color ?? colorSistema.texto2, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{b}</Text> : null}
        </View>
      ))}
      {resto ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>{resto}</Text>
      ) : null}
    </View>
  );
}

// Una barra por sala con su porcentaje — el cierre del día y el del mes.
export function BarrasDeSalas({ salas }) {
  if (!salas?.length) return null;
  return (
    <View style={{ gap: 7 }}>
      {salas.map((s) => {
        const col = tonoDe(s.pct);
        return (
          <View key={s.sala} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ width: 78, color: colorSistema.texto, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>{s.sala}</Text>
            <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: FONDO, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, Math.max(0, s.pct))}%`, height: 7, borderRadius: 4, backgroundColor: col }} />
            </View>
            {s.valor ? <Text style={{ color: colorSistema.texto2, fontSize: 12, fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' }}>{s.valor}</Text> : null}
            <Text style={{ width: 42, color: col, fontSize: 13, fontWeight: '800', textAlign: 'right', fontVariant: ['tabular-nums'] }}>{Math.round(s.pct)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

// Los pasos de un proceso (el pedido): hechos en color, el actual resaltado.
export function Pasos({ pasos, actual, color = MARCA.azulClaro }) {
  const i = pasos.findIndex((p) => p.id === actual);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {pasos.map((p, j) => (
          <View key={p.id} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: j <= i ? color : FONDO }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {pasos.map((p, j) => (
          <Text key={p.id} style={{ flex: 1, fontSize: 11, textAlign: j === 0 ? 'left' : j === pasos.length - 1 ? 'right' : 'center',
            color: j === i ? colorSistema.texto : colorSistema.texto2, fontWeight: j === i ? '700' : '400' }} numberOfLines={1}>{p.rotulo}</Text>
        ))}
      </View>
    </View>
  );
}

export function Nota({ rotulo, texto }) {
  if (!texto) return null;
  return (
    <View style={{ borderRadius: 14, backgroundColor: FONDO, paddingHorizontal: 12, paddingVertical: 9, gap: 3 }}>
      {rotulo ? <Rotulo>{rotulo}</Rotulo> : null}
      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{texto}</Text>
    </View>
  );
}

export function Fichas({ textos, color = MARCA.azulClaro }) {
  if (!textos?.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {textos.map((t) => (
        <View key={t} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: `${color}26` }}>
          <Text style={{ color: colorSistema.texto, fontSize: 12, fontWeight: '600' }}>{t}</Text>
        </View>
      ))}
    </View>
  );
}
