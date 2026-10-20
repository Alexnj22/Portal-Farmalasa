// El cupón del mes (Platino, 2026-10-07). Tres estados:
//   · Sin raspar: una capa plateada que se raspa con el dedo; debajo, el
//     premio (300, 500 o 1,000 puntos: no se sabe hasta rasparlo).
//   · Vigente: el cupón con un brillo que pasa cada pocos segundos.
//   · Usado: en gris, con el sello «USADO» (o lo que queda, si se usó una parte).
// Se usa en caja como cualquier saldo, mostrando la tarjeta.
//
// Premio que NO es puntos (2026-10-19): el raspable también puede dar un
// producto o un regalo promocional (`cupon.premio`). Ése no va al saldo: se
// RETIRA en una sucursal que el cliente elige acá, con el código del premio.
// «Usado» pasa a ser «ya lo retiraste».
import { useDespierta } from './reposo';
import { useMoviendoValor } from './movimiento';
import { LIVIANO } from '../lib/rendimiento';
import { useSesion } from '../lib/sesion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Canvas, Group, LinearGradient as SkGradiente, notifyChange, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, interpolate, runOnJS, runOnUI, useAnimatedReaction, useAnimatedStyle, useFrameCallback, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Icono from './Icono';
import { COLORES_NIVEL } from './TarjetaSocio';
import Mineral, { MATERIALES } from './minerales/Mineral';
import { Confeti } from './animacion';
import { dolares, fechaLarga } from '../lib/formato';

// La línea punteada entre las muescas: por ahí se «corta» al usarlo.
const CORTE = 86;
// Lo que se abre la ranura del corte al usarse (dentro de la caja del cupón).
const RANURA = 7;

// Los premios viven en otra tabla y sus ids se repiten con los de los lotes:
// su marca lleva el prefijo para no heredar el «raspado» de otro.
const clave = (c) => `puntos_salud_cupon_raspado_${c?.clase === 'premio' ? 'premio-' : ''}${String(c?.id).replace(/[^\w-]/g, '')}`;
const textoPremio = (p) => `${Number(p.cantidad) > 1 ? `${p.cantidad} × ` : ''}${p.nombre}`;

// `demo` (modo de prueba): cada vez que cambia, el cupón se tapa y se raspa
// solo, para ver la animación completa sin gastar el del mes.
export default function Cupon({ cupon, nivel: nivelDado = 'platino', fondo, activa = true, demo = 0, alCambiar }) {
  const nivel = nivelDado === 'vip' ? 'bronce' : nivelDado;
  const [raspado, setRaspado] = useState(null); // null = leyendo
  // Sólo los cupones reales (id numérico) se anotan en el servidor; los de prueba no.
  const pedirSesion = useSesion((x) => x.pedir);
  const pedir = Number.isFinite(Number(cupon?.id)) ? pedirSesion : null;
  const [festejo, setFestejo] = useState(false);
  const [auto, setAuto] = useState(false);
  // El premio «salta» al descubrirse, y el cupón destella.
  const salto = useSharedValue(1);
  const destello = useSharedValue(0);
  const estiloSalto = useAnimatedStyle(() => ({ transform: [{ scale: salto.value }] }));
  // El cupón lleva el MATERIAL del nivel o del rango (2026-10-08), vivo: sin
  // giroscopio, una luz que va y viene sola sobre las facetas o el metal.
  // Reposo (componentes/reposo.js, 2026-10-14): a los 20 s sin tocar, la luz
  // y el brillo se quedan quietos; tocar la pantalla los despierta.
  // Y quietos mientras la pantalla se desplaza (lib/desplazamiento.js,
  // 2026-10-14): el material se recalculaba en los mismos cuadros del scroll.
  // Como valor compartido (2026-10-15): lo leen los worklets y el cupón no se
  // repinta dos veces por cada gesto de desplazamiento.
  const moviendo = useMoviendoValor();
  const enUso = useDespierta(activa);
  // La luz que va y viene ya no son dos `withRepeat` aparte (2026-10-15): la
  // calcula el material con su propio reloj de 30 cuadros (`luzSola`), así
  // que se para con él —al dejar de verse, en reposo, al desplazar— y en un
  // teléfono liviano queda quieta, como el resto del material.
  const estiloDestello = useAnimatedStyle(() => ({ opacity: destello.value }));
  useEffect(() => {
    if (!demo) return;
    setRaspado(false); setAuto(true);
  }, [demo]);
  useEffect(() => {
    if (!cupon?.id) return;
    // El servidor manda (`cupon.raspado`); el teléfono es respaldo y lo sube si el servidor no lo sabía.
    if (cupon.raspado) { setRaspado(true); return; }
    SecureStore.getItemAsync(clave(cupon)).catch(() => null).then((v) => {
      setRaspado(v === '1');
      if (v === '1' && !auto) pedir?.('cupon_raspado', { id: cupon.id, clase: cupon.clase }).catch(() => {});
    });
  }, [cupon?.id]);

  // Usado (2026-10-08): las muescas ya decían «por aquí se corta», así que al
  // usarse el cupón se CORTA por la línea punteada: la parte grande se separa
  // del talón con un tirón, se inclina un poco y cae el sello. Si se abre la
  // app con el cupón ya usado, se ve cortado y quieto.
  const premio = cupon?.premio ?? null;
  const usadoAhora = !!cupon && (premio ? !!premio.entregado : cupon.restantes <= 0);
  const [medida, setMedida] = useState(null);
  const corte = useSharedValue(usadoAhora ? 1 : 0);
  const sello = useSharedValue(usadoAhora ? 1 : 0);
  const antes = useRef(null);
  useEffect(() => {
    if (antes.current === false && usadoAhora) {
      // El «rasgado»: tres vibraciones cortas, un tironcito y la abertura.
      [0, 70, 140].forEach((ms) => setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}), ms));
      corte.value = withSequence(withTiming(0.3, { duration: 110, easing: Easing.out(Easing.quad) }), withTiming(0.12, { duration: 120 }),
        withSpring(1, { damping: 16, stiffness: 120 }));
      sello.value = 0;
      sello.value = withDelay(520, withSpring(1, { damping: 14, stiffness: 220 }));
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}), 600);
    } else if (!usadoAhora) {
      corte.value = 0; sello.value = 0;
    } else if (antes.current == null) {
      corte.value = 1; sello.value = 1;
    }
    antes.current = usadoAhora;
  }, [usadoAhora]); // eslint-disable-line react-hooks/exhaustive-deps
  // El corte NO sale de la caja del cupón (2026-10-09, «choca con las cards de
  // abajo»): antes la parte grande se corría 12 px y giraba 3° sobre su
  // esquina, y su punta bajaba ~18 px encima de la tarjeta siguiente. Ahora se
  // ABRE una ranura en la línea punteada: la parte grande se angosta desde la
  // izquierda en vez de moverse, así su borde derecho no se mueve nunca. Sin
  // giro, sin desplazamiento vertical y sin escala fuera de su caja.
  const ancho = medida?.ancho ?? 0;
  // Con TRANSFORMACIONES (2026-10-15), no con `left`/`width`: animar la
  // posición y el ancho rehacía el layout en cada cuadro del corte. Ahora la
  // ventana de la parte grande se corre `abre` a la derecha y su contenido lo
  // mismo a la izquierda —queda quieto—; lo que sobra a la derecha lo recorta
  // la caja fija de afuera, que es la que lleva las esquinas redondeadas.
  const estiloParte = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(0, corte.value) * 0.08,
    transform: [{ translateX: Math.max(0, corte.value) * RANURA }],
  }));
  const estiloContenidoParte = useAnimatedStyle(() => ({ transform: [{ translateX: -Math.max(0, corte.value) * RANURA }] }));
  // El sello cae con poca escala (1.35 → 1): se nota sin cubrir media pantalla.
  const estiloSello = useAnimatedStyle(() => ({
    opacity: Math.min(1, sello.value * 1.6),
    transform: [{ rotate: '-12deg' }, { scale: interpolate(sello.value, [0, 1], [1.35, 1]) }],
  }));

  if (!cupon || raspado == null) return null;
  const usado = usadoAhora;
  const parcial = !premio && !usado && cupon.restantes < cupon.puntos;
  const paleta = COLORES_NIVEL[nivel] ?? COLORES_NIVEL.platino;
  const colores = usado ? ['#4A4A4F', '#8C8C93', '#5A5A60'] : paleta.frente;

  const descubrir = () => {
    if (!auto) {
      SecureStore.setItemAsync(clave(cupon), '1').catch(() => {});
      pedir?.('cupon_raspado', { id: cupon.id, clase: cupon.clase }).catch(() => {});
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 180);
    setRaspado(true);
    setAuto(false);
    setFestejo(true);
    salto.value = withSequence(withTiming(0.6, { duration: 0 }), withSpring(1.18, { damping: 6, stiffness: 220 }), withSpring(1, { damping: 12 }));
    destello.value = withSequence(withTiming(0.85, { duration: 120 }), withTiming(0, { duration: 700 }));
  };

  const sello_ = usado ? (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 14, top: 18,
      borderWidth: 3, borderColor: '#FF453A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2, backgroundColor: 'rgba(255,255,255,0.08)' }, estiloSello]}>
      <Text style={{ color: '#FF453A', fontSize: 20, fontWeight: '900', letterSpacing: 3 }}>USADO</Text>
    </Animated.View>
  ) : null;

  const cara = (
        <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ padding: 18, flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 104 }}>
          {!usado && MATERIALES.includes(nivel) ? (
            <>
              <Mineral material={nivel} luzSola pausa={moviendo} activa={enUso && !LIVIANO} />
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.22)' }]} />
            </>
          ) : null}
          <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <Icono sf={usado ? 'checkmark.seal.fill' : 'ticket.fill'} respaldo="🎟" tam={24} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, gap: 2, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.45)', paddingLeft: 16 }}>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }}>TU CUPÓN DEL MES</Text>
            <Animated.View style={[{ alignSelf: 'flex-start' }, estiloSalto]}>
              {premio ? (
                <Text numberOfLines={2} style={{ color: '#FFFFFF', fontSize: 21, fontWeight: '900', textDecorationLine: usado ? 'line-through' : 'none' }}>
                  {textoPremio(premio)}
                </Text>
              ) : (
              <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '900', fontVariant: ['tabular-nums'], textDecorationLine: usado ? 'line-through' : 'none' }}>
                {cupon.descuento ? `${cupon.descuento}% OFF` : dolares((parcial ? cupon.restantes : cupon.puntos) / 100)}
              </Text>
              )}
            </Animated.View>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
              {premio ? (usado ? 'Ya lo retiraste. ¡El próximo mes llega otro!'
                : premio.sala ? `Retíralo en ${premio.sala} con el código ${premio.codigo}.`
                : 'Es un regalo para retirar: elige en qué sucursal.')
                : usado ? 'Ya lo usaste. ¡El próximo mes llega otro!'
                : cupon.descuento ? `En una compra, hasta ${dolares(cupon.tope)}`
                : parcial ? `Te quedan ${dolares(cupon.restantes / 100)} de ${dolares(cupon.puntos / 100)}`
                  // Aclaración (2026-10-09): el premio YA está sumado al saldo;
                  // raspar sólo lo descubre. No hay nada que «reclamar».
                  : 'Ya está en tu saldo. Úsalo en caja con tu tarjeta.'}
            </Text>
            {/* Vence con el mes (2026-10-14, pedido del usuario): los puntos del
                cupón NO duran como los de las compras — `puntos_dar_cupones`
                les pone vence_el = fin de mes. Se dice con la fecha exacta y
                sólo después de raspar (antes, el premio sigue escondido). */}
            {!usado && raspado && cupon.vence ? (
              <View style={{ alignSelf: 'flex-start', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Icono sf="clock.fill" respaldo="⏰" tam={12} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>
                  Vence el {fechaLarga(cupon.vence)} — {premio ? 'retíralo' : 'úsalo'} este mes
                </Text>
              </View>
            ) : null}
            {!usado && raspado && !cupon.descuento ? (
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12 }}>{premio ? 'Si no lo retiras antes, se pierde.' : 'Si no lo canjeas antes, se pierde.'}</Text>
            ) : null}
            {/* El orden del canje (2026-10-13), el de la base
                (`puntos_canje_gasta_primero_el_cupon`): antes nadie lo decía. */}
            {!usado && !cupon.descuento && !premio ? (
              <Text style={{ color: 'rgba(255,255,255,0.78)', fontSize: 12 }}>Al canjear, primero se usa el cupón y después tus puntos.</Text>
            ) : null}
          </View>
          {!usado && raspado ? <Brillo activa={enUso && !LIVIANO} pausa={moviendo} /> : null}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF' }, estiloDestello]} />
        </LinearGradient>
  );

  return (
    <View>
      {usado && medida ? (
        // Cortado: el talón queda y la parte grande se separa. Las dos son la
        // misma cara recortada, así el corte cae justo en la línea punteada.
        // `overflow: hidden` en la caja: pase lo que pase, nada se pinta fuera.
        <View style={{ height: medida.alto, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', left: 0, top: 0, width: CORTE, height: medida.alto, overflow: 'hidden', borderTopLeftRadius: 22, borderBottomLeftRadius: 22 }}>
            <View style={{ width: medida.ancho }}>{cara}</View>
          </View>
          {/* La caja fija: el lugar de la parte grande y sus esquinas de la derecha. */}
          <View style={{ position: 'absolute', left: CORTE, top: 0, width: Math.max(0, ancho - CORTE), height: medida.alto, overflow: 'hidden',
            borderTopRightRadius: 22, borderBottomRightRadius: 22 }}>
            {/* La ventana que se corre: su borde izquierdo es la ranura. */}
            <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: Math.max(0, ancho - CORTE), height: medida.alto, overflow: 'hidden',
              borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }, estiloParte]}>
              {/* Anclada a la derecha y corrida al revés que la ventana: al
                  abrirse la ranura, el contenido —y el sello— no se mueven. */}
              <Animated.View style={[{ position: 'absolute', right: 0, top: 0, width: medida.ancho, height: medida.alto }, estiloContenidoParte]}>
                {cara}
                {sello_}
              </Animated.View>
            </Animated.View>
          </View>
        </View>
      ) : (
        <View style={{ borderRadius: 22, overflow: 'hidden' }}
          onLayout={(e) => setMedida({ ancho: e.nativeEvent.layout.width, alto: e.nativeEvent.layout.height })}>
          {cara}
          {!raspado && !usado ? <Raspable key={`${cupon.id}-${demo}`} alDescubrir={descubrir} auto={auto} activa={activa} /> : null}
          {usado ? sello_ : null}
        </View>
      )}
      {/* Las muescas de un cupón, del color del fondo. */}
      <View style={{ position: 'absolute', left: 78, top: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
      <View style={{ position: 'absolute', left: 78, bottom: -8, width: 16, height: 16, borderRadius: 8, backgroundColor: fondo }} />
      {premio && raspado && !usado && pedir ? <ElegirSala premio={premio} id={cupon.id} pedir={pedir} alCambiar={alCambiar} /> : null}
      {festejo ? <Confeti colores={['#FFD978', '#FFFFFF', '#E8ECF2', '#B5308C']} alTerminar={() => setFestejo(false)} /> : null}
    </View>
  );
}

// El brillo que cruza el cupón vigente cada ~4 s. Quieto mientras la pantalla
// se desplaza (`pausa`, valor compartido): se para y arranca en el hilo de la
// interfaz, sin repintar el cupón.
function Brillo({ activa, pausa }) {
  const x = useSharedValue(-1);
  const vivo = useSharedValue(activa);
  useEffect(() => { vivo.value = activa; }, [activa, vivo]);
  useAnimatedReaction(() => vivo.value && !pausa.value, (ahora, antes) => {
    if (ahora === antes) return;
    cancelAnimation(x);
    x.value = -1;
    if (!ahora) return;
    x.value = withRepeat(withSequence(withTiming(-1, { duration: 0 }), withDelay(2600, withTiming(1.4, { duration: 1100, easing: Easing.inOut(Easing.cubic) }))), -1);
  });
  const estilo = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 360 }, { rotate: '20deg' }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: -40, bottom: -40, width: 70 }, estilo]}>
      <LinearGradient colors={['transparent', 'rgba(255,255,255,0.35)', 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

// La capa para raspar (2026-10-08: más difícil y con más vida). Se mide lo
// raspado por CELDAS y no por largo del trazo —con el largo, tres rayas en el
// mismo sitio contaban como raspar todo—: se descubre con el 70 % de la
// superficie limpia. Mientras se raspa salta polvo plateado del dedo, la
// leyenda se apaga y el teléfono vibra.
//
// Todo en el hilo de la interfaz (2026-10-15): antes cada evento del dedo
// cruzaba a JavaScript, copiaba el trazo ENTERO (que crece con cada evento),
// lo guardaba en el estado y repintaba; y cada pizca de polvo era un
// componente nuevo montado por estado. Ahora el trazo es un valor compartido
// que el gesto alarga en su lugar (`notifyChange` avisa al lienzo), las celdas
// se marcan en el mismo worklet y el polvo es una reserva fija de pizcas que
// el worklet reutiliza. A JavaScript sólo se cruza para vibrar y al llegar a
// la meta.
const GROSOR = 24;
const COLS = 14;
const FILAS = 5;
const META = 0.7;
const CELDAS = COLS * FILAS;
// Cuántas pizcas de polvo puede haber a la vez (antes, las últimas 24 + 3).
const PIZCAS = 24;
const VIDA_PIZCA = 520;
// Worklets: se llaman también en el hilo de la interfaz, al limpiar.
const celdasVacias = () => { 'worklet'; return new Array(CELDAS + 1).fill(0); }; // la última posición es la cuenta
const pizcasVacias = () => {
  'worklet';
  const v = [];
  for (let k = 0; k < PIZCAS; k++) v.push({ x: 0, y: 0, dx: 0, dy: 0, t: 5, nace: -1 });
  return v;
};
const tocarSuave = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); };
const tocarMeta = () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); };
const tocarSeleccion = () => { Haptics.selectionAsync().catch(() => {}); };

// Si no se termina de raspar, la capa VUELVE a cubrirse (2026-10-09, pedido del
// usuario): sólo vale un cupón raspado completo. El premio ya está asignado en
// el servidor; esto es lo visual. Se restablece a los 2.5 s de soltar sin
// terminar, y también al salir de la pantalla.
function Raspable({ alDescubrir, auto = false, activa = true }) {
  const [tam, setTam] = useState(null);
  const tamUI = useSharedValue({ w: 0, h: 0 });
  const trazoInicial = useMemo(() => Skia.Path.Make(), []);
  const trazo = useSharedValue(trazoInicial);
  const celdas = useSharedValue(celdasVacias());
  const polvo = useSharedValue(pizcasVacias());
  const siguiente = useSharedValue(0);
  const ahora = useSharedValue(0);
  // El último punto del dedo y lo recorrido desde la última vibración / pizca.
  const hay = useSharedValue(false);
  const ux = useSharedValue(0);
  const uy = useSharedValue(0);
  const desdeToque = useSharedValue(0);
  const desdePolvo = useSharedValue(0);
  const listo = useSharedValue(false);
  const capa = useSharedValue(1);
  const leyenda = useSharedValue(1);
  const recubre = useSharedValue(0);
  const espera = useRef(null);
  // `alDescubrir` cambia con cada render del cupón: el worklet llama a ésta, estable.
  const descubrirRef = useRef(alDescubrir);
  descubrirRef.current = alDescubrir;
  const terminar = useMemo(() => () => descubrirRef.current?.(), []);

  // El reloj del polvo: corre sólo mientras el dedo raspa y un rato después.
  const reloj = useFrameCallback(() => { ahora.value = Date.now(); }, false);
  const apagarReloj = useRef(null);

  const limpiarUI = () => {
    'worklet';
    trazo.value.reset();
    notifyChange(trazo);
    celdas.value = celdasVacias();
    polvo.value = pizcasVacias();
    hay.value = false;
    recubre.value = 0;
  };
  const limpiar = () => runOnUI(limpiarUI)();
  const restablecer = () => {
    if (listo.value || celdas.value[CELDAS] === 0) return;
    tocarSuave();
    leyenda.value = withTiming(1, { duration: 450 });
    recubre.value = withTiming(1, { duration: 450, easing: Easing.inOut(Easing.quad) }, (fin) => { if (fin) limpiarUI(); });
  };
  useEffect(() => { if (!activa && !listo.value) { clearTimeout(espera.current); limpiar(); leyenda.value = 1; } }, [activa]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { clearTimeout(espera.current); clearTimeout(apagarReloj.current); }, []);

  // Al apoyar el dedo (una vez por gesto): no se recubre y el polvo tiene reloj.
  const empezar = () => {
    clearTimeout(espera.current);
    clearTimeout(apagarReloj.current);
    reloj.setActive(true);
  };
  const soltar = () => {
    clearTimeout(espera.current);
    clearTimeout(apagarReloj.current);
    apagarReloj.current = setTimeout(() => reloj.setActive(false), VIDA_PIZCA + 100);
    if (!listo.value && !auto) espera.current = setTimeout(restablecer, 2500);
  };

  // Un punto del dedo, en el hilo de la interfaz. `nuevo`: empieza otra raya.
  const agregarUI = (x, y, nuevo) => {
    'worklet';
    const { w, h } = tamUI.value;
    if (listo.value || !w) return;
    const cw = w / COLS; const ch = h / FILAS; const r = GROSOR / 2;
    const tolera = r + Math.min(cw, ch) * 0.35;
    const desde = nuevo || !hay.value ? null : { x: ux.value, y: uy.value };
    // Las celdas que cubre el círculo del dedo, a lo largo del tramo.
    celdas.modify((c) => {
      'worklet';
      const marcar = (px, py) => {
        for (let cx = Math.max(0, Math.floor((px - r) / cw)); cx <= Math.min(COLS - 1, Math.floor((px + r) / cw)); cx++) {
          for (let cy = Math.max(0, Math.floor((py - r) / ch)); cy <= Math.min(FILAS - 1, Math.floor((py + r) / ch)); cy++) {
            const i = cy * COLS + cx;
            if (!c[i] && Math.hypot((cx + 0.5) * cw - px, (cy + 0.5) * ch - py) <= tolera) { c[i] = 1; c[CELDAS] += 1; }
          }
        }
      };
      if (!desde) marcar(x, y);
      else {
        const pasos = Math.max(1, Math.ceil(Math.hypot(x - desde.x, y - desde.y) / 6));
        for (let k = 1; k <= pasos; k++) marcar(desde.x + ((x - desde.x) * k) / pasos, desde.y + ((y - desde.y) * k) / pasos);
      }
      return c;
    }, false);
    if (!desde) {
      trazo.value.moveTo(x, y);
      trazo.value.lineTo(x + 0.1, y + 0.1);
      runOnJS(tocarSeleccion)();
      leyenda.value = withTiming(0, { duration: 250 });
    } else {
      trazo.value.lineTo(x, y);
      const d = Math.hypot(x - desde.x, y - desde.y);
      desdeToque.value += d;
      if (desdeToque.value > 28) { desdeToque.value = 0; runOnJS(tocarSuave)(); }
      desdePolvo.value += d;
      if (desdePolvo.value > 18) {
        desdePolvo.value = 0;
        const nace = Date.now();
        polvo.modify((v) => {
          'worklet';
          for (let k = 0; k < 3; k++) {
            const q = v[siguiente.value];
            q.x = x; q.y = y; q.dx = (Math.random() - 0.5) * 70; q.dy = 10 + Math.random() * 50; q.t = 3 + Math.random() * 4; q.nace = nace;
            siguiente.value = (siguiente.value + 1) % PIZCAS;
          }
          return v;
        });
      }
    }
    notifyChange(trazo);
    hay.value = true; ux.value = x; uy.value = y;
    if (celdas.value[CELDAS] >= CELDAS * META) {
      listo.value = true;
      runOnJS(tocarMeta)();
      capa.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) }, (fin) => { if (fin) runOnJS(terminar)(); });
    }
  };

  // Modo demostración: un dedo invisible raspa en zigzag.
  useEffect(() => {
    if (!auto || !tam) return undefined;
    reloj.setActive(true);
    let k = 0; const total = 90;
    const t = setInterval(() => {
      if (listo.value || k > total * 1.6) { clearInterval(t); reloj.setActive(false); return; }
      const fila = Math.floor(k / 15); const avance = (k % 15) / 14;
      const x = (fila % 2 ? 1 - avance : avance) * tam.w;
      const y = ((fila % (FILAS + 1)) + 0.5) * (tam.h / (FILAS + 1)) + Math.sin(k) * 4;
      runOnUI(agregarUI)(Math.max(4, Math.min(tam.w - 4, x)), y, k === 0);
      k++;
    }, 22);
    return () => { clearInterval(t); reloj.setActive(false); };
  }, [auto, tam]); // eslint-disable-line react-hooks/exhaustive-deps -- `agregarUI` sólo lee valores compartidos

  // Armado una vez por tamaño (y por `auto`, que lee `soltar`): los worklets
  // leen valores compartidos.
  const gesto = useMemo(() => Gesture.Pan().minDistance(0)
    .onBegin((e) => { runOnJS(empezar)(); agregarUI(e.x, e.y, true); })
    .onUpdate((e) => { agregarUI(e.x, e.y, false); })
    .onFinalize(() => { hay.value = false; runOnJS(soltar)(); }),
  [tam, auto]); // eslint-disable-line react-hooks/exhaustive-deps
  const estilo = useAnimatedStyle(() => ({ opacity: capa.value, transform: [{ scale: 1 + (1 - capa.value) * 0.06 }] }));
  const estiloLeyenda = useAnimatedStyle(() => ({ opacity: leyenda.value }));

  return (
    <GestureDetector gesture={gesto}>
      <Animated.View style={[StyleSheet.absoluteFill, estilo]} onLayout={(e) => {
        const medida = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
        tamUI.value = medida; setTam(medida);
      }}
        accessible accessibilityRole="button" accessibilityLabel="Cupón por descubrir. Raspa con el dedo." accessibilityActions={[{ name: 'activate', label: 'Descubrir' }]}
        onAccessibilityAction={() => { listo.value = true; alDescubrir(); }}>
        {tam ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Group layer>
              <Rect x={0} y={0} width={tam.w} height={tam.h}>
                <SkGradiente start={vec(0, 0)} end={vec(tam.w, tam.h)} colors={['#B9BEC6', '#ECEFF3', '#A4AAB3', '#DDE1E7', '#B0B6BF']} />
              </Rect>
              <Path path={trazo} style="stroke" strokeWidth={GROSOR} strokeCap="round" strokeJoin="round" blendMode="clear" color="black" />
              {/* La capa que vuelve a cubrir lo raspado si no se terminó. */}
              <Rect x={0} y={0} width={tam.w} height={tam.h} opacity={recubre}>
                <SkGradiente start={vec(0, 0)} end={vec(tam.w, tam.h)} colors={['#B9BEC6', '#ECEFF3', '#A4AAB3', '#DDE1E7', '#B0B6BF']} />
              </Rect>
            </Group>
          </Canvas>
        ) : null}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 4 }, estiloLeyenda]}>
          <Icono sf="hand.draw.fill" respaldo="👆" tam={22} color="#5A606A" />
          <Text style={{ color: '#4A505A', fontSize: 15, fontWeight: '900', letterSpacing: 2 }}>RASPA TU CUPÓN</Text>
          <Text style={{ color: '#5A606A', fontSize: 12, fontWeight: '600' }}>¿Cuánto ganaste este mes?</Text>
        </Animated.View>
        {tam ? Array.from({ length: PIZCAS }, (_, i) => <Particula key={i} i={i} polvo={polvo} ahora={ahora} />) : null}
      </Animated.View>
    </GestureDetector>
  );
}

// Una pizca de polvo plateado que salta del dedo y cae: un lugar fijo de la
// reserva (`polvo[i]`), que el worklet del raspado vuelve a lanzar. Montada
// siempre; sin pizca viva, transparente. Se mueve sólo con transformaciones
// (el tamaño de cada pizca es una escala sobre un cuadrado de 10 pt).
const BASE_PIZCA = 10;
function Particula({ i, polvo, ahora }) {
  const estilo = useAnimatedStyle(() => {
    const q = polvo.value[i];
    const p = q.nace < 0 ? 1 : (ahora.value - q.nace) / VIDA_PIZCA;
    if (p < 0 || p >= 1) return { opacity: 0, transform: [{ translateX: -100 }, { translateY: -100 }] };
    // La curva de antes (`Easing.out(Easing.quad)`).
    const v = 1 - (1 - p) * (1 - p);
    return {
      opacity: 1 - v,
      transform: [
        { translateX: q.x - BASE_PIZCA / 2 + q.dx * v },
        { translateY: q.y - BASE_PIZCA / 2 + q.dy * v * v },
        { rotate: `${v * 200}deg` },
        { scale: q.t / BASE_PIZCA },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: BASE_PIZCA, height: BASE_PIZCA, borderRadius: 3, backgroundColor: '#C9CED6', opacity: 0 }, estilo]} />
  );
}

// Dónde retirar el premio (2026-10-19): las sucursales, marcando las que lo
// tienen. Elegir una que no lo tiene vale — se lo mandan —, pero se avisa.
function ElegirSala({ premio, id, pedir, alCambiar }) {
  const [ocupado, setOcupado] = useState(false);
  const abrir = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const r = await pedir('premio_salas', { id });
      if (!r?.ok) { Alert.alert('No se pudo', r?.mensaje ?? 'Intenta de nuevo.'); return; }
      const salas = r.sucursales ?? [];
      const opciones = [...salas.map((x) => `${x.elegida ? '✓ ' : ''}${x.sala}${x.hay ? '' : ' (hay que pedirlo)'}`), 'Cancelar'];
      ActionSheetIOS.showActionSheetWithOptions({
        title: '¿Dónde lo retiras?', message: 'Las que dicen «hay que pedirlo» todavía no lo tienen: te avisamos cuando llegue.',
        options: opciones, cancelButtonIndex: opciones.length - 1,
      }, async (i) => {
        const elegida = salas[i];
        if (!elegida) return;
        const c = await pedir('premio_elegir_sala', { id, branch_id: elegida.branch_id }).catch(() => null);
        if (!c?.ok) { Alert.alert('No se pudo', c?.mensaje ?? 'Intenta de nuevo.'); return; }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        alCambiar?.();
      });
    } catch {
      Alert.alert('No se pudo', 'Revisa tu conexión e intenta de nuevo.');
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Pressable onPress={abrir} accessibilityRole="button"
      style={({ pressed }) => ({ marginTop: 10, minHeight: 44, borderRadius: 14, paddingHorizontal: 14, justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.16)', opacity: pressed || ocupado ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: '#B5308C' }}>
        {premio.sala ? `Retirar en ${premio.sala} · Cambiar` : 'Elegir dónde lo retiro'}
      </Text>
    </Pressable>
  );
}
