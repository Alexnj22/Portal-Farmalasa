// Memoria (Bienestar, 2026-11-03; rehecho el mismo día: «no vibran, no tienen
// sonido… que se vean modernos»). Parejas de íconos de la farmacia en tres
// niveles. Las cartas giran en 3D; al acertar suenan dos notas que suben y la
// pareja brilla, al fallar la carta tiembla y suena una nota grave — sin
// regañar. Los aciertos seguidos son una RACHA, y cada uno suena un tono más
// arriba. Al terminar: estrellas según los movimientos, el tiempo y el récord
// de ese nivel, que queda en el teléfono.
//
// Niveles (2026-11-04, «aplica los niveles a los juegos que ya están»): doce
// tableros que crecen de 3×4 a 6×6. Los primeros enseñan las cartas un momento
// antes de empezar («Memoriza»); después ese vistazo se acorta y desaparece, y
// los últimos MEZCLAN una vez las cartas que quedan a mitad de partida. Cada
// nivel tiene su meta de movimientos para las tres estrellas. «Libre» es el
// juego de antes, con sus tres tamaños y su récord.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Confeti, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { AvisoJuego, BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio } from '../componentes/juegos/Escena';
import { Estrellas, SelectorNiveles, TarjetaNivel, useProgreso } from '../componentes/juegos/Niveles';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';
import { useVisible } from '../lib/visible';

// El juego libre de antes: tres tamaños, cada uno con su récord.
const LIBRE = {
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
  { sf: 'thermometer.medium', colores: ['#FFB38A', '#E2603A'] },
  { sf: 'testtube.2', colores: ['#8AF0E0', '#16A89A'] },
  { sf: 'diamond.fill', colores: ['#9FD0FF', '#2E7FE0'] },
  { sf: 'crown.fill', colores: ['#FFE38A', '#D99A00'] },
  { sf: 'gift.fill', colores: ['#FFA3C8', '#D6337A'] },
  { sf: 'birthday.cake.fill', colores: ['#E0B3FF', '#9A4DE0'] },
  { sf: 'mountain.2.fill', colores: ['#A8E6A0', '#3E9B4A'] },
  { sf: 'bell.fill', colores: ['#FFD0A0', '#E08A2E'] },
];
// Los niveles: el tablero crece, el vistazo inicial (segundos) se acorta y al
// final las cartas se mezclan una vez a mitad de partida.
const NIVELES = [
  { parejas: 6, columnas: 3, vistazo: 3 },
  { parejas: 6, columnas: 3, vistazo: 1.5 },
  { parejas: 8, columnas: 4, vistazo: 2.5 },
  { parejas: 8, columnas: 4, vistazo: 0 },
  { parejas: 10, columnas: 4, vistazo: 2.5 },
  { parejas: 10, columnas: 4, vistazo: 0 },
  { parejas: 10, columnas: 4, vistazo: 0, mezcla: true },
  { parejas: 12, columnas: 4, vistazo: 2.5 },
  { parejas: 12, columnas: 4, vistazo: 0, mezcla: true },
  { parejas: 15, columnas: 5, vistazo: 3 },
  { parejas: 15, columnas: 5, vistazo: 0, mezcla: true },
  { parejas: 18, columnas: 6, vistazo: 0, mezcla: true },
];
const CLAVE_NIVEL = 'puntos_salud_memoria_nivel';
const CLAVE_ESTRELLAS = 'puntos_salud_memoria_estrellas';
const MODOS = [{ valor: 'niveles', texto: 'Niveles', detalle: `${NIVELES.length} tableros` }, { valor: 'libre', texto: 'Libre' }];
// Metas de movimientos: con vistazo se pide más precisión; si se mezclan, se perdona un poco más.
function metas(c) {
  const extra = c.mezcla ? 2 : 0;
  return { tres: Math.ceil(c.parejas * (c.vistazo ? 1.5 : 1.75)) + extra, dos: Math.ceil(c.parejas * 2.3) + extra + (c.mezcla ? 1 : 0) };
}
const estrellasNivel = (movs, c) => { const m = metas(c); return movs <= m.tres ? 3 : movs <= m.dos ? 2 : 1; };
const forma = (c) => `${c.columnas}×${(c.parejas * 2) / c.columnas}`;
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
// Estrellas del modo libre: perfecto es una vuelta por pareja; se tolera un poco más.
const estrellasLibre = (movs, parejas) => (movs <= parejas * 1.4 ? 3 : movs <= parejas * 2 ? 2 : 1);

const Carta = memo(function Carta({ carta, ancho, alto, abierta, hecha, fallo, mezcla, alTocar, quieta }) {
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
  // Al mezclarse, las que quedan se encogen y vuelven: boca abajo son todas
  // iguales, y sin esto el cambio de lugar no se notaría.
  useEffect(() => {
    if (mezcla && !hecha && !quieta) pulso.value = withSequence(withTiming(0.82, { duration: 160 }), withSpring(1, { damping: 9, stiffness: 260 }));
  }, [mezcla]); // eslint-disable-line react-hooks/exhaustive-deps
  const envoltura = useAnimatedStyle(() => ({ transform: [{ translateX: temblor.value }, { scale: pulso.value }] }));
  const frente = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 1 : 0, transform: [{ perspective: 800 }, { rotateY: `${interpolate(giro.value, [0, 1], [180, 360])}deg` }] }));
  const atras = useAnimatedStyle(() => ({ opacity: giro.value > 0.5 ? 0 : 1, transform: [{ perspective: 800 }, { rotateY: `${interpolate(giro.value, [0, 1], [0, 180])}deg` }] }));
  const caja = { position: 'absolute', top: 0, left: 0, width: ancho, height: alto, borderRadius: Math.min(18, Math.round(ancho * 0.24)), alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backfaceVisibility: 'hidden' };
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
              <View style={{ width: Math.max(5, ancho * 0.08), height: Math.max(5, ancho * 0.08), borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' }} />
            </View>
          </LinearGradient>
        </Animated.View>
        <Animated.View style={[caja, frente]}>
          <LinearGradient colors={carta.colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[caja, { position: 'relative' }]}>
            <View style={{ position: 'absolute', top: -ancho * 0.3, left: -ancho * 0.2, width: ancho, height: ancho * 0.7, borderRadius: ancho, backgroundColor: 'rgba(255,255,255,0.18)' }} />
            <Icono sf={carta.sf} respaldo="●" tam={Math.min(ancho, alto) * 0.42} color={BLANCO} />
            {hecha ? <View style={{ position: 'absolute', right: 5, top: 5 }}><Icono sf="checkmark.circle.fill" respaldo="✓" tam={ancho < 64 ? 12 : 16} color="rgba(255,255,255,0.9)" /></View> : null}
          </LinearGradient>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});

export default function Memoria() {
  const quieta = useSinMovimiento();
  const { width } = useWindowDimensions();
  const progreso = useProgreso(CLAVE_NIVEL, CLAVE_ESTRELLAS);
  const [modo, setModo] = useState('niveles');
  const [fase, setFase] = useState('elegir'); // en niveles: elegir · jugando
  const [numNivel, setNumNivel] = useState(1);
  const [libre, setLibre] = useState('normal');
  const conf = modo === 'niveles' ? NIVELES[numNivel - 1] : LIBRE[libre];
  const [cartas, setCartas] = useState(() => barajar(LIBRE.normal.parejas));
  const [abiertas, setAbiertas] = useState([]);
  const [hechas, setHechas] = useState(() => new Set());
  const [fallidas, setFallidas] = useState([]);
  const [movs, setMovs] = useState(0);
  const [racha, setRacha] = useState(0);
  const [mejorRacha, setMejorRacha] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [empezo, setEmpezo] = useState(false);
  const [vistazo, setVistazo] = useState(false);
  const [mezcla, setMezcla] = useState(0);
  const [aviso, setAviso] = useState(null);
  const [record, setRecord] = useState(null);
  const [nuevoRecord, setNuevoRecord] = useState(false);
  const [resultado, setResultado] = useState(null); // { estrellas, primera, mejoro }
  const espera = useRef(null);
  const relojes = useRef([]);
  const mezclada = useRef(false);
  const hechasRef = useRef(hechas);
  hechasRef.current = hechas;
  const enJuego = modo === 'libre' || fase === 'jugando';
  const gano = enJuego && cartas.length > 0 && hechas.size === cartas.length;

  const limpiar = () => { clearTimeout(espera.current); espera.current = null; relojes.current.forEach(clearTimeout); relojes.current = []; };
  const luego = (fn, ms) => { relojes.current.push(setTimeout(fn, ms)); };
  useEffect(() => { precargar(SONIDOS); return () => { limpiar(); callar(SONIDOS); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (modo !== 'libre') return;
    setRecord(null);
    SecureStore.getItemAsync(clave(libre)).then((v) => { const n = Number(v); if (v && Number.isFinite(n)) setRecord(n); }).catch(() => {});
  }, [libre, modo]);
  // El reloj corre desde la primera carta hasta la última pareja — y sólo con
  // el juego a la vista (2026-11-04, auditoría de rendimiento): con la app en
  // segundo plano o en otra pantalla seguía sumando y pintando cada segundo, y
  // al volver el tiempo incluía el rato que nadie jugó. Se pausa y sigue.
  const visible = useVisible();
  useEffect(() => {
    if (!empezo || gano || !visible) return undefined;
    const id = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [empezo, gano, visible]);

  const preparar = (c) => {
    limpiar();
    mezclada.current = false;
    setCartas(barajar(c.parejas)); setAbiertas([]); setHechas(new Set()); setFallidas([]);
    setMovs(0); setRacha(0); setMejorRacha(0); setSegundos(0); setEmpezo(false); setNuevoRecord(false);
    setResultado(null); setAviso(null); setMezcla(0);
    // El vistazo: todas boca arriba un momento, y se dan vuelta solas.
    if (c.vistazo) {
      setVistazo(true);
      setAviso({ k: Date.now(), texto: 'Memoriza…' });
      luego(() => { setVistazo(false); setAviso(null); sonar('voltear', { volumen: 0.6 }); tacto.roce(); }, 500 + c.vistazo * 1000);
    } else setVistazo(false);
  };

  const jugarNivel = (n) => { setNumNivel(n); setFase('jugando'); preparar(NIVELES[n - 1]); };
  const cambiarModo = (m) => {
    setModo(m);
    if (m === 'libre') preparar(LIBRE[libre]);
    else { limpiar(); setFase('elegir'); setVistazo(false); setAviso(null); }
  };
  const cambiarLibre = (n) => { setLibre(n); preparar(LIBRE[n]); };

  // Las que quedan cambian de lugar entre ellas; las parejas hechas no se mueven.
  const mezclar = () => {
    setCartas((prev) => {
      const sitios = []; const sueltas = [];
      prev.forEach((c, i) => { if (!hechasRef.current.has(c.id)) { sitios.push(i); sueltas.push(c); } });
      for (let i = sueltas.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [sueltas[i], sueltas[j]] = [sueltas[j], sueltas[i]]; }
      const nuevo = prev.slice();
      sitios.forEach((s, k) => { nuevo[s] = sueltas[k]; });
      return nuevo;
    });
    setMezcla((k) => k + 1);
    setAviso({ k: Date.now(), texto: '¡Se mezclaron!' });
    sonar('voltear'); tacto.aviso();
    luego(() => setAviso(null), 1600);
  };
  const alTocar = useCallback((id) => {
    if (espera.current || abiertas.length >= 2 || vistazo) return;
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
      if (r > 1) setAviso({ k: r, texto: `¡Racha ×${r}!` });
      espera.current = setTimeout(() => {
        espera.current = null;
        sonar('par');
        if (r > 1) sonar(`toque-${Math.min(6, r)}`, { volumen: 0.6 });
        tacto.exito();
        const nuevas = new Set([...hechasRef.current, a.id, b.id]);
        setHechas(nuevas);
        setAbiertas([]);
        // A mitad de partida, en los niveles que lo dicen, una sola vez.
        const pares = nuevas.size / 2;
        if (conf.mezcla && !mezclada.current && pares === Math.floor(conf.parejas / 2)) {
          mezclada.current = true;
          espera.current = setTimeout(() => { espera.current = null; mezclar(); }, 450);
        }
      }, 260);
    } else {
      setRacha(0);
      setAviso((x) => (x && x.texto.startsWith('¡Racha') ? null : x));
      espera.current = setTimeout(() => {
        sonar('fallo', { volumen: 0.6 });
        tacto.aviso();
        setFallidas(dos);
        espera.current = setTimeout(() => { espera.current = null; setAbiertas([]); setFallidas([]); }, 520);
      }, 420);
    }
  }, [abiertas, cartas, racha, vistazo, conf]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!gano) return;
    sonar('ganar');
    tacto.exito();
    setAviso(null);
    if (modo === 'niveles') {
      const k = estrellasNivel(movs, conf);
      const r = progreso.registrar(numNivel, k);
      setResultado({ estrellas: k, ...r });
      return;
    }
    if (record == null || movs < record) {
      setNuevoRecord(true);
      setRecord(movs);
      SecureStore.setItemAsync(clave(libre), String(movs)).catch(() => {});
    }
  }, [gano]); // eslint-disable-line react-hooks/exhaustive-deps

  const hueco = conf.columnas >= 5 ? 7 : 10;
  const cols = conf.columnas;
  const ancho = Math.floor((Math.min(width, 560) - 32 - hueco * (cols - 1)) / cols);
  const alto = Math.round(ancho * (cols === 3 ? 1.05 : cols >= 5 ? 1.12 : 1.2));
  const parejas = hechas.size / 2;
  const meta = modo === 'niveles' ? metas(conf) : null;
  const ultimo = numNivel >= NIVELES.length;

  return (
    <Escena colores={ESCENAS.memoria}>
      <ControlesSensaciones izquierda={enJuego ? <>
        {modo === 'niveles' ? <Marcador sf="square.grid.2x2.fill" texto={`Nivel ${numNivel}`} /> : null}
        <Marcador sf="timer" texto={reloj(segundos)} etiqueta={`Tiempo ${reloj(segundos)}`} />
        <Marcador sf="hand.tap.fill" texto={`${movs}`} etiqueta={`${movs} movimientos`} />
      </> : null} />

      {empezo && !gano ? null : <OpcionesJuego opciones={MODOS} valor={modo} alCambiar={cambiarModo} />}

      {modo === 'niveles' && fase === 'elegir' ? (
        <>
          <SelectorNiveles total={NIVELES.length} progreso={progreso} alElegir={jugarNivel}
            detalle={(n) => { const c = NIVELES[n - 1]; return c.mezcla ? `${forma(c)} · mezcla` : c.vistazo ? `${forma(c)} · vistazo` : forma(c); }} />
          <PanelVidrio>
            <Text style={{ fontSize: 14, lineHeight: 20, color: BLANCO_2 }}>
              El tablero crece con cada nivel. En los primeros verás las cartas un momento antes de empezar; en los últimos, a mitad de partida las que quedan se mezclan una vez. Menos movimientos, más estrellas.
            </Text>
          </PanelVidrio>
        </>
      ) : (
        <>
          {modo === 'libre' && !(empezo && !gano) ? (
            <OpcionesJuego valor={libre} alCambiar={cambiarLibre}
              opciones={Object.entries(LIBRE).map(([valor, x]) => ({ valor, texto: x.texto, detalle: x.detalle }))} />
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, minHeight: 32 }}>
            <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '700', color: BLANCO_2 }}>Parejas {parejas} de {conf.parejas}</Text>
            {aviso ? <AvisoJuego clave={aviso.k} texto={aviso.texto} /> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {meta ? <><Estrellas n={3} tam={12} hueco={1} /><Text style={{ fontSize: 14, fontWeight: '700', color: BLANCO_2 }}>en {meta.tres} o menos</Text></> : (
                  <Text style={{ fontSize: 15, fontWeight: '700', color: BLANCO_2 }}>{record != null ? `Récord: ${record}` : ''}</Text>
                )}
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: hueco }}>
            {cartas.map((c) => (
              <Carta key={c.id} carta={c} ancho={ancho} alto={alto} quieta={quieta} mezcla={mezcla}
                abierta={vistazo || abiertas.includes(c.id)} hecha={hechas.has(c.id)} fallo={fallidas.includes(c.id)} alTocar={alTocar} />
            ))}
          </View>

          {gano && modo === 'niveles' && resultado ? (
            <View>
              <TarjetaNivel estrellas={resultado.estrellas} fondo="rgba(4,30,36,0.55)"
                insignia={resultado.mejoro && !resultado.primera ? '¡MÁS ESTRELLAS!' : null}
                titulo={ultimo ? '¡Terminaste todos los niveles!' : `¡Nivel ${numNivel} listo!`}
                texto={`${movs} movimientos en ${reloj(segundos)}.${resultado.estrellas < 3 ? ` Para tres estrellas: ${meta.tres} o menos.` : ''}${mejorRacha > 1 ? ` Mejor racha: ${mejorRacha}.` : ''}`}>
                {!ultimo ? <BotonJuego sf="play.fill" alTocar={() => jugarNivel(numNivel + 1)}>Siguiente nivel</BotonJuego> : null}
                <BotonJuego secundario sf="arrow.clockwise" alTocar={() => jugarNivel(numNivel)}>Repetir</BotonJuego>
                <BotonJuego secundario sf="square.grid.2x2.fill" alTocar={() => setFase('elegir')}>Niveles</BotonJuego>
              </TarjetaNivel>
              <Confeti colores={['#FFD86B', '#6EE7A8', '#8BB8FF', '#FF6B9A']} />
            </View>
          ) : null}

          {gano && modo === 'libre' ? (
            <View>
              <TarjetaNivel estrellas={estrellasLibre(movs, conf.parejas)} fondo="rgba(4,30,36,0.55)"
                titulo={nuevoRecord ? '¡Nuevo récord!' : '¡Lo lograste!'}
                texto={`${conf.parejas} parejas en ${movs} movimientos y ${reloj(segundos)}.${mejorRacha > 1 ? ` Mejor racha: ${mejorRacha}.` : ''}`}>
                <BotonJuego sf="play.fill" alTocar={() => preparar(conf)}>Jugar otra vez</BotonJuego>
              </TarjetaNivel>
              <Confeti colores={['#FFD86B', '#6EE7A8', '#8BB8FF', '#FF6B9A']} />
            </View>
          ) : null}

          {!gano ? (
            <View style={{ gap: 10 }}>
              <BotonJuego sf="shuffle" secundario alTocar={() => preparar(conf)}>{modo === 'niveles' ? 'Empezar de nuevo' : 'Barajar de nuevo'}</BotonJuego>
              {modo === 'niveles' ? <BotonJuego sf="square.grid.2x2.fill" secundario alTocar={() => { limpiar(); setVistazo(false); setFase('elegir'); }}>Niveles</BotonJuego> : null}
            </View>
          ) : null}
        </>
      )}
    </Escena>
  );
}
