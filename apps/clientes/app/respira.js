// Respira (Bienestar, 2026-11-03; rehecho el mismo día: «no vibran, no tienen
// sonido… que se vean modernos»). Una esfera de luz que crece al inhalar, se
// queda al sostener y se apaga al exhalar, con un aro que cuenta la fase.
//
// Se puede hacer CON LOS OJOS CERRADOS, que es la idea: cada fase tiene su
// sonido (un acorde que crece al inhalar y se apaga al exhalar, un cuenco al
// empezar y al terminar) y el teléfono late una vez por segundo mientras se
// inhala o exhala. Tres técnicas, las tres con la exhalación igual o más larga
// que la inhalación, que es lo que baja las pulsaciones.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { Canvas, Circle, Group, Path, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSinMovimiento } from '../componentes/animacion';
import { BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const TECNICAS = {
  calma: { texto: 'Calma', detalle: '4 · 4 · 6', fases: [['inhala', 4], ['sostén', 4], ['exhala', 6]] },
  caja: { texto: 'Caja', detalle: '4 · 4 · 4 · 4', fases: [['inhala', 4], ['sostén', 4], ['exhala', 4], ['pausa', 4]] },
  dormir: { texto: 'Dormir', detalle: '4 · 7 · 8', fases: [['inhala', 4], ['sostén', 7], ['exhala', 8]] },
};
const FASE = {
  inhala: { texto: 'Inhala', ayuda: 'por la nariz', hasta: 1 },
  'sostén': { texto: 'Sostén', ayuda: 'suave, sin apretar', hasta: null },
  exhala: { texto: 'Exhala', ayuda: 'lento, por la boca', hasta: 0 },
  pausa: { texto: 'Pausa', ayuda: 'vacío y tranquilo', hasta: null },
};
const MINUTOS = [1, 3, 5];
const SONIDOS = ['inhalar', 'exhalar', 'campana', 'gota'];
const PUNTOS = 14;

function NoApagar() { useKeepAwake(); return null; }

function Esfera({ lado, p, avance, reloj }) {
  const c = lado / 2;
  const rMin = lado * 0.17;
  const rMax = lado * 0.36;
  const r = useDerivedValue(() => rMin + (rMax - rMin) * p.value);
  const halo1 = useDerivedValue(() => r.value * 1.25);
  const halo2 = useDerivedValue(() => r.value * 1.55);
  const centro = vec(c, c);
  // El aro de la fase: se dibuja de 0 a `avance` alrededor de la esfera.
  const aro = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(c, c, lado * 0.46);
    return path;
  }, [c, lado]);
  // Las chispas giran despacio a la distancia de la esfera.
  const chispas = useDerivedValue(() => {
    const path = Skia.Path.Make();
    for (let i = 0; i < PUNTOS; i++) {
      const a = (i / PUNTOS) * Math.PI * 2 + reloj.value * 0.25;
      const d = r.value * 1.32 + Math.sin(reloj.value * 1.3 + i) * 6;
      path.addCircle(c + Math.cos(a) * d, c + Math.sin(a) * d, 1.6 + (i % 3) * 0.7);
    }
    return path;
  });
  return (
    <Canvas style={{ width: lado, height: lado }}>
      <Group>
        {/* Los halos son degradados, no desenfoques: un BlurMask de radio 30 que
            cambia de tamaño en cada cuadro era lo más caro de la pantalla. */}
        <Circle cx={c} cy={c} r={halo2}>
          <RadialGradient c={centro} r={halo2} colors={['rgba(140,170,255,0.28)', 'rgba(140,170,255,0.10)', 'rgba(140,170,255,0)']} positions={[0.45, 0.7, 1]} />
        </Circle>
        <Circle cx={c} cy={c} r={halo1}>
          <RadialGradient c={centro} r={halo1} colors={['rgba(190,160,255,0.45)', 'rgba(170,150,255,0.18)', 'rgba(170,150,255,0)']} positions={[0.6, 0.8, 1]} />
        </Circle>
        <Circle cx={c} cy={c} r={r}>
          <RadialGradient c={vec(c - lado * 0.06, c - lado * 0.08)} r={rMax * 1.1}
            colors={['#FFFFFF', '#C9D7FF', '#8C9BFF', '#7A5CE0']} positions={[0, 0.25, 0.65, 1]} />
        </Circle>
        <Path path={chispas} color="rgba(255,255,255,0.75)" />
        <Path path={aro} style="stroke" strokeWidth={3} color="rgba(255,255,255,0.14)" />
        <Path path={aro} style="stroke" strokeWidth={4} strokeCap="round" color="rgba(255,255,255,0.9)" start={0} end={avance} />
      </Group>
      {/* El centro marca el punto que no cambia: ayuda a no perder la vista. */}
      <Circle cx={centro.x} cy={centro.y} r={2} color="rgba(255,255,255,0.5)" />
    </Canvas>
  );
}

export default function Respira() {
  const quieta = useSinMovimiento();
  const { width } = useWindowDimensions();
  const lado = Math.min(width - 32, 360);
  const [tecnica, setTecnica] = useState('calma');
  const [minutos, setMinutos] = useState(1);
  const [activo, setActivo] = useState(false);
  const [fase, setFase] = useState(null);
  const [resta, setResta] = useState(0);
  const [ciclos, setCiclos] = useState(0);
  const [terminado, setTerminado] = useState(false);
  const p = useSharedValue(0);
  const avance = useSharedValue(0);
  const reloj = useSharedValue(0);
  const timers = useRef([]);
  const fases = TECNICAS[tecnica].fases;
  const duracionCiclo = fases.reduce((s, [, seg]) => s + seg, 0);
  const total = Math.max(1, Math.round((minutos * 60) / duracionCiclo));

  useFrameCallback((f) => { reloj.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000); }, !quieta);
  useEffect(() => { precargar(SONIDOS); return () => { limpiar(); callar(SONIDOS); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function limpiar() { timers.current.forEach(clearTimeout); timers.current = []; }
  const despues = (ms, f) => { timers.current.push(setTimeout(f, ms)); };

  const parar = (completo = false) => {
    limpiar();
    callar(['inhalar', 'exhalar']);
    cancelAnimation(p); cancelAnimation(avance);
    p.value = withTiming(0, { duration: 700 });
    avance.value = withTiming(0, { duration: 400 });
    setActivo(false); setFase(null);
    if (completo) { setTerminado(true); sonar('campana', { volumen: 0.8 }); tacto.exito(); }
  };

  const empezar = () => {
    setTerminado(false); setCiclos(0); setActivo(true);
    sonar('campana', { volumen: 0.7 });
    tacto.toque();
    let n = 0;
    const paso = (i) => {
      if (i === 0 && n >= total) { parar(true); return; }
      const [clave, seg] = fases[i];
      const f = FASE[clave];
      setFase(clave); setResta(seg);
      avance.value = 0;
      avance.value = withTiming(1, { duration: seg * 1000, easing: Easing.linear });
      if (f.hasta != null) p.value = withTiming(f.hasta, { duration: seg * 1000, easing: Easing.inOut(Easing.sin) });
      if (clave === 'inhala') sonar('inhalar', { volumen: 0.6, tono: 4 / seg });
      else if (clave === 'exhala') sonar('exhalar', { volumen: 0.6, tono: 6 / seg });
      else sonar('gota', { volumen: 0.35 });
      tacto.toque();
      // Un latido por segundo: con los ojos cerrados se siente el ritmo.
      for (let s = 1; s < seg; s++) {
        despues(s * 1000, () => {
          setResta(seg - s);
          if (clave === 'inhala' || clave === 'exhala') tacto.roce();
        });
      }
      despues(seg * 1000, () => {
        if (i === fases.length - 1) { n += 1; setCiclos(n); }
        paso((i + 1) % fases.length);
      });
    };
    // Medio segundo para que suene el cuenco antes de la primera inhalación.
    despues(600, () => paso(0));
  };

  const f = fase ? FASE[fase] : null;
  return (
    <Escena colores={ESCENAS.respira}>
      {activo ? <NoApagar /> : null}
      <ControlesSensaciones izquierda={activo ? <Marcador sf="wind" texto={`${Math.min(ciclos + 1, total)} de ${total}`} etiqueta={`Respiración ${Math.min(ciclos + 1, total)} de ${total}`} /> : null} />

      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Esfera lado={lado} p={p} avance={avance} reloj={reloj} />
        <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center' }}>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 36, fontWeight: '800', color: '#1B1B4A', textShadowColor: 'rgba(255,255,255,0.6)', textShadowRadius: 12 }}>
            {f ? f.texto : terminado ? '¡Bien hecho!' : 'Respira'}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: 'rgba(27,27,74,0.75)' }}>
            {f ? `${f.ayuda} · ${resta}` : terminado ? `${ciclos} respiraciones` : 'cuando estés listo'}
          </Text>
        </View>
      </View>

      {activo ? null : (
        <View style={{ gap: 12 }}>
          <OpcionesJuego valor={tecnica} alCambiar={setTecnica}
            opciones={Object.entries(TECNICAS).map(([valor, x]) => ({ valor, texto: x.texto, detalle: x.detalle }))} />
          <OpcionesJuego valor={minutos} alCambiar={setMinutos} opciones={MINUTOS.map((m) => ({ valor: m, texto: `${m} min` }))} />
        </View>
      )}

      <BotonJuego sf={activo ? 'stop.fill' : 'play.fill'} secundario={activo} alTocar={activo ? () => parar(false) : empezar}>
        {activo ? 'Detener' : terminado ? 'Otra vez' : 'Empezar'}
      </BotonJuego>

      <PanelVidrio>
        <Text style={textoAyuda}>
          {tecnica === 'dormir'
            ? 'Para conciliar el sueño: hazla acostado, con la luz baja. Si sostener 7 segundos te cuesta, no fuerces.'
            : tecnica === 'caja'
              ? 'La respiración en caja: cuatro lados iguales. La usan para calmarse antes de un momento difícil.'
              : 'Siéntate cómodo, apoya los pies en el suelo y relaja los hombros.'}
          {' '}Puedes cerrar los ojos: el sonido y la vibración te guían. Si te mareas, vuelve a respirar normal.
        </Text>
      </PanelVidrio>
    </Escena>
  );
}
