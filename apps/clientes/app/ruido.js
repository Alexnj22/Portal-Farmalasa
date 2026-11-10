// Sonidos de fondo (Bienestar, 2026-11-10). Ocho ambientes —lluvia, olas,
// fogata, noche, ventilador y tres ruidos— fabricados en el teléfono
// (lib/ruido.js): no gastan datos ni piden cuenta, y siguen sonando con el
// teléfono bloqueado, con su control en la pantalla de bloqueo.
//
// Rehecha el mismo día («más moderna, más interactiva, más inmersiva según el
// ruido»): cada sonido es un LUGAR de pantalla completa (componentes/
// PaisajeRuido.js) que se funde con el siguiente al cambiar. La escena se
// toca: deja una onda donde cae el dedo, y deslizar hacia arriba o hacia abajo
// sube o baja el volumen, con una barra que lo muestra. Sin sonar, la escena
// sigue viva pero casi quieta; al sonar, se despierta.
//
// El temporizador apaga despacio —medio minuto de fundido— para no despertar
// a nadie; está programado dentro del audio, así que se cumple bloqueado.
import { useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import Animated, {
  Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Tocable, useSinMovimiento } from '../componentes/animacion';
import Icono from '../componentes/Icono';
import PaisajeRuido from '../componentes/PaisajeRuido';
import { tacto } from '../lib/sensaciones';
import {
  SONIDOS, pararRuido, pausarRuido, prepararRuido, reanudarRuido, ruidoDisponible, sonarRuido, temporizadorRuido, useRuido, volumenActual, volumenRuido,
} from '../lib/ruido';

const MINUTOS = [0, 15, 30, 60, 90];
const BLANCO = '#FFFFFF';
const reloj = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// El botón grande: un círculo de vidrio con el color del lugar, que respira
// mientras suena (dos anillos que salen y se apagan).
function BotonPlay({ sonando, preparando, acento, alTocar }) {
  const quieta = useSinMovimiento();
  const pulso = useSharedValue(0);
  const s = useSharedValue(1);
  useEffect(() => {
    if (sonando && !quieta) pulso.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.out(Easing.quad) }), -1, false);
    else pulso.value = withTiming(0, { duration: 300 });
  }, [sonando, quieta, pulso]);
  const a1 = useAnimatedStyle(() => {
    const f = pulso.value % 1;
    return { opacity: sonando ? (1 - f) * 0.5 : 0, transform: [{ scale: 1 + f * 0.9 }] };
  });
  const a2 = useAnimatedStyle(() => {
    const f = (pulso.value + 0.5) % 1;
    return { opacity: sonando ? (1 - f) * 0.5 : 0, transform: [{ scale: 1 + f * 0.9 }] };
  });
  const boton = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const tocar = () => {
    s.value = withSequence(withTiming(0.9, { duration: 80 }), withSpring(1, { damping: 8, stiffness: 300 }));
    alTocar();
  };
  return (
    <View style={{ width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[estilos.anillo, { borderColor: acento }, a1]} />
      <Animated.View pointerEvents="none" style={[estilos.anillo, { borderColor: acento }, a2]} />
      <Tocable etiqueta={sonando ? 'Pausar' : 'Reproducir'} alTocar={tocar} estilo={{ borderRadius: 56 }}>
        <Animated.View style={[{ width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)',
          shadowColor: acento, shadowOpacity: sonando ? 0.8 : 0.3, shadowRadius: 30, shadowOffset: { width: 0, height: 0 } }, boton]}>
          {preparando
            ? <Text style={{ fontSize: 13, fontWeight: '800', color: BLANCO }}>…</Text>
            : <Icono sf={sonando ? 'pause.fill' : 'play.fill'} respaldo={sonando ? 'II' : '▶'} tam={40} color={BLANCO} />}
        </Animated.View>
      </Tocable>
    </View>
  );
}

// Un sonido en la tira de abajo: un círculo con los colores de su lugar.
function Orbe({ id, activo, sonando, alTocar }) {
  const x = SONIDOS[id];
  const s = useSharedValue(activo ? 1 : 0);
  useEffect(() => { s.value = withSpring(activo ? 1 : 0, { damping: 12, stiffness: 180 }); }, [activo, s]);
  const estilo = useAnimatedStyle(() => ({ transform: [{ scale: 0.88 + 0.12 * s.value }], opacity: 0.7 + 0.3 * s.value }));
  return (
    <Tocable etiqueta={`${x.nombre}. ${x.detalle}`} alTocar={alTocar} estilo={{ borderRadius: 20 }}>
      <Animated.View accessibilityRole="radio" accessibilityState={{ selected: activo }} style={[{ alignItems: 'center', gap: 6, width: 72 }, estilo]}>
        <LinearGradient colors={[x.colores[2], x.colores[0]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
            borderWidth: activo ? 2 : 1, borderColor: activo ? x.acento : 'rgba(255,255,255,0.25)' }}>
          <Icono sf={activo && sonando ? 'speaker.wave.2.fill' : x.sf} respaldo="" tam={24} color={activo ? x.acento : BLANCO} />
        </LinearGradient>
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: activo ? '800' : '600', color: BLANCO }}>{x.nombre}</Text>
      </Animated.View>
    </Tocable>
  );
}

export default function Ruido() {
  const ins = useSafeAreaInsets();
  const barra = useHeaderHeight();
  const { sonando, pausado, tipo, finEn, minutos, restaMs } = useRuido();
  const x = SONIDOS[tipo];
  const [volumen, setVolumen] = useState(volumenActual());
  const [ajustando, setAjustando] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [resta, setResta] = useState(null);
  const energia = useSharedValue(sonando ? 1 : 0);
  const relojEscena = useSharedValue(0);
  const toque = useSharedValue({ x: 0, y: 0, t: -10 });

  useEffect(() => { energia.value = withTiming(sonando ? 1 : 0, { duration: 1400 }); }, [sonando, energia]);
  // El sonido elegido se fabrica en cuanto la pantalla termina de entrar.
  useEffect(() => { const h = InteractionManager.runAfterInteractions(() => prepararRuido(tipo)); return () => h.cancel(); }, [tipo]);

  useEffect(() => {
    if (pausado) { setResta(restaMs != null ? Math.round(restaMs / 1000) : null); return undefined; }
    if (!sonando || !finEn) { setResta(null); return undefined; }
    const tic = () => setResta(Math.max(0, Math.round((finEn - Date.now()) / 1000)));
    tic();
    const id = setInterval(tic, 1000);
    return () => clearInterval(id);
  }, [sonando, pausado, finEn, restaMs]);

  const empezar = async (t = tipo) => {
    tacto.toque();
    setPreparando(true);
    // Un cuadro para que se vea «…» antes de fabricar el sonido.
    await new Promise((ok) => setTimeout(ok, 30));
    await sonarRuido(t);
    setPreparando(false);
  };
  // El botón grande pausa y reanuda (como en la pantalla de bloqueo);
  // «Detener» lo apaga del todo y quita el reproductor.
  const alternar = () => {
    if (sonando) { tacto.roce(); pausarRuido(); } else if (pausado) { tacto.toque(); reanudarRuido(); } else empezar();
  };
  const detener = () => { tacto.roce(); pararRuido(); };
  const elegir = (t) => {
    if (t === tipo && (sonando || pausado)) { if (pausado) reanudarRuido(); return; }
    Haptics.selectionAsync().catch(() => {});
    empezar(t);
  };
  const cambiarMinutos = (m) => { tacto.roce(); temporizadorRuido(m); };

  // La escena se toca: una onda; y se desliza: el volumen.
  const vol = useRef(volumen);
  const inicio = useRef(volumen);
  const gestos = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
    onPanResponderGrant: (e) => {
      inicio.current = vol.current;
      toque.value = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: relojEscena.value };
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dy) < 8) return;
      setAjustando(true);
      const v = Math.max(0.05, Math.min(1, inicio.current - g.dy / 320));
      if (Math.round(v * 20) !== Math.round(vol.current * 20)) Haptics.selectionAsync().catch(() => {});
      vol.current = v;
      setVolumen(v);
      volumenRuido(v);
    },
    onPanResponderRelease: (_, g) => {
      setTimeout(() => setAjustando(false), 700);
      if (Math.abs(g.dy) < 8 && Math.abs(g.dx) < 8) tacto.roce();
    },
  }), [toque, relojEscena]);

  return (
    <View style={{ flex: 1, backgroundColor: x.colores[0] }}>
      {/* El lugar: degradado y paisaje, que se funden al cambiar de sonido. */}
      <Animated.View key={tipo} entering={FadeIn.duration(900)} exiting={FadeOut.duration(900)} style={StyleSheet.absoluteFill}>
        <LinearGradient colors={x.colores} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={StyleSheet.absoluteFill} />
        <PaisajeRuido tipo={tipo} acento={x.acento} energia={energia} toque={toque} reloj={relojEscena} />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} {...gestos.panHandlers} accessible={false} />

      {/* La barra del volumen, a la derecha. Aparece al deslizar. */}
      <View pointerEvents="none" style={{ position: 'absolute', right: 14, top: barra + 70, bottom: 330, width: 6, borderRadius: 3,
        backgroundColor: 'rgba(255,255,255,0.15)', opacity: ajustando ? 1 : 0.35, justifyContent: 'flex-end', overflow: 'hidden' }}>
        <View style={{ height: `${Math.round(volumen * 100)}%`, backgroundColor: x.acento, borderRadius: 3 }} />
      </View>

      <View pointerEvents="box-none" style={{ flex: 1, paddingTop: barra + 10, paddingBottom: ins.bottom + 12 }}>
        <View pointerEvents="none" style={{ alignItems: 'center', minHeight: 32 }}>
          {ajustando ? (
            <Text style={estilos.pildora}>Volumen {Math.round(volumen * 100)} %</Text>
          ) : resta != null ? (
            <Text accessibilityLabel={`Se apaga en ${Math.ceil(resta / 60)} minutos`} style={estilos.pildora}>Se apaga en {reloj(resta)}</Text>
          ) : null}
        </View>

        <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 }}>
          <Animated.View key={`t-${tipo}`} entering={FadeIn.duration(600)} pointerEvents="none" style={{ alignItems: 'center', gap: 4 }}>
            <Text accessibilityRole="header" style={{ fontSize: 44, fontWeight: '800', letterSpacing: -1, color: BLANCO,
              textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 16 }}>{x.nombre}</Text>
            <Text style={{ fontSize: 16, fontWeight: '600', color: 'rgba(255,255,255,0.8)' }}>{x.detalle}</Text>
          </Animated.View>
          <BotonPlay sonando={sonando} preparando={preparando} acento={x.acento} alTocar={alternar} />
          {sonando || pausado ? (
            <Tocable etiqueta="Detener" alTocar={detener} estilo={{ borderRadius: 999 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.25)' }}>
                <Icono sf="stop.fill" respaldo="■" tam={13} color={BLANCO} />
                <Text style={{ fontSize: 14, fontWeight: '800', color: BLANCO }}>{pausado ? 'En pausa · Detener' : 'Detener'}</Text>
              </View>
            </Tocable>
          ) : null}
          {ruidoDisponible() ? (
            <Text pointerEvents="none" style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
              Desliza hacia arriba o hacia abajo para el volumen
            </Text>
          ) : (
            <Text style={{ fontSize: 14, color: BLANCO, textAlign: 'center' }}>Este teléfono no puede reproducir los sonidos de fondo.</Text>
          )}
        </View>

        {/* Abajo, en vidrio: los lugares y el temporizador. */}
        <BlurView intensity={30} tint="dark" style={{ marginHorizontal: 12, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' }}>
          <View style={{ paddingVertical: 14, gap: 12, backgroundColor: 'rgba(0,0,0,0.18)' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
              accessibilityRole="radiogroup">
              {Object.keys(SONIDOS).map((id) => (
                <Orbe key={id} id={id} activo={id === tipo} sonando={sonando} alTocar={() => elegir(id)} />
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, flexWrap: 'wrap' }}
              accessibilityRole="radiogroup" accessibilityLabel="Apagar en">
              <Icono sf="timer" respaldo="" tam={15} color="rgba(255,255,255,0.7)" />
              {MINUTOS.map((m) => {
                const activo = m === minutos;
                return (
                  <Tocable key={m} etiqueta={m ? `Apagar en ${m} minutos` : 'Sin límite'} alTocar={() => cambiarMinutos(m)} estilo={{ borderRadius: 999 }}>
                    <View accessibilityRole="radio" accessibilityState={{ selected: activo }}
                      style={{ minHeight: 36, minWidth: 44, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: activo ? BLANCO : 'rgba(255,255,255,0.1)' }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: activo ? '#111' : BLANCO }}>{m ? `${m} min` : '∞'}</Text>
                    </View>
                  </Tocable>
                );
              })}
            </View>
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const estilos = StyleSheet.create({
  anillo: { position: 'absolute', width: 104, height: 104, borderRadius: 52, borderWidth: 2 },
  pildora: { overflow: 'hidden', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.3)',
    fontSize: 14, fontWeight: '800', color: BLANCO },
});
