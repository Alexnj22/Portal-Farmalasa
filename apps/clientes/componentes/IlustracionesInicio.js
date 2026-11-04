// Los dibujos de las tarjetas del Inicio (2026-11-04, «siento extraño que puedes
// canjear, frase del día y puntos por vencer sólo sean cards de texto»).
//
// Dibujos QUIETOS con Skia: se pintan una vez y no se vuelven a tocar — ni
// reloj, ni valores compartidos, ni nada por cuadro. El único movimiento de
// estas tarjetas es la entrada que ya trae `Entrada`. Todo en el magenta de la
// marca (un solo acento, como el resto del Inicio): la tarjeta se reconoce por
// su dibujo, no por un color propio.
//
// Son adorno: `importantForAccessibility="no"` — lo que dicen ya está escrito
// en la tarjeta.
import { useMemo } from 'react';
import { View } from 'react-native';
import { Canvas, Circle, Group, LinearGradient, Oval, Path, RadialGradient, RoundedRect, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useTema } from '../tema/tema';

/** `#rrggbb` + alfa → `rgba(…)`: Skia no lee de igual forma el `#rrggbbaa` en todas las versiones. */
export function rgba(hex, a) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Una estrella de cuatro puntas (el destello), centrada en (x, y).
function destello(x, y, r) {
  const p = Skia.Path.Make();
  const k = r * 0.28;
  p.moveTo(x, y - r);
  p.quadTo(x + k, y - k, x + r, y);
  p.quadTo(x + k, y + k, x, y + r);
  p.quadTo(x - k, y + k, x - r, y);
  p.quadTo(x - k, y - k, x, y - r);
  p.close();
  return p;
}

/**
 * El regalo del canje. `avance` entre 0 y 1 dibuja alrededor el anillo de lo
 * que va (el primer canje); sin `avance` (ya puede canjear) va con su brillo y
 * sus destellos.
 */
export function Regalo({ tam = 84, avance = null }) {
  const t = useTema();
  const m = t.color.magenta;
  const s = tam;
  const listo = avance == null;
  // Con anillo, la caja se achica para caber adentro.
  const k = listo ? 1 : 0.62;
  const c = s / 2;
  const caja = (v) => c + (v - c) * k; // escala alrededor del centro

  const anillo = useMemo(() => {
    if (listo) return null;
    const p = Skia.Path.Make();
    const g = 5;
    const barrido = Math.max(0.02, Math.min(1, avance)) * 360;
    p.addArc({ x: g, y: g, width: s - g * 2, height: s - g * 2 }, -90, barrido);
    return p;
  }, [listo, avance, s]);
  const estrellas = useMemo(() => (listo ? [destello(s * 0.12, s * 0.22, s * 0.07), destello(s * 0.9, s * 0.16, s * 0.05), destello(s * 0.88, s * 0.62, s * 0.04)] : []), [listo, s]);

  const blanco = t.oscuro ? 'rgba(255,255,255,0.92)' : '#FFFFFF';
  // La caja: dos tonos del mismo magenta, para que tenga volumen sin otro color.
  const claro = t.oscuro ? '#B83BB7' : '#B030AF';
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none" style={{ width: s, height: s }}>
      <Canvas style={{ width: s, height: s }}>
        {listo ? (
          <Circle cx={c} cy={c} r={s * 0.5}>
            <RadialGradient c={vec(c, c)} r={s * 0.5} colors={[rgba(m, t.oscuro ? 0.42 : 0.22), rgba(m, 0)]} />
          </Circle>
        ) : (
          <Group>
            <Circle cx={c} cy={c} r={c - 5} style="stroke" strokeWidth={6} color={rgba(m, t.oscuro ? 0.3 : 0.14)} />
            <Path path={anillo} style="stroke" strokeWidth={6} strokeCap="round" color={t.oscuro ? t.color.magentaTexto : m} />
          </Group>
        )}
        <Group opacity={listo ? 1 : 0.9}>
          {/* El lazo: dos óvalos inclinados y el nudo. */}
          <Group transform={[{ translateX: caja(s * 0.39) }, { translateY: caja(s * 0.3) }, { rotate: -0.55 }]}>
            <Oval x={-s * 0.13 * k} y={-s * 0.075 * k} width={s * 0.26 * k} height={s * 0.15 * k} color={claro} />
            <Oval x={-s * 0.075 * k} y={-s * 0.035 * k} width={s * 0.15 * k} height={s * 0.07 * k} color={rgba('#000000', 0.18)} />
          </Group>
          <Group transform={[{ translateX: caja(s * 0.61) }, { translateY: caja(s * 0.3) }, { rotate: 0.55 }]}>
            <Oval x={-s * 0.13 * k} y={-s * 0.075 * k} width={s * 0.26 * k} height={s * 0.15 * k} color={claro} />
            <Oval x={-s * 0.075 * k} y={-s * 0.035 * k} width={s * 0.15 * k} height={s * 0.07 * k} color={rgba('#000000', 0.18)} />
          </Group>
          {/* El cuerpo y la tapa. */}
          <RoundedRect x={caja(s * 0.22)} y={caja(s * 0.47)} width={s * 0.56 * k} height={s * 0.36 * k} r={s * 0.07 * k}>
            <LinearGradient start={vec(0, caja(s * 0.47))} end={vec(0, caja(s * 0.83))} colors={[m, t.oscuro ? '#7A1679' : '#7E177D']} />
          </RoundedRect>
          <RoundedRect x={caja(s * 0.17)} y={caja(s * 0.36)} width={s * 0.66 * k} height={s * 0.15 * k} r={s * 0.05 * k} color={claro} />
          {/* La cinta: vertical sobre caja y tapa. */}
          <Rect x={caja(s * 0.455)} y={caja(s * 0.36)} width={s * 0.09 * k} height={s * 0.47 * k} color={blanco} />
          <Circle cx={caja(s * 0.5)} cy={caja(s * 0.33)} r={s * 0.055 * k} color={blanco} />
          {/* Un reflejo en la tapa. */}
          <RoundedRect x={caja(s * 0.21)} y={caja(s * 0.385)} width={s * 0.2 * k} height={s * 0.035 * k} r={s * 0.02 * k} color="rgba(255,255,255,0.35)" />
        </Group>
        {estrellas.map((p, i) => <Path key={i} path={p} color={t.oscuro ? t.color.magentaTexto : rgba(m, 0.75)} />)}
        {listo ? <Circle cx={s * 0.16} cy={s * 0.78} r={s * 0.025} color={rgba(m, 0.5)} /> : null}
      </Canvas>
    </View>
  );
}

/**
 * El adorno de la frase del día: círculos concéntricos que se abren desde la
 * esquina, un brillo suave y unos puntos — como ondas de calma. Va detrás del
 * texto, en la esquina de arriba a la derecha.
 */
export function OndasFrase({ tam = 170 }) {
  const t = useTema();
  const m = t.color.magenta;
  const s = tam;
  const a = t.oscuro ? 1.6 : 1;
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden pointerEvents="none" style={{ width: s, height: s }}>
      <Canvas style={{ width: s, height: s }}>
        <Circle cx={s} cy={0} r={s * 0.95}>
          <RadialGradient c={vec(s, 0)} r={s * 0.95} colors={[rgba(m, 0.16 * a), rgba(m, 0)]} />
        </Circle>
        {[0.32, 0.5, 0.68, 0.86].map((r, i) => (
          <Circle key={r} cx={s} cy={0} r={s * r} style="stroke" strokeWidth={1.2} color={rgba(m, (0.16 - i * 0.03) * a)} />
        ))}
        <Circle cx={s * 0.42} cy={s * 0.2} r={3} color={rgba(m, 0.22 * a)} />
        <Circle cx={s * 0.6} cy={s * 0.46} r={2} color={rgba(m, 0.18 * a)} />
        <Circle cx={s * 0.82} cy={s * 0.6} r={2.5} color={rgba(m, 0.16 * a)} />
      </Canvas>
    </View>
  );
}
