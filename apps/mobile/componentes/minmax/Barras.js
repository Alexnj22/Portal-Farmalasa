// Las dos barras de Min·Máx del portal (`tabminmax/StockBar` y `CoverageBar`):
//   · existencia contra MIN y MAX: la barra es lo que hay, las dos marcas son
//     el MIN (violeta) y el MAX (azul); roja en cero, ámbar bajo el MIN, azul
//     sobre el MAX, verde en rango — se lee de un vistazo sin leer números;
//   · cobertura: cuántos días alcanza lo que hay contra el ciclo de la sala.
// La escala del techo es la misma del portal (`max·1.3`, `existencia·1.15`,
// `min·3`), para que la misma fila se vea igual en los dos.
import { useEffect, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';

export const COLOR_MIN = MARCA.violetaClaro;
export const COLOR_MAX = MARCA.azulClaro;

function Relleno({ pct, color }) {
  const ancho = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(ancho, { toValue: pct, useNativeDriver: false, speed: 14, bounciness: 4 }).start();
  }, [pct, ancho]);
  return <Animated.View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4, backgroundColor: color,
    width: ancho.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }} />;
}

export function BarraDeExistencia({ existencia, min, max, alto = 8 }) {
  const c = Number(existencia) || 0;
  const mn = Number(min) || 0;
  const mx = Number(max) || 0;
  if (!mx && !mn) return null;
  const techo = Math.max(mx * 1.3, c * 1.15, mn * 3, 1);
  const pct = (v) => Math.min(100, (v / techo) * 100);
  const color = c === 0 ? MARCA.rojo : c < mn ? MARCA.ambar : c > mx ? MARCA.azulClaro : MARCA.verde;
  return (
    <View style={{ height: alto + 6, justifyContent: 'center' }} accessibilityLabel={`Existencia ${c}, MIN ${mn}, MAX ${mx}`}>
      <View style={{ height: alto, borderRadius: alto / 2, backgroundColor: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
        <Relleno pct={pct(c)} color={color} />
      </View>
      {mn > 0 ? <View style={{ position: 'absolute', left: `${pct(mn)}%`, top: 0, bottom: 0, width: 2.5, borderRadius: 2, backgroundColor: COLOR_MIN }} /> : null}
      {mx > 0 ? <View style={{ position: 'absolute', left: `${pct(mx)}%`, top: 0, bottom: 0, width: 2.5, borderRadius: 2, backgroundColor: COLOR_MAX }} /> : null}
    </View>
  );
}

/** Días de cobertura contra el ciclo: rojo en cero, ámbar bajo 20 %, amarillo bajo 50 %, verde. */
export function Cobertura({ dias, ciclo }) {
  if (dias == null) return <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin venta</Text>;
  const pct = Math.min(100, (dias / ciclo) * 100);
  const color = dias === 0 ? MARCA.rojo : dias < ciclo * 0.2 ? MARCA.ambar : dias < ciclo * 0.5 ? '#EAB308' : MARCA.verde;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{dias >= 999 ? '+999 días' : `${Math.round(dias)} días`}</Text>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(127,127,127,0.2)', overflow: 'hidden' }}>
        <Relleno pct={pct} color={color} />
      </View>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`de ${ciclo} días del ciclo`}</Text>
    </View>
  );
}
