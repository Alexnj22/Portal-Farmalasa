// Jardín zen (Bienestar, 2026-11-03, «agreguemos algún otro adicional más
// trabajado»). Una caja de arena para rastrillar con el dedo: cada trazo deja
// surcos con luz y sombra, las piedras se mueven y la arena dibuja anillos a
// su alrededor. Suena la arena —más fuerte cuanto más rápido se rastrilla— y
// el teléfono roza la mano cada tanto, como el rastrillo contra los granos.
// Tocar sin arrastrar deja una huella de anillos; «Alisar» la deja lisa.
//
// No tiene puntaje ni final, a propósito: es para soltar las manos un rato.
//
// Todo el dibujo vive en el hilo de la interfaz (Skia + Reanimated): el trazo
// que se está haciendo se arma cuadro a cuadro sin pasar por React, y sólo al
// soltar el dedo se suma, una vez, a los surcos ya hechos.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Rect, Shadow, Skia, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeOut, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSinMovimiento } from '../componentes/animacion';
import { BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, OpcionesJuego } from '../componentes/juegos/Escena';
import { bucle, callar, precargar, sonar, tacto } from '../lib/sensaciones';

const SEP = 11; // distancia entre las puntas del rastrillo
const RASTRILLOS = [{ valor: 1, texto: 'Punta' }, { valor: 3, texto: 'Rastrillo' }, { valor: 5, texto: 'Ancho' }];
const SONIDOS = ['piedra', 'gota', 'arena'];
const PASO_TACTO = 64; // cada cuántos puntos de recorrido roza el teléfono

// Las paralelas de un trazo: una por punta, corridas sobre la normal del
// camino. Es un worklet para usarlo igual en vivo (hilo de la interfaz) y al
// guardar el trazo (JavaScript).
function surcos(pts, puntas) {
  'worklet';
  const path = Skia.Path.Make();
  const n = pts.length / 2;
  if (n < 2) return path;
  for (let k = 0; k < puntas; k++) {
    const off = (k - (puntas - 1) / 2) * SEP;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
      const tx = pts[b * 2] - pts[a * 2]; const ty = pts[b * 2 + 1] - pts[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1;
      const x = pts[i * 2] - (ty / l) * off; const y = pts[i * 2 + 1] + (tx / l) * off;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
  }
  return path;
}

// El grano de la arena: miles de puntitos, fijos (la misma arena siempre).
function grano(w, h) {
  let s = 7; const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const oscuro = Skia.Path.Make(); const claro = Skia.Path.Make();
  const n = Math.round((w * h) / 140);
  for (let i = 0; i < n; i++) {
    (i % 2 ? oscuro : claro).addCircle(azar() * w, azar() * h, 0.5 + azar() * 0.9);
  }
  return { oscuro, claro };
}

// Un surco se pinta tres veces: la sombra abajo, el fondo, y el borde que
// recibe la luz arriba. Eso es lo que lo hace parecer hundido en la arena.
function Surco({ path, ancho, opacidad = 1 }) {
  return (
    <Group opacity={opacidad}>
      <Group transform={[{ translateX: 0.8 }, { translateY: 1.8 }]}>
        <Path path={path} style="stroke" strokeWidth={ancho} strokeCap="round" strokeJoin="round" color="rgba(110,78,40,0.34)" />
      </Group>
      <Path path={path} style="stroke" strokeWidth={ancho * 0.75} strokeCap="round" strokeJoin="round" color="rgba(176,142,96,0.55)" />
      <Group transform={[{ translateX: -0.8 }, { translateY: -1.6 }]}>
        <Path path={path} style="stroke" strokeWidth={ancho * 0.32} strokeCap="round" strokeJoin="round" color="rgba(255,250,238,0.75)" />
      </Group>
    </Group>
  );
}

function Piedra({ piedras, i }) {
  const x = useDerivedValue(() => piedras.value[i]?.x ?? -100);
  const y = useDerivedValue(() => piedras.value[i]?.y ?? -100);
  const r = useDerivedValue(() => piedras.value[i]?.r ?? 0);
  const luz = useDerivedValue(() => vec(x.value - r.value * 0.35, y.value - r.value * 0.45));
  const rLuz = useDerivedValue(() => r.value * 1.7);
  const brilloX = useDerivedValue(() => x.value - r.value * 0.32);
  const brilloY = useDerivedValue(() => y.value - r.value * 0.4);
  const rBrillo = useDerivedValue(() => r.value * 0.22);
  return (
    <Group>
      <Circle cx={x} cy={y} r={r}>
        <RadialGradient c={luz} r={rLuz} colors={['#A9A39B', '#6E6861', '#3E3A35']} positions={[0, 0.5, 1]} />
        <Shadow dx={4} dy={7} blur={9} color="rgba(60,40,18,0.5)" />
      </Circle>
      <Circle cx={brilloX} cy={brilloY} r={rBrillo} color="rgba(255,255,255,0.22)" />
    </Group>
  );
}

export default function Jardin() {
  const quieta = useSinMovimiento();
  const [caja, setCaja] = useState(null);
  const [puntas, setPuntas] = useState(3);
  const [hecho, setHecho] = useState(() => Skia.Path.Make());
  const [tocado, setTocado] = useState(false);
  const arena = useRef(null);
  const ancho = SEP * 0.58;

  const puntos = useSharedValue([]);
  const modo = useSharedValue(-1); // -1 rastrillo · 0..2 la piedra que se arrastra
  const recorrido = useSharedValue(0);
  const largo = useSharedValue(0);
  const piedras = useSharedValue([]);
  const nitidez = useSharedValue(1);
  const puntasV = useSharedValue(3);
  useEffect(() => { puntasV.value = puntas; }, [puntas, puntasV]);

  useEffect(() => {
    precargar(SONIDOS);
    arena.current = bucle('arena');
    return () => { arena.current?.parar(); callar(SONIDOS); };
  }, []);
  // Tres piedras, puestas como en un jardín: ninguna en el centro.
  useEffect(() => {
    if (!caja || piedras.value.length) return;
    const { w, h } = caja;
    piedras.value = [{ x: w * 0.28, y: h * 0.3, r: 24 }, { x: w * 0.7, y: h * 0.55, r: 34 }, { x: w * 0.4, y: h * 0.82, r: 18 }];
  }, [caja, piedras]);

  const textura = useMemo(() => (caja ? grano(caja.w, caja.h) : null), [caja]);
  const vivo = useDerivedValue(() => surcos(puntos.value, puntasV.value));
  // Los anillos que la arena forma alrededor de cada piedra.
  const anillos = useDerivedValue(() => {
    const path = Skia.Path.Make();
    for (const p of piedras.value) { path.addCircle(p.x, p.y, p.r + 11); path.addCircle(p.x, p.y, p.r + 22); }
    return path;
  });

  // ── Lo que pasa en JavaScript, llamado desde el gesto ────────────────────
  const sonidoArena = useCallback((vel) => { arena.current?.volumen(Math.min(0.75, vel / 1600)); }, []);
  const rozar = useCallback(() => tacto.roce(), []);
  const guardarTrazo = useCallback((pts, n) => {
    setTocado(true);
    setHecho((viejo) => { const nuevo = viejo.copy(); nuevo.addPath(surcos(pts, n)); return nuevo; });
  }, []);
  const huella = useCallback((x, y) => {
    setTocado(true);
    sonar('gota', { volumen: 0.5, tono: 0.9 + Math.random() * 0.2 });
    tacto.toque();
    setHecho((viejo) => { const nuevo = viejo.copy(); [9, 19, 29].forEach((r) => nuevo.addCircle(x, y, r)); return nuevo; });
  }, []);
  const soltarPiedra = useCallback(() => { sonar('piedra'); tacto.golpe(); }, []);
  const alzarPiedra = useCallback(() => tacto.roce(), []);

  const gesto = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onBegin((e) => {
      modo.value = -1;
      const lista = piedras.value;
      for (let i = lista.length - 1; i >= 0; i--) {
        if ((e.x - lista[i].x) ** 2 + (e.y - lista[i].y) ** 2 < (lista[i].r + 8) ** 2) { modo.value = i; break; }
      }
      if (modo.value >= 0) { runOnJS(alzarPiedra)(); return; }
      puntos.value = [e.x, e.y];
      recorrido.value = 0; largo.value = 0;
    })
    .onUpdate((e) => {
      if (modo.value >= 0) {
        const i = modo.value;
        const copia = piedras.value.slice();
        copia[i] = { ...copia[i], x: e.x, y: e.y };
        piedras.value = copia;
        return;
      }
      const p = puntos.value; const n = p.length;
      const d = Math.hypot(e.x - p[n - 2], e.y - p[n - 1]);
      if (d < 4) return;
      puntos.value = [...p, e.x, e.y];
      largo.value += d;
      recorrido.value += d;
      if (recorrido.value >= PASO_TACTO) { recorrido.value = 0; runOnJS(rozar)(); }
      runOnJS(sonidoArena)(Math.hypot(e.velocityX, e.velocityY));
    })
    .onFinalize((e) => {
      if (modo.value >= 0) { modo.value = -1; runOnJS(soltarPiedra)(); return; }
      runOnJS(sonidoArena)(0);
      const pts = puntos.value;
      if (largo.value < 6) runOnJS(huella)(e.x, e.y);
      else runOnJS(guardarTrazo)(pts, puntasV.value);
      puntos.value = [];
    }), [alzarPiedra, guardarTrazo, huella, largo, modo, piedras, puntasV, puntos, recorrido, rozar, soltarPiedra, sonidoArena]);

  const alisar = () => {
    sonar('gota', { volumen: 0.35, tono: 0.7 });
    arena.current?.volumen(0.5);
    tacto.toque();
    const vaciar = () => { setHecho(Skia.Path.Make()); nitidez.value = 1; arena.current?.volumen(0); };
    if (quieta) { vaciar(); return; }
    nitidez.value = withTiming(0, { duration: 650 }, (ok) => { if (ok) runOnJS(vaciar)(); });
  };

  return (
    <Escena colores={ESCENAS.jardin} fijo luces={false}>
      <ControlesSensaciones izquierda={<OpcionesJuego valor={puntas} alCambiar={setPuntas} opciones={RASTRILLOS} />} />
      <View style={{ flex: 1, borderRadius: 30, overflow: 'hidden', borderWidth: 6, borderColor: '#6B4F33',
        shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; setCaja({ w: w - 12, h: h - 12 }); }}
        accessible accessibilityLabel="Jardín zen. Arrastra el dedo para rastrillar la arena, toca para dejar una huella o arrastra una piedra para moverla.">
        {caja && textura ? (
          <GestureDetector gesture={gesto}>
            <Canvas style={{ flex: 1 }}>
              <Rect x={0} y={0} width={caja.w} height={caja.h}>
                <LinearGradient start={vec(0, 0)} end={vec(caja.w, caja.h)} colors={['#EFE3CB', '#E2D1B1', '#D6C29E']} />
              </Rect>
              <Path path={textura.oscuro} color="rgba(120,90,52,0.16)" />
              <Path path={textura.claro} color="rgba(255,255,255,0.35)" />
              <Surco path={anillos} ancho={ancho} />
              <Group opacity={nitidez}>
                <Surco path={hecho} ancho={ancho} />
              </Group>
              <Surco path={vivo} ancho={ancho} />
              {[0, 1, 2].map((i) => <Piedra key={i} piedras={piedras} i={i} />)}
            </Canvas>
          </GestureDetector>
        ) : null}
        {!tocado ? (
          <Animated.View pointerEvents="none" exiting={quieta ? undefined : FadeOut.duration(400)}
            style={{ position: 'absolute', left: 0, right: 0, top: '42%', alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: 'rgba(90,64,34,0.7)', textAlign: 'center' }}>Dibuja en la arena con el dedo</Text>
            <Text style={{ fontSize: 14, color: 'rgba(90,64,34,0.55)', marginTop: 4 }}>y arrastra las piedras donde quieras</Text>
          </Animated.View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: BLANCO_2 }}>Sin puntaje ni final: rastrilla despacio y sigue tu respiración.</Text>
        <BotonJuego secundario sf="sparkles" alTocar={alisar}>Alisar</BotonJuego>
      </View>
    </Escena>
  );
}
