// Ruido blanco (Bienestar, 2026-11-10). Cinco sonidos de fondo para
// concentrarse, calmarse o dormir, fabricados en el teléfono (lib/ruido.js):
// no gastan datos ni piden cuenta.
//
// Un sonido se elige tocándolo y empieza solo; tocar el mismo, o «Detener»,
// lo apaga. El temporizador lo apaga despacio —medio minuto de fundido— para
// no despertar a nadie. Mientras suena, la pantalla no se apaga: el sonido
// sólo vive con la app abierta.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import { BLANCO, BLANCO_2, BLANCO_3, BotonJuego, ESCENAS, Escena, Marcador, OpcionesJuego, PanelVidrio, textoAyuda } from '../componentes/juegos/Escena';
import { tacto } from '../lib/sensaciones';
import { SONIDOS, pararRuido, ruidoDisponible, sonarRuido, volumenRuido } from '../lib/ruido';

const MINUTOS = [15, 30, 60, 0];
const VOLUMENES = [{ valor: 0.3, texto: 'Bajo' }, { valor: 0.6, texto: 'Medio' }, { valor: 1, texto: 'Alto' }];

function NoApagar() { useKeepAwake(); return null; }

const reloj = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Tres anillos que respiran mientras suena: el pulso lento del sonido.
function Anillo({ i, sonando, quieta }) {
  const p = useSharedValue(0);
  useEffect(() => {
    if (sonando && !quieta) {
      p.value = 0;
      p.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.out(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(p);
      p.value = withTiming(0, { duration: 400 });
    }
  }, [sonando, quieta, p]);
  const estilo = useAnimatedStyle(() => {
    const f = (p.value + i / 3) % 1;
    return { opacity: sonando ? (1 - f) * 0.5 : 0, transform: [{ scale: 0.7 + f * 0.75 }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: 2, borderColor: BLANCO }, estilo]} />;
}

function Centro({ tipo, sonando, quieta }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withSpring(sonando ? 1.06 : 1, { damping: 9, stiffness: 140 });
  }, [sonando, tipo, s]);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const x = SONIDOS[tipo];
  return (
    <View style={{ height: 250, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 1, 2].map((i) => <Anillo key={i} i={i} sonando={sonando} quieta={quieta} />)}
      <Animated.View style={[{ width: 170, height: 170, borderRadius: 85, alignItems: 'center', justifyContent: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' }, estilo]}>
        <Icono sf={x.sf} respaldo="" tam={52} color={BLANCO} />
        <Text style={{ fontSize: 18, fontWeight: '800', color: BLANCO }}>{x.nombre}</Text>
      </Animated.View>
    </View>
  );
}

function Opcion({ id, activo, sonando, alTocar }) {
  const x = SONIDOS[id];
  return (
    <Tocable etiqueta={`${x.nombre}. ${x.detalle}`} alTocar={alTocar} estilo={{ width: '47.5%', flexGrow: 1 }}>
      <View accessibilityRole="radio" accessibilityState={{ selected: activo }}
        style={{ minHeight: 76, borderRadius: 20, padding: 14, gap: 4, flexDirection: 'row', alignItems: 'center',
          backgroundColor: activo ? BLANCO : 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: activo ? BLANCO : 'rgba(255,255,255,0.22)' }}>
        <Icono sf={activo && sonando ? 'speaker.wave.2.fill' : x.sf} respaldo="" tam={22} color={activo ? '#12304A' : BLANCO} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: activo ? '#12304A' : BLANCO }}>{x.nombre}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: activo ? 'rgba(18,48,74,0.65)' : BLANCO_3 }}>{x.detalle}</Text>
        </View>
      </View>
    </Tocable>
  );
}

export default function Ruido() {
  const quieta = useSinMovimiento();
  const [tipo, setTipo] = useState('blanco');
  const [sonando, setSonando] = useState(false);
  const [minutos, setMinutos] = useState(30);
  const [volumen, setVolumen] = useState(0.6);
  const [resta, setResta] = useState(null);
  const fin = useRef(null);

  // Al salir de la pantalla no queda nada sonando.
  useEffect(() => () => pararRuido(0.3), []);

  // El temporizador: cuenta en pantalla y, al llegar, se apaga en 30 s.
  useEffect(() => {
    if (!sonando || !minutos) { setResta(null); fin.current = null; return undefined; }
    fin.current = Date.now() + minutos * 60_000;
    const tic = () => {
      const s = Math.max(0, Math.round((fin.current - Date.now()) / 1000));
      setResta(s);
      if (s <= 0) { pararRuido(30); setSonando(false); }
    };
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [sonando, minutos]);

  const empezar = async (t = tipo) => {
    tacto.toque();
    setTipo(t);
    setSonando(true);
    volumenRuido(volumen);
    if (!(await sonarRuido(t))) setSonando(false);
  };
  const parar = () => { tacto.roce(); pararRuido(); setSonando(false); };
  const elegir = (t) => {
    if (t === tipo && sonando) { parar(); return; }
    empezar(t);
  };

  return (
    <Escena colores={ESCENAS.ruido}>
      {sonando ? <NoApagar /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'center', minHeight: 36 }}>
        {resta != null ? <Marcador sf="timer" texto={reloj(resta)} etiqueta={`Se apaga en ${Math.ceil(resta / 60)} minutos`} /> : null}
      </View>

      <Centro tipo={tipo} sonando={sonando} quieta={quieta} />

      {ruidoDisponible() ? null : (
        <PanelVidrio><Text style={textoAyuda}>Este teléfono no puede reproducir los sonidos de fondo.</Text></PanelVidrio>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
        {Object.keys(SONIDOS).map((id) => (
          <Opcion key={id} id={id} activo={id === tipo} sonando={sonando} alTocar={() => elegir(id)} />
        ))}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 0.6, color: BLANCO_2, textAlign: 'center' }}>VOLUMEN</Text>
        <OpcionesJuego valor={volumen} alCambiar={(v) => { setVolumen(v); volumenRuido(v); }} opciones={VOLUMENES} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 0.6, color: BLANCO_2, textAlign: 'center' }}>APAGAR EN</Text>
        <OpcionesJuego valor={minutos} alCambiar={setMinutos}
          opciones={MINUTOS.map((m) => ({ valor: m, texto: m ? `${m} min` : 'Sin límite' }))} />
      </View>

      <BotonJuego sf={sonando ? 'stop.fill' : 'play.fill'} secundario={sonando} alTocar={sonando ? parar : () => empezar()}>
        {sonando ? 'Detener' : 'Reproducir'}
      </BotonJuego>

      <PanelVidrio>
        <Text style={textoAyuda}>
          El ruido de fondo tapa los sonidos que distraen y ayuda a concentrarse o a dormir. Úsalo a un volumen cómodo,
          sin audífonos muy fuertes. Suena mientras la app está abierta.
        </Text>
      </PanelVidrio>
    </Escena>
  );
}
