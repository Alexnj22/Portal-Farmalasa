// Memoria (Bienestar, 2026-11-03; rehecho el mismo día: «no vibran, no tienen
// sonido… que se vean modernos»). Parejas de íconos de la farmacia en tres
// niveles. Las cartas giran en 3D; al acertar suenan dos notas que suben y la
// pareja brilla, al fallar la carta tiembla y suena una nota grave — sin
// regañar. Los aciertos seguidos son una RACHA, y cada uno suena un tono más
// arriba. Al terminar: estrellas según los movimientos, el tiempo y el récord
// de ese nivel, que queda en el teléfono.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Confeti, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio } from '../componentes/juegos/Escena';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const NIVELES = {
  facil: { texto: 'Fácil', detalle: '6 parejas', parejas: 6, columnas: 3 },
  normal: { texto: 'Normal', detalle: '8 parejas', parejas: 8, columnas: 4 },
  dificil: { texto: 'Difícil', detalle: '10 parejas', parejas: 10, columnas: 4 },
};
const FIGURAS = [
  { sf: 'heart.fill', colores: ['#FF6B9A', '#E0336E'] },
  { sf: 'leaf.fill', colores: ['#6EE7A8', '#1FA36A'] },
  { sf: 'pills.fill', colores: ['#8BB8FF', '#3D6BFF'] },
  { sf: 'drop.fill', colores: ['#7FE3FF', '#1C9BD8'] },
  { sf: 'star.fill', colores: ['#FFD86B', '#F5A100'] },
  { sf: 'syringe.fill', colores: ['#C6A6FF', '#7A4DE8'] },
  { sf: 'moon.fill', colores: ['#A3B1FF', '#4B4FC9'] },
  { sf: 'sparkles', colores: ['#FF9DE6', '#C43BB8'] },
  { sf: 'sun.max.fill', colores: ['#FFC17A', '#F2711C'] },
  { sf: 'cross.case.fill', colores: ['#FF8F8F', '#D93636'] },
];
const SONIDOS = ['voltear', 'par', 'fallo', 'ganar', 'toque-1', 'toque-2', 'toque-3', 'toque-4', 'toque-5', 'toque-6'];
const clave = (nivel) => `puntos_salud_memoria_record_${nivel}`;

function barajar(parejas) {
  const figs = FIGURAS.slice(0, parejas);
  const cartas = [...figs, ...figs].map((f, i) => ({ id: i, ...f }));
  for (let i = cartas.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cartas[i], cartas[j]] = [cartas[j], cartas[i]];
  }
  return cartas;
}
const reloj = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
// Estrellas: perfecto es una vuelta por pareja; se tolera un poco más.
const estrellas = (movs, parejas) => (movs <= parejas * 1.4 ? 3 : movs <= parejas * 2 ? 2 : 1);

const Carta = memo(function Carta({ carta, ancho, alto, abierta, hecha, fallo, alTocar, quieta }) {
  const giro = useSharedValue(0);
  const pulso = useSharedValue(1);
  const temblor = useSharedValue(0);
  useEffect(() => { giro.value = withTiming(abierta || hecha ? 1 : 0, { duration: quieta ? 0 : 320 }); }, [abierta, hecha, giro, quieta]);
  useEffect(() => {
    if (hecha && !quieta) pulso.value = withSequence(withDelay(200, withSpring(1.1, { damping: 6, stiffness: 300 })), withSpring(1, { damping: 10 }));
  }, [hecha, pulso, quieta]);
  useEffect(() => {
    if (fallo && !quieta) temblor.value = withSequence(withTiming(-7, { duration: 50 }), withTiming(7, { duration: 70 }), withTiming(-5, { duration: 60 }), withTiming(0, { duration: 50 }));
  }, [fallo, temblor, quieta]);
  const envoltura = useAnimatedStyle(() => ({ transform: [{ translateX: temblor.value }, { scale: pulso.value }] }));
  const frente = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 1 : 0, transform: [{ perspective: 800 }, { rotateY: `${interpolate(giro.value, [0, 1], [180, 360])}deg` }] }));
  const atras = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 0 : 1, transform: [{ perspective: 800 }, { rotateY: `${interpolate(giro.value, [0, 1], [0, 180])}deg` }] }));
  const caja = { position: 'absolute', top: 0, left: 0, width: ancho, height: alto, borderRadius: 18, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backfaceVisibility: 'hidden' };
  const nombre = carta.sf.split('.')[0];
  return (
    <Pressable onPress={() => alTocar(carta.id)} disabled={abierta || hecha} style={{ width: ancho, height: alto }}
      accessibilityRole="button" accessibilityLabel={hecha ? `Pareja ${nombre}, encontrada` : abierta ? `Carta ${nombre}` : 'Carta boca abajo'}>
      <Animated.View style={[{ width: ancho, height: alto }, envoltura]}>
        <Animated.View style={[caja, atras]}>
          <LinearGradient colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0.08)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[caja, { position: 'relative', borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)' }]}>
            {/* El dorso: un rombo de puntos, la marca de la casa. */}
            <View style={{ width: ancho * 0.36, height: ancho * 0.36, borderRadius: 10, transform: [{ rotate: '45deg' }], borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' }} />
            </View>
          </LinearGradient>
        </Animated.View>
        <Animated.View style={[caja, frente]}>
          <LinearGradient colors={carta.colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[caja, { position: 'relative' }]}>
            <View style={{ position: 'absolute', top: -ancho * 0.3, left: -ancho * 0.2, width: ancho, height: ancho * 0.7, borderRadius: ancho, backgroundColor: 'rgba(255,255,255,0.18)' }} />
            <Icono sf={carta.sf} respaldo="●" tam={Math.min(ancho, alto) * 0.42} color={BLANCO} />
            {hecha ? <View style={{ position: 'absolute', right: 6, top: 6 }}><Icono sf="checkmark.circle.fill" respaldo="✓" tam={16} color="rgba(255,255,255,0.9)" /></View> : null}
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});

export default function Memoria() {
  const quieta = useSinMovimiento();
  const { width } = useWindowDimensions();
  const [nivel, setNivel] = useState('normal');
  const conf = NIVELES[nivel];
  const [cartas, setCartas] = useState(() => barajar(conf.parejas));
  const [abiertas, setAbiertas] = useState([]);
  const [hechas, setHechas] = useState(() => new Set());
  const [fallidas, setFallidas] = useState([]);
  const [movs, setMovs] = useState(0);
  const [racha, setRacha] = useState(0);
  const [mejorRacha, setMejorRacha] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [empezo, setEmpezo] = useState(false);
  const [record, setRecord] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const espera = useRef(null);
  const gano = hechas.size === cartas.length;

  useEffect(() => { precargar(SONIDOS); return () => { clearTimeout(espera.current); callar(SONIDOS); }; }, []);
  useEffect(() => {
    setRecord(null);
    SecureStore.getItemAsync(clave(nivel)).then((v) => { const n = Number(v); if (v && Number.isFinite(n)) setRecord(n); }).catch(() => {});
  }, [nivel]);
  // El reloj corre desde la primera carta hasta la última pareja.
  useEffect(() => {
    if (!empezo || gano) return undefined;
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [empezo, gano]);

  const alTocar = useCallback((id) => {
    if (espera.current || abiertas.length >= 2) return;
    setEmpezo(true);
    sonar('voltear');
    tacto.roce();
    const dos = [...abiertas, id];
    setAbiertas(dos);
    if (dos.length < 2) return;
    setMovs((m) => m + 1);
    const [a, b] = dos.map((x) => cartas.find((c) => c.id === x));
    if (a.sf === b.sf) {
      const r = racha + 1;
      setRacha(r); setMejorRacha((m) => Math.max(m, r));
      espera.current = setTimeout(() => {
        espera.current = null;
        sonar('par');
        if (r > 1) sonar(`toque-${Math.min(6, r)}`, { volumen: 0.6 });
        tacto.exito();
        setHechas((h) => new Set([...h, a.id, b.id]));
        setAbiertas([]);
      }, 260);
    } else {
      setRacha(0);
      espera.current = setTimeout(() => {
        sonar('fallo', { volumen: 0.6 });
        tacto.aviso();
        setFallidas(dos);
        espera.current = setTimeout(() => { espera.current = null; setAbiertas([]); setFallidas([]); }, 520);
      }, 420);
    }
  }, [abiertas, cartas, racha]);

  useEffect(() => {
    if (!gano) return;
    sonar('ganar');
    tacto.exito();
    if (record == null || movs < record) {
      setNuevoRecord(true);
      setRecord(movs);
      SecureStore.setItemAsync(clave(nivel), String(movs)).catch(() => {});
    }
  }, [gano]); // eslint-disable-line react-hooks/exhaustive-deps

  const reiniciar = (n = nivel) => {
    clearTimeout(espera.current); espera.current = null;
    setCartas(barajar(NIVELES[n].parejas)); setAbiertas([]); setHechas(new Set()); setFallidas([]);
    setMovs(0); setRacha(0); setMejorRacha(0); setSegundos(0); setEmpezo(false); setNuevoRecord(false);
  };
  const cambiarNivel = (n) => { setNivel(n); reiniciar(n); };

  const hueco = 10;
  const cols = conf.columnas;
  const ancho = Math.floor((Math.min(width, 560) - 32 - hueco * (cols - 1)) / cols);
  const alto = Math.round(ancho * (cols === 3 ? 1.05 : 1.2));
  const parejas = hechas.size / 2;
  const nEstrellas = estrellas(movs, conf.parejas);

  return (
    <Escena colores={ESCENAS.memoria}>
      <ControlesSensaciones izquierda={<>
        <Marcador sf="timer" texto={reloj(segundos)} etiqueta={`Tiempo ${reloj(segundos)}`} />
        <Marcador sf="hand.tap.fill" texto={`${movs}`} etiqueta={`${movs} movimientos`} />
      </>} />

      {empezo && !gano ? null : <OpcionesJuego valor={nivel} alCambiar={cambiarNivel}
        opciones={Object.entries(NIVELES).map(([valor, x]) => ({ valor, texto: x.texto, detalle: x.detalle }))} />}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }}>
        <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '700', color: BLANCO_2 }}>Parejas {parejas} de {conf.parejas}</Text>
        {racha > 1 ? (
          <Animated.Text key={racha} entering={quieta ? undefined : ZoomIn.springify()} style={{ fontSize: 15, fontWeight: '900', color: '#FFE08A' }}>
            ¡Racha ×{racha}!
          </Animated.Text>
        ) : (
          <Text style={{ fontSize: 15, fontWeight: '700', color: BLANCO_2 }}>{record != null ? `Récord: ${record}` : ''}</Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: hueco }}>
        {cartas.map((c) => (
          <Carta key={`${nivel}-${c.id}-${cartas.length}`} carta={c} ancho={ancho} alto={alto} quieta={quieta}
            abierta={abiertas.includes(c.id)} hecha={hechas.has(c.id)} fallo={fallidas.includes(c.id)} alTocar={alTocar} />
        ))}
      </View>

      {gano ? (
        <View>
          <PanelVidrio estilo={{ alignItems: 'center', gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`${nEstrellas} de 3 estrellas`}>
              {[1, 2, 3].map((k) => (
                <Animated.View key={k} entering={quieta ? undefined : ZoomIn.delay(k * 160).springify()}>
                  <Icono sf="star.fill" respaldo="★" tam={34} color={k <= nEstrellas ? '#FFD86B' : 'rgba(255,255,255,0.22)'} />
                </Animated.View>
              ))}
            </View>
            <Text style={{ fontSize: 22, fontWeight: '800', color: BLANCO }}>{nuevoRecord ? '¡Nuevo récord!' : '¡Lo lograste!'}</Text>
            <Text style={{ fontSize: 15, color: BLANCO_2, textAlign: 'center' }}>
              {conf.parejas} parejas en {movs} movimientos y {reloj(segundos)}.{mejorRacha > 1 ? ` Mejor racha: ${mejorRacha}.` : ''}
            </Text>
          </PanelVidrio>
          <Confeti colores={['#FFD86B', '#6EE7A8', '#8BB8FF', '#FF6B9A']} />
        </View>
      ) : null}
      <BotonJuego sf={gano ? 'play.fill' : 'shuffle'} secundario={!gano} alTocar={() => reiniciar()}>{gano ? 'Jugar otra vez' : 'Barajar de nuevo'}</BotonJuego>
    </Escena>
  );
}
