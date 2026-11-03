// Respira (Bienestar, 2026-11-03): un círculo que crece al inhalar, se queda
// al sostener y se achica al exhalar. 4 · 4 · 6 segundos: la exhalación más
// larga que la inhalación es lo que baja las pulsaciones. Un toque suave del
// teléfono marca cada cambio, para poder hacerlo con los ojos cerrados.
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Boton, Chip, Pantalla, Tarjeta } from '../componentes/ui';
import { useSinMovimiento } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { suave, useTema } from '../tema/tema';

const FASES = [
  { clave: 'inhala', texto: 'Inhala', ayuda: 'por la nariz', seg: 4, escala: 1 },
  { clave: 'sostén', texto: 'Sostén', ayuda: 'suave, sin apretar', seg: 4, escala: 1 },
  { clave: 'exhala', texto: 'Exhala', ayuda: 'lento, por la boca', seg: 6, escala: 0.55 },
];
const CICLO = FASES.reduce((s, f) => s + f.seg, 0);
const MINUTOS = [1, 3, 5];

// La pantalla no se apaga mientras se respira (sólo entonces).
function NoApagar() { useKeepAwake(); return null; }

export default function Respira() {
  const t = useTema();
  const quieta = useSinMovimiento();
  const [minutos, setMinutos] = useState(1);
  const [activo, setActivo] = useState(false);
  const [fase, setFase] = useState(-1);
  const [ciclos, setCiclos] = useState(0);
  const [terminado, setTerminado] = useState(false);
  const escala = useSharedValue(0.55);
  const reloj = useRef(null);
  const total = Math.round((minutos * 60) / CICLO);

  const parar = () => {
    clearTimeout(reloj.current);
    cancelAnimation(escala);
    escala.value = withTiming(0.55, { duration: 600 });
    setActivo(false);
    setFase(-1);
  };

  useEffect(() => () => clearTimeout(reloj.current), []);

  const empezar = () => {
    setTerminado(false);
    setCiclos(0);
    setActivo(true);
    let n = 0;
    const paso = (i) => {
      if (i === 0 && n >= total) { parar(); setTerminado(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); return; }
      const f = FASES[i];
      setFase(i);
      Haptics.impactAsync(i === 1 ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      escala.value = withTiming(f.escala, { duration: f.seg * 1000, easing: Easing.inOut(Easing.sin) });
      reloj.current = setTimeout(() => {
        if (i === FASES.length - 1) { n += 1; setCiclos(n); }
        paso((i + 1) % FASES.length);
      }, f.seg * 1000);
    };
    paso(0);
  };

  const circulo = useAnimatedStyle(() => (quieta
    ? { opacity: 0.45 + (escala.value - 0.55) * 1.2 }
    : { transform: [{ scale: escala.value }] }));
  const f = fase >= 0 ? FASES[fase] : null;
  const colores = [t.acentos.azul.fuerte, t.acentos.violeta.fuerte];

  return (
    <Pantalla conPestanas={false} conBurbuja={false}>
      {activo ? <NoApagar /> : null}
      <View style={{ alignItems: 'center', justifyContent: 'center', height: 340 }}>
        {/* El halo fijo marca hasta dónde llega el círculo al inhalar. */}
        <View style={{ position: 'absolute', width: 300, height: 300, borderRadius: 150, borderWidth: 2, borderColor: suave(colores[0], 0.25) }} />
        <Animated.View style={[{ width: 300, height: 300, borderRadius: 150, overflow: 'hidden' }, circulo]}>
          <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }} />
        </Animated.View>
        <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', gap: 4 }}>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 34, fontWeight: '800', color: '#FFFFFF' }}>
            {f ? f.texto : terminado ? '¡Bien hecho!' : 'Respira'}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: 'rgba(255,255,255,0.88)' }}>
            {f ? `${f.ayuda} · ${f.seg} s` : terminado ? `${ciclos} respiraciones` : 'cuando estés listo'}
          </Text>
        </View>
      </View>

      {activo ? (
        <Text style={{ textAlign: 'center', fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>
          Respiración {Math.min(ciclos + 1, total)} de {total}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
          {MINUTOS.map((m) => <Chip key={m} texto={`${m} min`} activo={minutos === m} alTocar={() => setMinutos(m)} />)}
        </View>
      )}

      <Boton tipo={activo ? 'secundario' : 'principal'} alTocar={activo ? parar : empezar}>
        {activo ? 'Detener' : terminado ? 'Otra vez' : 'Empezar'}
      </Boton>

      <Tarjeta>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>
          Siéntate cómodo, apoya los pies en el suelo y relaja los hombros. Si te mareas, vuelve a respirar normal: no hay que forzar nada.
        </Text>
      </Tarjeta>
    </Pantalla>
  );
}
