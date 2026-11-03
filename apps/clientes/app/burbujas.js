// Burbujas (Bienestar, 2026-11-03). El plástico de burbujas, dibujado con Skia.
//
// Tercera versión, el mismo día: «el juego de las burbujas se me traba». La
// segunda le preguntaba a JavaScript por CADA cuadro del arrastre (un
// `runOnJS` por movimiento del dedo), volvía a pintar las 35 burbujas con React
// en cada reventón y cada una llevaba un filtro de sombra. Con el dedo rápido
// el hilo de JavaScript se atoraba y el tablero se quedaba atrás.
//
// Ahora todo el juego vive en el hilo de la interfaz: qué burbuja hay bajo el
// dedo, cuáles están reventadas, la animación del reventón y las chispas.
// JavaScript sólo se entera cuando una burbuja revienta (para el sonido y la
// vibración) y React no vuelve a pintar el tablero. El arrastre además se
// interpola entre un cuadro y el siguiente: con el dedo rápido no se salta
// ninguna burbuja del camino.
//
// Lo que se siente: al reventar, la burbuja se infla un poco y se aplasta,
// suelta chispas del color de la hoja y suena un «pop» que SUBE de tono
// mientras se arrastra en racha. Una hoja nueva entra inflándose en ola.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Canvas, Circle, Group, LinearGradient, Oval, Path, RadialGradient, Rect, Skia, rect, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeOut, ZoomIn, runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { Confeti, useSinMovimiento } from '../componentes/animacion';
import { BLANCO, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, textoAyuda } from '../componentes/juegos/Escena';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const COLUMNAS = 5;
const FILAS = 7;
const N = COLUMNAS * FILAS;
const CLAVE = 'puntos_salud_burbujas_total';
const SONIDOS = ['pop-1', 'pop-2', 'pop-3', 'ganar'];
// Una paleta por hoja: la siguiente sale de otro color.
const HOJAS = [
  ['#FF8AD8', '#C04BD8'], ['#8BD6FF', '#4F7BFF'], ['#9BF0C2', '#2FB98A'],
  ['#FFD38A', '#FF8A4F'], ['#C9A8FF', '#7A5CE0'], ['#FF9C9C', '#E0446A'],
];
const POP = 0.22; // segundos que dura el aplastón
const CHISPA = 0.55; // segundos que vuelan las chispas
const OLA = 0.75; // lo que tarda una hoja nueva en inflarse entera
const VACIAS = () => new Array(N).fill(-1);

const Burbuja = memo(function Burbuja({ i, x, y, r, color, marcas, ahora, nace }) {
  const [claro, fuerte] = color;
  // 0 = entera, 1 = reventada del todo.
  const e = useDerivedValue(() => {
    const m = marcas.value[i];
    return m < 0 ? 0 : Math.max(0, Math.min(1, (ahora.value - m) / POP));
  });
  // La ola de una hoja nueva: cada burbuja se infla con un rebote, un poco
  // después que la anterior.
  const infla = useDerivedValue(() => {
    const k = Math.max(0, Math.min(1, (ahora.value - nace.value - i * 0.012) / 0.38));
    const t = k - 1; const s = 1.9;
    return 1 + (s + 1) * t * t * t + s * t * t;
  });
  const llenaT = useDerivedValue(() => [{ scale: infla.value * (1 + 0.24 * Math.sin(e.value * Math.PI * 0.5)) }]);
  const llenaO = useDerivedValue(() => (e.value >= 1 ? 0 : 1 - e.value * e.value));
  const vaciaO = useDerivedValue(() => e.value);
  const pliegue = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(x - r * 0.45, y - r * 0.1); p.lineTo(x + r * 0.4, y + r * 0.15);
    p.moveTo(x - r * 0.1, y - r * 0.4); p.lineTo(x + r * 0.05, y + r * 0.42);
    return p;
  }, [x, y, r]);
  const origen = vec(x, y);
  return (
    <Group>
      <Group opacity={vaciaO}>
        <Circle cx={x} cy={y} r={r * 0.86} color="rgba(255,255,255,0.07)" />
        <Circle cx={x} cy={y} r={r * 0.86} style="stroke" strokeWidth={1.2} color="rgba(255,255,255,0.2)" />
        <Path path={pliegue} style="stroke" strokeWidth={1.4} strokeCap="round" color="rgba(255,255,255,0.25)" />
      </Group>
      <Group opacity={llenaO} transform={llenaT} origin={origen}>
        {/* La sombra es un círculo corrido, no un filtro: 35 filtros de sombra eran la mitad del costo. */}
        <Circle cx={x} cy={y + r * 0.14} r={r * 1.02} color="rgba(20,0,40,0.32)" />
        <Circle cx={x} cy={y} r={r}>
          <RadialGradient c={vec(x - r * 0.35, y - r * 0.4)} r={r * 1.5} colors={['#FFFFFF', claro, fuerte]} positions={[0, 0.35, 1]} />
        </Circle>
        <Circle cx={x} cy={y} r={r} style="stroke" strokeWidth={1.2} color="rgba(255,255,255,0.55)" />
        <Oval rect={rect(x - r * 0.58, y - r * 0.66, r * 0.62, r * 0.36)} color="rgba(255,255,255,0.78)" />
        <Circle cx={x + r * 0.42} cy={y + r * 0.42} r={r * 0.09} color="rgba(255,255,255,0.45)" />
      </Group>
    </Group>
  );
});

export default function Burbujas() {
  const quieta = useSinMovimiento();
  const [caja, setCaja] = useState(null);
  const [numHoja, setNumHoja] = useState(0);
  const [quedan, setQuedan] = useState(N);
  const [total, setTotal] = useState(0);
  const [racha, setRacha] = useState(0);
  const [festejo, setFestejo] = useState(0);
  const guardar = useRef(null);
  const relojHoja = useRef(null);

  // El estado del tablero vive en el hilo de la interfaz.
  const marcas = useSharedValue(VACIAS()); // cuándo reventó cada una (-1 = entera)
  const restan = useSharedValue(N);
  const rachaV = useSharedValue(0);
  const ultimo = useSharedValue({ x: -1, y: -1 });
  const tiempo = useSharedValue(0); // reloj que corre siempre
  const ahora = useSharedValue(0); // el reloj que miran los dibujos: sólo avanza si algo se mueve
  const hasta = useSharedValue(OLA + 0.1);
  const nace = useSharedValue(0);
  const chispas = useSharedValue([]);
  const geoV = useSharedValue(null);
  const bloqueada = useSharedValue(false);

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v); if (Number.isFinite(n)) setTotal((x) => x + n); }).catch(() => {});
    return () => { clearTimeout(guardar.current); clearTimeout(relojHoja.current); callar(SONIDOS); };
  }, []);
  useEffect(() => {
    if (!total) return;
    clearTimeout(guardar.current);
    guardar.current = setTimeout(() => SecureStore.setItemAsync(CLAVE, String(total)).catch(() => {}), 800);
  }, [total]);

  const geo = useMemo(() => {
    if (!caja) return null;
    const celda = Math.min(caja.w / COLUMNAS, caja.h / FILAS);
    return { celda, x0: (caja.w - celda * COLUMNAS) / 2, y0: (caja.h - celda * FILAS) / 2, r: celda * 0.4 };
  }, [caja]);
  useEffect(() => { geoV.value = geo; }, [geo, geoV]);

  useFrameCallback((f) => {
    tiempo.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const meta = quieta ? hasta.value : Math.min(tiempo.value, hasta.value);
    if (ahora.value !== meta) ahora.value = meta;
  });

  // Las chispas y el anillo de cada reventón, en dos trazos para todo el tablero.
  const dibujoChispas = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const t = ahora.value;
    for (const c of chispas.value) {
      const k = (t - c.t) / CHISPA;
      if (k < 0 || k > 1) continue;
      for (let j = 0; j < 9; j++) {
        const a = (j / 9) * Math.PI * 2 + c.giro;
        const d = c.r * (0.8 + k * (1.3 + (j % 3) * 0.25));
        path.addCircle(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d + k * k * c.r * 0.9, Math.max(0.1, (2.2 + (j % 2) * 1.4) * (1 - k)));
      }
    }
    return path;
  });
  const anillos = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const t = ahora.value;
    for (const c of chispas.value) {
      const k = (t - c.t) / (CHISPA * 0.7);
      if (k < 0 || k > 1) continue;
      path.addCircle(c.x, c.y, c.r * (0.85 + k * 0.85));
    }
    return path;
  });

  const nuevaHoja = useCallback(() => {
    clearTimeout(relojHoja.current);
    marcas.value = VACIAS();
    restan.value = N;
    chispas.value = [];
    nace.value = tiempo.value;
    hasta.value = tiempo.value + OLA + 0.1;
    bloqueada.value = false;
    setQuedan(N);
    setRacha(0);
    setNumHoja((x) => x + 1);
    sonar('pop-2', { volumen: 0.35, tono: 1.4 });
  }, [bloqueada, chispas, hasta, marcas, nace, restan, tiempo]);

  // JavaScript sólo hace lo que no puede hacer el hilo de la interfaz: sonar y vibrar.
  const alReventar = useCallback((n, quedanAhora, i) => {
    sonar(`pop-${1 + (i % 3)}`, { tono: 0.86 + Math.min(n, 14) * 0.035 + Math.random() * 0.08, volumen: 0.9 });
    tacto.toque();
    setTotal((x) => x + 1);
    setQuedan(quedanAhora);
    setRacha(n);
    if (quedanAhora === 0) {
      sonar('ganar', { volumen: 0.8 });
      tacto.exito();
      setFestejo((k) => k + 1);
      relojHoja.current = setTimeout(nuevaHoja, 1200);
    }
  }, [nuevaHoja]);

  const gesto = useMemo(() => {
    const probar = (x, y) => {
      'worklet';
      const g = geoV.value;
      if (!g || bloqueada.value) return;
      const col = Math.floor((x - g.x0) / g.celda);
      const fila = Math.floor((y - g.y0) / g.celda);
      if (col < 0 || col >= COLUMNAS || fila < 0 || fila >= FILAS) return;
      const cx = g.x0 + (col + 0.5) * g.celda;
      const cy = g.y0 + (fila + 0.5) * g.celda;
      // Sólo dentro del círculo, no en el hueco entre dos: así arrastrar en
      // diagonal no revienta de más.
      if ((x - cx) ** 2 + (y - cy) ** 2 > (g.r * 1.08) ** 2) return;
      const i = fila * COLUMNAS + col;
      if (marcas.value[i] >= 0) return;
      const m = marcas.value.slice();
      const t = tiempo.value;
      m[i] = t;
      marcas.value = m;
      restan.value -= 1;
      rachaV.value += 1;
      if (restan.value === 0) bloqueada.value = true;
      chispas.value = [...chispas.value.filter((c) => t - c.t < CHISPA), { x: cx, y: cy, r: g.r, t, giro: (i * 1.7) % 6.28 }];
      hasta.value = Math.max(hasta.value, t + CHISPA + 0.05);
      runOnJS(alReventar)(rachaV.value, restan.value, i);
    };
    // Entre un cuadro y el siguiente el dedo puede avanzar más que una burbuja:
    // se prueba también el camino, cada medio radio.
    const recorrer = (x, y) => {
      'worklet';
      const g = geoV.value;
      const a = ultimo.value;
      if (g && a.x >= 0) {
        const d = Math.hypot(x - a.x, y - a.y);
        const pasos = Math.min(24, Math.floor(d / (g.r * 0.5)));
        for (let k = 1; k <= pasos; k++) probar(a.x + ((x - a.x) * k) / (pasos + 1), a.y + ((y - a.y) * k) / (pasos + 1));
      }
      probar(x, y);
      ultimo.value = { x, y };
    };
    return Gesture.Pan().minDistance(0).maxPointers(1)
      .onBegin((e) => { rachaV.value = 0; ultimo.value = { x: -1, y: -1 }; recorrer(e.x, e.y); })
      .onUpdate((e) => { recorrer(e.x, e.y); })
      .onFinalize(() => { ultimo.value = { x: -1, y: -1 }; });
  }, [alReventar, bloqueada, chispas, geoV, hasta, marcas, rachaV, restan, tiempo, ultimo]);

  const color = HOJAS[numHoja % HOJAS.length];
  const celdas = useMemo(() => (geo ? Array.from({ length: N }, (_, i) => ({
    i, x: geo.x0 + (i % COLUMNAS + 0.5) * geo.celda, y: geo.y0 + (Math.floor(i / COLUMNAS) + 0.5) * geo.celda,
  })) : []), [geo]);

  return (
    <Escena colores={ESCENAS.burbujas} fijo>
      <ControlesSensaciones izquierda={<>
        <Marcador sf="circle.grid.3x3.fill" texto={quedan ? `Quedan ${quedan}` : '¡Hoja lista!'} />
        <Marcador sf="sparkles" texto={entero(total)} etiqueta={`${entero(total)} reventadas en total`} />
      </>} />
      <View style={{ flex: 1, borderRadius: 30, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; setCaja({ w, h }); }}
        accessible accessibilityLabel={`Hoja de burbujas. Quedan ${quedan}. Toca o arrastra el dedo para reventarlas.`}
        accessibilityActions={[{ name: 'activate', label: 'Reventar una burbuja' }]}
        onAccessibilityAction={() => {
          const i = marcas.value.findIndex((m) => m < 0);
          if (i < 0) return;
          const m = marcas.value.slice(); m[i] = tiempo.value; marcas.value = m;
          restan.value -= 1; hasta.value = tiempo.value + POP + 0.05;
          alReventar(1, restan.value, i);
        }}>
        {geo ? (
          <GestureDetector gesture={gesto}>
            <Canvas style={{ flex: 1 }}>
              {/* El brillo del plástico, en diagonal. */}
              <Rect x={0} y={0} width={caja.w} height={caja.h}>
                <LinearGradient start={vec(0, 0)} end={vec(caja.w, caja.h)}
                  colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']} positions={[0, 0.35, 0.55, 1]} />
              </Rect>
              {celdas.map((c) => (
                <Burbuja key={c.i} i={c.i} x={c.x} y={c.y} r={geo.r} color={color} marcas={marcas} ahora={ahora} nace={nace} />
              ))}
              <Path path={anillos} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.6)" />
              <Path path={dibujoChispas} color={color[0]} />
            </Canvas>
          </GestureDetector>
        ) : null}
        {racha >= 3 && quedan > 0 ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <Animated.View key={racha} entering={ZoomIn.springify().damping(10)} exiting={FadeOut.duration(150)}
              style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: BLANCO }}>¡Racha ×{racha}!</Text>
            </Animated.View>
          </View>
        ) : null}
        {festejo ? <Confeti key={festejo} colores={[...color, '#FFFFFF', '#FFD38A']} alTerminar={() => {}} /> : null}
      </View>
      <Text style={[textoAyuda, { textAlign: 'center' }]}>Toca una, o arrastra el dedo sin soltar: cuantas más seguidas, más agudo el «pop».</Text>
      <BotonJuego secundario sf="arrow.clockwise" alTocar={nuevaHoja}>Hoja nueva</BotonJuego>
    </Escena>
  );
}
