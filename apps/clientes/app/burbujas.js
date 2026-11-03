// Burbujas (Bienestar, 2026-11-03; rehecho el mismo día: «no vibran, no tienen
// sonido… que se vean modernos»). El plástico de burbujas, dibujado con Skia:
// cada burbuja tiene su brillo y su sombra, y al reventarla suena un «pop»
// (tres distintos, con el tono corrido un poco para que dos seguidos no suenen
// iguales), el teléfono da un golpe seco y salta una chispa.
//
// Se puede tocar de a una o ARRASTRAR el dedo y reventar una fila entera, que
// es lo más satisfactorio del plástico de verdad. Al terminar la hoja sale una
// nueva, de otro color. El total queda en el teléfono.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Canvas, Circle, Group, Oval, Path, RadialGradient, Shadow, Skia, rect, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { Confeti, useSinMovimiento } from '../componentes/animacion';
import { BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, textoAyuda } from '../componentes/juegos/Escena';
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
  ['#FFD38A', '#FF8A4F'], ['#C9A8FF', '#7A5CE0'],
];
const DURA_CHISPA = 0.45;

function Burbuja({ x, y, r, color, reventada }) {
  const [claro, fuerte] = color;
  if (reventada) {
    // Aplastada: más chica, apagada y con el pliegue en cruz del plástico.
    const pliegue = Skia.Path.Make();
    pliegue.moveTo(x - r * 0.45, y - r * 0.1); pliegue.lineTo(x + r * 0.4, y + r * 0.15);
    pliegue.moveTo(x - r * 0.1, y - r * 0.4); pliegue.lineTo(x + r * 0.05, y + r * 0.42);
    return (
      <Group>
        <Circle cx={x} cy={y} r={r * 0.86} color="rgba(255,255,255,0.07)" />
        <Circle cx={x} cy={y} r={r * 0.86} style="stroke" strokeWidth={1.2} color="rgba(255,255,255,0.18)" />
        <Path path={pliegue} style="stroke" strokeWidth={1.4} strokeCap="round" color="rgba(255,255,255,0.22)" />
      </Group>
    );
  }
  return (
    <Group>
      <Circle cx={x} cy={y} r={r}>
        <RadialGradient c={vec(x - r * 0.35, y - r * 0.4)} r={r * 1.5} colors={['#FFFFFF', claro, fuerte]} positions={[0, 0.35, 1]} />
        <Shadow dx={0} dy={4} blur={6} color="rgba(0,0,0,0.30)" />
      </Circle>
      <Circle cx={x} cy={y} r={r} style="stroke" strokeWidth={1.2} color="rgba(255,255,255,0.55)" />
      {/* El brillo que la hace ver inflada, y un reflejo chico abajo. */}
      <Oval rect={rect(x - r * 0.58, y - r * 0.66, r * 0.62, r * 0.36)} color="rgba(255,255,255,0.75)" />
      <Circle cx={x + r * 0.42} cy={y + r * 0.42} r={r * 0.09} color="rgba(255,255,255,0.45)" />
    </Group>
  );
}

export default function Burbujas() {
  const quieta = useSinMovimiento();
  const [caja, setCaja] = useState(null);
  const [hoja, setHoja] = useState(() => Array(N).fill(false));
  const [numHoja, setNumHoja] = useState(0);
  const [total, setTotal] = useState(0);
  const [festejo, setFestejo] = useState(false);
  const guardar = useRef(null);
  const hojaRef = useRef(hoja);
  hojaRef.current = hoja;

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v); if (Number.isFinite(n)) setTotal((x) => x + n); }).catch(() => {});
    return () => { clearTimeout(guardar.current); callar(SONIDOS); };
  }, []);
  useEffect(() => {
    if (!total) return;
    clearTimeout(guardar.current);
    guardar.current = setTimeout(() => SecureStore.setItemAsync(CLAVE, String(total)).catch(() => {}), 800);
  }, [total]);

  // La geometría del tablero: celdas cuadradas centradas en la caja medida.
  const geo = useMemo(() => {
    if (!caja) return null;
    const celda = Math.min(caja.w / COLUMNAS, caja.h / FILAS);
    const x0 = (caja.w - celda * COLUMNAS) / 2;
    const y0 = (caja.h - celda * FILAS) / 2;
    return { celda, x0, y0, r: celda * 0.4 };
  }, [caja]);

  // Las chispas: un reloj y una lista de reventones en el hilo de la interfaz.
  const ahora = useSharedValue(0);
  const chispas = useSharedValue([]);
  useFrameCallback((f) => { ahora.value += (f.timeSincePreviousFrame ?? 16) / 1000; }, !quieta);
  const dibujoChispas = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const t = ahora.value;
    for (const c of chispas.value) {
      const e = (t - c.t) / DURA_CHISPA;
      if (e < 0 || e > 1) continue;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + c.giro;
        const d = c.r * (0.9 + e * 1.1);
        path.addCircle(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, Math.max(0.1, 3.2 * (1 - e)));
      }
    }
    return path;
  });
  const anillos = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const t = ahora.value;
    for (const c of chispas.value) {
      const e = (t - c.t) / DURA_CHISPA;
      if (e < 0 || e > 1) continue;
      path.addCircle(c.x, c.y, c.r * (0.8 + e * 0.9));
    }
    return path;
  });

  const reventar = useCallback((i) => {
    if (hojaRef.current[i]) return;
    const nueva = hojaRef.current.slice(); nueva[i] = true;
    hojaRef.current = nueva;
    setHoja(nueva);
    setTotal((x) => x + 1);
    sonar(`pop-${1 + (i % 3)}`, { tono: 0.88 + Math.random() * 0.3, volumen: 0.9 });
    tacto.toque();
    if (geo) {
      const cx = geo.x0 + (i % COLUMNAS + 0.5) * geo.celda;
      const cy = geo.y0 + (Math.floor(i / COLUMNAS) + 0.5) * geo.celda;
      const t = ahora.value;
      chispas.value = [...chispas.value.filter((c) => t - c.t < DURA_CHISPA), { x: cx, y: cy, r: geo.r, t, giro: Math.random() * 3 }];
    }
  }, [geo, ahora, chispas]);

  // ¿Qué burbuja hay bajo el dedo? Sólo cuenta si cae DENTRO del círculo, no
  // en el hueco entre dos: así arrastrar en diagonal no revienta de más.
  const tocar = useCallback((x, y) => {
    if (!geo) return;
    const col = Math.floor((x - geo.x0) / geo.celda);
    const fila = Math.floor((y - geo.y0) / geo.celda);
    if (col < 0 || col >= COLUMNAS || fila < 0 || fila >= FILAS) return;
    const cx = geo.x0 + (col + 0.5) * geo.celda;
    const cy = geo.y0 + (fila + 0.5) * geo.celda;
    if ((x - cx) ** 2 + (y - cy) ** 2 > (geo.r * 1.08) ** 2) return;
    reventar(fila * COLUMNAS + col);
  }, [geo, reventar]);

  const gesto = useMemo(() => Gesture.Pan().minDistance(0).maxPointers(1)
    .onBegin((e) => { runOnJS(tocar)(e.x, e.y); })
    .onUpdate((e) => { runOnJS(tocar)(e.x, e.y); }), [tocar]);

  // Hoja completa: festejo, y una nueva de otro color.
  const completa = hoja.every(Boolean);
  useEffect(() => {
    if (!completa) return undefined;
    sonar('ganar', { volumen: 0.8 });
    tacto.exito();
    setFestejo(true);
    const id = setTimeout(() => { setNumHoja((x) => x + 1); setHoja(Array(N).fill(false)); }, 1100);
    return () => clearTimeout(id);
  }, [completa]);

  const color = HOJAS[numHoja % HOJAS.length];
  const quedan = hoja.filter((x) => !x).length;
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
        onAccessibilityAction={() => { const i = hoja.findIndex((x) => !x); if (i >= 0) reventar(i); }}>
        {geo ? (
          <GestureDetector gesture={gesto}>
            <Canvas style={{ flex: 1 }}>
              {hoja.map((r, i) => (
                <Burbuja key={`${numHoja}-${i}`} reventada={r} color={color} r={geo.r}
                  x={geo.x0 + (i % COLUMNAS + 0.5) * geo.celda} y={geo.y0 + (Math.floor(i / COLUMNAS) + 0.5) * geo.celda} />
              ))}
              <Path path={anillos} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.55)" />
              <Path path={dibujoChispas} color={color[0]} />
            </Canvas>
          </GestureDetector>
        ) : null}
        {festejo && completa ? <Confeti colores={[...color, '#FFFFFF', '#FFD38A']} alTerminar={() => setFestejo(false)} /> : null}
      </View>
      <Text style={[textoAyuda, { textAlign: 'center' }]}>Toca una, o arrastra el dedo y revienta toda una fila.</Text>
      <BotonJuego secundario sf="arrow.clockwise" alTocar={() => { setHoja(Array(N).fill(false)); setNumHoja((x) => x + 1); }}>Hoja nueva</BotonJuego>
    </Escena>
  );
}
