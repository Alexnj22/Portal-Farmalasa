// Burbujas (Bienestar, 2026-11-03). El plástico de burbujas, dibujado con Skia.
//
// Cuarta versión, el mismo día: «el de burbujas aún se traba, no es tan
// fluida». La tercera ya había sacado el juego del hilo de JavaScript, pero el
// tablero seguía siendo 35 árboles de Skia con ~7 figuras y 5 valores animados
// cada uno: unas 250 figuras y 175 cálculos que se rehacían en CADA cuadro
// mientras algo se movía, más un `setPlaybackRate` por reventón —que en
// Android corre en el hilo de la interfaz—.
//
// Ahora:
// - Cada burbuja se dibuja UNA vez, al entrar, como imagen (entera, reventada
//   y dorada, con su sombra suave horneada). El cuadro es un solo `Picture`
//   que estampa 35 imágenes: un cálculo por cuadro en vez de 175, y sólo
//   mientras hay algo animándose.
// - El tono de la racha está en el archivo (`pop-1`…`pop-6`), no en la
//   velocidad del reproductor.
//
// Dos modos: «Relax» —hojas sin fin— y «Contrarreloj» —niveles: vaciar la
// hoja antes de que se acabe el tiempo, y cada nivel da menos—. En las dos
// salen burbujas DORADAS: valen más, y en contrarreloj suman tiempo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { BlurStyle, Canvas, PaintStyle, Picture, Skia, TileMode } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, ZoomIn, runOnJS, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { Confeti, useSinMovimiento } from '../componentes/animacion';
import { BLANCO, BLANCO_2, BotonJuego, ControlesSensaciones, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { entero } from '../lib/formato';
import { callar, precargar, sonar, tacto } from '../lib/sensaciones';

const COLUMNAS = 5;
const FILAS = 7;
const N = COLUMNAS * FILAS;
const CLAVE = 'puntos_salud_burbujas_total';
const CLAVE_RETO = 'puntos_salud_burbujas_nivel';
const SONIDOS = ['pop-1', 'pop-2', 'pop-3', 'pop-4', 'pop-5', 'pop-6', 'par', 'ganar', 'fallo'];
const HOJAS = [
  ['#FF8AD8', '#C04BD8'], ['#8BD6FF', '#4F7BFF'], ['#9BF0C2', '#2FB98A'],
  ['#FFD38A', '#FF8A4F'], ['#C9A8FF', '#7A5CE0'], ['#FF9C9C', '#E0446A'],
];
const ORO = ['#FFF3A6', '#F5B000'];
const POP = 0.2; // segundos que dura el aplastón
const CHISPA = 0.5;
const OLA = 0.75; // lo que tarda una hoja nueva en inflarse entera
const VACIAS = () => new Array(N).fill(-1);
const MODOS = [{ valor: 'relax', texto: 'Relax' }, { valor: 'reto', texto: 'Contrarreloj', detalle: 'con niveles' }];
// Segundos por nivel en contrarreloj: 12 al principio, uno menos cada nivel, nunca menos de 5.
const segundosDe = (nivel) => Math.max(5, 13 - nivel);
const BONO = 1.5; // segundos que da una dorada

function doradasAlAzar() {
  const d = new Array(N).fill(false);
  const cuantas = 1 + Math.floor(Math.random() * 2);
  for (let k = 0; k < cuantas; k++) d[Math.floor(Math.random() * N)] = true;
  return d;
}

// Dibuja una burbuja en una imagen. Se hace una vez por hoja (al cambiar de
// color), en el hilo de JavaScript, y después sólo se estampa.
function hornear(r, [claro, fuerte], tipo) {
  const d = PixelRatio.get();
  const lado = Math.ceil(r * 2.6);
  const sup = Skia.Surface.Make(Math.ceil(lado * d), Math.ceil(lado * d));
  if (!sup) return null;
  const c = sup.getCanvas();
  c.scale(d, d);
  const m = lado / 2;
  const pincel = (color) => { const p = Skia.Paint(); p.setAntiAlias(true); p.setColor(Skia.Color(color)); return p; };
  if (tipo === 'vacia') {
    c.drawCircle(m, m, r * 0.86, pincel('rgba(255,255,255,0.08)'));
    const borde = pincel('rgba(255,255,255,0.22)'); borde.setStyle(PaintStyle.Stroke); borde.setStrokeWidth(1.2);
    c.drawCircle(m, m, r * 0.86, borde);
    const pliegue = pincel('rgba(255,255,255,0.26)'); pliegue.setStyle(PaintStyle.Stroke); pliegue.setStrokeWidth(1.4); pliegue.setStrokeCap(1);
    c.drawLine(m - r * 0.45, m - r * 0.1, m + r * 0.4, m + r * 0.15, pliegue);
    c.drawLine(m - r * 0.1, m - r * 0.4, m + r * 0.05, m + r * 0.42, pliegue);
  } else {
    const sombra = pincel('rgba(20,0,40,0.38)');
    sombra.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, r * 0.1, true));
    c.drawCircle(m, m + r * 0.16, r, sombra);
    const cuerpo = Skia.Paint(); cuerpo.setAntiAlias(true);
    cuerpo.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(m - r * 0.35, m - r * 0.4), r * 1.5,
      [Skia.Color('#FFFFFF'), Skia.Color(claro), Skia.Color(fuerte)], [0, 0.35, 1], TileMode.Clamp));
    c.drawCircle(m, m, r, cuerpo);
    const borde = pincel('rgba(255,255,255,0.6)'); borde.setStyle(PaintStyle.Stroke); borde.setStrokeWidth(1.2);
    c.drawCircle(m, m, r, borde);
    c.drawOval(Skia.XYWHRect(m - r * 0.58, m - r * 0.66, r * 0.62, r * 0.36), pincel('rgba(255,255,255,0.8)'));
    c.drawCircle(m + r * 0.42, m + r * 0.42, r * 0.09, pincel('rgba(255,255,255,0.45)'));
    if (tipo === 'dorada') {
      // Una estrellita de brillo en el centro.
      const brillo = pincel('rgba(255,255,255,0.95)');
      const e = Skia.Path.Make();
      const R = r * 0.34; const q = r * 0.08;
      e.moveTo(m, m - R); e.lineTo(m + q, m - q); e.lineTo(m + R, m); e.lineTo(m + q, m + q);
      e.lineTo(m, m + R); e.lineTo(m - q, m + q); e.lineTo(m - R, m); e.lineTo(m - q, m - q); e.close();
      c.drawPath(e, brillo);
    }
  }
  sup.flush();
  return sup.makeImageSnapshot();
}

export default function Burbujas() {
  const quieta = useSinMovimiento();
  const [caja, setCaja] = useState(null);
  const [modo, setModo] = useState('relax');
  const [numHoja, setNumHoja] = useState(0);
  const [nivel, setNivel] = useState(1);
  const [mejorNivel, setMejorNivel] = useState(0);
  const [perdio, setPerdio] = useState(false);
  const [quedan, setQuedan] = useState(N);
  const [total, setTotal] = useState(0);
  const [aviso, setAviso] = useState(null); // «¡Racha ×N!», «¡Dorada! +1.5 s»
  const [festejo, setFestejo] = useState(0);
  const guardar = useRef(null);
  const relojHoja = useRef(null);
  const nivelRef = useRef(1);
  const modoRef = useRef('relax');

  // El tablero vive en el hilo de la interfaz.
  const marcas = useSharedValue(VACIAS());
  const doradas = useSharedValue(doradasAlAzar());
  const restan = useSharedValue(N);
  const racha = useSharedValue(0);
  const ultimo = useSharedValue({ x: -1, y: -1 });
  const tiempo = useSharedValue(0);
  const ahora = useSharedValue(0);
  const hasta = useSharedValue(OLA + 0.1);
  const nace = useSharedValue(0);
  const chispas = useSharedValue([]);
  const geoV = useSharedValue(null);
  const imagenes = useSharedValue(null);
  const bloqueada = useSharedValue(false);
  // Contrarreloj: el límite corre desde el primer reventón de la hoja.
  const enReto = useSharedValue(false);
  const limite = useSharedValue(-1);
  const duracion = useSharedValue(segundosDe(1));

  useEffect(() => {
    precargar(SONIDOS);
    SecureStore.getItemAsync(CLAVE).then((v) => { const n = Number(v); if (Number.isFinite(n)) setTotal((x) => x + n); }).catch(() => {});
    SecureStore.getItemAsync(CLAVE_RETO).then((v) => setMejorNivel(Number(v) || 0)).catch(() => {});
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
    return { w: caja.w, h: caja.h, celda, x0: (caja.w - celda * COLUMNAS) / 2, y0: (caja.h - celda * FILAS) / 2, r: celda * 0.4 };
  }, [caja]);
  useEffect(() => { geoV.value = geo; }, [geo, geoV]);

  const color = HOJAS[numHoja % HOJAS.length];
  useEffect(() => {
    if (!geo) return;
    const llena = hornear(geo.r, color, 'llena');
    const vacia = hornear(geo.r, color, 'vacia');
    const dorada = hornear(geo.r, ORO, 'dorada');
    if (llena && vacia && dorada) imagenes.value = { llena, vacia, dorada, lado: Math.ceil(geo.r * 2.6), color: Skia.Color(color[0]) };
  }, [geo, color, imagenes]);

  // El reloj: `tiempo` corre siempre; `ahora` —el que miran los dibujos— sólo
  // avanza mientras algo se mueve, así un tablero quieto no se vuelve a pintar.
  const alAcabarse = useRef(null);
  const acabarse = useCallback(() => alAcabarse.current?.(), []);
  useFrameCallback((f) => {
    tiempo.value += Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000);
    const meta = quieta ? hasta.value : Math.min(tiempo.value, hasta.value);
    if (ahora.value !== meta) ahora.value = meta;
    if (enReto.value && limite.value > 0 && !bloqueada.value && tiempo.value >= limite.value) {
      bloqueada.value = true;
      runOnJS(acabarse)();
    }
  });

  const cuadro = useDerivedValue(() => {
    const rec = Skia.PictureRecorder();
    const g = geoV.value;
    const img = imagenes.value;
    const c = rec.beginRecording(Skia.XYWHRect(0, 0, g ? g.w : 1, g ? g.h : 1));
    if (!g || !img) return rec.finishRecordingAsPicture();
    const t = ahora.value;
    const m = marcas.value;
    const oro = doradas.value;
    const pincel = Skia.Paint();
    const L = img.lado;
    const src = Skia.XYWHRect(0, 0, img.llena.width(), img.llena.height());
    for (let i = 0; i < N; i++) {
      const cx = g.x0 + ((i % COLUMNAS) + 0.5) * g.celda;
      const cy = g.y0 + (Math.floor(i / COLUMNAS) + 0.5) * g.celda;
      // La ola de una hoja nueva: se inflan con un rebote, una tras otra.
      const k = Math.max(0, Math.min(1, (t - nace.value - i * 0.012) / 0.38));
      if (k <= 0) continue;
      const u = k - 1;
      const infla = 1 + 2.9 * u * u * u + 1.9 * u * u;
      const e = m[i] < 0 ? 0 : Math.max(0, Math.min(1, (t - m[i]) / POP));
      if (e > 0) {
        pincel.setAlphaf(e);
        const l = L * infla;
        c.drawImageRect(img.vacia, src, Skia.XYWHRect(cx - l / 2, cy - l / 2, l, l), pincel);
      }
      if (e < 1) {
        pincel.setAlphaf(1 - e * e);
        const l = L * infla * (1 + 0.24 * Math.sin(e * Math.PI * 0.5));
        c.drawImageRect(oro[i] ? img.dorada : img.llena, src, Skia.XYWHRect(cx - l / 2, cy - l / 2, l, l), pincel);
      }
    }
    // Chispas que saltan y caen, y un anillo que se abre.
    const chispa = Skia.Paint(); chispa.setAntiAlias(true);
    const anillo = Skia.Paint(); anillo.setAntiAlias(true); anillo.setStyle(PaintStyle.Stroke); anillo.setStrokeWidth(2);
    anillo.setColor(Skia.Color('white'));
    for (const s of chispas.value) {
      const p = (t - s.t) / CHISPA;
      if (p < 0 || p > 1) continue;
      chispa.setColor(s.oro ? Skia.Color('#FFE27A') : img.color);
      for (let j = 0; j < 9; j++) {
        const a = (j / 9) * Math.PI * 2 + s.giro;
        const d = s.r * (0.8 + p * (1.3 + (j % 3) * 0.25));
        c.drawCircle(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d + p * p * s.r * 0.9, Math.max(0.1, (2.2 + (j % 2) * 1.4) * (1 - p)), chispa);
      }
      const q = Math.min(1, p / 0.7);
      anillo.setAlphaf((1 - q) * 0.6);
      c.drawCircle(s.x, s.y, s.r * (0.85 + q * 0.85), anillo);
    }
    return rec.finishRecordingAsPicture();
  });

  const nuevaHoja = useCallback((siguienteNivel) => {
    clearTimeout(relojHoja.current);
    marcas.value = VACIAS();
    doradas.value = doradasAlAzar();
    restan.value = N;
    chispas.value = [];
    nace.value = tiempo.value;
    hasta.value = tiempo.value + OLA + 0.1;
    limite.value = -1;
    duracion.value = segundosDe(siguienteNivel);
    bloqueada.value = false;
    setQuedan(N);
    setAviso(null);
    setPerdio(false);
    setNumHoja((x) => x + 1);
    sonar('pop-6', { volumen: 0.3 });
  }, [bloqueada, chispas, doradas, duracion, hasta, limite, marcas, nace, restan, tiempo]);

  const cambiarModo = (m) => {
    modoRef.current = m; setModo(m);
    enReto.value = m === 'reto';
    nivelRef.current = 1; setNivel(1);
    nuevaHoja(1);
  };

  alAcabarse.current = () => {
    const n = nivelRef.current;
    sonar('fallo'); tacto.aviso();
    setPerdio(true);
    const logrado = n - 1;
    if (logrado > mejorNivel) {
      setMejorNivel(logrado);
      SecureStore.setItemAsync(CLAVE_RETO, String(logrado)).catch(() => {});
    }
  };

  // JavaScript sólo hace lo que no puede el hilo de la interfaz: sonar, vibrar y contar.
  const alReventar = useCallback((n, quedanAhora, eraOro) => {
    sonar(`pop-${Math.min(6, 1 + Math.floor((n - 1) / 2))}`, { volumen: 0.9 });
    if (eraOro) { sonar('par', { volumen: 0.6 }); tacto.exito(); } else tacto.toque();
    setTotal((x) => x + (eraOro ? 5 : 1));
    setQuedan(quedanAhora);
    if (eraOro) setAviso({ k: Date.now(), texto: modoRef.current === 'reto' ? `¡Dorada! +${BONO} s` : '¡Dorada! +5' });
    else if (n >= 3) setAviso({ k: n, texto: `¡Racha ×${n}!` });
    if (quedanAhora === 0) {
      sonar('ganar', { volumen: 0.8 });
      tacto.exito();
      setFestejo((k) => k + 1);
      if (modoRef.current === 'reto') {
        const sig = nivelRef.current + 1;
        nivelRef.current = sig;
        relojHoja.current = setTimeout(() => { setNivel(sig); nuevaHoja(sig); }, 1100);
      } else {
        relojHoja.current = setTimeout(() => nuevaHoja(1), 1100);
      }
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
      // Sólo dentro del círculo, no en el hueco entre dos.
      if ((x - cx) ** 2 + (y - cy) ** 2 > (g.r * 1.08) ** 2) return;
      const i = fila * COLUMNAS + col;
      if (marcas.value[i] >= 0) return;
      const t = tiempo.value;
      const m = marcas.value.slice(); m[i] = t; marcas.value = m;
      const oro = doradas.value[i];
      restan.value -= 1;
      racha.value += 1;
      if (enReto.value) {
        if (limite.value < 0) limite.value = t + duracion.value;
        else if (oro) limite.value += BONO;
      }
      if (restan.value === 0) bloqueada.value = true;
      chispas.value = [...chispas.value.filter((s) => t - s.t < CHISPA), { x: cx, y: cy, r: g.r, t, giro: (i * 1.7) % 6.28, oro }];
      hasta.value = Math.max(hasta.value, t + CHISPA + 0.05);
      runOnJS(alReventar)(racha.value, restan.value, oro);
    };
    // Con el dedo rápido se prueba también el camino entre dos cuadros.
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
      .onBegin((e) => { racha.value = 0; ultimo.value = { x: -1, y: -1 }; recorrer(e.x, e.y); })
      .onUpdate((e) => { recorrer(e.x, e.y); })
      .onFinalize(() => { ultimo.value = { x: -1, y: -1 }; });
  }, [alReventar, bloqueada, chispas, doradas, duracion, enReto, geoV, hasta, limite, marcas, racha, restan, tiempo, ultimo]);

  // La barra del tiempo: un estilo animado, sin pasar por React.
  const barra = useAnimatedStyle(() => {
    const queda = limite.value < 0 ? 1 : Math.max(0, (limite.value - tiempo.value) / duracion.value);
    return { width: `${Math.min(1, queda) * 100}%`, backgroundColor: queda < 0.25 ? '#FF7A7A' : '#FFFFFF' };
  });

  const reto = modo === 'reto';
  return (
    <Escena colores={ESCENAS.burbujas} fijo>
      <ControlesSensaciones izquierda={reto ? <>
        <Marcador sf="star.fill" texto={`Nivel ${nivel}`} />
        <Marcador sf="trophy.fill" texto={`Récord ${mejorNivel}`} etiqueta={`Récord: nivel ${mejorNivel}`} />
      </> : <>
        <Marcador sf="circle.grid.3x3.fill" texto={quedan ? `Quedan ${quedan}` : '¡Hoja lista!'} />
        <Marcador sf="sparkles" texto={entero(total)} etiqueta={`${entero(total)} reventadas en total`} />
      </>} />
      <OpcionesJuego opciones={MODOS} valor={modo} alCambiar={cambiarModo} />
      {reto ? (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}
          accessibilityLabel={`Tienes ${segundosDe(nivel)} segundos desde el primer reventón`}>
          <Animated.View style={[{ height: 8, borderRadius: 4 }, barra]} />
        </View>
      ) : null}
      <View style={{ flex: 1, borderRadius: 30, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' }}
        onLayout={(e) => { const { width: w, height: h } = e.nativeEvent.layout; if (!caja || caja.w !== w || caja.h !== h) setCaja({ w, h }); }}
        accessible accessibilityLabel={`Hoja de burbujas. Quedan ${quedan}. Toca o arrastra el dedo para reventarlas.`}
        accessibilityActions={[{ name: 'activate', label: 'Reventar una burbuja' }]}
        onAccessibilityAction={() => {
          const i = marcas.value.findIndex((x) => x < 0);
          if (i < 0) return;
          const m = marcas.value.slice(); m[i] = tiempo.value; marcas.value = m;
          restan.value -= 1; hasta.value = tiempo.value + CHISPA;
          alReventar(1, restan.value, doradas.value[i]);
        }}>
        {geo ? (
          <GestureDetector gesture={gesto}>
            <Canvas style={{ flex: 1 }}>
              <Picture picture={cuadro} />
            </Canvas>
          </GestureDetector>
        ) : null}
        {aviso && quedan > 0 && !perdio ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' }}>
            <Animated.View key={aviso.k} entering={quieta ? undefined : ZoomIn.duration(180)}
              style={{ paddingHorizontal: 14, paddingVertical: 4, minHeight: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' }}>
              <Text style={{ fontSize: 15, fontWeight: '900', color: BLANCO }}>{aviso.texto}</Text>
            </Animated.View>
          </View>
        ) : null}
        {reto && quedan === N && !perdio ? (
          <Animated.View pointerEvents="none" entering={FadeIn.delay(300)} exiting={FadeOut.duration(150)}
            style={{ position: 'absolute', bottom: 14, left: 0, right: 0, alignItems: 'center' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: BLANCO }}>Nivel {nivel} · {segundosDe(nivel)} segundos</Text>
            <Text style={{ fontSize: 13, color: BLANCO_2 }}>El tiempo corre desde la primera burbuja</Text>
          </Animated.View>
        ) : null}
        {perdio ? (
          <Animated.View entering={FadeIn.duration(250)} style={{ position: 'absolute', left: 16, right: 16, top: '30%' }}>
            <PanelVidrio estilo={{ gap: 10, alignItems: 'center', backgroundColor: 'rgba(30,6,40,0.72)' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: BLANCO }}>¡Se acabó el tiempo!</Text>
              <Text style={{ fontSize: 15, color: BLANCO_2, textAlign: 'center' }}>
                {nivel > 1 ? `Pasaste ${nivel - 1} ${nivel - 1 === 1 ? 'nivel' : 'niveles'}.` : 'Vuelve a intentarlo: arrastra el dedo por las filas.'} Tu récord: nivel {mejorNivel}.
              </Text>
              <View style={{ alignSelf: 'stretch' }}>
                <BotonJuego sf="arrow.clockwise" alTocar={() => { nivelRef.current = 1; setNivel(1); nuevaHoja(1); }}>Otra vez</BotonJuego>
              </View>
            </PanelVidrio>
          </Animated.View>
        ) : null}
        {festejo ? <Confeti key={festejo} colores={[...color, '#FFFFFF', '#FFD38A']} alTerminar={() => {}} /> : null}
      </View>
      <Text style={[textoAyuda, { textAlign: 'center' }]}>
        {reto ? 'Vacía la hoja antes de que se acabe la barra. Las doradas suman tiempo.' : 'Arrastra el dedo sin soltar: en racha el «pop» sube de tono. Las doradas valen 5.'}
      </Text>
      {!reto ? <BotonJuego secundario sf="arrow.clockwise" alTocar={() => nuevaHoja(1)}>Hoja nueva</BotonJuego> : null}
    </Escena>
  );
}
