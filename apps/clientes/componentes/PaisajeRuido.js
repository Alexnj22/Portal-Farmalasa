// El paisaje de cada sonido de fondo (2026-11-10, «más moderna, más
// interactiva, más inmersiva según el ruido»). Una escena de pantalla
// completa por sonido: la lluvia cae y salpica, las olas crecen y rompen al
// ritmo de las del audio, las brasas suben de la fogata, la noche tiene
// estrellas, luna y luciérnagas, el ventilador gira…
//
// Es UN dibujo de Skia (un `Picture`) que se rehace a 30 cuadros en el hilo de
// la interfaz, como las luces de los juegos (juegos/Escena.js): JavaScript no
// hace nada mientras se mueve. `energia` (0..1) baja la escena a casi quieta
// cuando no suena, y tocar deja una onda donde cayó el dedo (`toque`, marcado
// con el mismo `reloj` que la dibuja; los dos los crea la pantalla).
import { StyleSheet, useWindowDimensions } from 'react-native';
import { BlurStyle, Canvas, PaintStyle, Picture, Skia, StrokeCap, TileMode } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useSinMovimiento } from './animacion';

// Un número «al azar» fijo por índice: cada gota, estrella o brasa tiene su carril.
function h(i, s) {
  'worklet';
  const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return x - Math.floor(x);
}


export default function PaisajeRuido({ tipo, acento, energia, toque, reloj }) {
  const { width: W, height: H } = useWindowDimensions();
  const quieta = useSinMovimiento();
  const acum = useSharedValue(0);
  useFrameCallback((f) => {
    const dt = Math.min(0.1, (f.timeSincePreviousFrame ?? 16) / 1000);
    acum.value += dt;
    // Sin sonar, la escena sigue viva pero a un quinto de la velocidad.
    if (acum.value >= 0.033) { reloj.value += acum.value * (0.2 + 0.8 * energia.value); acum.value = 0; }
  }, !quieta);
  const col = Skia.Color(acento);

  const cuadro = useDerivedValue(() => {
    const t = reloj.value;
    const e = energia.value;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, W, H));
    const p = Skia.Paint();
    // Los desenfoques se crean aquí, en el hilo que dibuja.
    const BLUR = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 6, true);
    const BLUR_GRANDE = Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 40, true);
    p.setAntiAlias(true);
    p.setColor(col);

    if (tipo === 'lluvia') {
      p.setStyle(PaintStyle.Stroke);
      p.setStrokeCap(StrokeCap.Round);
      const n = 90;
      for (let i = 0; i < n; i++) {
        const cerca = h(i, 1);
        const vel = 0.5 + cerca * 0.9;
        const largo = 14 + cerca * 30;
        const y = ((t * vel * 0.9 + h(i, 2)) % 1) * (H + largo) - largo;
        const x = h(i, 3) * (W + 60) - 30 + y * 0.12;
        p.setStrokeWidth(0.8 + cerca * 1.6);
        p.setAlphaf((0.12 + cerca * 0.4) * (0.4 + 0.6 * e));
        c.drawLine(x, y, x + largo * 0.12, y + largo, p);
      }
      // Salpicaduras en el piso: anillos que se abren y se apagan.
      for (let i = 0; i < 14; i++) {
        const f = (t * 1.3 + h(i, 4)) % 1;
        const x = h(i + Math.floor(t * 1.3 + h(i, 4)) * 7, 5) * W;
        const y = H * (0.82 + h(i, 6) * 0.15);
        p.setStrokeWidth(1);
        p.setAlphaf((1 - f) * 0.35 * e);
        c.drawOval(Skia.XYWHRect(x - f * 18, y - f * 4, f * 36, f * 8), p);
      }
    } else if (tipo === 'olas') {
      // Cuatro capas de mar; la de adelante sube y rompe con el ritmo del audio
      // (tres olas en 26 s, como lib/ruido.js).
      const ciclo = (t % 26) / 26;
      const ola = 0.5 + 0.5 * Math.sin(ciclo * Math.PI * 6 - 1.2);
      for (let k = 0; k < 4; k++) {
        const base = H * (0.58 + k * 0.1) - ola * (k === 3 ? 34 : 14) * e;
        const amp = 10 + k * 6 + ola * 10 * e;
        const fase = t * (0.25 + k * 0.12) + k * 1.7;
        const path = Skia.Path.Make();
        path.moveTo(0, H);
        for (let x = 0; x <= W + 10; x += 10) {
          const y = base + Math.sin(x / (90 + k * 30) + fase) * amp + Math.sin(x / 47 - fase * 1.4) * amp * 0.3;
          path.lineTo(x, y);
        }
        path.lineTo(W, H); path.close();
        p.setStyle(PaintStyle.Fill);
        p.setAlphaf(0.08 + k * 0.06);
        c.drawPath(path, p);
      }
      // La espuma: puntitos que brillan sobre la cresta de adelante.
      p.setStyle(PaintStyle.Fill);
      for (let i = 0; i < 40; i++) {
        const x = h(i, 7) * W;
        const y = H * 0.88 - ola * 34 * e + Math.sin(x / 90 + t * 0.61 + 5.1) * 28 - h(i, 8) * 16;
        p.setAlphaf((0.25 + 0.5 * h(i, 9)) * ola * e);
        c.drawCircle(x, y, 1 + h(i, 10) * 1.8, p);
      }
    } else if (tipo === 'fuego') {
      // El resplandor de la fogata, que late, y las brasas que suben.
      const late = 0.75 + 0.25 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
      p.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(W / 2, H * 1.02), H * 0.6 * late,
        [Skia.Color('rgba(255,140,40,0.55)'), Skia.Color('rgba(255,80,20,0)')], null, TileMode.Clamp));
      p.setAlphaf(0.4 + 0.6 * e);
      c.drawRect(Skia.XYWHRect(0, 0, W, H), p);
      p.setShader(null);
      p.setColor(col);
      p.setMaskFilter(BLUR);
      for (let i = 0; i < 46; i++) {
        const vida = (t * (0.18 + h(i, 11) * 0.25) + h(i, 12)) % 1;
        const x = W / 2 + (h(i, 13) - 0.5) * W * 0.5 + Math.sin(t * 2 + i) * 22 * vida;
        const y = H * 1.02 - vida * H * (0.55 + h(i, 14) * 0.4);
        const brillo = (1 - vida) * (0.6 + 0.4 * Math.sin(t * 9 + i * 3));
        p.setAlphaf(Math.max(0, brillo) * (0.3 + 0.7 * e));
        c.drawCircle(x, y, 1.5 + h(i, 15) * 3, p);
      }
      p.setMaskFilter(null);
    } else if (tipo === 'noche') {
      // Estrellas que titilan, la luna con su halo, luciérnagas y el pasto.
      p.setStyle(PaintStyle.Fill);
      for (let i = 0; i < 90; i++) {
        p.setColor(Skia.Color('#FFFFFF'));
        p.setAlphaf(0.2 + 0.6 * Math.abs(Math.sin(t * (0.6 + h(i, 16)) + i)) * h(i, 17));
        c.drawCircle(h(i, 18) * W, h(i, 19) * H * 0.65, 0.6 + h(i, 20) * 1.4, p);
      }
      p.setColor(Skia.Color('#F3EEDA'));
      p.setMaskFilter(BLUR_GRANDE);
      p.setAlphaf(0.35);
      c.drawCircle(W * 0.78, H * 0.17, 46, p);
      p.setMaskFilter(null);
      p.setAlphaf(0.95);
      c.drawCircle(W * 0.78, H * 0.17, 26, p);
      // La sombra que la hace menguante.
      p.setColor(Skia.Color('#0F1640'));
      p.setAlphaf(1);
      c.drawCircle(W * 0.78 + 11, H * 0.17 - 6, 23, p);
      // Luciérnagas: vagan despacio y se encienden a destiempo.
      p.setColor(Skia.Color('#E8FF8A'));
      p.setMaskFilter(BLUR);
      for (let i = 0; i < 14; i++) {
        const x = (h(i, 21) * W + Math.sin(t * 0.3 + i) * 40 + t * 6 * (h(i, 22) - 0.5)) % W;
        const y = H * (0.6 + h(i, 23) * 0.3) + Math.cos(t * 0.4 + i * 2) * 26;
        const on = Math.max(0, Math.sin(t * (0.8 + h(i, 24)) + i * 5));
        p.setAlphaf(on * on * (0.35 + 0.65 * e));
        c.drawCircle((x + W) % W, y, 3.5, p);
      }
      p.setMaskFilter(null);
      // El pasto: una silueta que se mece apenas.
      const pasto = Skia.Path.Make();
      pasto.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) {
        const alto = 26 + h(x, 25) * 38;
        pasto.lineTo(x + Math.sin(t * 0.8 + x * 0.05) * 4, H - alto);
        pasto.lineTo(x + 3, H - 10);
      }
      pasto.lineTo(W, H); pasto.close();
      p.setColor(Skia.Color('#02030C'));
      p.setAlphaf(0.9);
      c.drawPath(pasto, p);
    } else if (tipo === 'ventilador') {
      // Tres aspas enormes y borrosas detrás de todo.
      const cx = W / 2, cy = H * 0.42, R = Math.min(W, H) * 0.42;
      const giro = t * (0.4 + 5.6 * e);
      p.setStyle(PaintStyle.Fill);
      p.setMaskFilter(BLUR_GRANDE);
      for (let k = 0; k < 3; k++) {
        const a = giro + (k * 2 * Math.PI) / 3;
        const path = Skia.Path.Make();
        path.moveTo(cx, cy);
        path.quadTo(cx + Math.cos(a - 0.5) * R * 0.9, cy + Math.sin(a - 0.5) * R * 0.9, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        path.quadTo(cx + Math.cos(a + 0.35) * R * 0.6, cy + Math.sin(a + 0.35) * R * 0.6, cx, cy);
        p.setAlphaf(0.14);
        c.drawPath(path, p);
      }
      p.setMaskFilter(null);
      p.setStyle(PaintStyle.Stroke);
      for (let k = 1; k <= 3; k++) {
        p.setStrokeWidth(1);
        p.setAlphaf(0.08);
        c.drawCircle(cx, cy, R * (0.4 + k * 0.25), p);
      }
    } else if (tipo === 'blanco') {
      // Grano de televisor, fino y parejo.
      p.setStyle(PaintStyle.Fill);
      const cuadroN = Math.floor(t * 24);
      for (let i = 0; i < 360; i++) {
        p.setAlphaf(0.05 + 0.18 * h(i, cuadroN));
        c.drawRect(Skia.XYWHRect(h(i, cuadroN + 1) * W, h(i, cuadroN + 2) * H, 1.6, 1.6), p);
      }
    } else {
      // Rosa y Profundo: luces grandes y borrosas que flotan (una aurora).
      p.setMaskFilter(BLUR_GRANDE);
      const lenta = tipo === 'cafe' ? 0.08 : 0.15;
      for (let i = 0; i < 4; i++) {
        const x = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * lenta * (1 + i * 0.3) + i * 2)));
        const y = H * (0.2 + 0.6 * (0.5 + 0.5 * Math.cos(t * lenta * (0.8 + i * 0.25) + i)));
        p.setAlphaf(0.18 + 0.12 * e);
        c.drawCircle(x, y, W * (0.25 + 0.1 * i), p);
      }
      p.setMaskFilter(null);
    }

    // La onda del dedo.
    const tt = toque.value;
    if (tt.t >= 0) {
      const f = (t - tt.t) / 1.6;
      if (f >= 0 && f < 1) {
        p.setShader(null);
        p.setColor(Skia.Color('#FFFFFF'));
        p.setStyle(PaintStyle.Stroke);
        for (let k = 0; k < 3; k++) {
          const g = f - k * 0.12;
          if (g <= 0) continue;
          p.setStrokeWidth(2 - g * 1.5);
          p.setAlphaf((1 - g) * 0.45);
          c.drawCircle(tt.x, tt.y, 20 + g * 160, p);
        }
      }
    }
    return rec.finishRecordingAsPicture();
  });

  return (
    <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Picture picture={cuadro} />
    </Canvas>
  );
}
